import { ExecutionContext } from '@nestjs/common';
import { AuthClock } from './auth-clock.service';
import { AuthRateLimitGuard } from './auth-rate-limit.guard';

describe('Auth request limits', () => {
  const clock = new AuthClock();
  let guard: AuthRateLimitGuard;
  let instant: number;
  beforeEach(() => {
    instant = 100000;
    jest.spyOn(clock, 'now').mockImplementation(() => new Date(instant));
    guard = new AuthRateLimitGuard(clock);
  });
  afterEach(() => jest.restoreAllMocks());

  it('limits a bucket and restores allowance at expiry', () => {
    guard.consume('peer', 1);
    expect(() => guard.consume('peer', 1)).toThrow('Too Many Requests');
    guard.consume('different-peer', 1);
    instant += 60000;
    expect(() => guard.consume('peer', 1)).not.toThrow();
  });

  it('applies the registration limit to the transport peer without trusting forwarded headers', () => {
    const context = {
      getHandler: () => function register() {},
      switchToHttp: () => ({
        getRequest: () => ({
          ip: '127.0.0.1',
          headers: { 'x-forwarded-for': 'untrusted' },
          socket: {},
        }),
      }),
    } as unknown as ExecutionContext;
    for (let i = 0; i < 5; i++) expect(guard.canActivate(context)).toBe(true);
    expect(() => guard.canActivate(context)).toThrow('Too Many Requests');
  });
});
