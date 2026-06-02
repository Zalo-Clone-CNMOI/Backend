import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AiEntityDetectionLog } from '@libs/database/entities';
import { MessageRepository } from '@libs/scylla';
import { EntityDetectionHistoryService } from './entity-detection-history.service';

describe('EntityDetectionHistoryService', () => {
  let service: EntityDetectionHistoryService;
  const logRepo = { find: jest.fn() };
  const messageRepo = { getAllMessages: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    const mod = await Test.createTestingModule({
      providers: [
        EntityDetectionHistoryService,
        {
          provide: getRepositoryToken(AiEntityDetectionLog),
          useValue: logRepo,
        },
        { provide: MessageRepository, useValue: messageRepo },
      ],
    }).compile();
    service = mod.get(EntityDetectionHistoryService);
  });

  it('joins logs with bodies and re-computes offsets via indexOf', async () => {
    messageRepo.getAllMessages.mockResolvedValue([
      { message_id: 'm1', body: 'Tôi dùng Google', created_at: 1 },
    ]);
    logRepo.find.mockResolvedValue([
      {
        messageId: 'm1',
        entities: [{ text: 'Google', type: 'company', confidence: 0.9 }],
      },
    ]);

    const result = await service.getForConversation('c1');

    // 'Google' in 'Tôi dùng Google': 'tôi dùng google'.indexOf('google') = 9
    expect(result).toEqual([
      {
        message_id: 'm1',
        entities: [
          {
            text: 'Google',
            type: 'company',
            confidence: 0.9,
            start_index: 9,
            end_index: 15,
          },
        ],
      },
    ]);
  });

  it('drops entities whose text is not found in the body (indexOf < 0)', async () => {
    messageRepo.getAllMessages.mockResolvedValue([
      { message_id: 'm1', body: 'no match here', created_at: 1 },
    ]);
    logRepo.find.mockResolvedValue([
      {
        messageId: 'm1',
        entities: [{ text: 'Google', type: 'company', confidence: 0.9 }],
      },
    ]);

    const result = await service.getForConversation('c1');
    expect(result).toEqual([{ message_id: 'm1', entities: [] }]);
  });

  it('drops entities below confidence 0.75 (matches highlighter threshold)', async () => {
    messageRepo.getAllMessages.mockResolvedValue([
      { message_id: 'm1', body: 'Tôi dùng Google', created_at: 1 },
    ]);
    logRepo.find.mockResolvedValue([
      {
        messageId: 'm1',
        entities: [{ text: 'Google', type: 'company', confidence: 0.5 }],
      },
    ]);

    const result = await service.getForConversation('c1');
    expect(result).toEqual([{ message_id: 'm1', entities: [] }]);
  });

  it('returns [] when there are no logs', async () => {
    messageRepo.getAllMessages.mockResolvedValue([
      { message_id: 'm1', body: 'hi', created_at: 1 },
    ]);
    logRepo.find.mockResolvedValue([]);
    expect(await service.getForConversation('c1')).toEqual([]);
  });
});
