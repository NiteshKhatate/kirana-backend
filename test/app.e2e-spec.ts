import {
  Body,
  Controller,
  Get,
  INestApplication,
  Logger,
  Post,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Transform, Type } from 'class-transformer';
import { IsEmail, IsInt, Min } from 'class-validator';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';
import { configureApp } from '../src/configure-app';

class ValidationProbeDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  email: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity: number;
}

/** Test-only routes exercise the global HTTP boundary without shipping APIs. */
@Controller('__test')
class BoundaryProbeController {
  @Post('validation')
  validate(@Body() dto: ValidationProbeDto) {
    return { ...dto, transformed: dto instanceof ValidationProbeDto };
  }

  @Get('failure')
  fail() {
    throw new Error('private database credentials and token');
  }
}

describe('Foundation HTTP (database mocked)', () => {
  let app: INestApplication<App>;
  const queryRaw = jest.fn();
  let log: jest.SpyInstance;

  beforeAll(async () => {
    log = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [BoundaryProbeController],
    })
      .overrideProvider(PrismaService)
      .useValue({ $queryRaw: queryRaw })
      .compile();
    app = moduleFixture.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
  });

  beforeEach(() => {
    queryRaw.mockReset();
    log.mockClear();
  });
  afterAll(async () => {
    await app?.close();
    log?.mockRestore();
  });

  it('returns database readiness under the versioned prefix', async () => {
    queryRaw.mockResolvedValueOnce([{ '?column?': 1 }]);
    await request(app.getHttpServer())
      .get('/api/v1/health')
      .expect(200)
      .expect({ status: 'ok', database: 'connected' });
    expect(queryRaw.mock.calls).toEqual([[['SELECT 1']]]);
  });

  it('returns a safe, correlated 503 on database failure', async () => {
    queryRaw.mockRejectedValueOnce(new Error('private database error'));
    const response = await request(app.getHttpServer())
      .get('/api/v1/health')
      .set('x-request-id', 'readiness-123')
      .expect(503);
    expect(response.headers['x-request-id']).toBe('readiness-123');
    expect(response.body).toEqual({
      statusCode: 503,
      message: 'Service Unavailable',
      error: 'Service Unavailable',
      requestId: 'readiness-123',
      timestamp: expect.any(String) as unknown,
    });
    expect(JSON.stringify(response.body)).not.toContain('private');
  });

  it('serves liveness without querying PostgreSQL', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/health/live')
      .expect(200)
      .expect({ status: 'ok' });
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it('serves Swagger UI and documented health endpoints', async () => {
    await request(app.getHttpServer()).get('/api/docs').expect(200);
    const response = await request(app.getHttpServer())
      .get('/api/docs-json')
      .expect(200);
    const document = response.body as {
      paths: Record<string, { get: { responses: Record<string, unknown> } }>;
    };
    expect(document.paths['/api/v1/health'].get.responses).toHaveProperty(
      '503',
    );
    expect(document.paths).toHaveProperty('/api/v1/health/live');
  });

  it('transforms and validates DTO inputs', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/__test/validation')
      .send({ email: ' Owner@Example.com ', quantity: '2' })
      .expect(201)
      .expect({ email: 'owner@example.com', quantity: 2, transformed: true });
  });

  it.each([
    { email: 'owner@example.com', quantity: 2, role: 'OWNER' },
    { email: 'invalid', quantity: 2 },
    { email: 'owner@example.com', quantity: 0 },
    { email: 'owner@example.com' },
  ])('rejects unknown or invalid fields: %p', async (payload) => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/__test/validation')
      .send(payload)
      .expect(400);
    expect(response.body).toMatchObject({
      statusCode: 400,
      message: 'Bad Request',
    });
  });

  it('formats malformed JSON errors safely', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/__test/validation')
      .set('Content-Type', 'application/json')
      .send('{"private-secret":')
      .expect(400);
    expect(JSON.stringify(response.body)).not.toContain('private-secret');
  });

  it('sanitizes unexpected exceptions and logs only allowlisted metadata', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/__test/failure?token=private-query-token')
      .set('Authorization', 'Bearer private-header-token')
      .set('x-request-id', 'safe-request-123')
      .expect(500);
    expect(response.body).toMatchObject({
      statusCode: 500,
      message: 'Internal Server Error',
      requestId: 'safe-request-123',
    });
    const records = log.mock.calls
      .flat()
      .filter((value): value is string => typeof value === 'string');
    const record = records.find((value) => value.includes('http.request'));
    expect(record).toBeDefined();
    expect(JSON.parse(record!)).toEqual({
      event: 'http.request',
      requestId: 'safe-request-123',
      method: 'GET',
      statusCode: 500,
      durationMs: expect.any(Number) as unknown,
    });
    expect(JSON.stringify(records)).not.toContain('private');
  });

  it('replaces invalid correlation IDs with generated UUIDs', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/health/live')
      .set('x-request-id', 'invalid ID with spaces')
      .expect(200);
    expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('does not expose unfinished domain APIs', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ password: 'private-body-password' })
      .expect(404);
    expect(response.body).toMatchObject({
      statusCode: 404,
      message: 'Not Found',
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain(
      'private-body-password',
    );
  });
});
