import { randomUUID } from 'node:crypto';
import { INestApplication, Logger } from '@nestjs/common';
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
import { VerificationTokenService } from '../src/modules/auth/verification-token.service';
import { PasswordService } from '../src/modules/auth/password.service';
import { connectTestDatabase } from './helpers/test-database';
import { testAccessToken } from './helpers/access-token';

describe('Registration → verification HTTP (dedicated PostgreSQL, SMTP mocked)', () => {
  let client: PrismaClient;
  let app: INestApplication<App>;
  let instant: number;
  const fixtureEmails = new Set<string>();
  const messages: VerificationMail[] = [];
  const send = jest.fn();
  const password = 'correct horse battery staple';

  function email() {
    const value = `${randomUUID()}@registration.example.invalid`;
    fixtureEmails.add(value);
    return value;
  }
  function token(index = messages.length - 1): string {
    const match = messages[index].text.match(/https?:\/\/\S+/);
    if (!match) throw new Error('Missing fixture link');
    return new URL(match[0]).searchParams.get('token')!;
  }
  function register(address: string) {
    return request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ fullName: ' Owner ', email: address, password });
  }
  function verify(value: string) {
    return request(app.getHttpServer())
      .post('/api/v1/auth/verify-email')
      .send({ token: value });
  }
  function resend(address: string) {
    return request(app.getHttpServer())
      .post('/api/v1/auth/resend-verification')
      .send({ email: address });
  }

  beforeAll(async () => {
    client = await connectTestDatabase();
  });
  beforeEach(async () => {
    instant = new Date('2026-10-13T12:00:00Z').getTime();
    messages.length = 0;
    send.mockReset().mockImplementation((message: VerificationMail) => {
      messages.push(message);
      return Promise.resolve('smtp-accepted');
    });
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MailAdapter)
      .useValue({ send })
      .overrideProvider(AuthClock)
      .useValue({ now: () => new Date(instant) })
      .compile();
    app = module.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    await app?.close();
    // Concurrency tests need committed transactions. Remove only this suite's
    // exact UUID-named fixtures from the verified dedicated test database.
    if (fixtureEmails.size)
      await client.user.deleteMany({
        where: { email: { in: [...fixtureEmails] } },
      });
    fixtureEmails.clear();
  });
  afterAll(async () => {
    await client?.$disconnect();
  });

  it('normalizes registration, stores only hashes, verifies once and emits no credentials in logs', async () => {
    const address = email();
    const log = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    const response = await register(` ${address.toUpperCase()} `).expect(201);
    expect(response.body).toMatchObject({
      verificationEmailDelivery: 'smtp-accepted',
      user: {
        email: address,
        fullName: 'Owner',
        emailVerifiedAt: null,
        status: 'ACTIVE',
      },
    });
    expect(
      Object.keys((response.body as { user: object }).user).sort(),
    ).toEqual([
      'createdAt',
      'email',
      'emailVerifiedAt',
      'fullName',
      'id',
      'status',
    ]);
    const user = await client.user.findUniqueOrThrow({
      where: { email: address },
      include: { emailTokens: true },
    });
    expect(user.passwordHash).toMatch(/^\$argon2id\$/);
    expect(
      await new PasswordService().verify(user.passwordHash, password),
    ).toBe(true);
    const raw = token();
    expect(user.emailTokens[0].tokenHash).toBe(
      new VerificationTokenService().hash(raw),
    );
    expect(user.emailTokens[0].tokenHash).not.toBe(raw);
    await verify(raw).expect(200).expect({ message: 'Email verified.' });
    await verify(raw).expect(400);
    expect(
      (await client.user.findUniqueOrThrow({ where: { id: user.id } }))
        .emailVerifiedAt,
    ).toEqual(new Date(instant));
    const logs = JSON.stringify(log.mock.calls);
    for (const secret of [
      address,
      password,
      raw,
      user.passwordHash,
      user.emailTokens[0].tokenHash,
    ])
      expect(logs).not.toContain(secret);
    expect(logs).toContain('account.registered');
    expect(logs).toContain('email.verified');
    expect(JSON.stringify(response.body)).not.toContain(raw);
  });

  it('enforces normalized duplicate emails, including concurrent registration', async () => {
    const address = email();
    const responses = await Promise.all([
      register(address),
      register(address.toUpperCase()),
    ]);
    expect(responses.map((result) => result.status).sort()).toEqual([201, 409]);
    expect(await client.user.count({ where: { email: address } })).toBe(1);
    expect(messages).toHaveLength(1);
  });

  it('rolls back user creation when verification-token persistence fails', async () => {
    const address = email();
    jest
      .spyOn(app.get(VerificationTokenService), 'hash')
      .mockReturnValue('x'.repeat(129));
    await register(address).expect(500);
    expect(await client.user.count({ where: { email: address } })).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });

  it('keeps the account and allows retry when SMTP fails', async () => {
    const address = email();
    send.mockRejectedValueOnce(new Error('private SMTP failure'));
    const response = await register(address).expect(201);
    expect(
      (response.body as { verificationEmailDelivery: string })
        .verificationEmailDelivery,
    ).toBe('failed');
    expect(await client.user.count({ where: { email: address } })).toBe(1);
    instant += 60000;
    await resend(address).expect(200);
    await verify(token()).expect(200);
  });

  it('rejects expired, missing, used and inactive-account tokens', async () => {
    const address = email();
    await register(address).expect(201);
    const raw = token();
    instant += 86400000;
    await verify(raw).expect(400);
    await verify('f'.repeat(64)).expect(400);
    await resend(address).expect(200);
    const current = token();
    await client.user.update({
      where: { email: address },
      data: { status: 'SUSPENDED' },
    });
    await verify(current).expect(400);
    await client.user.update({
      where: { email: address },
      data: { status: 'ACTIVE' },
    });
    await verify(current).expect(200);
    await verify(current).expect(400);
  });

  it('permits only one simultaneous verification of a token', async () => {
    await register(email()).expect(201);
    const raw = token();
    const results = await Promise.all([verify(raw), verify(raw)]);
    expect(results.map((result) => result.status).sort()).toEqual([200, 400]);
  });

  it('uses a generic resend response, DB cooldown and atomic invalidation', async () => {
    const address = email();
    await register(address).expect(201);
    const original = token();
    const cooldown = await resend(address).expect(200);
    expect(messages).toHaveLength(1);
    const missing = await resend(email()).expect(200);
    expect(missing.body).toEqual(cooldown.body);
    instant += 60000;
    const results = await Promise.all([resend(address), resend(address)]);
    expect(results.every((result) => result.status === 200)).toBe(true);
    expect(messages).toHaveLength(2);
    await verify(original).expect(400);
    await verify(token()).expect(200);
    const verified = await resend(address).expect(200);
    expect(verified.body).toEqual(missing.body);
    expect(messages).toHaveLength(2);
  });

  it('serializes concurrent resend and verify without leaving an active token on a verified account', async () => {
    const address = email();
    await register(address).expect(201);
    const raw = token();
    instant += 60000;
    const results = await Promise.all([verify(raw), resend(address)]);
    expect([200, 400]).toContain(results[0].status);
    expect(results[1].status).toBe(200);
    const user = await client.user.findUniqueOrThrow({
      where: { email: address },
      include: { emailTokens: true },
    });
    if (user.emailVerifiedAt)
      expect(user.emailTokens.every((value) => value.usedAt !== null)).toBe(
        true,
      );
    else await verify(token()).expect(200);
  });

  it('validates actual registration DTOs and never accepts privilege fields', async () => {
    const address = email();
    for (const body of [
      { fullName: 'Owner', email: address, password: 'short' },
      { fullName: 'Owner', email: address, password, status: 'ACTIVE' },
      { fullName: '   ', email: address, password },
      { fullName: 'Owner', email: 'invalid', password },
      { fullName: 'Owner', email: address, password: ' '.repeat(12) },
    ])
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send(body)
        .expect(400);
    expect(await client.user.count({ where: { email: address } })).toBe(0);
    await request(app.getHttpServer())
      .post('/api/v1/auth/verify-email')
      .send({ token: 'invalid' })
      .expect(400);
  });

  it('authenticates /me after verification and immediately rejects suspended accounts', async () => {
    const address = email();
    await register(address).expect(201);
    const user = await client.user.findUniqueOrThrow({
      where: { email: address },
    });
    const issuedAt = Math.floor(instant / 1000);
    const access = testAccessToken(user.id, {
      iat: issuedAt,
      exp: issuedAt + 900,
      email: 'untrusted@example.invalid',
      role: 'OWNER',
    });
    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${access}`)
      .expect(401);
    await verify(token()).expect(200);
    const response = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${access}`)
      .expect(200);
    expect(response.body).toMatchObject({
      id: user.id,
      email: address,
      status: 'ACTIVE',
    });
    expect(Object.keys(response.body as object).sort()).toEqual([
      'createdAt',
      'email',
      'emailVerifiedAt',
      'fullName',
      'id',
      'status',
    ]);
    await client.user.update({
      where: { id: user.id },
      data: { status: 'SUSPENDED' },
    });
    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${access}`)
      .expect(401);
  });

  it('enforces request rate limits before hashing or issuing mail', async () => {
    for (let i = 0; i < 5; i++)
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({})
        .expect(400);
    await register(email()).expect(429);
    expect(send).not.toHaveBeenCalled();
  });
});
