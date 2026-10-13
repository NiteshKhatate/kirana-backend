import { assertTestDatabaseUrl } from './database-safety';

export type RuntimeEnvironment = 'development' | 'test' | 'production';

export interface Environment {
  NODE_ENV: RuntimeEnvironment;
  PORT: number;
  DATABASE_URL: string;
}

export function runtimeEnvironment(
  value = process.env.NODE_ENV,
): RuntimeEnvironment {
  const mode = value ?? 'development';
  if (!['development', 'test', 'production'].includes(mode)) {
    throw new Error('Invalid configuration: NODE_ENV');
  }
  return mode as RuntimeEnvironment;
}

export function validateEnvironment(
  input: Record<string, unknown>,
  mode: RuntimeEnvironment = runtimeEnvironment(),
): Environment {
  const invalid = new Set<string>();
  if (input.NODE_ENV !== undefined && input.NODE_ENV !== mode)
    invalid.add('NODE_ENV');
  const rawPort = input.PORT ?? 3001;
  const port = Number(rawPort);
  if (
    !['string', 'number'].includes(typeof rawPort) ||
    !/^\d+$/.test(
      typeof rawPort === 'number'
        ? rawPort.toString()
        : typeof rawPort === 'string'
          ? rawPort
          : '',
    ) ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535
  )
    invalid.add('PORT');

  const databaseUrl =
    mode === 'test'
      ? (input.DATABASE_URL_TEST ?? input.DATABASE_URL)
      : input.DATABASE_URL;
  if (
    mode === 'test' &&
    input.DATABASE_URL !== undefined &&
    input.DATABASE_URL !== databaseUrl
  )
    invalid.add('DATABASE_URL');
  try {
    if (typeof databaseUrl !== 'string') throw new Error();
    const url = new URL(databaseUrl);
    if (
      !['postgres:', 'postgresql:'].includes(url.protocol) ||
      !url.hostname ||
      !url.username ||
      !url.password ||
      url.pathname.length < 2 ||
      url.hash
    )
      throw new Error();
    if (
      mode === 'development' &&
      (!['localhost', '127.0.0.1', 'postgres'].includes(url.hostname) ||
        url.pathname !== '/kirana_identity')
    )
      throw new Error();
    if (mode === 'test') assertTestDatabaseUrl(databaseUrl);
    if (
      mode === 'production' &&
      (['localhost', '127.0.0.1', 'postgres'].includes(url.hostname) ||
        url.pathname.endsWith('_test'))
    )
      throw new Error();
  } catch {
    invalid.add('DATABASE_URL');
  }
  if (invalid.size)
    throw new Error(`Invalid configuration: ${[...invalid].join(', ')}`);
  return { NODE_ENV: mode, PORT: port, DATABASE_URL: databaseUrl as string };
}

export function environmentOptions() {
  const mode = runtimeEnvironment();
  return {
    isGlobal: true,
    cache: true,
    ignoreEnvFile: mode === 'production',
    envFilePath: mode === 'test' ? ['.env.test'] : ['.env.development', '.env'],
    validate: (input: Record<string, unknown>) =>
      validateEnvironment(input, mode),
  };
}
