import { Controller, Inject, Logger } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';
import { InjectRepository } from '@nestjs/typeorm';
import * as crypto from 'crypto';
import { Repository } from 'typeorm';
import {
  KafkaTopics,
  type ChatMessageSendCommand,
  type ChatMessageCreatedEvent,
  type ChatMessageEditCommand,
  type ChatMessageUpdatedEvent,
  type ChatMessageDeleteCommand,
  type ChatMessageDeletedEvent,
  type ChatReactionAddCommand,
  type ChatReactionAddedEvent,
  type ChatReactionRemoveCommand,
  type ChatReactionRemovedEvent,
  type ChatMessageForwardCommand,
  type NotificationRequestedEvent,
  NotificationType,
  AiModerationRequestEvent,
  type AiModerationResultEvent,
  type AiModerationEnforcementEvent,
  type ModerationEnforcementOutcomeType,
  type ModerationEnforcementReasonType,
  type ModerationLabelType,
} from '@libs/contracts';
import { APP_CONFIG, type AppConfig } from '@libs/config';
import { MessageRepository } from '@libs/scylla';
import { CacheService, CACHE_LOCK_RENEW_STATUS } from '@libs/redis';
import { ConversationMembershipService } from '@libs/mvp-access';
import { User, ConversationMember } from '@libs/database';
import { ChatPublisher } from '../services/chat.publisher';
import {
  getConversationMemberIds,
  getUserDisplayName,
} from '../utils/notification.helper';
import {
  ensureConversationAccess,
  ensureMessageOwnership,
} from '../utils/access.helper';

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

@Controller()
export class PersistMessageConsumer {
  private readonly logger = new Logger(PersistMessageConsumer.name);
  private readonly moderationDeleteEventLockTtlSeconds: number;
  private readonly moderationWarnOnly: boolean;
  private readonly moderationEnforceMinConfidence: number;
  private readonly moderationHighRiskLabels: ReadonlySet<ModerationLabelType>;
  private readonly consistencyCounters: Record<
    'duplicate' | 'replay' | 'timestamp_mismatch',
    number
  > = {
    duplicate: 0,
    replay: 0,
    timestamp_mismatch: 0,
  };

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly repo: MessageRepository,
    private readonly publisher: ChatPublisher,
    private readonly cacheService: CacheService,
    private readonly membershipService: ConversationMembershipService,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(ConversationMember)
    private readonly conversationMemberRepo: Repository<ConversationMember>,
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

