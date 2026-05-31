import { AiFanoutConsumer } from './ai-fanout.consumer';
import { WsEvents } from '@libs/contracts';

describe('AiFanoutConsumer', () => {
  const gateway = {
    emitToUser: jest.fn(),
    broadcastToConversation: jest.fn(),
  };
  const streamTracker = {
    track: jest.fn(),
    complete: jest.fn(),
    getActiveStreams: jest.fn(),
  };
  const redisService = {
    incrBy: jest.fn().mockResolvedValue(1),
    expire: jest.fn().mockResolvedValue(1),
    setEx: jest.fn().mockResolvedValue(undefined),
    del: jest.fn().mockResolvedValue(undefined),
  };
  const config = {
    moderationStrikeThreshold: 3,
    moderationStrikeWindowSeconds: 60,
    moderationCooldownSeconds: 30,
  };

  // recordModerationStrike runs fire-and-forget; flush microtasks to observe it.
  const flush = () => new Promise((resolve) => setImmediate(resolve));

  let consumer: AiFanoutConsumer;

  beforeEach(() => {
    jest.clearAllMocks();
    redisService.incrBy.mockResolvedValue(1);
    consumer = new AiFanoutConsumer(
      gateway as never,
      streamTracker as never,
      redisService as never,
      config as never,
    );
  });

  describe('onAiModerationResult', () => {
    it('should notify sender only when moderation result is flagged', () => {
      consumer.onAiModerationResult({
        message_id: 'msg-1',
        conversation_id: 'conv-1',
        sender_id: 'user-1',
        created_at: Date.now(),
        is_flagged: true,
        labels: ['spam'],
        confidence: 1,
        provider: 'openai',
        ensemble: false,
        decision_source: 'model',
        processed_at: Date.now(),
        tokens_used: 8,
      });

      expect(gateway.emitToUser).toHaveBeenCalledWith(
        'user-1',
        WsEvents.AiModerationResult,
        expect.objectContaining({
          message_id: 'msg-1',
          conversation_id: 'conv-1',
          is_flagged: true,
        }),
      );
      expect(gateway.broadcastToConversation).not.toHaveBeenCalled();
    });

    it('should ignore non-flagged moderation results', () => {
      consumer.onAiModerationResult({
        message_id: 'msg-2',
        conversation_id: 'conv-1',
        sender_id: 'user-1',
        created_at: Date.now(),
        is_flagged: false,
        labels: ['clean'],
        confidence: 0.99,
        provider: 'openai',
        ensemble: false,
        decision_source: 'model',
        processed_at: Date.now(),
        tokens_used: 4,
      });

      expect(gateway.emitToUser).not.toHaveBeenCalled();
      expect(gateway.broadcastToConversation).not.toHaveBeenCalled();
    });
  });

  describe('onAiModerationEnforcement', () => {
    it('should broadcast enforcement outcomes to conversation scope', () => {
      consumer.onAiModerationEnforcement({
        message_id: 'msg-3',
        conversation_id: 'conv-2',
        sender_id: 'user-3',
        created_at: Date.now(),
        is_flagged: true,
        labels: ['spam'],
        confidence: 1,
        provider: 'openai',
        action: 'soft_delete',
        outcome: 'deleted',
        reason: 'conditional_delete_applied',
        enforced_at: Date.now(),
      });

      expect(gateway.broadcastToConversation).toHaveBeenCalledWith(
        'conv-2',
        WsEvents.AiModerationEnforcement,
        expect.objectContaining({
          message_id: 'msg-3',
          conversation_id: 'conv-2',
          outcome: 'deleted',
          action: 'soft_delete',
        }),
      );
      expect(gateway.emitToUser).not.toHaveBeenCalled();
    });

    it.each([
      {
        outcome: 'deduplicated' as const,
        reason: 'delete_event_already_emitted_after_lock_acquired' as const,
      },
      {
        outcome: 'failed' as const,
        reason: 'delete_emit_lock_busy' as const,
      },
    ])(
      'should broadcast $outcome moderation enforcement outcome',
      ({ outcome, reason }) => {
        consumer.onAiModerationEnforcement({
          message_id: 'msg-4',
          conversation_id: 'conv-4',
          sender_id: 'user-4',
          created_at: Date.now(),
          is_flagged: true,
          labels: ['spam'],
          confidence: 1,
          provider: 'openai',
          action: 'soft_delete',
          outcome,
          reason,
          enforced_at: Date.now(),
        });

        expect(gateway.broadcastToConversation).toHaveBeenCalledWith(
          'conv-4',
          WsEvents.AiModerationEnforcement,
          expect.objectContaining({
            message_id: 'msg-4',
            conversation_id: 'conv-4',
            outcome,
            reason,
            action: 'soft_delete',
          }),
        );
        // failed/deduplicated outcomes must NOT individually notify the sender
        expect(gateway.emitToUser).not.toHaveBeenCalled();
      },
    );

    it('records a strike for a deleted message and sets a cooldown at the threshold', async () => {
      redisService.incrBy.mockResolvedValue(3); // reaches the default threshold (3)

      consumer.onAiModerationEnforcement({
        message_id: 'msg-5',
        conversation_id: 'conv-5',
        sender_id: 'user-5',
        created_at: Date.now(),
        is_flagged: true,
        labels: ['toxic'],
        confidence: 1,
        provider: 'openai',
        action: 'soft_delete',
        outcome: 'deleted',
        reason: 'conditional_delete_applied',
        enforced_at: Date.now(),
      });
      await flush();

      expect(redisService.incrBy).toHaveBeenCalledWith('mod:strikes:user-5', 1);
      expect(redisService.setEx).toHaveBeenCalledWith(
        'mod:cooldown:user-5',
        30,
        '1',
      );
      expect(redisService.del).toHaveBeenCalledWith('mod:strikes:user-5');
    });

    it('does NOT set a cooldown below the strike threshold', async () => {
      redisService.incrBy.mockResolvedValue(1);

      consumer.onAiModerationEnforcement({
        message_id: 'msg-6',
        conversation_id: 'conv-6',
        sender_id: 'user-6',
        created_at: Date.now(),
        is_flagged: true,
        labels: ['toxic'],
        confidence: 1,
        provider: 'openai',
        action: 'soft_delete',
        outcome: 'deleted',
        reason: 'conditional_delete_applied',
        enforced_at: Date.now(),
      });
      await flush();

      expect(redisService.incrBy).toHaveBeenCalledWith('mod:strikes:user-6', 1);
      expect(redisService.expire).toHaveBeenCalledWith(
        'mod:strikes:user-6',
        60,
      );
      expect(redisService.setEx).not.toHaveBeenCalled();
    });

    it('does NOT record a strike for non-deleted enforcement outcomes', async () => {
      consumer.onAiModerationEnforcement({
        message_id: 'msg-7',
        conversation_id: 'conv-7',
        sender_id: 'user-7',
        created_at: Date.now(),
        is_flagged: true,
        labels: ['spam'],
        confidence: 1,
        provider: 'openai',
        action: 'soft_delete',
        outcome: 'deduplicated',
        reason: 'delete_event_already_emitted_after_lock_acquired',
        enforced_at: Date.now(),
      });
      await flush();

      expect(redisService.incrBy).not.toHaveBeenCalled();
      expect(redisService.setEx).not.toHaveBeenCalled();
    });
  });

  describe('onAiStreamComplete', () => {
    it('forwards stream complete event UNICAST for non-zai features', () => {
      consumer.onAiStreamComplete({
        stream_id: 'stream-1',
        user_id: 'user-1',
        conversation_id: 'conv-1',
        feature: 'summary',
        total_chunks: 3,
        total_tokens: 100,
        provider: 'openai',
        completed_at: Date.now(),
      });

      expect(gateway.emitToUser).toHaveBeenCalledWith(
        'user-1',
        WsEvents.AiStreamComplete,
        expect.objectContaining({
          stream_id: 'stream-1',
          feature: 'summary',
          total_chunks: 3,
        }),
      );
      expect(gateway.broadcastToConversation).not.toHaveBeenCalled();
    });

    it('BROADCASTS stream complete to the whole conversation for zai_chat (C4)', () => {
      consumer.onAiStreamComplete({
        stream_id: 'stream-zai-1',
        user_id: 'user-trigger',
        conversation_id: 'conv-group',
        feature: 'zai_chat',
        total_chunks: 5,
        total_tokens: 200,
        provider: 'openai',
        completed_at: Date.now(),
      });

      expect(gateway.broadcastToConversation).toHaveBeenCalledWith(
        'conv-group',
        WsEvents.AiStreamComplete,
        expect.objectContaining({
          stream_id: 'stream-zai-1',
          feature: 'zai_chat',
          total_chunks: 5,
        }),
      );
      expect(gateway.emitToUser).not.toHaveBeenCalled();
      // C12: stop tracking the finished stream.
      expect(streamTracker.complete).toHaveBeenCalledWith('stream-zai-1');
    });

    it('does NOT track/complete for non-zai stream complete', () => {
      consumer.onAiStreamComplete({
        stream_id: 'stream-1',
        user_id: 'user-1',
        conversation_id: 'conv-1',
        feature: 'summary',
        total_chunks: 2,
        total_tokens: 50,
        provider: 'openai',
        completed_at: Date.now(),
      });

      expect(streamTracker.complete).not.toHaveBeenCalled();
    });
  });

  describe('onAiStreamChunk', () => {
    it('forwards stream chunk event UNICAST for non-zai features', () => {
      consumer.onAiStreamChunk({
        stream_id: 'stream-2',
        user_id: 'user-2',
        conversation_id: 'conv-2',
        feature: 'summary',
        chunk_index: 1,
        content: 'partial response',
        is_final: false,
      });

      expect(gateway.emitToUser).toHaveBeenCalledWith(
        'user-2',
        WsEvents.AiStreamChunk,
        expect.objectContaining({
          stream_id: 'stream-2',
          conversation_id: 'conv-2',
          feature: 'summary',
          chunk_index: 1,
          content: 'partial response',
          is_final: false,
        }),
      );
      expect(gateway.broadcastToConversation).not.toHaveBeenCalled();
    });

    it('BROADCASTS stream chunk to the conversation room for zai_chat (C4)', () => {
      consumer.onAiStreamChunk({
        stream_id: 'stream-zai-2',
        user_id: 'user-trigger',
        conversation_id: 'conv-group',
        feature: 'zai_chat',
        chunk_index: 0,
        content: 'Hi everyone,',
        is_final: false,
      });

      expect(gateway.broadcastToConversation).toHaveBeenCalledWith(
        'conv-group',
        WsEvents.AiStreamChunk,
        expect.objectContaining({
          stream_id: 'stream-zai-2',
          conversation_id: 'conv-group',
          feature: 'zai_chat',
          chunk_index: 0,
          content: 'Hi everyone,',
        }),
      );
      expect(gateway.emitToUser).not.toHaveBeenCalled();
      // C12: track the stream against its conversation for disconnect-abort.
      expect(streamTracker.track).toHaveBeenCalledWith(
        'stream-zai-2',
        'conv-group',
      );
    });

    it('does NOT track non-zai stream chunks', () => {
      consumer.onAiStreamChunk({
        stream_id: 'stream-9',
        user_id: 'user-9',
        conversation_id: 'conv-9',
        feature: 'summary',
        chunk_index: 0,
        content: 'x',
        is_final: false,
      });
      expect(streamTracker.track).not.toHaveBeenCalled();
    });

    it('regression guard: smart_reply and document_analysis stay unicast', () => {
      consumer.onAiStreamChunk({
        stream_id: 'stream-smart',
        user_id: 'user-3',
        conversation_id: 'conv-3',
        feature: 'smart_reply',
        chunk_index: 0,
        content: 'Sure!',
        is_final: false,
      });
      consumer.onAiStreamChunk({
        stream_id: 'stream-doc',
        user_id: 'user-4',
        conversation_id: 'conv-4',
        feature: 'document_analysis',
        chunk_index: 0,
        content: 'According to the document...',
        is_final: false,
      });

      expect(gateway.broadcastToConversation).not.toHaveBeenCalled();
      expect(gateway.emitToUser).toHaveBeenCalledTimes(2);
    });
  });

  // ── Phase 4: AiZaiTyping ─────────────────────────────────────────────────

  describe('onAiZaiTyping', () => {
    it('broadcasts is_typing:true to the conversation room', () => {
      consumer.onAiZaiTyping({
        conversation_id: 'conv-9',
        is_typing: true,
        user_id: 'user-9',
      });

      expect(gateway.broadcastToConversation).toHaveBeenCalledWith(
        'conv-9',
        WsEvents.AiZaiTyping,
        { conversation_id: 'conv-9', is_typing: true },
      );
    });

    it('broadcasts is_typing:false to the conversation room', () => {
      consumer.onAiZaiTyping({
        conversation_id: 'conv-9',
        is_typing: false,
        user_id: 'user-9',
      });

      expect(gateway.broadcastToConversation).toHaveBeenCalledWith(
        'conv-9',
        WsEvents.AiZaiTyping,
        { conversation_id: 'conv-9', is_typing: false },
      );
    });
  });
});
