import { Test, TestingModule } from '@nestjs/testing';
import { MessageRepository } from './message.repository';
import { SCYLLA_CLIENT } from '../scylla.tokens';

describe('MessageRepository - insertSystemMessage', () => {
  let repository: MessageRepository;
  let scyllaClient: { batch: jest.Mock; execute: jest.Mock };

  beforeEach(async () => {
    scyllaClient = {
      batch: jest.fn().mockResolvedValue(undefined),
      execute: jest.fn().mockResolvedValue({ rowLength: 0, rows: [] }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MessageRepository,
        {
          provide: SCYLLA_CLIENT,
          useValue: scyllaClient,
        },
      ],
    }).compile();

    repository = module.get<MessageRepository>(MessageRepository);
  });

  it('should batch insert system message into messages_by_conversation and messages_by_id', async () => {
    const payload = {
      message_id: 'msg-1',
      conversation_id: 'conv-1',
      message_type: 'system',
      system_event_type: 'member_added',
      metadata: { key: 'value' },
      body: 'System generated text',
      created_at: 1234567890,
    };

    await repository.insertSystemMessage(payload);

    expect(scyllaClient.batch).toHaveBeenCalledWith(
      [
        {
          query: expect.stringContaining(
            'INSERT INTO messages_by_conversation',
          ) as string,
          params: [
            payload.conversation_id,
            payload.created_at,
            payload.message_id,
            'SYSTEM',
            payload.body,
            payload.message_type,
            payload.system_event_type,
            JSON.stringify(payload.metadata),
          ],
        },
        {
          query: expect.stringContaining(
            'INSERT INTO messages_by_id',
          ) as string,
          params: [
            payload.message_id,
            payload.conversation_id,
            payload.created_at,
          ],
        },
      ],
      { prepare: true },
    );
  });
});
