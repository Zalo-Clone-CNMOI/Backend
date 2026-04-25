import { InteractionFanoutConsumer } from './interaction-fanout.consumer';
import { WsEvents } from '@libs/contracts';

describe('InteractionFanoutConsumer (poll fanout)', () => {
  const gateway: {
    broadcastToConversation: jest.Mock<void, [string, string, unknown]>;
    broadcastToConversationExceptUsers: jest.Mock<
      void,
      [string, string, unknown, string[]]
    >;
    emitToUser: jest.Mock<Promise<void>, [string, string, unknown]>;
  } = {
    broadcastToConversation: jest.fn<void, [string, string, unknown]>(),
    broadcastToConversationExceptUsers: jest.fn<
      void,
      [string, string, unknown, string[]]
    >(),
    emitToUser: jest.fn<Promise<void>, [string, string, unknown]>(),
  };

  let consumer: InteractionFanoutConsumer;

  beforeEach(() => {
    jest.clearAllMocks();
    consumer = new InteractionFanoutConsumer(gateway as never);
  });

  it('should broadcast poll created payload to conversation room', () => {
    consumer.onConversationPollCreated({
      poll_id: 'poll-1',
      conversation_id: 'conv-1',
      creator_id: 'user-1',
      question: 'Lunch?',
      options: [
        { option_id: 'opt-1', label: 'Pizza', order_index: 0 },
        { option_id: 'opt-2', label: 'Sushi', order_index: 1 },
      ],
      allow_multiple: false,
      allow_add_option: true,
      expires_at: 1706169999000,
      created_at: 1706162800000,
      message_id: 'msg-1',
      trace_id: 'trace-poll-create',
    });

    expect(gateway.broadcastToConversation).toHaveBeenCalledWith(
      'conv-1',
      WsEvents.ConversationPollCreated,
      {
        poll_id: 'poll-1',
        conversation_id: 'conv-1',
        message_id: 'msg-1',
        creator_id: 'user-1',
        question: 'Lunch?',
        options: [
          { option_id: 'opt-1', label: 'Pizza', order_index: 0 },
          { option_id: 'opt-2', label: 'Sushi', order_index: 1 },
        ],
        allow_multiple: false,
        allow_add_option: true,
        expires_at: 1706169999000,
        created_at: 1706162800000,
      },
    );
  });

  it('should broadcast poll edited payload to conversation room', () => {
    consumer.onConversationPollEdited({
      poll_id: 'poll-1',
      conversation_id: 'conv-1',
      editor_user_id: 'user-1',
      changes: {
        question: 'Dinner?',
        allow_multiple: true,
      },
      edited_at: 1706162900000,
      trace_id: 'trace-poll-edit',
    });

    expect(gateway.broadcastToConversation).toHaveBeenCalledWith(
      'conv-1',
      WsEvents.ConversationPollEdited,
      {
        poll_id: 'poll-1',
        conversation_id: 'conv-1',
        editor_user_id: 'user-1',
        changes: { question: 'Dinner?', allow_multiple: true },
        edited_at: 1706162900000,
      },
    );
  });

  it('should broadcast poll option added payload to conversation room', () => {
    consumer.onConversationPollOptionAdded({
      poll_id: 'poll-1',
      conversation_id: 'conv-1',
      option_id: 'opt-3',
      label: 'Salad',
      order_index: 2,
      added_by_user_id: 'user-2',
      added_at: 1706162950000,
      trace_id: 'trace-poll-opt-add',
    });

    expect(gateway.broadcastToConversation).toHaveBeenCalledWith(
      'conv-1',
      WsEvents.ConversationPollOptionAdded,
      {
        poll_id: 'poll-1',
        conversation_id: 'conv-1',
        option_id: 'opt-3',
        label: 'Salad',
        order_index: 2,
        added_by_user_id: 'user-2',
      },
    );
  });

  it('should broadcast poll option removed payload to conversation room', () => {
    consumer.onConversationPollOptionRemoved({
      poll_id: 'poll-1',
      conversation_id: 'conv-1',
      option_id: 'opt-3',
      removed_by_user_id: 'user-1',
      removed_at: 1706162970000,
      trace_id: 'trace-poll-opt-remove',
    });

    expect(gateway.broadcastToConversation).toHaveBeenCalledWith(
      'conv-1',
      WsEvents.ConversationPollOptionRemoved,
      {
        poll_id: 'poll-1',
        conversation_id: 'conv-1',
        option_id: 'opt-3',
        removed_by_user_id: 'user-1',
      },
    );
  });

  it('should broadcast poll closed payload with final tally to conversation room', () => {
    consumer.onConversationPollClosed({
      poll_id: 'poll-1',
      conversation_id: 'conv-1',
      closed_by_user_id: 'user-1',
      reason: 'by_creator',
      final_tally: [
        { option_id: 'opt-1', vote_count: 3 },
        { option_id: 'opt-2', vote_count: 5 },
      ],
      closed_at: 1706163000000,
      trace_id: 'trace-poll-close',
    });

    expect(gateway.broadcastToConversation).toHaveBeenCalledWith(
      'conv-1',
      WsEvents.ConversationPollClosed,
      {
        poll_id: 'poll-1',
        conversation_id: 'conv-1',
        closed_by_user_id: 'user-1',
        reason: 'by_creator',
        final_tally: [
          { option_id: 'opt-1', vote_count: 3 },
          { option_id: 'opt-2', vote_count: 5 },
        ],
        closed_at: 1706163000000,
      },
    );
  });

  it('should broadcast lightweight vote-updated signal on vote cast (empty tally, voted_at as updated_at)', () => {
    consumer.onConversationPollVoteCast({
      poll_id: 'poll-1',
      conversation_id: 'conv-1',
      voter_id: 'user-2',
      option_ids_added: ['opt-1'],
      option_ids_removed: [],
      voted_at: 1706162850000,
      trace_id: 'trace-poll-vote-cast',
    });

    expect(gateway.broadcastToConversation).toHaveBeenCalledWith(
      'conv-1',
      WsEvents.ConversationPollVoteUpdated,
      {
        poll_id: 'poll-1',
        conversation_id: 'conv-1',
        tally: [],
        total_votes: 0,
        total_voters: 0,
        updated_at: 1706162850000,
      },
    );
  });

  it('should broadcast lightweight vote-updated signal on vote retract (empty tally, retracted_at as updated_at)', () => {
    consumer.onConversationPollVoteRetracted({
      poll_id: 'poll-1',
      conversation_id: 'conv-1',
      voter_id: 'user-2',
      retracted_at: 1706162860000,
      trace_id: 'trace-poll-vote-retract',
    });

    expect(gateway.broadcastToConversation).toHaveBeenCalledWith(
      'conv-1',
      WsEvents.ConversationPollVoteUpdated,
      {
        poll_id: 'poll-1',
        conversation_id: 'conv-1',
        tally: [],
        total_votes: 0,
        total_voters: 0,
        updated_at: 1706162860000,
      },
    );
  });
});
