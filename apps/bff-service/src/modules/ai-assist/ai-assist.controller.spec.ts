import { Test, TestingModule } from '@nestjs/testing';
import { AiAssistController } from './ai-assist.controller';
import { AiAssistService } from './ai-assist.service';
import type { AuthenticatedUser } from '@app/types';
import type { CatchUpResponseDto } from './dto/catch-up-response.dto';
import type { TranslateResponseDto } from './dto/translate-response.dto';
import type { TranslateRequestDto } from './dto/translate-request.dto';

// ── helpers ────────────────────────────────────────────────────────────────

const mockUser = (): AuthenticatedUser =>
  ({
    id: 'user-1',
    phone: '+84900000001',
  }) as AuthenticatedUser;

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

const mockTranslateResponse = (): TranslateResponseDto => ({
  originalBody: 'Hello',
  translatedBody: 'Xin chào',
  sourceLanguage: 'en',
  targetLanguage: 'vi',
  provider: 'openai',
  cached: false,
});

// ── test suite ──────────────────────────────────────────────────────────────

describe('AiAssistController', () => {
  let controller: AiAssistController;
  let service: jest.Mocked<AiAssistService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AiAssistController],
      providers: [
        {
          provide: AiAssistService,
          useValue: {
            catchUp: jest.fn(),
            translate: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<AiAssistController>(AiAssistController);
    service = module.get(AiAssistService);
  });

  describe('getCatchUp', () => {
    it('delegates to service.catchUp with (token, user.id, conversationId) and returns result', async () => {
      const expected = mockCatchUpResponse();
      service.catchUp.mockResolvedValue(expected);

      const result = await controller.getCatchUp(
        mockUser(),
        'token-abc',
        'conv-1',
      );

      expect(service.catchUp).toHaveBeenCalledWith(
        'token-abc',
        'user-1',
        'conv-1',
      );
      expect(result).toEqual(expected);
    });

    it('throws BusinessException when conversationId is empty string', async () => {
      await expect(
        controller.getCatchUp(mockUser(), 'token-abc', ''),
      ).rejects.toThrow();
      expect(service.catchUp).not.toHaveBeenCalled();
    });

    it('throws BusinessException when conversationId is whitespace only', async () => {
      await expect(
        controller.getCatchUp(mockUser(), 'token-abc', '   '),
      ).rejects.toThrow();
      expect(service.catchUp).not.toHaveBeenCalled();
    });
  });

  describe('translate', () => {
    it('delegates to service.translate with (user.id, dto) and returns result', async () => {
      const expected = mockTranslateResponse();
      service.translate.mockResolvedValue(expected);

      const dto: TranslateRequestDto = {
        text: 'Hello',
        targetLanguage: 'vi',
        sourceLanguage: 'en',
      };
      const result = await controller.translate(mockUser(), dto);

      expect(service.translate).toHaveBeenCalledWith('user-1', dto);
      expect(result).toEqual(expected);
    });
  });
});
