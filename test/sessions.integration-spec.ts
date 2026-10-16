import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import {
  MailAdapter,
  VerificationMail,
} from '../src/modules/email/mail.adapter';
import { AuthClock } from '../src/modules/auth/auth-clock.service';
import { PasswordService } from '../src/modules/auth/password.service';
import { VerificationTokenService } from '../src/modules/auth/verification-token.service';
import { connectTestDatabase } from './helpers/test-database';

interface Credentials {
  accessToken: string;
  refreshToken: string;
}

describe('Login, rotation and recovery HTTP (dedicated PostgreSQL)', () => {
  let client: PrismaClient;
  let app: INestApplication<App>;
  let now: number;
  let address: string;
  let userId: string;
  const messages: VerificationMail[] = [];
  const password = 'correct horse battery staple';
  const nextPassword = 'a different secure password';
  const tokens = new VerificationTokenService();
  const send = jest.fn();
  const login = (email = address, secret = password) =>
    request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: secret });
  const refresh = (refreshToken: string) =>
    request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken });
  const forgot = (email = address) =>
    request(app.getHttpServer())
      .post('/api/v1/auth/forgot-password')
      .send({ email });
  const reset = (token: string) =>
    request(app.getHttpServer())
      .post('/api/v1/auth/reset-password')
      .send({ token, password: nextPassword });
  const resetToken = () => {
    const match = messages.at(-1)?.text.match(/https?:\/\/\S+/);
    if (!match) throw new Error('Missing test email');
    return new URL(match[0]).searchParams.get('token')!;
  };
  beforeAll(async () => {
    client = await connectTestDatabase();
  });
  beforeEach(async () => {
    now = Date.now();
    messages.length = 0;
    send.mockReset().mockImplementation((message: VerificationMail) => {
      messages.push(message);
      return Promise.resolve('smtp-accepted');
    });
    address = `${randomUUID()}@sessions.example.invalid`;
    const user = await client.user.create({
      data: {
        fullName: 'Session Owner',
        email: address,
        emailVerifiedAt: new Date(now),
        passwordHash: await new PasswordService().hash(password),
      },
    });
    userId = user.id;
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MailAdapter)
      .useValue({ send })
      .overrideProvider(AuthClock)
      .useValue({ now: () => new Date(now) })
      .compile();
    app = module.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    await app?.close();
    if (userId)
      await client.user.deleteMany({ where: { id: userId, email: address } });
  });
  afterAll(async () => {
    await client?.$disconnect();
  });

  it('logs in, authenticates /me, rotates once and contains replay', async () => {
    const response = await login(` ${address.toUpperCase()} `).expect(200);
    expect(response.headers['cache-control']).toBe('no-store');
    const first = response.body as Credentials;
    expect(Object.keys(first).sort()).toEqual([
      'accessToken',
      'expiresIn',
      'refreshToken',
      'tokenType',
    ]);
    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${first.accessToken}`)
      .expect(200);
    const session = await client.refreshSession.findUniqueOrThrow({
      where: { tokenHash: tokens.hash(first.refreshToken) },
    });
    expect(session.tokenHash).not.toBe(first.refreshToken);
    const second = (await refresh(first.refreshToken).expect(200))
      .body as Credentials;
    expect(second.refreshToken).not.toBe(first.refreshToken);
    await refresh(first.refreshToken).expect(401);
    await refresh(second.refreshToken).expect(401);
    expect(
      await client.refreshSession.count({
        where: { familyId: session.familyId, revokedAt: null },
      }),
    ).toBe(0);
  });
  it('serializes simultaneous refresh requests and revokes the winning descendant', async () => {
    const first = (await login().expect(200)).body as Credentials;
    const results = await Promise.all([
      refresh(first.refreshToken),
      refresh(first.refreshToken),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 401]);
    const winner = results.find((r) => r.status === 200)!.body as Credentials;
    await refresh(winner.refreshToken).expect(401);
    expect(
      await client.refreshSession.count({ where: { userId, revokedAt: null } }),
    ).toBe(0);
  });
  it('rejects wrong, unverified and inactive logins with the same safe 401', async () => {
    await login(address, 'incorrect').expect(401);
    await login(`${randomUUID()}@missing.example.invalid`).expect(401);
    await client.user.update({
      where: { id: userId },
      data: { emailVerifiedAt: null },
    });
    await login().expect(401);
    await client.user.update({
      where: { id: userId },
      data: { emailVerifiedAt: new Date(now), status: 'SUSPENDED' },
    });
    await login().expect(401);
    expect(await client.refreshSession.count({ where: { userId } })).toBe(0);
  });
  it('rejects refresh expiry and current user suspension', async () => {
    const first = (await login().expect(200)).body as Credentials;
    now += 604800000;
    await refresh(first.refreshToken).expect(401);
    now -= 604800000;
    const second = (await login().expect(200)).body as Credentials;
    await client.user.update({
      where: { id: userId },
      data: { status: 'DISABLED' },
    });
    await refresh(second.refreshToken).expect(401);
  });
  it('logout revokes its family, is idempotent, and preserves short-lived access tokens', async () => {
    const first = (await login().expect(200)).body as Credentials;
    const other = (await login().expect(200)).body as Credentials;
    const second = (await refresh(first.refreshToken).expect(200))
      .body as Credentials;
    const logout = () =>
      request(app.getHttpServer())
        .post('/api/v1/auth/logout')
        .send({ refreshToken: first.refreshToken });
    await logout().expect(204);
    await logout().expect(204);
    await refresh(second.refreshToken).expect(401);
    await refresh(other.refreshToken).expect(200);
    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${first.accessToken}`)
      .expect(200);
  });
  it('uses generic recovery, cooldown, hashed one-time reset and revokes all sessions', async () => {
    const credentials = (await login().expect(200)).body as Credentials;
    const missing = await forgot(
      `${randomUUID()}@missing.example.invalid`,
    ).expect(200);
    expect((await forgot().expect(200)).body).toEqual(missing.body);
    await new Promise<void>((resolve) => setImmediate(resolve));
    const raw = resetToken();
    const stored = await client.passwordResetToken.findUniqueOrThrow({
      where: { tokenHash: tokens.hash(raw) },
    });
    expect(stored.tokenHash).not.toBe(raw);
    expect((await forgot().expect(200)).body).toEqual(missing.body);
    expect(messages).toHaveLength(1);
    await reset(raw).expect(200);
    await reset(raw).expect(400);
    await refresh(credentials.refreshToken).expect(401);
    await login().expect(401);
    await login(address, nextPassword).expect(200);
  });
  it('invalidates prior reset tokens, rejects expiry, and handles concurrent consumption', async () => {
    await forgot().expect(200);
    const first = resetToken();
    now += 61000;
    await forgot().expect(200);
    const second = resetToken();
    await reset(first).expect(400);
    const results = await Promise.all([reset(second), reset(second)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 400]);
    now += 61000;
    await forgot().expect(200);
    const expired = resetToken();
    now += 1800000;
    await reset(expired).expect(400);
  });
  it('rolls back consumed refresh tokens if replacement persistence fails', async () => {
    const first = (await login().expect(200)).body as Credentials;
    const issuer = app.get(VerificationTokenService);
    jest.spyOn(issuer, 'create').mockImplementationOnce(() => {
      throw new Error('test issuance failure');
    });
    await refresh(first.refreshToken).expect(500);
    expect(
      (
        await client.refreshSession.findUniqueOrThrow({
          where: { tokenHash: tokens.hash(first.refreshToken) },
        })
      ).revokedAt,
    ).toBeNull();
    await refresh(first.refreshToken).expect(200);
  });
});
