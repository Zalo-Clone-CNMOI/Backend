import { Test, TestingModule } from '@nestjs/testing';
import { TranslationController } from './translation.controller';
import { TranslationEngine } from './translation.engine';
import { BusinessException } from '@app/types';
import type { AiTranslateResultEvent } from '@libs/contracts';

// ── Helpers ────────────────────────────────────────────────────────────────

const VALID_USER_ID = '550e8400-e29b-41d4-a716-446655440001';

function stubResult(
  overrides: Partial<AiTranslateResultEvent> = {},
): AiTranslateResultEvent {
  return {
    message_id: 'some-uuid',
    conversation_id: 'http-translate',
    user_id: VALID_USER_ID,
    original_body: 'Hello, how are you?',
    translated_body: 'Xin chào, bạn có khỏe không?',
    source_language: 'en',
    target_language: 'vi',
    provider: 'openai',
    tokens_used: 42,
    cached: false,
    processed_at: Date.now(),
    ...overrides,
  };
}

/** Returns the `error.message` string embedded inside a BusinessException response. */
function getErrorMessage(err: unknown): string {
  if (err instanceof BusinessException) {
    const response = err.getResponse() as {
      error?: { message?: string };
    };
    return response?.error?.message ?? '';
  }
  return String(err);
}

// ── Suite ───────────────────────────────────────────────────────────────────

