import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { AccessTokenGuard, AuthenticatedRequest } from './access-token.guard';
import { AccessTokenVerifier } from './access-token-verifier.service';

describe('Access token guard', () => {
  const tokens = { subject: jest.fn() };
  const users = { findVerifiedActiveUser: jest.fn() };
  const guard = new AccessTokenGuard(
    tokens as unknown as AccessTokenVerifier,
    users as unknown as UsersService,
  );
  const user = {
    id: 'authenticated-id',
    status: 'ACTIVE',
    emailVerifiedAt: new Date(),
  };
  let req: AuthenticatedRequest;
  let context: ExecutionContext;
  beforeEach(() => {
    jest.clearAllMocks();
    req = {
      headers: {},
      query: { userId: 'untrusted-id' },
    } as unknown as AuthenticatedRequest;
    context = {
      switchToHttp: () => ({ getRequest: () => req }),
    } as unknown as ExecutionContext;
    tokens.subject.mockReturnValue('authenticated-id');
    users.findVerifiedActiveUser.mockResolvedValue(user);
  });
  it.each([
    undefined,
    'Basic credential',
    'Bearer invalid',
    'Bearer a.b.c extra',
  ])(
    'rejects missing/malformed headers before database access %#',
    async (authorization) => {
      req.headers.authorization = authorization;
      await expect(guard.canActivate(context)).rejects.toThrow('Unauthorized');
      expect(users.findVerifiedActiveUser).not.toHaveBeenCalled();
    },
  );
  it('binds only the verified subject and current database profile', async () => {
    req.headers.authorization = 'Bearer a.b.c';
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(users.findVerifiedActiveUser).toHaveBeenCalledWith(
      'authenticated-id',
    );
    expect(req.user).toEqual(user);
  });
  it('rejects a failed JWT without accessing the database', async () => {
    req.headers.authorization = 'Bearer a.b.c';
    tokens.subject.mockImplementationOnce(() => {
      throw new UnauthorizedException();
    });
    await expect(guard.canActivate(context)).rejects.toThrow('Unauthorized');
    expect(users.findVerifiedActiveUser).not.toHaveBeenCalled();
  });
  it('rejects an ineligible or deleted database account', async () => {
    req.headers.authorization = 'Bearer a.b.c';
    users.findVerifiedActiveUser.mockResolvedValueOnce(null);
    await expect(guard.canActivate(context)).rejects.toThrow('Unauthorized');
  });
});
