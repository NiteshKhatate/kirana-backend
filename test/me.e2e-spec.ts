import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { PrismaService } from '../src/database/prisma.service';
import { testAccessToken } from './helpers/access-token';

describe('Authenticated profile HTTP (database mocked)', () => {
  let app: INestApplication<App>;
  const findUnique = jest.fn();
  const user = {
    id: randomUUID(),
    fullName: 'Verified Owner',
    email: 'owner@example.com',
    status: 'ACTIVE',
    emailVerifiedAt: new Date(),
    createdAt: new Date(),
  };
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue({ user: { findUnique } })
      .compile();
    app = module.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
  });
  beforeEach(() => {
    findUnique.mockReset().mockResolvedValue(user);
  });
  afterAll(async () => {
    await app?.close();
  });

  it('returns the current verified subject with no-store caching and no secrets', async () => {
    const response = await request(app.getHttpServer())
      .get(`/api/v1/auth/me?userId=${randomUUID()}`)
      .set('Authorization', `Bearer ${testAccessToken(user.id)}`)
      .expect(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).toEqual({
      ...user,
      emailVerifiedAt: user.emailVerifiedAt.toISOString(),
      createdAt: user.createdAt.toISOString(),
    });
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: user.id } }),
    );
    expect(response.body).not.toHaveProperty('passwordHash');
  });
  it('returns a generic correlated 401 for missing or invalid authentication', async () => {
    const missing = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('x-request-id', 'me-auth-check')
      .expect(401);
    expect(missing.body).toMatchObject({
      statusCode: 401,
      message: 'Unauthorized',
      requestId: 'me-auth-check',
    });
    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', 'Bearer invalid')
      .expect(401);
    expect(findUnique).not.toHaveBeenCalled();
  });
  it.each(['SUSPENDED', 'DISABLED', 'UNVERIFIED', 'DELETED'])(
    'rejects a currently %s account despite a valid JWT',
    async (status) => {
      findUnique.mockResolvedValueOnce(
        status === 'DELETED'
          ? null
          : {
              ...user,
              status: status === 'UNVERIFIED' ? 'ACTIVE' : status,
              emailVerifiedAt:
                status === 'UNVERIFIED' ? null : user.emailVerifiedAt,
            },
      );
      await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${testAccessToken(user.id)}`)
        .expect(401);
    },
  );
});
