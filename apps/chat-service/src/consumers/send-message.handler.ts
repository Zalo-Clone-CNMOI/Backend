import { Injectable } from '@nestjs/common';
import {
  KafkaTopics,
  type ChatMessageSendCommand,
  type ChatMessageCreatedEvent,
  AiModerationRequestEvent,
  AiEntityDetectionRequestEvent,
} from '@libs/contracts';
import { MessageRepository } from '@libs/scylla';
import { CacheService } from '@libs/redis';
import { ConversationMembershipService } from '@libs/mvp-access';
import { ChatPublisher } from '../services/chat.publisher';
import { ensureConversationAccess } from '../utils/access.helper';
import { MessageConsumerSharedService } from './message-consumer-shared.service';

@Injectable()
export class SendMessageHandler {
  constructor(
    private readonly repo: MessageRepository,
    private readonly publisher: ChatPublisher,
    private readonly cacheService: CacheService,
    private readonly membershipService: ConversationMembershipService,
    private readonly shared: MessageConsumerSharedService,
  ) {}

  async handle(payload: ChatMessageSendCommand): Promise<void> {
    const startTime = Date.now();
    const createdAt =
      Number.isFinite(payload.sent_at) && payload.sent_at > 0
        ? payload.sent_at
        : startTime;
    const traceId = payload.trace_id || `trace-${Date.now()}-${Math.random()}`;

    this.shared.logger.debug(`[${traceId}] ChatMessageSend started`, {
      messageId: payload.message_id,
      conversationId: payload.conversation_id,
      senderId: payload.sender_id,
    });

    try {
      const hasAccess = await ensureConversationAccess({
        membershipService: this.membershipService,
        logger: this.shared.logger,
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
          this.shared.bumpConsistencyCounter('timestamp_mismatch', {
            traceId,
            messageId: payload.message_id,
            incomingCreatedAt: createdAt,
            existingCreatedAt,
          });
        }

        if (existingStatus === 'stored') {
          this.shared.bumpConsistencyCounter('duplicate', {
            traceId,
            messageId: payload.message_id,
            status: existingStatus,
          });
          this.shared.logger.debug(
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
            this.shared.bumpConsistencyCounter('duplicate', {
              traceId,
              messageId: payload.message_id,
              status: 'replay_claim_conflict',
            });
            this.shared.logger.debug(
              `[${traceId}] Replay claim already in progress`,
              {
                messageId: payload.message_id,
              },
            );
            return;
          }

          try {
            const existingMessage = await this.repo.getMessage(
              existingConversationId,
              canonicalCreatedAt,
              payload.message_id,
            );

            if (!existingMessage) {
              this.shared.logger.warn(
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

            this.shared.bumpConsistencyCounter('replay', {
              traceId,
              messageId: payload.message_id,
              status: 'pending_replay_emitted',
            });

            this.shared.logger.warn(
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
                this.shared.logger.error(
                  `[${traceId}] Failed to restore pending idempotency state after replay failure`,
                  {
                    messageId: payload.message_id,
                  },
                );
              });

            throw replayError;
          }
        }

        this.shared.bumpConsistencyCounter('duplicate', {
          traceId,
          messageId: payload.message_id,
          status: existingStatus,
        });
        this.shared.logger.warn(
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
        this.shared.logger.log(
          `[${traceId}] ChatMessageCreated event emitted`,
          {
            messageId: payload.message_id,
          },
        );

        await this.repo.markMessageStored(payload.message_id);
        stored = true;
      } catch (error) {
        if (!inserted) {
          await this.repo
            .clearMessageProcessing(payload.message_id)
            .catch(() => {
              this.shared.logger.error(
                `[${traceId}] Failed to clear idempotency lock for message: ${payload.message_id}`,
              );
            });
        } else if (!eventEmitted) {
          this.shared.bumpConsistencyCounter('replay', {
            traceId,
            messageId: payload.message_id,
            status: 'pending_replay_required',
          });
          this.shared.logger.warn(
            `[${traceId}] Message persisted but event emission failed; pending replay on retry`,
            {
              messageId: payload.message_id,
            },
          );
        } else if (!stored) {
          this.shared.bumpConsistencyCounter('replay', {
            traceId,
            messageId: payload.message_id,
            status: 'store_marker_retry_required',
          });
          this.shared.logger.warn(
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

      this.shared.logger.log(`[${traceId}] ChatMessageSend completed`, {
        duration: Date.now() - startTime,
      });
    } catch (error) {
      this.shared.logger.error(`[${traceId}] ChatMessageSend failed`, {
        messageId: payload.message_id,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw error;
    }
  }

  async handlePostMessagePersist(params: {
    conversationId: string;
    senderId: string;
    body: string;
    messageId: string;
    createdAt: number;
    traceId: string;
  }): Promise<void> {
    await this.shared.emitMessageNotification(
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
        this.shared.logger.debug(
          `[${params.traceId}] AiModerationRequest emitted for message: ${params.messageId}`,
        );
      } catch (err) {
        this.shared.logger.error(
          `[${params.traceId}] AiModerationRequest emit failed`,
          err,
        );
      }
    })();

    // ── AI Entity Detection: detect named entities in text messages ─
    if (params.body?.trim()) {
      void (async () => {
        try {
          const entityEvent: AiEntityDetectionRequestEvent = {
            message_id: params.messageId,
            conversation_id: params.conversationId,
            sender_id: params.senderId,
            body: params.body,
            created_at: params.createdAt,
            trace_id: params.traceId,
          };
          await this.publisher.emit(
            KafkaTopics.AiEntityDetectionRequest,
            entityEvent,
          );
          this.shared.logger.debug(
            `[${params.traceId}] AiEntityDetectionRequest emitted for message: ${params.messageId}`,
          );
        } catch (err) {
          this.shared.logger.error(
            `[${params.traceId}] AiEntityDetectionRequest emit failed`,
            err,
          );
        }
      })();
    }

    // ── Cache invalidation (fire-and-forget: non-blocking by design so the
    //    message-send critical path is not delayed by a Redis round-trip) ──────
    void (async () => {
      try {
        await this.cacheService.invalidateRecentMessages(params.conversationId);
        this.shared.logger.debug(`[${params.traceId}] Cache invalidated`, {
          conversationId: params.conversationId,
        });
      } catch (err) {
        this.shared.logger.error(
          `[${params.traceId}] Cache invalidation failed`,
          err,
        );
      }
    })();
  }
}