  @EventPattern(KafkaTopics.ChatMessageSend)
  async onSend(@Payload() payload: ChatMessageSendCommand) {
    const startTime = Date.now();
    const createdAt =
      Number.isFinite(payload.sent_at) && payload.sent_at > 0
        ? payload.sent_at
        : startTime;
    const traceId = payload.trace_id || `trace-${Date.now()}-${Math.random()}`;

    this.logger.debug(`[${traceId}] ChatMessageSend started`, {
      messageId: payload.message_id,
      conversationId: payload.conversation_id,
      senderId: payload.sender_id,
    });

    try {
      const hasAccess = await ensureConversationAccess({
        membershipService: this.membershipService,
        logger: this.logger,
        traceId,
        senderId: payload.sender_id,
        conversationId: payload.conversation_id,
        action: 'message',
        messageId: payload.message_id,
      });
      if (!hasAccess) {
        return;
      }

      const acquired = await this.repo.tryBeginMessageProcessing(
        payload.message_id,
        payload.conversation_id,
        createdAt,
      );
      if (!acquired) {
        const existingState = await this.repo.getMessageProcessingState(
          payload.message_id,
        );

        const existingCreatedAt = existingState?.created_at;
        const canonicalCreatedAt =
          typeof existingCreatedAt === 'number' ? existingCreatedAt : createdAt;
        const existingStatus = existingState?.status ?? 'unknown';
        const existingConversationId =
          existingState?.conversation_id ?? payload.conversation_id;

        if (
          typeof existingCreatedAt === 'number' &&
          existingCreatedAt !== createdAt
        ) {
          this.bumpConsistencyCounter('timestamp_mismatch', {
            traceId,
            messageId: payload.message_id,
            incomingCreatedAt: createdAt,
            existingCreatedAt,
          });
        }

        if (existingStatus === 'stored') {
          this.bumpConsistencyCounter('duplicate', {
            traceId,
            messageId: payload.message_id,
            status: existingStatus,
          });
          this.logger.debug(
            `[${traceId}] Message already processed (idempotent)`,
            {
              messageId: payload.message_id,
              status: existingStatus,
              canonicalCreatedAt,
            },
          );
          return;
        }

        if (existingStatus === 'pending') {
          const replayClaimed = await this.repo.tryClaimPendingReplay(
            payload.message_id,
          );
          if (!replayClaimed) {
            this.bumpConsistencyCounter('duplicate', {
              traceId,
              messageId: payload.message_id,
              status: 'replay_claim_conflict',
            });
            this.logger.debug(`[${traceId}] Replay claim already in progress`, {
              messageId: payload.message_id,
            });
            return;
          }

          try {
            const existingMessage = await this.repo.getMessage(
              existingConversationId,
              canonicalCreatedAt,
              payload.message_id,
            );

            if (!existingMessage) {
              this.logger.warn(
                `[${traceId}] Pending idempotency state has no persisted message`,
                {
                  messageId: payload.message_id,
                  conversationId: existingConversationId,
                  createdAt: canonicalCreatedAt,
                },
              );
              await this.repo.restoreMessageProcessingToPending(
                payload.message_id,
              );
              return;
            }

            const replayEvent: ChatMessageCreatedEvent = {
              message_id: existingMessage.message_id,
              conversation_id: existingMessage.conversation_id,
              sender_id: existingMessage.sender_id,
              body: existingMessage.body,
              created_at: existingMessage.created_at,
              attachments: existingMessage.attachments,
              reply_to_message_id: existingMessage.reply_to_message_id,
              trace_id: traceId,
            };

            await this.publisher.emit(
              KafkaTopics.ChatMessageCreated,
              replayEvent,
            );
            await this.repo.markMessageStored(payload.message_id);

            this.bumpConsistencyCounter('replay', {
              traceId,
              messageId: payload.message_id,
              status: 'pending_replay_emitted',
            });

            this.logger.warn(
              `[${traceId}] Replayed ChatMessageCreated from pending idempotency state`,
              {
                messageId: payload.message_id,
                conversationId: existingConversationId,
                createdAt: canonicalCreatedAt,
              },
            );

            await this.handlePostMessagePersist({
              conversationId: existingMessage.conversation_id,
              senderId: existingMessage.sender_id,
              body: existingMessage.body,
              messageId: existingMessage.message_id,
              createdAt: existingMessage.created_at,
              traceId,
            });

            return;
          } catch (replayError) {
            await this.repo
              .restoreMessageProcessingToPending(payload.message_id)
              .catch(() => {
                this.logger.error(
                  `[${traceId}] Failed to restore pending idempotency state after replay failure`,
                  {
                    messageId: payload.message_id,
                  },
                );
              });

            throw replayError;
          }
        }

        this.bumpConsistencyCounter('duplicate', {
          traceId,
          messageId: payload.message_id,
          status: existingStatus,
        });
        this.logger.warn(
          `[${traceId}] Skipping message with unknown idempotency state`,
          {
            messageId: payload.message_id,
            status: existingStatus,
          },
        );
        return;
      }

      let inserted = false;
      let eventEmitted = false;
      let stored = false;

      try {
        await this.repo.insertMessage({
          message_id: payload.message_id,
          conversation_id: payload.conversation_id,
          sender_id: payload.sender_id,
          body: payload.body,
          created_at: createdAt,
          attachments: payload.attachments,
          reply_to_message_id: payload.reply_to_message_id,
        });
        inserted = true;

        const event: ChatMessageCreatedEvent = {
          message_id: payload.message_id,
          conversation_id: payload.conversation_id,
          sender_id: payload.sender_id,
          body: payload.body,
          created_at: createdAt,
          attachments: payload.attachments,
          reply_to_message_id: payload.reply_to_message_id,
          trace_id: traceId,
        };

        await this.publisher.emit(KafkaTopics.ChatMessageCreated, event);
        eventEmitted = true;
        this.logger.log(`[${traceId}] ChatMessageCreated event emitted`, {
          messageId: payload.message_id,
        });

        await this.repo.markMessageStored(payload.message_id);
        stored = true;
      } catch (error) {
        if (!inserted) {
          await this.repo
            .clearMessageProcessing(payload.message_id)
            .catch(() => {
              this.logger.error(
                `[${traceId}] Failed to clear idempotency lock for message: ${payload.message_id}`,
              );
            });
        } else if (!eventEmitted) {
          this.bumpConsistencyCounter('replay', {
            traceId,
            messageId: payload.message_id,
            status: 'pending_replay_required',
          });
          this.logger.warn(
            `[${traceId}] Message persisted but event emission failed; pending replay on retry`,
            {
              messageId: payload.message_id,
            },
          );
        } else if (!stored) {
          this.bumpConsistencyCounter('replay', {
            traceId,
            messageId: payload.message_id,
            status: 'store_marker_retry_required',
          });
          this.logger.warn(
            `[${traceId}] Message event emitted but idempotency store marker was not finalized`,
            {
              messageId: payload.message_id,
            },
          );
        }
        throw error;
      }

      await this.handlePostMessagePersist({
        conversationId: payload.conversation_id,
        senderId: payload.sender_id,
        body: payload.body,
        messageId: payload.message_id,
        createdAt,
        traceId,
      });

      this.logger.log(`[${traceId}] ChatMessageSend completed`, {
        duration: Date.now() - startTime,
      });
    } catch (error) {
      this.logger.error(`[${traceId}] ChatMessageSend failed`, {
        messageId: payload.message_id,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw error;
    }
  }

  private async handlePostMessagePersist(params: {
    conversationId: string;
    senderId: string;
    body: string;
    messageId: string;
    createdAt: number;
    traceId: string;
  }): Promise<void> {
    await this.emitMessageNotification(
      params.conversationId,
      params.senderId,
      params.body,
      params.messageId,
      params.traceId,
    );

    // ── AI Moderation: auto-moderate every new message ──────────────
    void (async () => {
      try {
        const moderationEvent: AiModerationRequestEvent = {
          message_id: params.messageId,
          conversation_id: params.conversationId,
          sender_id: params.senderId,
          created_at: params.createdAt,
          body: params.body,
          requested_at: Date.now(),
          trace_id: params.traceId,
        };
        await this.publisher.emit(
          KafkaTopics.AiModerationRequest,
          moderationEvent,
        );
        this.logger.debug(
          `[${params.traceId}] AiModerationRequest emitted for message: ${params.messageId}`,
        );
      } catch (err) {
        this.logger.error(
          `[${params.traceId}] AiModerationRequest emit failed`,
          err,
        );
      }
    })();

    // ── Cache invalidation (fire-and-forget: non-blocking by design so the
    //    message-send critical path is not delayed by a Redis round-trip) ──────
    void (async () => {
      try {
        await this.cacheService.invalidateRecentMessages(params.conversationId);
        this.logger.debug(`[${params.traceId}] Cache invalidated`, {
          conversationId: params.conversationId,
        });
      } catch (err) {
        this.logger.error(`[${params.traceId}] Cache invalidation failed`, err);
      }
    })();
  }

  @EventPattern(KafkaTopics.AiModerationResult)
  async onModerationResult(@Payload() payload: AiModerationResultEvent) {
    if (!payload.is_flagged) {
      return;
    }

    const traceId = payload.trace_id || `mod:${payload.message_id}`;
    if (payload.decision_source !== 'model') {
      this.logger.warn(
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
      this.logger.warn(
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

    if (!this.isValidEpochTimestamp(payload.created_at)) {
      this.logPoisonPayload('AiModerationResult', traceId, {
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
          this.logger.error(
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
            this.logger.debug(
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

          this.logger.warn(
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
          this.logger.error(
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
          this.logger.debug(
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
        this.logger.warn(
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
        this.logger.debug(
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
              this.logger.warn(
                `[${traceId}] Moderation delete event lock renewal skipped`,
                {
                  messageId: payload.message_id,
                  conversationId: payload.conversation_id,
                },
              );
              return;
            }

            if (renewStatus === CACHE_LOCK_RENEW_STATUS.Error) {
              this.logger.warn(
                `[${traceId}] Moderation delete event lock renewal hit infra error`,
                {
                  messageId: payload.message_id,
                  conversationId: payload.conversation_id,
                },
              );
            }
          })
          .catch((renewError) => {
            this.logger.error(
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
        this.logger.warn(
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
        this.logger.error(
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
          this.logger.error(
            `[${traceId}] Moderation cache invalidation failed`,
            err,
          );
        });

      this.logger.warn(`[${traceId}] Message soft-deleted by moderation`, {
        messageId: payload.message_id,
        conversationId: payload.conversation_id,
        labels: payload.labels,
      });
    } catch (error) {
      await this.emitEnforcementOutcome(
        payload,
        traceId,
        'failed',
        failureReason ?? 'unexpected',
      );
      this.logger.error(`[${traceId}] Moderation enforcement failed`, {
        messageId: payload.message_id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      if (emitLockRenewTimer) {
        clearInterval(emitLockRenewTimer);
      }

      if (emitLockAcquired) {
        await this.cacheService
          .delIfValueMatches(deleteEmitLockKey, emitLockToken)
          .catch((lockErr) => {
            this.logger.error(
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
        this.bumpConsistencyCounter('replay', {
          traceId,
          context: 'enforcement_outcome_emit_failed',
          outcome,
        });
        this.logger.error(
          `[${traceId}] Failed to emit moderation enforcement outcome`,
          emitErrorStack,
        );
      });
  }

  private bumpConsistencyCounter(
    metric: 'duplicate' | 'replay' | 'timestamp_mismatch',
    fields: Record<string, unknown>,
  ): void {
    this.consistencyCounters[metric] += 1;
    this.logger.warn('[consistency-telemetry]', {
      metric,
      count: this.consistencyCounters[metric],
      ...fields,
    });
  }

  private getModerationDeleteEmitKey(
    conversationId: string,
    messageId: string,
  ): string {
    return `moderation:delete-event-emitted:${conversationId}:${messageId}`;
  }

  private isValidEpochTimestamp(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0;
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

  private isNonRetryableBindError(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return false;
    }

    return /Unexpected unset value for bind variable/i.test(error.message);
  }

  private logPoisonPayload(
    context: string,
    traceId: string,
    fields: Record<string, unknown>,
  ): void {
    this.bumpConsistencyCounter('replay', {
      traceId,
      context: `${context}_poison_payload`,
      ...fields,
    });
    this.logger.error(`[${traceId}] ${context} skipped poison payload`, fields);
  }

  @EventPattern(KafkaTopics.ChatMessageEdit)
  async onEdit(@Payload() payload: ChatMessageEditCommand) {
    const startTime = Date.now();
    const editedAt = payload.edited_at ?? startTime;
    const traceId = payload.trace_id || `trace-${Date.now()}-${Math.random()}`;
    const createdAt = payload.created_at;

    this.logger.debug(`[${traceId}] ChatMessageEdit started`, {
      messageId: payload.message_id,
      conversationId: payload.conversation_id,
      createdAt,
    });

    if (!this.isValidEpochTimestamp(createdAt)) {
      this.logPoisonPayload('ChatMessageEdit', traceId, {
        messageId: payload.message_id,
        conversationId: payload.conversation_id,
        createdAt,
        reason: 'missing_or_invalid_created_at',
      });
      return;
    }

    try {
      const hasAccess = await ensureConversationAccess({
        membershipService: this.membershipService,
        logger: this.logger,
        traceId,
        senderId: payload.sender_id,
        conversationId: payload.conversation_id,
        action: 'edit',
        messageId: payload.message_id,
      });
      if (!hasAccess) {
        return;
      }

      const isOwner = await ensureMessageOwnership({
        repo: this.repo,
        logger: this.logger,
        traceId,
        senderId: payload.sender_id,
        conversationId: payload.conversation_id,
        createdAt,
        messageId: payload.message_id,
        action: 'edit',
      });
      if (!isOwner) {
        return;
      }

      await this.repo.updateMessageBody(
        payload.conversation_id,
        createdAt,
        payload.message_id,
        payload.new_body,
        editedAt,
      );

      const event: ChatMessageUpdatedEvent = {
        message_id: payload.message_id,
        conversation_id: payload.conversation_id,
        sender_id: payload.sender_id,
        body: payload.new_body,
        edited_at: editedAt,
        trace_id: traceId,
      };

      await this.publisher.emit(KafkaTopics.ChatMessageUpdated, event);
      this.logger.log(`[${traceId}] ChatMessageUpdated event emitted`, {
        messageId: payload.message_id,
        duration: Date.now() - startTime,
      });

      await (async () => {
        try {
          await this.cacheService.invalidateRecentMessages(
            payload.conversation_id,
          );
        } catch (err) {
          this.logger.error(`[${traceId}] Cache invalidation failed`, err);
        }
      })();
    } catch (error) {
      if (this.isNonRetryableBindError(error)) {
        this.logPoisonPayload('ChatMessageEdit', traceId, {
          messageId: payload.message_id,
          conversationId: payload.conversation_id,
          createdAt,
          reason: 'non_retryable_bind_error',
          error: error instanceof Error ? error.message : String(error),
        });
        return;
      }

      this.logger.error(`[${traceId}] ChatMessageEdit failed`, {
        messageId: payload.message_id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  @EventPattern(KafkaTopics.ChatMessageDelete)
  async onDelete(@Payload() payload: ChatMessageDeleteCommand) {
    const startTime = Date.now();
    const deletedAt = payload.deleted_at ?? startTime;
    const traceId = payload.trace_id || `trace-${Date.now()}-${Math.random()}`;
    const createdAt = payload.created_at;

    this.logger.debug(`[${traceId}] ChatMessageDelete started`, {
      messageId: payload.message_id,
      conversationId: payload.conversation_id,
      createdAt,
    });

    if (!this.isValidEpochTimestamp(createdAt)) {
      this.logPoisonPayload('ChatMessageDelete', traceId, {
        messageId: payload.message_id,
        conversationId: payload.conversation_id,
        createdAt,
        reason: 'missing_or_invalid_created_at',
      });
      return;
    }

    try {
      const hasAccess = await ensureConversationAccess({
        membershipService: this.membershipService,
        logger: this.logger,
        traceId,
        senderId: payload.sender_id,
        conversationId: payload.conversation_id,
        action: 'delete',
        messageId: payload.message_id,
      });
      if (!hasAccess) {
        return;
      }

      const isOwner = await ensureMessageOwnership({
        repo: this.repo,
        logger: this.logger,
        traceId,
        senderId: payload.sender_id,
        conversationId: payload.conversation_id,
        createdAt,
        messageId: payload.message_id,
        action: 'delete',
      });
      if (!isOwner) {
        return;
      }

      await this.repo.softDeleteMessage(
        payload.conversation_id,
        createdAt,
        payload.message_id,
        deletedAt,
      );

      const event: ChatMessageDeletedEvent = {
        message_id: payload.message_id,
        conversation_id: payload.conversation_id,
        sender_id: payload.sender_id,
        deleted_at: deletedAt,
        trace_id: traceId,
      };

      await this.publisher.emit(KafkaTopics.ChatMessageDeleted, event);
      this.logger.log(`[${traceId}] ChatMessageDeleted event emitted`, {
        messageId: payload.message_id,
        duration: Date.now() - startTime,
      });

      await (async () => {
        try {
          await this.cacheService.invalidateRecentMessages(
            payload.conversation_id,
          );
        } catch (err) {
          this.logger.error(`[${traceId}] Cache invalidation failed`, err);
        }
      })();
    } catch (error) {
      if (this.isNonRetryableBindError(error)) {
        this.logPoisonPayload('ChatMessageDelete', traceId, {
          messageId: payload.message_id,
          conversationId: payload.conversation_id,
          createdAt,
          reason: 'non_retryable_bind_error',
          error: error instanceof Error ? error.message : String(error),
        });
        return;
      }

      this.logger.error(`[${traceId}] ChatMessageDelete failed`, {
        messageId: payload.message_id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  @EventPattern(KafkaTopics.ChatReactionAdd)
  async onReactionAdd(@Payload() payload: ChatReactionAddCommand) {
    const startTime = Date.now();
    const createdAt = payload.created_at ?? startTime;
    const traceId = payload.trace_id || `trace-${Date.now()}-${Math.random()}`;

    this.logger.debug(`[${traceId}] ChatReactionAdd started`, {
      messageId: payload.message_id,
      userId: payload.user_id,
      reaction: payload.reaction_type,
    });

    try {
      // Note: Race condition still exists here. Needs atomic upsert.
      await this.repo.addReaction({
        message_id: payload.message_id,
        user_id: payload.user_id,
        reaction_type: payload.reaction_type,
        created_at: createdAt,
      });

      const event: ChatReactionAddedEvent = {
        message_id: payload.message_id,
        conversation_id: payload.conversation_id,
        user_id: payload.user_id,
        reaction_type: payload.reaction_type,
        created_at: createdAt,
        trace_id: traceId,
      };

      await this.publisher.emit(KafkaTopics.ChatReactionAdded, event);
      this.logger.log(`[${traceId}] ChatReactionAdded event emitted`, {
        duration: Date.now() - startTime,
      });

      await this.emitMessageNotification(
        payload.conversation_id,
        payload.user_id,
        `Reacted with ${payload.reaction_type}`,
        payload.message_id,
        traceId,
      );
    } catch (error) {
      this.logger.error(`[${traceId}] ChatReactionAdd failed`, {
        messageId: payload.message_id,
        userId: payload.user_id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  @EventPattern(KafkaTopics.ChatReactionRemove)
  async onReactionRemove(@Payload() payload: ChatReactionRemoveCommand) {
    const startTime = Date.now();
    const traceId = payload.trace_id || `trace-${Date.now()}-${Math.random()}`;

    this.logger.debug(`[${traceId}] ChatReactionRemove started`, {
      messageId: payload.message_id,
      userId: payload.user_id,
    });

    try {
      await this.repo.removeReaction(payload.message_id, payload.user_id);

      const event: ChatReactionRemovedEvent = {
        message_id: payload.message_id,
        conversation_id: payload.conversation_id,
        user_id: payload.user_id,
        trace_id: traceId,
      };

      await this.publisher.emit(KafkaTopics.ChatReactionRemoved, event);
      this.logger.log(`[${traceId}] ChatReactionRemoved event emitted`, {
        duration: Date.now() - startTime,
      });
    } catch (error) {
      this.logger.error(`[${traceId}] ChatReactionRemove failed`, {
        messageId: payload.message_id,
        userId: payload.user_id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  @EventPattern(KafkaTopics.ChatMessageForward)
  async onForward(@Payload() payload: ChatMessageForwardCommand) {
    const startTime = Date.now();
    const createdAt =
      Number.isFinite(payload.sent_at) && payload.sent_at > 0
        ? payload.sent_at
        : startTime;
    const traceId = payload.trace_id || `trace-${Date.now()}-${Math.random()}`;

    this.logger.debug(`[${traceId}] ChatMessageForward started`, {
      messageId: payload.message_id,
      conversationId: payload.conversation_id,
      senderId: payload.sender_id,
      forwardId: payload.forward_id,
    });

    try {
      const hasAccess = await ensureConversationAccess({
        membershipService: this.membershipService,
        logger: this.logger,
        traceId,
        senderId: payload.sender_id,
        conversationId: payload.conversation_id,
        action: 'message',
        messageId: payload.message_id,
      });
      if (!hasAccess) {
        return;
      }

      const acquired = await this.repo.tryBeginMessageProcessing(
        payload.message_id,
        payload.conversation_id,
        createdAt,
      );
      if (!acquired) {
        const existingState = await this.repo.getMessageProcessingState(
          payload.message_id,
        );
        this.logger.debug(
          `[${traceId}] Forward message already processed (idempotent)`,
          {
            messageId: payload.message_id,
            status: existingState?.status ?? 'unknown',
          },
        );
        return;
      }

      await this.repo.insertMessage({
        message_id: payload.message_id,
        conversation_id: payload.conversation_id,
        sender_id: payload.sender_id,
        body: payload.body,
        created_at: createdAt,
        attachments: payload.attachments,
        forwarded_from: payload.forwarded_from,
      });

      const event: ChatMessageCreatedEvent = {
        message_id: payload.message_id,
        conversation_id: payload.conversation_id,
        sender_id: payload.sender_id,
        body: payload.body,
        created_at: createdAt,
        attachments: payload.attachments,
        forwarded_from: payload.forwarded_from,
        trace_id: traceId,
      };

      await this.publisher.emit(KafkaTopics.ChatMessageCreated, event);
      await this.repo.markMessageStored(payload.message_id);

      this.logger.log(`[${traceId}] ChatMessageForward completed`, {
        messageId: payload.message_id,
        duration: Date.now() - startTime,
      });

      await this.handlePostMessagePersist({
        conversationId: payload.conversation_id,
        senderId: payload.sender_id,
        body: payload.body,
        messageId: payload.message_id,
        createdAt,
        traceId,
      });
    } catch (error) {
      await this.repo.clearMessageProcessing(payload.message_id).catch(() => {
        this.logger.error(
          `[${traceId}] Failed to clear idempotency lock for forwarded message: ${payload.message_id}`,
        );
      });
      this.logger.error(`[${traceId}] ChatMessageForward failed`, {
        messageId: payload.message_id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  private async emitMessageNotification(
    conversationId: string,
    senderId: string,
    messageBody: string,
    messageId: string,
    traceId?: string,
  ): Promise<void> {
    const notificationTraceId = traceId || `trace-noti-${Date.now()}`;
    this.logger.debug(
      `[${notificationTraceId}] Emitting message notification`,
      {
        messageId,
        conversationId,
      },
    );

    try {
      const recipientIds = await getConversationMemberIds(
        this.conversationMemberRepo,
        conversationId,
      );
      const recipients = recipientIds.filter((id) => id !== senderId);

      if (recipients.length === 0) {
        this.logger.debug(
          `[${notificationTraceId}] No recipients for notification.`,
        );
        return;
      }

      const senderName = await getUserDisplayName(this.userRepo, senderId);
      const preview =
        messageBody.length > 100
          ? `${messageBody.substring(0, 100)}...`
          : messageBody;

      for (const recipientId of recipients) {
        const notification: NotificationRequestedEvent = {
          channel: 'push',
          user_id: recipientId,
          title: senderName || 'New message',
          body: preview,
          type: NotificationType.ChatMessage,
          data: {
            conversation_id: conversationId,
            message_id: messageId,
            sender_id: senderId,
          },
          rich: {
            priority: 'high',
            thread_id: conversationId,
            category: 'message',
          },
          requested_at: Date.now(),
          trace_id: notificationTraceId,
        };
        await this.publisher
          .emit(KafkaTopics.NotificationRequested, notification)
          .catch((err) =>
            this.logger.error(
              `[${notificationTraceId}] Failed to emit notification for ${recipientId}`,
              err,
            ),
          );
      }

      this.logger.log(
        `[${notificationTraceId}] Notifications emitted for ${recipients.length} recipients`,
        { messageId },
      );
    } catch (error) {
      this.logger.error(
        `[${notificationTraceId}] Failed to emit message notification`,
        {
          messageId,
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        },
      );
    }
  }
}
