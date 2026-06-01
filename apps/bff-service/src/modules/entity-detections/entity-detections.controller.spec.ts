import { Test } from '@nestjs/testing';
import { BusinessException } from '@app/types';
import { JwtService } from '@libs/auth';
import { EntityDetectionsController } from './entity-detections.controller';
import { EntityDetectionsService } from './entity-detections.service';

const mockService = { getEntityDetections: jest.fn() };
const mockJwt = { verifyAccessToken: jest.fn() };
const TOKEN = 'token-abc';

const SAMPLE_RESULT = {
  items: [
    {
      message_id: 'msg-1',
      entities: [{ text: 'React', type: 'tool' }],
    },
  ],
};

describe('EntityDetectionsController', () => {
  let controller: EntityDetectionsController;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockJwt.verifyAccessToken.mockReturnValue({
      sub: 'user-123',
      phone: '+84900000001',
      type: 'access',
    });
    const module = await Test.createTestingModule({
      controllers: [EntityDetectionsController],
      providers: [
        { provide: EntityDetectionsService, useValue: mockService },
        { provide: JwtService, useValue: mockJwt },
      ],
    }).compile();

    controller = module.get(EntityDetectionsController);
  });

  describe('getEntityDetections', () => {
    it('derives userId from the JWT and delegates to service with correct params', async () => {
      mockService.getEntityDetections.mockResolvedValue(SAMPLE_RESULT);

      const result = await controller.getEntityDetections(TOKEN, {
        conversation_id: 'conv-456',
      });

      expect(mockJwt.verifyAccessToken).toHaveBeenCalledWith(TOKEN);
      expect(mockService.getEntityDetections).toHaveBeenCalledWith({
        conversationId: 'conv-456',
        userId: 'user-123',
      });
      expect(result).toEqual(SAMPLE_RESULT);
    });

    it('throws (401) when the access token is missing', async () => {
      await expect(
        controller.getEntityDetections(null, { conversation_id: 'conv-456' }),
      ).rejects.toThrow(BusinessException);
      expect(mockJwt.verifyAccessToken).not.toHaveBeenCalled();
      expect(mockService.getEntityDetections).not.toHaveBeenCalled();
    });

    it('throws (400) when conversation_id is missing', async () => {
      await expect(
        controller.getEntityDetections(TOKEN, { conversation_id: undefined }),
      ).rejects.toThrow(BusinessException);
      expect(mockService.getEntityDetections).not.toHaveBeenCalled();
    });
  });
});