describe('TranslationController', () => {
  let controller: TranslationController;
  let mockEngine: jest.Mocked<TranslationEngine>;

  beforeEach(async () => {
    mockEngine = {
      translate: jest.fn(),
    } as unknown as jest.Mocked<TranslationEngine>;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [TranslationController],
      providers: [{ provide: TranslationEngine, useValue: mockEngine }],
    }).compile();

    controller = module.get(TranslationController);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ── text validation ────────────────────────────────────────────────────────

  describe('text validation', () => {
    it('throws 400 (BusinessException) when text is empty string', async () => {
      await expect(
        controller.translate({
          text: '',
          target_language: 'vi',
          user_id: VALID_USER_ID,
        } as never),
      ).rejects.toBeInstanceOf(BusinessException);
      expect(mockEngine.translate).not.toHaveBeenCalled();
    });

    it('throws 400 with "text is required" message when text is whitespace only', async () => {
      let caughtErr: unknown;
      try {
        await controller.translate({
          text: '   ',
          target_language: 'vi',
          user_id: VALID_USER_ID,
        } as never);
      } catch (e) {
        caughtErr = e;
      }
      expect(caughtErr).toBeInstanceOf(BusinessException);
      expect(getErrorMessage(caughtErr)).toBe('text is required');
      expect(mockEngine.translate).not.toHaveBeenCalled();
    });

    it('throws 400 when text exceeds 5000 characters', async () => {
      let caughtErr: unknown;
      try {
        await controller.translate({
          text: 'a'.repeat(5001),
          target_language: 'vi',
          user_id: VALID_USER_ID,
        } as never);
      } catch (e) {
        caughtErr = e;
      }
      expect(caughtErr).toBeInstanceOf(BusinessException);
      expect(getErrorMessage(caughtErr)).toBe('text exceeds 5000 characters');
      expect(mockEngine.translate).not.toHaveBeenCalled();
    });

    it('does NOT throw for text of exactly 5000 characters', async () => {
      mockEngine.translate.mockResolvedValue(stubResult());
      await expect(
        controller.translate({
          text: 'a'.repeat(5000),
          target_language: 'vi',
          user_id: VALID_USER_ID,
        } as never),
      ).resolves.toBeDefined();
      expect(mockEngine.translate).toHaveBeenCalledTimes(1);
    });
  });

  // ── target_language validation ─────────────────────────────────────────────

  describe('target_language validation', () => {
    it('throws 400 when target_language is empty string', async () => {
      await expect(
        controller.translate({
          text: 'Hello',
          target_language: '',
          user_id: VALID_USER_ID,
        } as never),
      ).rejects.toBeInstanceOf(BusinessException);
      expect(mockEngine.translate).not.toHaveBeenCalled();
    });

    it('throws 400 with correct message when target_language is whitespace only', async () => {
      let caughtErr: unknown;
      try {
        await controller.translate({
          text: 'Hello',
          target_language: '   ',
          user_id: VALID_USER_ID,
        } as never);
      } catch (e) {
        caughtErr = e;
      }
      expect(caughtErr).toBeInstanceOf(BusinessException);
      expect(getErrorMessage(caughtErr)).toBe('target_language is required');
      expect(mockEngine.translate).not.toHaveBeenCalled();
    });
  });

  // ── user_id validation ─────────────────────────────────────────────────────

  describe('user_id validation', () => {
    it('throws 400 when user_id is empty string', async () => {
      await expect(
        controller.translate({
          text: 'Hello',
          target_language: 'vi',
          user_id: '',
        } as never),
      ).rejects.toBeInstanceOf(BusinessException);
      expect(mockEngine.translate).not.toHaveBeenCalled();
    });

    it('throws 400 with correct message when user_id is whitespace only', async () => {
      let caughtErr: unknown;
      try {
        await controller.translate({
          text: 'Hello',
          target_language: 'vi',
          user_id: '   ',
        } as never);
      } catch (e) {
        caughtErr = e;
      }
      expect(caughtErr).toBeInstanceOf(BusinessException);
      expect(getErrorMessage(caughtErr)).toBe('user_id is required');
      expect(mockEngine.translate).not.toHaveBeenCalled();
    });
  });

  // ── Happy path ─────────────────────────────────────────────────────────────

  describe('happy path', () => {
    it('calls engine.translate with correctly-built event and returns result unchanged', async () => {
      const expected = stubResult();
      mockEngine.translate.mockResolvedValue(expected);

      const result = await controller.translate({
        text: '  Hello, how are you?  ', // leading/trailing whitespace — must be trimmed
        target_language: ' vi ', // must be trimmed
        source_language: 'en',
        user_id: VALID_USER_ID,
      } as never);

      expect(result).toBe(expected);
      expect(mockEngine.translate).toHaveBeenCalledTimes(1);

      const event = mockEngine.translate.mock.calls[0][0];

      // body must be trimmed text
      expect(event.body).toBe('Hello, how are you?');
      // target_language must be trimmed
      expect(event.target_language).toBe('vi');
      // user_id passed through unchanged
      expect(event.user_id).toBe(VALID_USER_ID);
      // source_language passed through as-is
      expect(event.source_language).toBe('en');
      // synthetic conversation_id
      expect(event.conversation_id).toBe('http-translate');
      // message_id must be a non-empty string (synthetic UUID)
      expect(typeof event.message_id).toBe('string');
      expect(event.message_id.length).toBeGreaterThan(0);
      // requested_at must be a positive epoch-ms number
      expect(typeof event.requested_at).toBe('number');
      expect(event.requested_at).toBeGreaterThan(0);
    });

    it('works without optional source_language (passes undefined to engine)', async () => {
      const expected = stubResult({ source_language: 'auto' });
      mockEngine.translate.mockResolvedValue(expected);

      const result = await controller.translate({
        text: 'Hello',
        target_language: 'vi',
        user_id: VALID_USER_ID,
        // source_language intentionally omitted
      } as never);

      expect(result).toBe(expected);
      expect(
        mockEngine.translate.mock.calls[0][0].source_language,
      ).toBeUndefined();
    });

    it('returns the engine result object by reference (no cloning)', async () => {
      const expected = stubResult();
      mockEngine.translate.mockResolvedValue(expected);

      const result = await controller.translate({
        text: 'Test',
        target_language: 'en',
        user_id: VALID_USER_ID,
      } as never);

      expect(result).toBe(expected);
    });
  });
});
