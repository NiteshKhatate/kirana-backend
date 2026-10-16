import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service';
import { EmailService } from '../email/email.service';
import { SecurityEvents } from '../audit/security-events.service';
import { SessionService } from './session.service';
import { VerificationTokenService } from './verification-token.service';
import { AccessTokenIssuer } from './access-token-issuer.service';

describe('SessionService', () => {
  const now = new Date('2026-10-16T12:00:00Z');
  let service: SessionService;
  const user = {
    id: 'user',
    status: 'ACTIVE',
    emailVerifiedAt: now,
    passwordHash: 'hash',
  };
  const tx = {
    $queryRaw: jest.fn(),
    user: { findUnique: jest.fn(), update: jest.fn() },
    refreshSession: {
      findUnique: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
    },
    passwordResetToken: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
    },
  };
  const prisma = { ...tx, $transaction: jest.fn() };
  const passwords = { hash: jest.fn(), verify: jest.fn() };
  const issuer = { issue: jest.fn() };
  const email = { sendPasswordReset: jest.fn() };
  const events = { record: jest.fn() };
  beforeEach(() => {
    jest.resetAllMocks();
    prisma.$transaction.mockImplementation(
      (work: (value: typeof tx) => unknown) => work(tx),
    );
    tx.user.findUnique.mockResolvedValue(user);
    tx.refreshSession.updateMany.mockResolvedValue({ count: 1 });
    tx.passwordResetToken.updateMany.mockResolvedValue({ count: 1 });
    passwords.hash.mockResolvedValue('new-hash');
    passwords.verify.mockResolvedValue(true);
    issuer.issue.mockReturnValue('signed-access');
    email.sendPasswordReset.mockResolvedValue('smtp-accepted');
    service = new SessionService(
      prisma as unknown as PrismaService,
      passwords,
      new VerificationTokenService(),
      { now: () => now },
      new ConfigService({
        SESSION: { refreshTtlSeconds: 604800, resetTtlSeconds: 1800 },
        JWT: { maxLifetimeSeconds: 900 },
      }),
      issuer as unknown as AccessTokenIssuer,
      email as unknown as EmailService,
      events as unknown as SecurityEvents,
    );
  });
  it('issues opaque credentials, persists only a digest and normalizes login', async () => {
    const result = await service.login({
      email: ' OWNER@Example.com ',
      password: 'password',
    });
    expect(tx.user.findUnique).toHaveBeenCalledWith({
      where: { email: 'owner@example.com' },
      select: { id: true },
    });
    expect(result).toMatchObject({
      accessToken: 'signed-access',
      tokenType: 'Bearer',
      expiresIn: 900,
    });
    expect(result.refreshToken).toMatch(/^[a-f0-9]{64}$/);
    const data = (
      tx.refreshSession.create.mock.calls[0] as [
        { data: { tokenHash: string } },
      ]
    )[0].data;
    expect(data.tokenHash).toBe(
      new VerificationTokenService().hash(result.refreshToken),
    );
    expect(JSON.stringify(data)).not.toContain(result.refreshToken);
  });
  it.each([
    { ...user, emailVerifiedAt: null },
    { ...user, status: 'SUSPENDED' },
    { ...user, status: 'DISABLED' },
  ])('rejects ineligible users', async (value) => {
    tx.user.findUnique.mockResolvedValue(value);
    await expect(
      service.login({ email: 'owner@example.com', password: 'password' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(tx.refreshSession.create).not.toHaveBeenCalled();
  });
  it('rejects incorrect passwords and does dummy work for unknown accounts', async () => {
    passwords.verify.mockResolvedValue(false);
    await expect(
      service.login({ email: 'owner@example.com', password: 'wrong' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    tx.user.findUnique.mockResolvedValue(null);
    await expect(
      service.login({ email: 'unknown@example.com', password: 'wrong' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(passwords.hash).toHaveBeenCalled();
  });
  it.each(['revoked', 'expired'])(
    'commits family containment before rejecting %s refresh',
    async (kind) => {
      tx.refreshSession.findUnique.mockResolvedValue({
        id: 'session',
        userId: 'user',
        familyId: 'family',
        revokedAt: kind === 'revoked' ? now : null,
        expiresAt: kind === 'expired' ? now : new Date(now.getTime() + 10000),
      });
      await expect(service.refresh('raw')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(tx.refreshSession.updateMany).toHaveBeenCalledWith({
        where: { familyId: 'family', revokedAt: null },
        data: { revokedAt: now },
      });
      await expect(
        prisma.$transaction.mock.results[0].value as Promise<unknown>,
      ).resolves.toBeNull();
    },
  );
  it('rotates within the existing family and preserves absolute expiry', async () => {
    const expiresAt = new Date(now.getTime() + 10000);
    tx.refreshSession.findUnique.mockResolvedValue({
      id: 'session',
      userId: 'user',
      familyId: 'family',
      revokedAt: null,
      expiresAt,
    });
    await service.refresh('raw');
    expect(tx.refreshSession.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        familyId: 'family',
        expiresAt,
      }) as unknown,
    });
  });
  it('returns the same recovery response for missing, cooldown and eligible accounts', async () => {
    tx.user.findUnique.mockResolvedValueOnce(null);
    const missing = await service.forgotPassword('missing@example.com');
    tx.passwordResetToken.findFirst.mockResolvedValueOnce({ id: 'recent' });
    expect(await service.forgotPassword('owner@example.com')).toEqual(missing);
    expect(await service.forgotPassword('owner@example.com')).toEqual(missing);
    await service.onModuleDestroy();
    expect(email.sendPasswordReset).toHaveBeenCalledTimes(1);
  });
  it('returns generic recovery success on mail failure without leaking it', async () => {
    email.sendPasswordReset.mockRejectedValueOnce(new Error('secret'));
    await expect(
      service.forgotPassword('owner@example.com'),
    ).resolves.toHaveProperty('message');
    await service.onModuleDestroy();
    expect(events.record).toHaveBeenCalledWith(
      'password_reset.delivery_failed',
      'user',
    );
  });
  it('rejects a consumed reset and revokes all sessions on successful reset', async () => {
    tx.passwordResetToken.findUnique.mockResolvedValue({
      id: 'reset',
      userId: 'user',
    });
    tx.passwordResetToken.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(
      service.resetPassword({ token: 'token', password: 'new-password' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.user.update).not.toHaveBeenCalled();
    await service.resetPassword({ token: 'token', password: 'new-password' });
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: 'user' },
      data: { passwordHash: 'new-hash' },
    });
    expect(tx.refreshSession.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user', revokedAt: null },
      data: { revokedAt: now },
    });
  });
  it('logs out the complete family and treats unknown credentials idempotently', async () => {
    await service.logout('unknown');
    expect(tx.refreshSession.updateMany).not.toHaveBeenCalled();
    tx.refreshSession.findUnique.mockResolvedValue({
      userId: 'user',
      familyId: 'family',
    });
    await service.logout('raw');
    expect(tx.refreshSession.updateMany).toHaveBeenCalledWith({
      where: { familyId: 'family', revokedAt: null },
      data: { revokedAt: now },
    });
  });
});
