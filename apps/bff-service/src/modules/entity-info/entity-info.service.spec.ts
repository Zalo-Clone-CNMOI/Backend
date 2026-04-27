import { Test } from '@nestjs/testing';
import { EntityInfoService } from './entity-info.service';
import { AiCoreClientService } from '@app/clients';
import { CacheService } from '@libs/redis';

const mockAiCoreClient = {
  getEntityInfo: jest.fn(),
};

const mockCache = {
  get: jest.fn(),
  set: jest.fn(),
};

const SAMPLE_RESULT = {
  entity_text: 'React',
  entity_type: 'tool' as const,
  title: 'React',
  summary: 'A JavaScript library for building UIs.',
  details: 'Developed by Meta.',
  related_entities: ['Vue', 'Angular'],
  provider: 'locdorouter' as const,
  tokens_used: 120,
  processed_at: Date.now(),
};

describe('EntityInfoService', () => {
  let service: EntityInfoService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        EntityInfoService,
        { provide: AiCoreClientService, useValue: mockAiCoreClient },
        { provide: CacheService, useValue: mockCache },
      ],
    }).compile();

    service = module.get(EntityInfoService);
  });

  describe('getEntityInfo', () => {
    it('returns cached result when available', async () => {
      mockCache.get.mockResolvedValue(SAMPLE_RESULT);

      const result = await service.getEntityInfo({
        text: 'React',
        type: 'tool',
        lang: 'vi',
        userId: 'user-1',
      });

      expect(result).toEqual(SAMPLE_RESULT);
      expect(mockAiCoreClient.getEntityInfo).not.toHaveBeenCalled();
      expect(mockCache.set).not.toHaveBeenCalled();
    });

    it('fetches from client and caches when cache misses', async () => {
      mockCache.get.mockResolvedValue(null);
      mockAiCoreClient.getEntityInfo.mockResolvedValue(SAMPLE_RESULT);

      const result = await service.getEntityInfo({
        text: 'React',
        type: 'tool',
        lang: 'vi',
        userId: 'user-1',
      });

      expect(mockAiCoreClient.getEntityInfo).toHaveBeenCalledWith({
        text: 'React',
        type: 'tool',
        lang: 'vi',
        userId: 'user-1',
      });
      expect(mockCache.set).toHaveBeenCalledWith(
        expect.stringMatching(/^ai:entity-info:/),
        SAMPLE_RESULT,
        7 * 24 * 60 * 60,
      );
      expect(result).toEqual(SAMPLE_RESULT);
    });

    it('uses same cache key for identical text/type/lang regardless of userId', async () => {
      mockCache.get.mockResolvedValue(null);
      mockAiCoreClient.getEntityInfo.mockResolvedValue(SAMPLE_RESULT);

      await service.getEntityInfo({
        text: 'React',
        type: 'tool',
        lang: 'vi',
        userId: 'user-1',
      });
      await service.getEntityInfo({
        text: 'React',
        type: 'tool',
        lang: 'vi',
        userId: 'user-2',
      });

      const [key1] = mockCache.set.mock.calls[0] as [string, ...unknown[]];
      const [key2] = mockCache.set.mock.calls[1] as [string, ...unknown[]];
      expect(key1).toBe(key2);
    });

    it('propagates errors from client', async () => {
      mockCache.get.mockResolvedValue(null);
      mockAiCoreClient.getEntityInfo.mockRejectedValue(
        new Error('AI unavailable'),
      );

      await expect(
        service.getEntityInfo({
          text: 'React',
          type: 'tool',
          lang: 'vi',
          userId: 'user-1',
        }),
      ).rejects.toThrow('AI unavailable');
    });
  });
});
