/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any */
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CallSession } from '@libs/database/entities';
import { CallType, ConversationType } from '@app/constant';
import { CallHistoryService } from './call-history.service';

describe('CallHistoryService', () => {
  let service: CallHistoryService;
  let repo: any;

  beforeEach(async () => {
    repo = {
      save: jest.fn().mockImplementation((d: any) => Promise.resolve(d)),
      create: jest.fn().mockImplementation((d: any) => d),
      findOne: jest.fn(),
      findAndCount: jest.fn().mockResolvedValue([[], 0]),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    const module = await Test.createTestingModule({
      providers: [
        CallHistoryService,
        { provide: getRepositoryToken(CallSession), useValue: repo },
      ],
    }).compile();
    service = module.get(CallHistoryService);
  });

  afterEach(() => jest.clearAllMocks());

  it('should be defined', () => expect(service).toBeDefined());

  describe('createSession', () => {
    it('saves a new call session with status=missed', async () => {
      const payload = {
        id: 'call-1',
        conversationId: 'conv-1',
        initiatorId: 'user-1',
        callType: CallType.AUDIO,
        conversationType: ConversationType.DIRECT,
        startedAt: 1000,
        participantIds: ['user-1', 'user-2'],
      };
      await service.createSession(payload);
      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'call-1', status: 'missed' }),
      );
    });
  });

  describe('closeSession', () => {
    it('updates ended_at, duration_ms and status=completed for normal end', async () => {
      await service.closeSession('call-1', {
        endedAt: 2000,
        startedAt: 1000,
        reason: 'normal',
      });
      expect(repo.update).toHaveBeenCalledWith(
        { id: 'call-1' },
        expect.objectContaining({
          endedAt: 2000,
          durationMs: 1000,
          status: 'completed',
        }),
      );
    });

    it('marks as timeout when reason is timeout', async () => {
      await service.closeSession('call-1', {
        endedAt: 2000,
        startedAt: 1000,
        reason: 'timeout',
      });
      expect(repo.update).toHaveBeenCalledWith(
        { id: 'call-1' },
        expect.objectContaining({ status: 'timeout' }),
      );
    });

    it('marks as rejected when reason is rejected', async () => {
      await service.closeSession('call-1', {
        endedAt: 2000,
        startedAt: 1000,
        reason: 'rejected',
      });
      expect(repo.update).toHaveBeenCalledWith(
        { id: 'call-1' },
        expect.objectContaining({ status: 'rejected' }),
      );
    });
  });

  describe('listForConversation', () => {
    it('queries with correct where clause and returns pagination shape', async () => {
      repo.findAndCount.mockResolvedValue([[{ id: 'call-1' }], 1]);
      const result = await service.listForConversation('conv-1', 1, 20);
      expect(repo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { conversationId: 'conv-1' },
        }),
      );
      expect(result.total).toBe(1);
      expect(result.items).toHaveLength(1);
    });
  });
});
