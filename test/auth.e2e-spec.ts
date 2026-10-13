import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { PrismaService } from '../src/database/prisma.service';
import { AuthService } from '../src/modules/auth/auth.service';

describe('Auth HTTP contract (persistence mocked)', () => {
  let app: INestApplication<App>;
  const service = {
    register: jest.fn(),
    verifyEmail: jest.fn(),
    resendVerification: jest.fn(),
  };
  beforeAll(async () => {
    const fixture = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue({})
      .overrideProvider(AuthService)
      .useValue(service)
      .compile();
    app = fixture.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
  });
  afterAll(async () => {
    await app?.close();
  });
  it('registers with normalized DTO input and verifies using a POST body', async () => {
    service.register.mockResolvedValueOnce({
      user: { id: 'fixture-id', email: 'owner@example.com' },
      verificationEmailDelivery: 'smtp-accepted',
    });
    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        fullName: ' Owner ',
        email: ' OWNER@EXAMPLE.COM ',
        password: 'a long password',
      })
      .expect(201);
    expect(service.register).toHaveBeenCalledWith({
      fullName: 'Owner',
      email: 'owner@example.com',
      password: 'a long password',
    });
    const token = 'a'.repeat(64);
    service.verifyEmail.mockResolvedValueOnce({ message: 'Email verified.' });
    await request(app.getHttpServer())
      .post('/api/v1/auth/verify-email')
      .send({ token })
      .expect(200)
      .expect({ message: 'Email verified.' });
    expect(service.verifyEmail).toHaveBeenCalledWith(token);
  });
  it('normalizes resend emails and documents all three endpoints', async () => {
    service.resendVerification.mockResolvedValueOnce({
      message:
        'If the account is eligible, a verification email will be attempted.',
    });
    await request(app.getHttpServer())
      .post('/api/v1/auth/resend-verification')
      .send({ email: ' OWNER@EXAMPLE.COM ' })
      .expect(200);
    expect(service.resendVerification).toHaveBeenCalledWith(
      'owner@example.com',
    );
    const response = await request(app.getHttpServer())
      .get('/api/docs-json')
      .expect(200);
    const document = response.body as { paths: Record<string, unknown> };
    for (const path of ['register', 'verify-email', 'resend-verification'])
      expect(document.paths).toHaveProperty(`/api/v1/auth/${path}`);
    expect(document.paths).toHaveProperty('/api/v1/auth/me');
  });
});
