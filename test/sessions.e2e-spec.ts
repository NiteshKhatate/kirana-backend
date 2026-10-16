import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { PrismaService } from '../src/database/prisma.service';
import { SessionService } from '../src/modules/auth/session.service';
import { AuthClock } from '../src/modules/auth/auth-clock.service';

describe('Session HTTP boundary (service mocked)', () => {
  let app: INestApplication<App>;
  let now: number;
  const sessions = {
    login: jest.fn(),
    refresh: jest.fn(),
    logout: jest.fn(),
    forgotPassword: jest.fn(),
    resetPassword: jest.fn(),
  };
  const raw = 'a'.repeat(64);
  const credentials = {
    accessToken: 'test-access',
    refreshToken: raw,
    tokenType: 'Bearer',
    expiresIn: 900,
  };
  beforeEach(async () => {
    jest.resetAllMocks();
    now = Date.now();
    sessions.login.mockResolvedValue(credentials);
    sessions.refresh.mockResolvedValue(credentials);
    sessions.forgotPassword.mockResolvedValue({
      message: 'Generic recovery response.',
    });
    sessions.resetPassword.mockResolvedValue({
      message: 'Password reset. Please log in again.',
    });
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue({})
      .overrideProvider(SessionService)
      .useValue(sessions)
      .overrideProvider(AuthClock)
      .useValue({ now: () => new Date(now) })
      .compile();
    app = module.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
  });
  afterEach(async () => {
    await app?.close();
  });
  it('normalizes login and keeps token responses uncached', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: ' OWNER@Example.com ', password: ' password preserved ' })
      .expect(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(sessions.login).toHaveBeenCalledWith({
      email: 'owner@example.com',
      password: ' password preserved ',
    });
    expect(response.body).toEqual(credentials);
    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: raw })
      .expect(200);
    await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .send({ refreshToken: raw })
      .expect(204)
      .expect('');
  });
  it.each([
    [
      'login',
      { email: 'owner@example.com', password: 'password', role: 'OWNER' },
    ],
    ['login', { email: 'invalid', password: 'password' }],
    ['refresh', { refreshToken: 'bad' }],
    ['logout', { refreshToken: raw, userId: 'injected' }],
    ['forgot-password', { email: 'invalid' }],
    ['reset-password', { token: raw, password: 'short' }],
    ['reset-password', { token: raw, password: ' '.repeat(12) }],
  ])('validates %s and rejects privilege injection', async (path, body) => {
    await request(app.getHttpServer())
      .post(`/api/v1/auth/${path}`)
      .send(body)
      .expect(400);
    for (const method of Object.values(sessions))
      expect(method).not.toHaveBeenCalled();
  });
  it('accepts recovery/reset JSON bodies and ignores query credentials', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/forgot-password')
      .send({ email: ' OWNER@Example.com ' })
      .expect(200);
    expect(sessions.forgotPassword).toHaveBeenCalledWith('owner@example.com');
    await request(app.getHttpServer())
      .post('/api/v1/auth/reset-password')
      .send({ token: raw, password: 'a secure new password' })
      .expect(200);
    await request(app.getHttpServer())
      .post(`/api/v1/auth/refresh?refreshToken=${raw}`)
      .send({})
      .expect(400);
  });
  it.each(['login', 'forgot-password', 'reset-password'])(
    'limits %s before business logic and expires the window',
    async (path) => {
      const payload =
        path === 'login'
          ? { email: 'owner@example.com', password: 'password' }
          : path === 'forgot-password'
            ? { email: 'owner@example.com' }
            : { token: raw, password: 'a secure new password' };
      const post = () =>
        request(app.getHttpServer()).post(`/api/v1/auth/${path}`).send(payload);
      for (let i = 0; i < 10; i++) await post().expect(200);
      await post().expect(429);
      now += 60000;
      await post().expect(200);
      const method =
        path === 'login'
          ? sessions.login
          : path === 'forgot-password'
            ? sessions.forgotPassword
            : sessions.resetPassword;
      expect(method).toHaveBeenCalledTimes(11);
    },
  );
  it('documents all implemented session and organization APIs', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/docs-json')
      .expect(200);
    const document = response.body as { paths: Record<string, unknown> };
    for (const path of [
      'login',
      'refresh',
      'logout',
      'forgot-password',
      'reset-password',
    ])
      expect(document.paths).toHaveProperty(`/api/v1/auth/${path}`);
    expect(document.paths).toHaveProperty('/api/v1/organizations');
    expect(document.paths).toHaveProperty('/api/v1/organizations/{orgId}');
  });
});
