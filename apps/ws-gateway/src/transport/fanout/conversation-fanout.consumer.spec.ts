import { ConversationFanoutConsumer } from './conversation-fanout.consumer';
import { WsEvents } from '@libs/contracts';

describe('ConversationFanoutConsumer', () => {
  const gateway = {
    emitToUser: jest.fn(),
  };

  const membershipService = {
    invalidateSettingsCache: jest.fn(),
    invalidateRoleCache: jest.fn(),
  };

  let consumer: ConversationFanoutConsumer;

  beforeEach(() => {
    jest.clearAllMocks();
    consumer = new ConversationFanoutConsumer(
      gateway as never,
      membershipService as never,
    );
  });

  it('should emit conversation pinned event to user room', () => {
    consumer.onConversationPinned({
      userId: 'user-1',
      conversationId: 'conv-1',
      pinnedAt: 1706162900000,
      trace_id: 'trace-conv-pin-1',
    });

    expect(gateway.emitToUser).toHaveBeenCalledWith(
      'user-1',
      WsEvents.ConversationPinned,
      {
        conversationId: 'conv-1',
        pinnedAt: 1706162900000,
      },
    );
  });

  it('should emit conversation unpinned event to user room', () => {
    consumer.onConversationUnpinned({
      userId: 'user-1',
      conversationId: 'conv-1',
      unpinnedAt: 1706163000000,
    });

    expect(gateway.emitToUser).toHaveBeenCalledWith(
      'user-1',
      WsEvents.ConversationUnpinned,
      {
        conversationId: 'conv-1',
        unpinnedAt: 1706163000000,
      },
    );
  });

  it('should invalidate settings cache when ConversationSettingsUpdated fires', () => {
    consumer.onConversationSettingsUpdated({
      conversation_id: 'conv-1',
      updated_by: 'user-1',
      settings: {},
      updated_at: Date.now(),
    });

    expect(membershipService.invalidateSettingsCache).toHaveBeenCalledWith(
      'conv-1',
    );
    expect(membershipService.invalidateRoleCache).not.toHaveBeenCalled();
  });

  it('should invalidate role cache when ConversationMemberRoleUpdated fires', () => {
    consumer.onConversationMemberRoleUpdated({
      conversation_id: 'conv-1',
      updated_by: 'admin-1',
      user_id: 'user-2',
      previous_role: 'member' as never,
      current_role: 'admin' as never,
      updated_at: Date.now(),
    });

    expect(membershipService.invalidateRoleCache).toHaveBeenCalledWith(
      'user-2',
      'conv-1',
    );
    expect(membershipService.invalidateSettingsCache).not.toHaveBeenCalled();
  });
});
