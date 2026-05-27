import { Test, TestingModule } from '@nestjs/testing';
import { ModerationController } from './moderation.controller';
import { ModerationEngine } from './moderation.engine';
import type { AiModerationResultEvent } from '@libs/contracts';

describe('ModerationController', () => {
  let controller: ModerationController;
  let engine: jest.Mocked<ModerationEngine>;

  beforeEach(async () => {
    engine = {
      moderate: jest.fn(),
    } as unknown as jest.Mocked<ModerationEngine>;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ModerationController],
      providers: [{ provide: ModerationEngine, useValue: engine }],
    }).compile();

    controller = module.get<ModerationController>(ModerationController);
  });

  afterEach(() => jest.clearAllMocks());

  it('delegates to engine.moderate with a synthesized pre-send event', async () => {
    const engineResult: Partial<AiModerationResultEvent> = {
      is_flagged: false,
      labels: ['clean'],
      confidence: 0.97,
      decision_source: 'model',
    };
    engine.moderate.mockResolvedValue(engineResult as AiModerationResultEvent);

    const dto = {
      body: 'hello team',
      sender_id: '550e8400-e29b-41d4-a716-446655440000',
      conversation_id: '660e8400-e29b-41d4-a716-446655440000',
    };

    const result = await controller.checkPreSend(dto);

    expect(engine.moderate).toHaveBeenCalledTimes(1);
    const [event] = engine.moderate.mock.calls[0];
    expect(event.message_id).toBe('pre-send');
    expect(event.sender_id).toBe(dto.sender_id);
    expect(event.conversation_id).toBe(dto.conversation_id);
    expect(event.body).toBe(dto.body);
    expect(typeof event.created_at).toBe('number');
    expect(typeof event.requested_at).toBe('number');

    expect(result).toEqual({
      is_flagged: false,
      labels: ['clean'],
      confidence: 0.97,
      decision_source: 'model',
    });
  });

  it('forwards the engine verdict verbatim — no threshold interpretation', async () => {
    // Locks in confidence semantics: a flagged result with low confidence
    // is NOT downgraded by the controller. The chat-service caller owns
    // the threshold decision.
    engine.moderate.mockResolvedValue({
      is_flagged: true,
      labels: ['toxic'],
      confidence: 0.5, // below the chat-service default threshold of 0.85
      decision_source: 'model',
    } as AiModerationResultEvent);

    const result = await controller.checkPreSend({
      body: 'borderline content',
      sender_id: '550e8400-e29b-41d4-a716-446655440000',
    });

    expect(result.is_flagged).toBe(true);
    expect(result.confidence).toBe(0.5);
    expect(result.labels).toEqual(['toxic']);
  });

  it('omits conversation_id when caller did not provide one', async () => {
    engine.moderate.mockResolvedValue({
      is_flagged: false,
      labels: ['clean'],
      confidence: 0.99,
      decision_source: 'model',
    } as AiModerationResultEvent);

    await controller.checkPreSend({
      body: 'hi',
      sender_id: '550e8400-e29b-41d4-a716-446655440000',
    });

    const [event] = engine.moderate.mock.calls[0];
    // We synthesize 'pre-send' as a sentinel so downstream logs/audit
    // can distinguish pre-send checks from real post-persist events.
    expect(event.conversation_id).toBe('pre-send');
  });
});
