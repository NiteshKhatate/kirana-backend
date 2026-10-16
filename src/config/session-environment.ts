import { createPrivateKey, createPublicKey, KeyObject } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { JwtConfig } from './jwt-environment';

export interface SessionConfig {
  privateKey: KeyObject | null;
  refreshTtlSeconds: number;
  resetTtlSeconds: number;
  resetUrl: string;
}

export function validateSessionEnvironment(
  input: Record<string, unknown>,
  mode: string,
  jwt: JwtConfig,
): SessionConfig {
  const invalid = new Set<string>();
  let privateKey: KeyObject | null = null;
  let raw = input.JWT_PRIVATE_KEY;
  try {
    const path = resolve(process.cwd(), '.keys/jwt-private.pem');
    if (raw === undefined && mode === 'development' && existsSync(path))
      raw = readFileSync(path, 'utf8');
    if (raw === undefined && mode === 'production') throw new Error();
    if (raw !== undefined) {
      if (typeof raw !== 'string') throw new Error();
      privateKey = createPrivateKey(raw.replace(/\\n/g, '\n'));
      if (
        privateKey.asymmetricKeyType !== 'rsa' ||
        (privateKey.asymmetricKeyDetails?.modulusLength ?? 0) < 2048 ||
        !jwt.publicKey ||
        !createPublicKey(privateKey).equals(jwt.publicKey)
      )
        throw new Error();
    }
  } catch {
    invalid.add('JWT_PRIVATE_KEY');
  }
  function seconds(key: string, fallback: number, min: number, max: number) {
    const raw = input[key] ?? fallback;
    const value =
      typeof raw === 'string' || typeof raw === 'number' ? Number(raw) : NaN;
    if (!Number.isInteger(value) || value < min || value > max)
      invalid.add(key);
    return value;
  }
  const refreshTtlSeconds = seconds(
    'REFRESH_TTL_SECONDS',
    604800,
    300,
    2592000,
  );
  const resetTtlSeconds = seconds(
    'PASSWORD_RESET_TTL_SECONDS',
    1800,
    300,
    3600,
  );
  const resetUrl =
    input.RESET_PASSWORD_URL ??
    (mode === 'production' ? '' : 'http://localhost:3000/reset-password');
  try {
    if (typeof resetUrl !== 'string') throw new Error();
    const url = new URL(resetUrl);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (mode === 'production' &&
        (url.protocol !== 'https:' ||
          ['localhost', '127.0.0.1'].includes(url.hostname)))
    )
      throw new Error();
  } catch {
    invalid.add('RESET_PASSWORD_URL');
  }
  if (invalid.size)
    throw new Error(`Invalid configuration: ${[...invalid].join(', ')}`);
  return {
    privateKey,
    refreshTtlSeconds,
    resetTtlSeconds,
    resetUrl: resetUrl as string,
  };
}
