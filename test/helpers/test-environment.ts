import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'dotenv';
import { assertTestDatabaseUrl } from '../../src/config/database-safety';

export function loadTestEnvironment(requireDatabase = false): string {
  if (process.env.NODE_ENV && process.env.NODE_ENV !== 'test') {
    throw new Error('Tests require NODE_ENV=test');
  }
  const path = resolve(__dirname, '../../.env.test');
  const file = existsSync(path) ? parse(readFileSync(path)) : {};
  const configured = process.env.DATABASE_URL_TEST ?? file.DATABASE_URL_TEST;
  if (requireDatabase && !configured) {
    throw new Error(
      'Dedicated test database is not configured; run npm run db:test:setup',
    );
  }
  // Unit/HTTP suites always mock Prisma. This fallback is not a real credential.
  const databaseUrl = assertTestDatabaseUrl(
    configured ??
      'postgresql://kirana_test:unused@127.0.0.1:5434/kirana_identity_test?schema=public',
  );
  process.env.NODE_ENV = 'test';
  process.env.PORT = '3001';
  process.env.DATABASE_URL = databaseUrl;
  if (configured) process.env.DATABASE_URL_TEST = databaseUrl;
  return databaseUrl;
}
