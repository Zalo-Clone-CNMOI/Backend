import { AiFanoutConsumer } from './ai-fanout.consumer';
import { WsEvents } from '@libs/contracts';

describe('AiFanoutConsumer', () => {
  const gateway = {
    emitToUser: jest.fn(),
    broadcastToConversation: jest.fn(),
  };

  let consumer: AiFanoutConsumer;

  beforeEach(() => {
    jest.clearAllMocks();
    consumer = new AiFanoutConsumer(gateway as never);
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
  });
});
