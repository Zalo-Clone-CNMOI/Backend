import { Test, TestingModule } from '@nestjs/testing';
import { BusinessException } from '@app/types';
import { JwtService } from '@libs/auth';
import { AiAssistController } from './ai-assist.controller';
import { AiAssistService } from './ai-assist.service';
import type { CatchUpResponseDto } from './dto/catch-up-response.dto';
import type { ZaiConversationResponseDto } from './dto/zai-conversation-response.dto';

// ── helpers ────────────────────────────────────────────────────────────────

const mockCatchUpResponse = (): CatchUpResponseDto => ({
  hadUnread: true,
  summary: 'Some summary',
  messageCount: 2,
  fromMessageId: 'msg-a',
  toMessageId: 'msg-b',
  truncated: false,
  provider: 'openai',
  cached: false,
  generatedAt: 1700000000000,
});

// ── test suite ──────────────────────────────────────────────────────────────

describe('AiAssistController', () => {
  let controller: AiAssistController;
  let service: jest.Mocked<AiAssistService>;
  let jwt: jest.Mocked<JwtService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AiAssistController],
      providers: [
        {
          provide: AiAssistService,
          useValue: {
            catchUp: jest.fn(),
            getOrCreateZaiConversation: jest.fn(),
            disbandAiConversation: jest.fn(),
          },
        },
        {
          provide: JwtService,
          useValue: {
            verifyAccessToken: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<AiAssistController>(AiAssistController);
    service = module.get(AiAssistService);
    jwt = module.get(JwtService);
  });

  describe('getOrCreateZaiConversation', () => {
    it('delegates to service.getOrCreateZaiConversation with token and returns DTO', async () => {
      const expected: ZaiConversationResponseDto = {
        conversationId: 'conv-zai-1',
      };
      (service.getOrCreateZaiConversation as jest.Mock).mockResolvedValue(
        expected,
      );

      const result = await controller.getOrCreateZaiConversation('token-xyz');

      expect(service.getOrCreateZaiConversation).toHaveBeenCalledWith(
        'token-xyz',
      );
      expect(result).toEqual(expected);
    });
  });

  describe('disbandAiConversation', () => {
    it('delegates to service.disbandAiConversation with (token, conversationId)', async () => {
      (service.disbandAiConversation as jest.Mock).mockResolvedValue({
        message: 'AI conversation disbanded successfully',
      });

      const result = await controller.disbandAiConversation(
        'token-xyz',
        'conv-ai-1',
      );

      expect(service.disbandAiConversation).toHaveBeenCalledWith(
        'token-xyz',
        'conv-ai-1',
      );
      expect(result.message).toBe('AI conversation disbanded successfully');
    });
    // conversationId validation is enforced by ParseUUIDPipe at the route layer
    // (framework-tested), so there is no in-method whitespace guard to unit test.
  });

  describe('getCatchUp', () => {
    it('derives userId from the JWT and delegates to service.catchUp with (token, userId, conversationId)', async () => {
      const expected = mockCatchUpResponse();
      service.catchUp.mockResolvedValue(expected);
      jwt.verifyAccessToken.mockReturnValue({
        sub: 'user-1',
        phone: '+84900000001',
        type: 'access',
      });

      const result = await controller.getCatchUp('token-abc', 'conv-1');

      expect(jwt.verifyAccessToken).toHaveBeenCalledWith('token-abc');
      expect(service.catchUp).toHaveBeenCalledWith(
        'token-abc',
        'user-1',
        'conv-1',
      );
      expect(result).toEqual(expected);
    });

    it('throws (401) when the access token is missing — never reads user off an unguarded request', async () => {
      await expect(controller.getCatchUp(null, 'conv-1')).rejects.toThrow(
        BusinessException,
      );
      expect(jwt.verifyAccessToken).not.toHaveBeenCalled();
      expect(service.catchUp).not.toHaveBeenCalled();
    });

    it('throws BusinessException when conversationId is empty string', async () => {
      jwt.verifyAccessToken.mockReturnValue({
        sub: 'user-1',
        phone: '+84900000001',
        type: 'access',
      });
      await expect(controller.getCatchUp('token-abc', '')).rejects.toThrow();
      expect(service.catchUp).not.toHaveBeenCalled();
    });

    it('throws BusinessException when conversationId is whitespace only', async () => {
      jwt.verifyAccessToken.mockReturnValue({
        sub: 'user-1',
        phone: '+84900000001',
        type: 'access',
      });
      await expect(controller.getCatchUp('token-abc', '   ')).rejects.toThrow();
      expect(service.catchUp).not.toHaveBeenCalled();
    });
  });
});
