import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parse } from 'dotenv';
import { assertTestDatabaseUrl } from '../src/config/database-safety';

let stage = 'runtime environment';

async function main(): Promise<void> {
  if (process.env.NODE_ENV && process.env.NODE_ENV !== 'test')
    throw new Error('Test database setup requires NODE_ENV=test or unset');
  const root = resolve(__dirname, '..');
  const envPath = resolve(root, '.env.test');
  stage = 'local test configuration';
  if (!existsSync(envPath)) {
    const password = randomBytes(32).toString('hex');
    const url = `postgresql://kirana_test:${password}@127.0.0.1:5434/kirana_identity_test?schema=public`;
    writeFileSync(
      envPath,
      `NODE_ENV=test\nPORT=3001\nPOSTGRES_TEST_PASSWORD=${password}\nDATABASE_URL_TEST=${url}\nPOSTGRES_TEST_VOLUME_NAME=kirana-backend-test-${randomBytes(8).toString('hex')}-data\n`,
      { flag: 'wx', mode: 0o600 },
    );
    console.log(
      'Created ignored .env.test with generated local test credentials.',
    );
  }
  const file = parse(readFileSync(envPath));
  const url = assertTestDatabaseUrl(
    process.env.DATABASE_URL_TEST ?? file.DATABASE_URL_TEST,
  );
  const password = file.POSTGRES_TEST_PASSWORD;
  if (!password || decodeURIComponent(new URL(url).password) !== password)
    throw new Error('Test database credentials do not match .env.test');
  const environment = {
    ...process.env,
    NODE_ENV: 'test',
    DATABASE_URL: url,
    DATABASE_URL_TEST: url,
    POSTGRES_TEST_PASSWORD: password,
  };
  stage = 'dedicated Docker service';
  const docker = spawnSync(
    'docker',
    [
      'compose',
      '--env-file',
      envPath,
      '-f',
      'docker-compose.test.yml',
      'up',
      '-d',
      '--wait',
    ],
    { cwd: root, env: environment, stdio: 'inherit', windowsHide: true },
  );
  if (docker.status !== 0)
    throw new Error('Dedicated test PostgreSQL startup failed');

  // Verify the live target before applying the existing reviewed migration SQL.
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = url;
  const { PrismaClient } = await import('@prisma/client');
  const client = new PrismaClient({ datasources: { db: { url } } });
  stage = 'database identity verification';
  try {
    const [identity] = await client.$queryRaw<
      { database: string; username: string }[]
    >`SELECT current_database() AS database, current_user AS username`;
    if (
      identity?.database !== 'kirana_identity_test' ||
      identity.username !== 'kirana_test'
    )
      throw new Error('Unexpected database identity');
  } catch {
    throw new Error('Dedicated test database identity verification failed');
  } finally {
    await client.$disconnect();
  }
  stage = 'test database migrations';
  const migration = spawnSync(
    process.execPath,
    [resolve(root, 'node_modules/prisma/build/index.js'), 'migrate', 'deploy'],
    { cwd: root, env: environment, stdio: 'inherit', windowsHide: true },
  );
  if (migration.status !== 0)
    throw new Error('Dedicated test database migration failed');
  console.log(
    'Dedicated test database is ready; existing volumes and records were preserved.',
  );
}

void main().catch(() => {
  console.error(
    `Test database setup failed at ${stage}. Check Docker and ignored .env.test; no database reset was attempted.`,
  );
  process.exitCode = 1;
});
