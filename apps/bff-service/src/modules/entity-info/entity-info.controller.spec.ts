import { Test } from '@nestjs/testing';
import { BusinessException } from '@app/types';
import { JwtService } from '@libs/auth';
import { EntityInfoController } from './entity-info.controller';
import { EntityInfoService } from './entity-info.service';

const mockService = { getEntityInfo: jest.fn() };
const mockJwt = { verifyAccessToken: jest.fn() };
const TOKEN = 'token-abc';

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
    mockJwt.verifyAccessToken.mockReturnValue({
      sub: 'user-123',
      phone: '+84900000001',
      type: 'access',
    });
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
    it('derives userId from the JWT and delegates to service with correct params', async () => {
      mockService.getEntityInfo.mockResolvedValue(SAMPLE_RESULT);

      const result = await controller.getEntityInfo(TOKEN, {
        text: 'React',
        type: 'tool',
        lang: 'vi',
      });

      expect(mockJwt.verifyAccessToken).toHaveBeenCalledWith(TOKEN);
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

      await controller.getEntityInfo(TOKEN, { text: 'React', type: 'tool' });

      expect(mockService.getEntityInfo).toHaveBeenCalledWith({
        text: 'React',
        type: 'tool',
        lang: 'vi',
        userId: 'user-123',
      });
    });

    it('throws (401) when the access token is missing', async () => {
      await expect(
        controller.getEntityInfo(null, { text: 'React', type: 'tool' }),
      ).rejects.toThrow(BusinessException);
      expect(mockJwt.verifyAccessToken).not.toHaveBeenCalled();
      expect(mockService.getEntityInfo).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when text is empty', async () => {
      await expect(
        controller.getEntityInfo(TOKEN, { text: '', type: 'tool' }),
      ).rejects.toThrow(BusinessException);
    });

    it('throws BadRequestException when text exceeds 200 chars', async () => {
      const longText = 'a'.repeat(201);
      await expect(
        controller.getEntityInfo(TOKEN, { text: longText, type: 'tool' }),
      ).rejects.toThrow(BusinessException);
    });

    it('throws BadRequestException for invalid type', async () => {
      await expect(
        controller.getEntityInfo(TOKEN, {
          text: 'React',
          type: 'invalid-type',
        }),
      ).rejects.toThrow(BusinessException);
    });

    it('trims whitespace from text before passing to service', async () => {
      mockService.getEntityInfo.mockResolvedValue(SAMPLE_RESULT);

      await controller.getEntityInfo(TOKEN, {
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
