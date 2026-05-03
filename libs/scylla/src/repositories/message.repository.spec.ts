import { Logger } from '@nestjs/common';
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

describe('MessageRepository - insertMentions', () => {
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
        { provide: SCYLLA_CLIENT, useValue: scyllaClient },
      ],
    }).compile();

    repository = module.get<MessageRepository>(MessageRepository);
  });

  it('should insert one row per mention into mentions_by_message and skip __ALL__ for mentions_by_user', async () => {
    await repository.insertMentions({
      message_id: 'msg-1',
      conversation_id: 'conv-1',
      sender_id: 'user-sender',
      created_at: 1700000000000,
      mentions: [
        { user_id: 'user-1', mention_type: 'user', offset: 0, length: 5 },
        { user_id: '__ALL__', mention_type: 'all', offset: 6, length: 4 },
      ],
    });

    const calls = scyllaClient.execute.mock.calls;
    const mentionsByMessageInserts = calls.filter(([q]) =>
      String(q).includes('INSERT INTO mentions_by_message'),
    );
    const mentionsByUserInserts = calls.filter(([q]) =>
      String(q).includes('INSERT INTO mentions_by_user'),
    );
    const updateInline = calls.filter(([q]) =>
      String(q).includes('UPDATE messages_by_conversation'),
    );

    expect(mentionsByMessageInserts).toHaveLength(2);   // both mentions
    expect(mentionsByUserInserts).toHaveLength(1);      // only real user, NOT __ALL__
    expect(updateInline).toHaveLength(1);
    expect(updateInline[0][1]).toEqual([
      JSON.stringify([
        { user_id: 'user-1', mention_type: 'user', offset: 0, length: 5 },
        { user_id: '__ALL__', mention_type: 'all', offset: 6, length: 4 },
      ]),
      'conv-1',
      1700000000000,
      'msg-1',
    ]);
  });

  it('should be a no-op when mentions array is empty', async () => {
    await repository.insertMentions({
      message_id: 'msg-2',
      conversation_id: 'conv-2',
      sender_id: 'user-sender',
      created_at: 1700000000000,
      mentions: [],
    });

    expect(scyllaClient.execute).not.toHaveBeenCalled();
  });

  it('should not throw when one of the parallel inserts fails (eventual consistency)', async () => {
    const loggerErrorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    scyllaClient.execute.mockImplementationOnce(() =>
      Promise.reject(new Error('scylla unavailable')),
    );

    await expect(
      repository.insertMentions({
        message_id: 'msg-3',
        conversation_id: 'conv-3',
        sender_id: 'user-sender',
        created_at: 1700000000000,
        mentions: [
          { user_id: 'user-1', mention_type: 'user', offset: 0, length: 5 },
        ],
      }),
    ).resolves.toBeUndefined();

    expect(loggerErrorSpy).toHaveBeenCalledWith(
      '[insertMentions] task failed',
      expect.any(Error),
    );

    loggerErrorSpy.mockRestore();
  });
});
