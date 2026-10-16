import { assertTestDatabaseUrl } from './database-safety';
import {
  environmentOptions,
  runtimeEnvironment,
  validateEnvironment,
} from './environment';

const development =
  'postgresql://dev:placeholder@localhost:5433/kirana_identity?schema=public';
const testUrl =
  'postgresql://kirana_test:placeholder@127.0.0.1:5434/kirana_identity_test?schema=public';
const production =
  'postgresql://app:placeholder@db.example.invalid:5432/kirana_identity';

describe('Environment validation', () => {
  it('defaults the development port and returns typed configuration', () => {
    expect(
      validateEnvironment({ DATABASE_URL: development }, 'development'),
    ).toMatchObject({
      NODE_ENV: 'development',
      PORT: 3001,
      DATABASE_URL: development,
    });
    expect(
      validateEnvironment(
        {
          PORT: '8080',
          DATABASE_URL: production,
          EMAIL_FROM: 'no-reply@example.com',
          VERIFY_EMAIL_URL: 'https://app.example.com/verify-email',
          SMTP_HOST: 'smtp.example.com',
          SMTP_USER: 'placeholder',
          SMTP_PASSWORD: 'placeholder',
          JWT_PUBLIC_KEY: process.env.JWT_PUBLIC_KEY,
          JWT_PRIVATE_KEY: process.env.JWT_PRIVATE_KEY,
          RESET_PASSWORD_URL: 'https://app.example.com/reset-password',
          JWT_ISSUER: 'kirana-identity',
          JWT_AUDIENCE: 'kirana-api',
        },
        'production',
      ).PORT,
    ).toBe(8080);
  });

  it.each(['', '0', '-1', '65536', '1.5', '3001oops', ' 3001 ', false])(
    'rejects invalid PORT %p',
    (PORT) => {
      expect(() =>
        validateEnvironment({ PORT, DATABASE_URL: development }, 'development'),
      ).toThrow('Invalid configuration: PORT');
    },
  );

  it('rejects missing/unsafe database settings without echoing secrets', () => {
    for (const url of [
      undefined,
      'private-secret-value',
      'https://app:private-secret-value@host/db',
      production,
    ]) {
      expect(() =>
        validateEnvironment({ DATABASE_URL: url }, 'development'),
      ).toThrow('Invalid configuration: DATABASE_URL');
    }
  });

  it('rejects an invalid or file-mismatched environment', () => {
    expect(() => runtimeEnvironment('staging')).toThrow(
      'Invalid configuration: NODE_ENV',
    );
    expect(() =>
      validateEnvironment(
        { NODE_ENV: 'production', DATABASE_URL: development },
        'development',
      ),
    ).toThrow('NODE_ENV');
  });

  it('uses the isolated test URL and rejects a conflicting dev URL', () => {
    expect(
      validateEnvironment({ DATABASE_URL_TEST: testUrl }, 'test').DATABASE_URL,
    ).toBe(testUrl);
    expect(() =>
      validateEnvironment(
        { DATABASE_URL_TEST: testUrl, DATABASE_URL: development },
        'test',
      ),
    ).toThrow('DATABASE_URL');
    expect(() =>
      validateEnvironment({ DATABASE_URL: development }, 'test'),
    ).toThrow('DATABASE_URL');
  });

  it('production ignores dotenv files and rejects a local/test database', () => {
    const original = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'production';
      expect(environmentOptions().ignoreEnvFile).toBe(true);
      expect(() =>
        validateEnvironment({ DATABASE_URL: development }, 'production'),
      ).toThrow('DATABASE_URL');
      expect(() =>
        validateEnvironment({ DATABASE_URL: testUrl }, 'production'),
      ).toThrow('DATABASE_URL');
    } finally {
      process.env.NODE_ENV = original;
    }
  });

  it('test dotenv loading has no development fallback', () => {
    expect(environmentOptions().envFilePath).toEqual(['.env.test']);
  });
});

describe('Test database target safety', () => {
  it('allows only the dedicated local test target', () => {
    expect(assertTestDatabaseUrl(testUrl)).toBe(testUrl);
  });

  it.each([
    development,
    production,
    undefined,
    testUrl.replace('5434', '5433'),
    testUrl.replace('kirana_test:', 'kirana:'),
    testUrl.replace('127.0.0.1', 'remote.example.invalid'),
    testUrl.replace('schema=public', 'schema=other'),
    `${testUrl}&host=remote.example.invalid`,
    `${testUrl}&schema=public`,
    `${testUrl}#fragment`,
  ])('rejects an unsafe target %p', (url) => {
    expect(() => assertTestDatabaseUrl(url)).toThrow(
      'Test database must use the dedicated local',
    );
  });
});
