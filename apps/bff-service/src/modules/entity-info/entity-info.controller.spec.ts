import { Test } from '@nestjs/testing';
import type { AuthenticatedUser } from '@app/types';
import { JwtAuthGuard } from '@libs/auth';
import { EntityInfoController } from './entity-info.controller';
import { EntityInfoService } from './entity-info.service';

const mockService = { getEntityInfo: jest.fn() };
const mockUser = { id: 'user-123' } as AuthenticatedUser;

const SAMPLE_RESULT = {
  entity_text: 'React',
  entity_type: 'tool',
  title: 'React',
  summary: 'A JavaScript library for building UIs.',
  details: 'Developed by Meta.',
  provider: 'locdorouter',
  tokens_used: 120,
  processed_at: Date.now(),
};

describe('EntityInfoController', () => {
  let controller: EntityInfoController;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      controllers: [EntityInfoController],
      providers: [{ provide: EntityInfoService, useValue: mockService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(EntityInfoController);
  });

  describe('getEntityInfo', () => {
    it('delegates to service with correct params', async () => {
      mockService.getEntityInfo.mockResolvedValue(SAMPLE_RESULT);

      const result = await controller.getEntityInfo(mockUser, {
        text: 'React',
        type: 'tool',
        lang: 'vi',
      });

      expect(mockService.getEntityInfo).toHaveBeenCalledWith({
        text: 'React',
        type: 'tool',
        lang: 'vi',
        userId: 'user-123',
      });
      expect(result).toEqual(expect.objectContaining(SAMPLE_RESULT));
    });

    it('defaults lang to vi when not provided', async () => {
      mockService.getEntityInfo.mockResolvedValue(SAMPLE_RESULT);

      await controller.getEntityInfo(mockUser, { text: 'React', type: 'tool' });

      expect(mockService.getEntityInfo).toHaveBeenCalledWith({
        text: 'React',
        type: 'tool',
        lang: 'vi',
        userId: 'user-123',
      });
    });

    it('trims whitespace from text before passing to service', async () => {
      mockService.getEntityInfo.mockResolvedValue(SAMPLE_RESULT);

      await controller.getEntityInfo(mockUser, {
        text: '  React  ',
        type: 'tool',
      });

      expect(mockService.getEntityInfo).toHaveBeenCalledWith({
        text: 'React',
        type: 'tool',
        lang: 'vi',
        userId: 'user-123',
      });
    });
  });
});
