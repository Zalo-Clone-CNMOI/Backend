import { Injectable, Inject } from '@nestjs/common';
import * as crypto from 'crypto';
import {
  KafkaTopics,
  type ChatMessageDeletedEvent,
  type AiModerationResultEvent,
  type AiModerationEnforcementEvent,
  type ModerationEnforcementOutcomeType,
  type ModerationEnforcementReasonType,
  type ModerationLabelType,
} from '@libs/contracts';
import { APP_CONFIG, type AppConfig } from '@libs/config';
import { MessageRepository } from '@libs/scylla';
import { CacheService, CACHE_LOCK_RENEW_STATUS } from '@libs/redis';
import { ChatPublisher } from '../services/chat.publisher';
import { MessageConsumerSharedService } from './message-consumer-shared.service';

const MODERATION_DELETE_EVENT_TTL_SECONDS = 86400;
const MODERATION_DELETE_EVENT_LOCK_TTL_SECONDS = 120;
const MIN_MODERATION_DELETE_EVENT_LOCK_TTL_SECONDS = 30;
const MAX_MODERATION_DELETE_EVENT_LOCK_TTL_SECONDS = 900;
const MIN_LOCK_RENEW_INTERVAL_MS = 5000;
const DEFAULT_HIGH_RISK_MODERATION_LABELS: ReadonlySet<ModerationLabelType> =
  new Set<ModerationLabelType>([
    'spam',
    'toxic',
    'harassment',
    'hate_speech',
    'sexual',
    'violence',
    'self_harm',
  ]);

