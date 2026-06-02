import {
  withTimeout,
  AI_SYNC_COMPLETION_TIMEOUT_MS,
} from './with-timeout.util';

describe('withTimeout', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('resolves with the value when the promise settles before the timeout', async () => {
    await expect(withTimeout(Promise.resolve('ok'), 1_000)).resolves.toBe('ok');
  });

  it('propagates the original rejection when the promise rejects before the timeout', async () => {
    await expect(
      withTimeout(Promise.reject(new Error('boom')), 1_000),
    ).rejects.toThrow('boom');
  });

  it('rejects with a descriptive, labelled error when the timeout elapses first', async () => {
    jest.useFakeTimers();
    const neverSettles = new Promise<string>(() => {});
    const raced = withTimeout(neverSettles, 25_000, 'entity_info');
    const assertion = expect(raced).rejects.toThrow(
      'entity_info timed out after 25000ms',
    );
    await jest.advanceTimersByTimeAsync(25_000);
    await assertion;
  });

  it('exports a sync-completion default below a typical 30s mobile client timeout', () => {
    expect(AI_SYNC_COMPLETION_TIMEOUT_MS).toBeLessThan(30_000);
    expect(AI_SYNC_COMPLETION_TIMEOUT_MS).toBeGreaterThan(0);
  });
});
