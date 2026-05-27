import { Inject, Injectable } from '@nestjs/common';
import {
  KafkaTopics,
  type ChatMessageSendCommand,
  type ChatMessageCreatedEvent,
  type ChatMessageRejectedEvent,
  type MessageMention,
  type MessageAttachment,
  AiModerationRequestEvent,
  AiEntityDetectionRequestEvent,
  type AiZaiChatRequestEvent,
  type AiZaiImageRef,
} from '@libs/contracts';
import { MessageRepository } from '@libs/scylla';
import { CacheService } from '@libs/redis';
import { ConversationMembershipService } from '@libs/mvp-access';
import { APP_CONFIG, AppConfig } from '@libs/config';
import { ChatPublisher } from '../services/chat.publisher';
import { PreSendModerationService } from '../services/pre-send-moderation.service';
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
    private readonly preSendModerationService: PreSendModerationService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
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

      // ── Pre-send moderation gate (Phase 5) ───────────────────────────
      // Body-truthy check mirrors the existing entity-detection guard:
      // media-only messages cannot be moderated and would waste an LLM
      // call. convType comes from the same accessCache populated by
      // hasAccess — no extra DB roundtrip on the critical path.
      if (payload.body?.trim()) {
        const convType = await this.membershipService.getCachedConversationType(
          payload.sender_id,
          payload.conversation_id,
        );

        const blocked = await this.preSendModerationService.checkOrAllow({
          senderId: payload.sender_id,
          conversationId: payload.conversation_id,
          body: payload.body,
          conversationType: convType,
          traceId,
        });

        if (blocked) {
          const rejectedEvent: ChatMessageRejectedEvent = {
            message_id: payload.message_id,
            conversation_id: payload.conversation_id,
            sender_id: payload.sender_id,
            reason: blocked.reason,
            labels: blocked.labels,
            confidence: blocked.confidence,
            rejected_at: Date.now(),
            trace_id: traceId,
          };
          await this.publisher.emit(
            KafkaTopics.ChatMessageRejected,
            rejectedEvent,
          );
          // Rich audit log — sender, conv, labels, confidence, bodyHash for
          // correlation with cache logs. NEVER includes payload.body
          // (privacy).
          this.shared.logger.log(
            `[${traceId}] Pre-send moderation blocked message`,
            {
              messageId: payload.message_id,
              senderId: payload.sender_id,
              conversationId: payload.conversation_id,
              convType: convType ?? 'unknown',
              labels: blocked.labels,
              confidence: blocked.confidence,
              bodyHash: blocked.bodyHash,
            },
          );
          // No insertMessage, no idempotency lock claimed.
          return;
        }
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
              mentions: payload.mentions,
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
              mentions: payload.mentions,
              attachments: existingMessage.attachments,
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

        // Persist mentions (idempotent — Scylla upsert).
        // insertMentions never throws; partial failures are logged for replay.
        if (payload.mentions && payload.mentions.length > 0) {
          await this.repo.insertMentions({
            message_id: payload.message_id,
            conversation_id: payload.conversation_id,
            sender_id: payload.sender_id,
            created_at: createdAt,
            mentions: payload.mentions,
          });
        }

        const event: ChatMessageCreatedEvent = {
          message_id: payload.message_id,
          conversation_id: payload.conversation_id,
          sender_id: payload.sender_id,
          body: payload.body,
          created_at: createdAt,
          attachments: payload.attachments,
          reply_to_message_id: payload.reply_to_message_id,
          mentions: payload.mentions,
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
        mentions: payload.mentions,
        attachments: payload.attachments,
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
    // Forwarded to emitMessageNotification for branched
    // (Mention vs ChatMessage) notification fanout.
    mentions?: MessageMention[];
    // Attachments on the message — image ones are forwarded to Zai for vision.
    attachments?: MessageAttachment[];
  }): Promise<void> {
    await this.shared.emitMessageNotification(
      params.conversationId,
      params.senderId,
      params.body,
      params.messageId,
      params.traceId,
      params.mentions,
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

    // ── Zai Chat: route messages to ZaiChatEngine for AI conversations or @Zai mentions ────────
    // Vision: forward image attachments so Zai can "see" them (images-only).
    const zaiImages: AiZaiImageRef[] =
      params.attachments
        ?.filter((a) => a.type === 'image')
        .map((a) => ({ key: a.key, content_type: a.content_type })) ?? [];

    // Route to Zai when there is text to respond to OR an image to look at.
    // Pure non-image media (video/audio/file) still skips — the LLM (and the
    // document RAG path) have nothing usable. Holds for AI_ASSISTANT convs and
    // @Zai mentions alike.
    if (params.body?.trim() || zaiImages.length > 0) {
      void (async () => {
        try {
          // Don't trigger Zai for messages sent by Zai itself (loop guard).
          if (params.senderId === this.config.zaiBotUserId) return;

          const aiContext = await this.cacheService.getAiConversationContext(
            params.conversationId,
          );

          if (aiContext) {
            // AI_ASSISTANT conversation — always route to Zai with conversation trigger.
            const zaiEvent: AiZaiChatRequestEvent = {
              message_id: params.messageId,
              conversation_id: params.conversationId,
              sender_id: params.senderId,
              body: params.body,
              created_at: params.createdAt,
              ai_context: aiContext,
              trigger: 'conversation',
              ...(zaiImages.length > 0 ? { images: zaiImages } : {}),
              trace_id: params.traceId,
            };
            await this.publisher.emit(KafkaTopics.AiZaiChatRequest, zaiEvent);
            this.shared.logger.debug(
              `[${params.traceId}] AiZaiChatRequest (conversation) emitted for message: ${params.messageId}`,
            );
            return;
          }

          // Group @Zai mention path — mutually exclusive with AI_ASSISTANT path.
          const mentionedZai = params.mentions?.some(
            (m) => m.user_id === this.config.zaiBotUserId,
          );
          if (!mentionedZai) return;

          const acquired = await this.cacheService.acquireZaiMentionCooldown(
            params.conversationId,
            params.senderId,
          );
          if (!acquired) {
            this.shared.logger.debug(
              `[${params.traceId}] @Zai mention rate-limited for conversation: ${params.conversationId} user: ${params.senderId}`,
            );
            return;
          }

          const zaiEvent: AiZaiChatRequestEvent = {
            message_id: params.messageId,
            conversation_id: params.conversationId,
            sender_id: params.senderId,
            body: params.body,
            created_at: params.createdAt,
            trigger: 'mention',
            ...(zaiImages.length > 0 ? { images: zaiImages } : {}),
            trace_id: params.traceId,
          };
          await this.publisher.emit(KafkaTopics.AiZaiChatRequest, zaiEvent);
          this.shared.logger.debug(
            `[${params.traceId}] AiZaiChatRequest (mention) emitted for message: ${params.messageId}`,
          );
        } catch (err) {
          this.shared.logger.error(
            `[${params.traceId}] AiZaiChatRequest emit failed`,
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
