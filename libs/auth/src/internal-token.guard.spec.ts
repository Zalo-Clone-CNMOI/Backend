import { ExecutionContext } from '@nestjs/common';
import { InternalTokenGuard } from './internal-token.guard';

function ctx(headerVal?: string): ExecutionContext {
  return {
    getType: () => 'http',
    switchToHttp: () => ({
      getRequest: () => ({ headers: { 'x-internal-token': headerVal } }),
    }),
  } as unknown as ExecutionContext;
}

describe('InternalTokenGuard', () => {
  it('allows when token matches config', () => {
    const guard = new InternalTokenGuard({
      internalMonitoringToken: 'secret',
    } as never);
    expect(guard.canActivate(ctx('secret'))).toBe(true);
  });

  it('denies when token missing', () => {
    const guard = new InternalTokenGuard({
      internalMonitoringToken: 'secret',
    } as never);
    expect(guard.canActivate(ctx(undefined))).toBe(false);
  });

  it('denies when token mismatches', () => {
    const guard = new InternalTokenGuard({
      internalMonitoringToken: 'secret',
    } as never);
    expect(guard.canActivate(ctx('wrong'))).toBe(false);
  });

  it('denies when config secret unset (fail closed)', () => {
    const guard = new InternalTokenGuard({} as never);
    expect(guard.canActivate(ctx('anything'))).toBe(false);
  });
});
