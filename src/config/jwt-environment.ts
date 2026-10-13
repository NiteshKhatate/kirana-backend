import { createPublicKey, KeyObject } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export interface JwtConfig {
  publicKey: KeyObject | null;
  issuer: string;
  audience: string;
  maxLifetimeSeconds: number;
}

export function validateJwtEnvironment(
  input: Record<string, unknown>,
  mode: string,
): JwtConfig {
  const invalid = new Set<string>();
  const issuer =
    input.JWT_ISSUER ?? (mode === 'production' ? '' : 'kirana-identity');
  const audience =
    input.JWT_AUDIENCE ?? (mode === 'production' ? '' : 'kirana-api');
  for (const [key, value] of [
    ['JWT_ISSUER', issuer],
    ['JWT_AUDIENCE', audience],
  ]) {
    if (
      typeof value !== 'string' ||
      !value ||
      value.length > 200 ||
      /\s/.test(value)
    )
      invalid.add(key as string);
  }
  const rawTtl = input.JWT_ACCESS_TTL_SECONDS ?? 900;
  const ttl =
    typeof rawTtl === 'string' || typeof rawTtl === 'number'
      ? Number(rawTtl)
      : NaN;
  if (!Number.isInteger(ttl) || ttl < 60 || ttl > 900)
    invalid.add('JWT_ACCESS_TTL_SECONDS');
  let key = input.JWT_PUBLIC_KEY;
  let publicKey: KeyObject | null = null;
  try {
    if (key === undefined && mode === 'development') {
      const path = resolve(process.cwd(), '.keys/jwt-public.pem');
      if (existsSync(path)) key = readFileSync(path, 'utf8');
    }
    if (key === undefined && mode === 'production') throw new Error();
    if (key !== undefined) {
      if (
        typeof key !== 'string' ||
        !/-----BEGIN (RSA )?PUBLIC KEY-----/.test(key)
      )
        throw new Error();
      publicKey = createPublicKey(key.replace(/\\n/g, '\n'));
      if (
        publicKey.asymmetricKeyType !== 'rsa' ||
        (publicKey.asymmetricKeyDetails?.modulusLength ?? 0) < 2048
      )
        throw new Error();
    }
  } catch {
    invalid.add('JWT_PUBLIC_KEY');
  }
  if (invalid.size)
    throw new Error(`Invalid configuration: ${[...invalid].join(', ')}`);
  return {
    publicKey,
    issuer: issuer as string,
    audience: audience as string,
    maxLifetimeSeconds: ttl,
  };
}
