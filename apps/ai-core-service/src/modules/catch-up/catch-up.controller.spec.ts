import { Test, TestingModule } from '@nestjs/testing';
import { CatchUpController } from './catch-up.controller';
import { CatchUpEngine } from './catch-up.engine';
import { BusinessException } from '@app/types';
import type { AiCatchUpResultEvent } from '@libs/contracts';

// ── Helper ─────────────────────────────────────────────────────────────────

function stubResult(
  overrides: Partial<AiCatchUpResultEvent> = {},
): AiCatchUpResultEvent {
  return {
    conversation_id: 'conv-001',
    user_id: 'user-001',
    had_unread: true,
    summary: 'You missed a lot.',
    message_count: 5,
    from_message_id: 'msg-1',
    to_message_id: 'msg-5',
    since: 1_000_000,
    truncated: false,
    provider: 'openai',
    tokens_used: 150,
    cached: false,
    generated_at: Date.now(),
    ...overrides,
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('CatchUpController', () => {
  let controller: CatchUpController;
  let mockEngine: jest.Mocked<CatchUpEngine>;

  beforeEach(async () => {
    mockEngine = {
      summarizeUnread: jest.fn(),
    } as unknown as jest.Mocked<CatchUpEngine>;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [CatchUpController],
      providers: [{ provide: CatchUpEngine, useValue: mockEngine }],
    }).compile();

    controller = module.get(CatchUpController);
  });

  // ── validation errors ────────────────────────────────────────────────────

  describe('validation', () => {
    it('throws 400 when conversation_id is missing', async () => {
      await expect(
        controller.getCatchUp({
          conversation_id: '',
          user_id: 'user-001',
        } as never),
      ).rejects.toBeInstanceOf(BusinessException);
    });

    it('throws 400 when user_id is missing', async () => {
      await expect(
        controller.getCatchUp({
          conversation_id: 'conv-001',
          user_id: '',
        } as never),
      ).rejects.toBeInstanceOf(BusinessException);
    });

    it('throws 400 when since is a non-numeric string', async () => {
      await expect(
        controller.getCatchUp({
          conversation_id: 'conv-001',
          user_id: 'user-001',
          since: 'not-a-number',
        } as never),
      ).rejects.toBeInstanceOf(BusinessException);
    });

    it('throws 400 when limit is a non-numeric string', async () => {
      await expect(
        controller.getCatchUp({
          conversation_id: 'conv-001',
          user_id: 'user-001',
          limit: 'abc',
        } as never),
      ).rejects.toBeInstanceOf(BusinessException);
    });

    it('throws 400 when since is negative', async () => {
      await expect(
        controller.getCatchUp({
          conversation_id: 'conv-001',
          user_id: 'user-001',
          since: '-1',
        } as never),
      ).rejects.toBeInstanceOf(BusinessException);
    });

    // m2: limit bounds
    it('throws 400 when limit is zero', async () => {
      await expect(
        controller.getCatchUp({
          conversation_id: 'conv-001',
          user_id: 'user-001',
          limit: '0',
        } as never),
      ).rejects.toBeInstanceOf(BusinessException);
    });

    it('throws 400 when limit is negative', async () => {
      await expect(
        controller.getCatchUp({
          conversation_id: 'conv-001',
          user_id: 'user-001',
          limit: '-5',
        } as never),
      ).rejects.toBeInstanceOf(BusinessException);
    });
  });

  // ── delegation ───────────────────────────────────────────────────────────

  describe('delegation', () => {
    it('delegates to the engine with correctly parsed since/limit', async () => {
      const expected = stubResult();
      mockEngine.summarizeUnread.mockResolvedValue(expected);

      const result = await controller.getCatchUp({
        conversation_id: 'conv-001',
        user_id: 'user-001',
        since: '1716537600000',
        limit: '20',
      });

      expect(mockEngine.summarizeUnread).toHaveBeenCalledWith({
        conversation_id: 'conv-001',
        user_id: 'user-001',
        since: 1_716_537_600_000,
        limit: 20,
      });
      expect(result).toEqual(expected);
    });

    it('delegates without since/limit when they are not provided', async () => {
      const expected = stubResult({ since: undefined });
      mockEngine.summarizeUnread.mockResolvedValue(expected);

      const result = await controller.getCatchUp({
        conversation_id: 'conv-001',
        user_id: 'user-001',
      });

      expect(mockEngine.summarizeUnread).toHaveBeenCalledWith({
        conversation_id: 'conv-001',
        user_id: 'user-001',
        since: undefined,
        limit: undefined,
      });
      expect(result).toEqual(expected);
    });

    it('returns the engine result unchanged', async () => {
      const expected = stubResult({ summary: 'Something special' });
      mockEngine.summarizeUnread.mockResolvedValue(expected);

      const result = await controller.getCatchUp({
        conversation_id: 'conv-001',
        user_id: 'user-001',
      });

      expect(result.summary).toBe('Something special');
    });
  });
});
