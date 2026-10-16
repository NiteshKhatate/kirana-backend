import { createHash, createPublicKey, KeyObject } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export interface JwtConfig {
  publicKey: KeyObject | null;
  issuer: string;
  audience: string;
  maxLifetimeSeconds: number;
  keyId?: string;
  verificationKeys?: ReadonlyMap<string, KeyObject>;
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
  const keyId =
    input.JWT_KEY_ID ??
    (publicKey
      ? createHash('sha256')
          .update(publicKey.export({ type: 'spki', format: 'der' }))
          .digest('hex')
          .slice(0, 32)
      : 'unconfigured');
  const verificationKeys = new Map<string, KeyObject>();
  if (typeof keyId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(keyId))
    invalid.add('JWT_KEY_ID');
  else if (publicKey) verificationKeys.set(keyId, publicKey);
  try {
    if (input.JWT_PREVIOUS_PUBLIC_KEYS !== undefined) {
      if (typeof input.JWT_PREVIOUS_PUBLIC_KEYS !== 'string') throw new Error();
      const entries: unknown = JSON.parse(input.JWT_PREVIOUS_PUBLIC_KEYS);
      if (
        !entries ||
        typeof entries !== 'object' ||
        Array.isArray(entries) ||
        Object.keys(entries).length > 5
      )
        throw new Error();
      for (const [id, pem] of Object.entries(entries)) {
        if (
          !/^[A-Za-z0-9_-]{1,64}$/.test(id) ||
          id === keyId ||
          typeof pem !== 'string' ||
          !/-----BEGIN (RSA )?PUBLIC KEY-----/.test(pem)
        )
          throw new Error();
        const parsed = createPublicKey(pem.replace(/\\n/g, '\n'));
        if (
          parsed.asymmetricKeyType !== 'rsa' ||
          (parsed.asymmetricKeyDetails?.modulusLength ?? 0) < 2048
        )
          throw new Error();
        verificationKeys.set(id, parsed);
      }
    }
  } catch {
    invalid.add('JWT_PREVIOUS_PUBLIC_KEYS');
  }
  if (invalid.size)
    throw new Error(`Invalid configuration: ${[...invalid].join(', ')}`);
  return {
    publicKey,
    issuer: issuer as string,
    audience: audience as string,
    maxLifetimeSeconds: ttl,
    keyId: keyId as string,
    verificationKeys,
  };
}
