import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { EntityInfoController } from './entity-info.controller';
import { EntityInfoService } from './entity-info.service';
import { JwtService } from '@libs/auth';

const mockService = { getEntityInfo: jest.fn() };
const mockJwt = {
  verifyToken: jest.fn().mockReturnValue({ userId: 'user-123' }),
};

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
      providers: [
        { provide: EntityInfoService, useValue: mockService },
        { provide: JwtService, useValue: mockJwt },
      ],
    }).compile();

    controller = module.get(EntityInfoController);
  });

  describe('getEntityInfo', () => {
    it('delegates to service with correct params', async () => {
      mockService.getEntityInfo.mockResolvedValue(SAMPLE_RESULT);

      const result = await controller.getEntityInfo(
        'bearer-token',
        'React',
        'tool',
        'vi',
      );

      expect(mockJwt.verifyToken).toHaveBeenCalledWith('bearer-token');
      expect(mockService.getEntityInfo).toHaveBeenCalledWith(
        'React',
        'tool',
        'vi',
        'user-123',
      );
      expect(result).toEqual(SAMPLE_RESULT);
    });

    it('defaults lang to vi when not provided', async () => {
      mockService.getEntityInfo.mockResolvedValue(SAMPLE_RESULT);

      await controller.getEntityInfo('bearer-token', 'React', 'tool');

      expect(mockService.getEntityInfo).toHaveBeenCalledWith(
        'React',
        'tool',
        'vi',
        'user-123',
      );
    });

    it('throws BadRequestException when text is empty', async () => {
      await expect(
        controller.getEntityInfo('bearer-token', '', 'tool'),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when text exceeds 200 chars', async () => {
      const longText = 'a'.repeat(201);
      await expect(
        controller.getEntityInfo('bearer-token', longText, 'tool'),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException for invalid type', async () => {
      await expect(
        controller.getEntityInfo('bearer-token', 'React', 'invalid-type'),
      ).rejects.toThrow(BadRequestException);
    });

    it('trims whitespace from text before passing to service', async () => {
      mockService.getEntityInfo.mockResolvedValue(SAMPLE_RESULT);

      await controller.getEntityInfo('bearer-token', '  React  ', 'tool');

      expect(mockService.getEntityInfo).toHaveBeenCalledWith(
        'React',
        'tool',
        'vi',
        'user-123',
      );
    });
  });
});
