import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { validateMailEnvironment } from '../../config/mail-environment';
import { EmailService } from '../email/email.service';
import { SecurityEvents } from '../audit/security-events.service';
import { AuthService } from './auth.service';
import { PasswordService } from './password.service';
import { VerificationTokenService } from './verification-token.service';
import { AuthClock } from './auth-clock.service';

describe('Registration and verification service', () => {
  const now = new Date('2026-10-13T12:00:00Z');
  const raw = 'a'.repeat(64);
  const user = {
    id: '11111111-1111-4111-8111-111111111111',
    fullName: 'Owner',
    email: 'owner@example.com',
    status: 'ACTIVE',
    emailVerifiedAt: null,
    createdAt: now,
  };
  let service: AuthService;
  const tx = {
    user: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
    emailVerificationToken: {
      findUnique: jest.fn(),
      updateMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
    },
    $queryRaw: jest.fn(),
  };
  const mail = { sendVerification: jest.fn() };
  const events = { record: jest.fn() };
  const passwords = { hash: jest.fn() };
  const tokens = new VerificationTokenService();
  const clock = new AuthClock();

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(tokens, 'create').mockReturnValue(raw);
    jest.spyOn(clock, 'now').mockReturnValue(now);
    passwords.hash.mockResolvedValue('$argon2id$test-fixture');
    mail.sendVerification.mockResolvedValue('smtp-accepted');
    tx.user.create.mockResolvedValue(user);
    tx.user.findUnique.mockResolvedValue(user);
    tx.emailVerificationToken.updateMany.mockResolvedValue({ count: 1 });
    tx.emailVerificationToken.findUnique.mockResolvedValue({
      id: 'token-id',
      userId: user.id,
    });
    tx.emailVerificationToken.findFirst.mockResolvedValue(null);
    const prisma = {
      $transaction: (
        work: (transaction: Prisma.TransactionClient) => Promise<unknown>,
      ) => work(tx as unknown as Prisma.TransactionClient),
    };
    service = new AuthService(
      prisma as unknown as PrismaService,
      passwords as unknown as PasswordService,
      tokens,
      clock,
      new ConfigService({ MAIL: validateMailEnvironment({}, 'test') }),
      mail as unknown as EmailService,
      events as unknown as SecurityEvents,
    );
  });
  afterEach(() => jest.restoreAllMocks());

  it('normalizes input, persists only a digest and returns an allowlisted user', async () => {
    const response = await service.register({
      fullName: ' Owner ',
      email: ' OWNER@EXAMPLE.COM ',
      password: 'a-long-password',
    });
    expect(response).toEqual({
      user,
      verificationEmailDelivery: 'smtp-accepted',
    });
    const calls = tx.user.create.mock.calls as unknown as [
      Prisma.UserCreateArgs,
    ][];
    const data = calls[0][0].data;
    expect(data.email).toBe('owner@example.com');
    expect(data.fullName).toBe('Owner');
    expect(data.passwordHash).toBe('$argon2id$test-fixture');
    expect(data.emailTokens).toEqual({
      create: {
        tokenHash: tokens.hash(raw),
        createdAt: now,
        expiresAt: new Date(now.getTime() + 86400000),
      },
    });
    expect(JSON.stringify(response)).not.toContain(raw);
    expect(JSON.stringify(response)).not.toContain('passwordHash');
    expect(events.record).toHaveBeenCalledWith('account.registered', user.id);
  });

  it('returns conflict for database-enforced duplicate email and sends no email', async () => {
    tx.user.create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('duplicate', {
        code: 'P2002',
        clientVersion: '6.19.0',
      }),
    );
    await expect(
      service.register({
        fullName: 'Owner',
        email: user.email,
        password: 'a-long-password',
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(mail.sendVerification).not.toHaveBeenCalled();
  });

  it('reports delivery failure while preserving the created account', async () => {
    mail.sendVerification.mockRejectedValueOnce(
      new Error('private SMTP details'),
    );
    const response = await service.register({
      fullName: 'Owner',
      email: user.email,
      password: 'a-long-password',
    });
    expect(response.verificationEmailDelivery).toBe('failed');
    expect(events.record).toHaveBeenCalledWith(
      'verification.delivery_failed',
      user.id,
    );
  });

  it('conditionally consumes the token with expiry checking before verification', async () => {
    await expect(service.verifyEmail(raw)).resolves.toEqual({
      message: 'Email verified.',
    });
    expect(tx.$queryRaw).toHaveBeenCalled();
    expect(tx.emailVerificationToken.updateMany).toHaveBeenCalledWith({
      where: { id: 'token-id', usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: user.id },
      data: { emailVerifiedAt: now },
    });
  });

  it('rejects an unconsumable token without verifying the user', async () => {
    tx.emailVerificationToken.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(service.verifyEmail(raw)).rejects.toMatchObject({
      status: 400,
    });
    expect(tx.user.update).not.toHaveBeenCalled();
  });

  it('rejects a missing token', async () => {
    tx.emailVerificationToken.findUnique.mockResolvedValueOnce(null);
    await expect(service.verifyEmail(raw)).rejects.toMatchObject({
      status: 400,
    });
  });

  it.each(['SUSPENDED', 'DISABLED'])(
    'rejects verification for %s accounts',
    async (status) => {
      tx.user.findUnique.mockResolvedValueOnce({ ...user, status });
      await expect(service.verifyEmail(raw)).rejects.toMatchObject({
        status: 400,
      });
      expect(tx.user.update).not.toHaveBeenCalled();
    },
  );

  it('returns identical resend responses for missing, verified and cooldown-limited users', async () => {
    tx.user.findUnique.mockResolvedValueOnce(null);
    const missing = await service.resendVerification('missing@example.com');
    tx.user.findUnique
      .mockResolvedValueOnce(user)
      .mockResolvedValueOnce({ ...user, emailVerifiedAt: now });
    expect(await service.resendVerification(user.email)).toEqual(missing);
    tx.user.findUnique.mockResolvedValue(user);
    tx.emailVerificationToken.findFirst.mockResolvedValueOnce({ id: 'recent' });
    expect(await service.resendVerification(user.email)).toEqual(missing);
    expect(mail.sendVerification).not.toHaveBeenCalled();
  });

  it('invalidates prior tokens on resend and keeps SMTP failures generic', async () => {
    mail.sendVerification.mockRejectedValueOnce(new Error('SMTP failure'));
    const response = await service.resendVerification(' OWNER@EXAMPLE.COM ');
    expect(response).toEqual({
      message:
        'If the account is eligible, a verification email will be attempted.',
    });
    expect(tx.emailVerificationToken.create).toHaveBeenCalledWith({
      data: {
        userId: user.id,
        tokenHash: tokens.hash(raw),
        createdAt: now,
        expiresAt: new Date(now.getTime() + 86400000),
      },
    });
    expect(tx.emailVerificationToken.updateMany).toHaveBeenCalledWith({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: now },
    });
  });

  it('returns the generic resend response without awaiting SMTP and drains pending mail on shutdown', async () => {
    let finish!: () => void;
    mail.sendVerification.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          finish = () => resolve('smtp-accepted');
        }),
    );
    const response = await service.resendVerification(user.email);
    expect(response).toEqual({
      message:
        'If the account is eligible, a verification email will be attempted.',
    });
    expect(mail.sendVerification).toHaveBeenCalledTimes(1);
    finish();
    await service.onModuleDestroy();
  });
});
