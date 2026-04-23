import { MessageType } from '@app/constant';
import { SystemMessageFactory } from './system-message.factory';
import { SystemEventType, MemberAddedMetadata } from '@libs/contracts';

describe('SystemMessageFactory', () => {
  it('should create a valid system message command', () => {
    const params = {
      conversationId: 'conv-123',
      systemEventType: SystemEventType.MEMBER_ADDED,
      metadata: {
        added_by: 'user-1',
        added_by_name: 'Admin',
        added_members: [{ user_id: 'user-2', full_name: 'Member 2' }],
      } satisfies MemberAddedMetadata,
      traceId: 'trace-123',
      bodyFallback: 'Admin added Member 2 to the group.',
    };

    const result = SystemMessageFactory.create(params);

    expect(result).toMatchObject({
      conversation_id: 'conv-123',
      message_type: MessageType.SYSTEM,
      system_event_type: SystemEventType.MEMBER_ADDED,
      metadata: params.metadata,
      body: params.bodyFallback,
      trace_id: 'trace-123',
    });
    expect(result.message_id).toBeDefined();
    expect(result.created_at).toBeLessThanOrEqual(Date.now());
  });
});