@Injectable()
export class ModerationResultHandler {
  private readonly moderationDeleteEventLockTtlSeconds: number;
  private readonly moderationWarnOnly: boolean;
  private readonly moderationEnforceMinConfidence: number;
  private readonly moderationHighRiskLabels: ReadonlySet<ModerationLabelType>;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly repo: MessageRepository,
    private readonly publisher: ChatPublisher,
    private readonly cacheService: CacheService,
    private readonly shared: MessageConsumerSharedService,
  ) {
    this.moderationWarnOnly = this.config.chatModerationWarnOnly === true;
    this.moderationEnforceMinConfidence =
      this.config.chatModerationEnforceMinConfidence ?? 0.8;

    const configuredHighRiskLabels =
      this.config.chatModerationHighRiskLabels?.filter(
        (label): label is ModerationLabelType =>
          DEFAULT_HIGH_RISK_MODERATION_LABELS.has(label as ModerationLabelType),
      ) ?? [];

    this.moderationHighRiskLabels =
      configuredHighRiskLabels.length > 0
        ? new Set<ModerationLabelType>(configuredHighRiskLabels)
        : DEFAULT_HIGH_RISK_MODERATION_LABELS;

    const configuredTtl = this.config.chatModerationDeleteLockTtlSeconds;
    if (configuredTtl === undefined || !Number.isFinite(configuredTtl)) {
      this.moderationDeleteEventLockTtlSeconds =
        MODERATION_DELETE_EVENT_LOCK_TTL_SECONDS;
      return;
    }

    const normalizedTtl = Math.trunc(configuredTtl);
    this.moderationDeleteEventLockTtlSeconds = Math.min(
      Math.max(normalizedTtl, MIN_MODERATION_DELETE_EVENT_LOCK_TTL_SECONDS),
      MAX_MODERATION_DELETE_EVENT_LOCK_TTL_SECONDS,
    );
  }

  async handle(payload: AiModerationResultEvent): Promise<void> {
    if (!payload.is_flagged) {
      return;
    }

    const traceId = payload.trace_id || `mod:${payload.message_id}`;
    if (payload.decision_source !== 'model') {
      this.shared.logger.warn(
        `[${traceId}] Skipping moderation enforcement for fallback decision source`,
        {
          messageId: payload.message_id,
          conversationId: payload.conversation_id,
          decisionSource: payload.decision_source,
          failureReason: payload.failure_reason,
        },
      );
      await this.emitEnforcementOutcome(
        payload,
        traceId,
        'not_flagged',
        'fallback_decision_source',
        'none',
      );
      return;
    }

    const enforcementSkipReason = this.getPolicySkipReason(payload);
    if (enforcementSkipReason) {
      this.shared.logger.warn(
        `[${traceId}] Moderation enforcement skipped by policy`,
        {
          messageId: payload.message_id,
          conversationId: payload.conversation_id,
          reason: enforcementSkipReason,
          confidence: payload.confidence,
          labels: payload.labels,
          threshold: this.moderationEnforceMinConfidence,
          warnOnly: this.moderationWarnOnly,
        },
      );
      await this.emitEnforcementOutcome(
        payload,
        traceId,
        'not_flagged',
        enforcementSkipReason,
        'none',
      );
      return;
    }

    if (!this.shared.isValidEpochTimestamp(payload.created_at)) {
      this.shared.logPoisonPayload('AiModerationResult', traceId, {
        messageId: payload.message_id,
        conversationId: payload.conversation_id,
        createdAt: payload.created_at,
        reason: 'missing_or_invalid_created_at',
      });
      return;
    }

    const deletedAt = Date.now();
    const deleteEmitKey = this.getModerationDeleteEmitKey(
      payload.conversation_id,
      payload.message_id,
    );
    const deleteEmitLockKey = `${deleteEmitKey}:lock`;
    let effectiveDeletedAt = deletedAt;
    let shouldEmitDeleteEvent = false;
    let deletedPreviously = false;
    let emitLockAcquired = false;
    let emitLockToken = '';
    let emitLockRenewTimer: NodeJS.Timeout | null = null;
    let failureReason: ModerationEnforcementReasonType | null = null;

    try {
      const applied = await this.repo.trySoftDeleteMessage(
        payload.conversation_id,
        payload.created_at,
        payload.message_id,
        deletedAt,
      );

      if (!applied) {
        const message = await this.repo.getMessage(
          payload.conversation_id,
          payload.created_at,
          payload.message_id,
        );

        if (!message) {
          failureReason = 'message_not_found';
          this.shared.logger.error(
            `[${traceId}] Moderation enforcement failed: message not found`,
            {
              messageId: payload.message_id,
              conversationId: payload.conversation_id,
              createdAt: payload.created_at,
            },
          );
          throw new Error('Moderation target message not found');
        }

        if (message.deleted_at) {
          effectiveDeletedAt = message.deleted_at;
          deletedPreviously = true;

          const alreadyEmitted =
            await this.cacheService.get<boolean>(deleteEmitKey);
          if (alreadyEmitted) {
            this.shared.logger.debug(
              `[${traceId}] Moderation result deduplicated: delete event already emitted`,
              {
                messageId: payload.message_id,
                conversationId: payload.conversation_id,
                deletedAt: message.deleted_at,
              },
            );
            await this.emitEnforcementOutcome(
              payload,
              traceId,
              'deduplicated',
              'delete_event_already_emitted',
            );
            return;
          }

          this.shared.logger.warn(
            `[${traceId}] Retrying delete event emit for previously deleted message`,
            {
              messageId: payload.message_id,
              conversationId: payload.conversation_id,
              deletedAt: message.deleted_at,
            },
          );

          shouldEmitDeleteEvent = true;
        } else {
          failureReason = 'conditional_delete_not_applied';
          this.shared.logger.error(
            `[${traceId}] Moderation enforcement failed: conditional delete not applied`,
            {
              messageId: payload.message_id,
              conversationId: payload.conversation_id,
            },
          );
          throw new Error('Moderation conditional delete was not applied');
        }
      } else {
        shouldEmitDeleteEvent = true;
      }

      if (!shouldEmitDeleteEvent) {
        return;
      }

      emitLockToken = crypto.randomUUID();
      emitLockAcquired = await this.cacheService.setIfAbsent(
        deleteEmitLockKey,
        emitLockToken,
        this.moderationDeleteEventLockTtlSeconds,
      );

      if (!emitLockAcquired) {
        const alreadyEmitted =
          await this.cacheService.get<boolean>(deleteEmitKey);
        if (alreadyEmitted) {
          this.shared.logger.debug(
            `[${traceId}] Moderation result deduplicated after lock contention`,
            {
              messageId: payload.message_id,
              conversationId: payload.conversation_id,
            },
          );
          await this.emitEnforcementOutcome(
            payload,
            traceId,
            'deduplicated',
            'delete_event_already_emitted_after_lock_contention',
          );
          return;
        }

        failureReason = 'delete_emit_lock_busy';
        this.shared.logger.warn(
          `[${traceId}] Moderation delete event emit lock is busy`,
          {
            messageId: payload.message_id,
            conversationId: payload.conversation_id,
          },
        );
        throw new Error('Moderation delete event emit lock busy');
      }

      const alreadyEmittedAfterLock =
        await this.cacheService.get<boolean>(deleteEmitKey);
      if (alreadyEmittedAfterLock) {
        this.shared.logger.debug(
          `[${traceId}] Moderation result deduplicated: delete event already emitted`,
          {
            messageId: payload.message_id,
            conversationId: payload.conversation_id,
          },
        );
        await this.emitEnforcementOutcome(
          payload,
          traceId,
          'deduplicated',
          'delete_event_already_emitted_after_lock_acquired',
        );
        return;
      }

      const lockRenewIntervalMs = Math.max(
        MIN_LOCK_RENEW_INTERVAL_MS,
        Math.floor(this.moderationDeleteEventLockTtlSeconds * 1000 * 0.5),
      );

      emitLockRenewTimer = setInterval(() => {
        if (!emitLockAcquired) {
          return;
        }

        void this.cacheService
          .expireIfValueMatches(
            deleteEmitLockKey,
            emitLockToken,
            this.moderationDeleteEventLockTtlSeconds,
          )
          .then((renewStatus) => {
            if (
              renewStatus === CACHE_LOCK_RENEW_STATUS.Mismatch &&
              emitLockRenewTimer
            ) {
              clearInterval(emitLockRenewTimer);
              emitLockRenewTimer = null;
              this.shared.logger.warn(
                `[${traceId}] Moderation delete event lock renewal skipped`,
                {
                  messageId: payload.message_id,
                  conversationId: payload.conversation_id,
                },
              );
              return;
            }

            if (renewStatus === CACHE_LOCK_RENEW_STATUS.Error) {
              this.shared.logger.warn(
                `[${traceId}] Moderation delete event lock renewal hit infra error`,
                {
                  messageId: payload.message_id,
                  conversationId: payload.conversation_id,
                },
              );
            }
          })
          .catch((renewError) => {
            this.shared.logger.error(
              `[${traceId}] Moderation delete event lock renewal failed`,
              renewError,
            );
          });
      }, lockRenewIntervalMs);

      const lockRenewStatusBeforeEmit =
        await this.cacheService.expireIfValueMatches(
          deleteEmitLockKey,
          emitLockToken,
          this.moderationDeleteEventLockTtlSeconds,
        );
      if (lockRenewStatusBeforeEmit === CACHE_LOCK_RENEW_STATUS.Mismatch) {
        failureReason = 'delete_emit_lock_lost_before_publish';
        this.shared.logger.warn(
          `[${traceId}] Moderation delete event lock lost before publish`,
          {
            messageId: payload.message_id,
            conversationId: payload.conversation_id,
          },
        );
        throw new Error(
          'Moderation delete event emit lock lost before publish',
        );
      }

      if (lockRenewStatusBeforeEmit === CACHE_LOCK_RENEW_STATUS.Error) {
        failureReason = 'delete_emit_lock_renewal_failed';
        this.shared.logger.error(
          `[${traceId}] Moderation delete event lock renewal failed before publish`,
          {
            messageId: payload.message_id,
            conversationId: payload.conversation_id,
          },
        );
        throw new Error('Moderation delete event emit lock renewal failed');
      }

      const event: ChatMessageDeletedEvent = {
        message_id: payload.message_id,
        conversation_id: payload.conversation_id,
        sender_id: payload.sender_id,
        deleted_at: effectiveDeletedAt,
        trace_id: traceId,
      };

      failureReason = 'chat_message_deleted_emit_failed';
      await this.publisher.emit(KafkaTopics.ChatMessageDeleted, event);

      failureReason = 'dedup_marker_write_failed';
      await this.cacheService.set(
        deleteEmitKey,
        true,
        MODERATION_DELETE_EVENT_TTL_SECONDS,
      );

      failureReason = null;
      await this.emitEnforcementOutcome(
        payload,
        traceId,
        deletedPreviously ? 'already_deleted' : 'deleted',
        deletedPreviously
          ? 'message_was_already_deleted'
          : 'conditional_delete_applied',
      );

      await this.cacheService
        .invalidateRecentMessages(payload.conversation_id)
        .catch((err) => {
          this.shared.logger.error(
            `[${traceId}] Moderation cache invalidation failed`,
            err,
          );
        });

      this.shared.logger.warn(
        `[${traceId}] Message soft-deleted by moderation`,
        {
          messageId: payload.message_id,
          conversationId: payload.conversation_id,
          labels: payload.labels,
        },
      );
    } catch (error) {
      await this.emitEnforcementOutcome(
        payload,
        traceId,
        'failed',
        failureReason ?? 'unexpected',
      );
      this.shared.logger.error(
        `[${traceId}] Moderation enforcement failed`,
        {
          messageId: payload.message_id,
          error: error instanceof Error ? error.message : String(error),
        },
      );
      throw error;
    } finally {
      if (emitLockRenewTimer) {
        clearInterval(emitLockRenewTimer);
      }

      if (emitLockAcquired) {
        await this.cacheService
          .delIfValueMatches(deleteEmitLockKey, emitLockToken)
          .catch((lockErr) => {
            this.shared.logger.error(
              `[${traceId}] Failed to release moderation delete emit lock`,
              lockErr,
            );
          });
      }
    }
  }

  private async emitEnforcementOutcome(
    payload: AiModerationResultEvent,
    traceId: string,
    outcome: ModerationEnforcementOutcomeType,
    reason?: ModerationEnforcementReasonType,
    action: 'none' | 'soft_delete' = 'soft_delete',
  ): Promise<void> {
    const enforcementEvent: AiModerationEnforcementEvent = {
      message_id: payload.message_id,
      conversation_id: payload.conversation_id,
      sender_id: payload.sender_id,
      created_at: payload.created_at,
      is_flagged: payload.is_flagged,
      labels: payload.labels,
      confidence: payload.confidence,
      provider: payload.provider,
      action,
      outcome,
      reason,
      enforced_at: Date.now(),
      trace_id: traceId,
    };

    await this.publisher
      .emit(KafkaTopics.AiModerationEnforcement, enforcementEvent)
      .catch((emitErr) => {
        const emitErrorStack =
          emitErr instanceof Error
            ? (emitErr.stack ?? emitErr.message)
            : String(emitErr);
        // Fix [2]: bump telemetry so a Kafka failure here is not silently lost
        this.shared.bumpConsistencyCounter('replay', {
          traceId,
          context: 'enforcement_outcome_emit_failed',
          outcome,
        });
        this.shared.logger.error(
          `[${traceId}] Failed to emit moderation enforcement outcome`,
          emitErrorStack,
        );
      });
  }

  private getModerationDeleteEmitKey(
    conversationId: string,
    messageId: string,
  ): string {
    return `moderation:delete-event-emitted:${conversationId}:${messageId}`;
  }

  private hasHighRiskLabel(labels: ModerationLabelType[]): boolean {
    return labels.some((label) => this.moderationHighRiskLabels.has(label));
  }

  private getPolicySkipReason(
    payload: AiModerationResultEvent,
  ): Extract<
    ModerationEnforcementReasonType,
    'warn_only_mode' | 'below_confidence_threshold' | 'label_not_high_risk'
  > | null {
    if (this.moderationWarnOnly) {
      return 'warn_only_mode';
    }

    if (payload.confidence < this.moderationEnforceMinConfidence) {
      return 'below_confidence_threshold';
    }

    if (!this.hasHighRiskLabel(payload.labels)) {
      return 'label_not_high_risk';
    }

    return null;
  }
}
