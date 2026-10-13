import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { connectTestDatabase, withRollback } from './helpers/test-database';

describe('Dedicated PostgreSQL foundation', () => {
  let client: PrismaClient;
  let app: INestApplication<App>;

  beforeAll(async () => {
    client = await connectTestDatabase();
    const fixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = fixture.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    await client?.$disconnect();
  });

  it('serves readiness through the real Prisma client', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/health')
      .expect(200)
      .expect({ status: 'ok', database: 'connected' });
  });

  it('persists a fixture inside a transaction and rolls it back', async () => {
    const id = randomUUID();
    await withRollback(client, async (tx) => {
      await tx.user.create({
        data: {
          id,
          fullName: 'Integration fixture',
          email: `${id}@example.invalid`,
          passwordHash: 'test-fixture-not-a-real-password',
        },
      });
      expect(await tx.user.count({ where: { id } })).toBe(1);
    });
    expect(await client.user.findUnique({ where: { id } })).toBeNull();
  });
});
