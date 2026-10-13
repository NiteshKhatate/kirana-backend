import { generateKeyPairSync } from 'node:crypto';
import { validateJwtEnvironment } from './jwt-environment';

describe('RS256 verification configuration', () => {
  const production = {
    JWT_PUBLIC_KEY: process.env.JWT_PUBLIC_KEY,
    JWT_ISSUER: 'kirana-identity',
    JWT_AUDIENCE: 'kirana-api',
  };
  it('requires an RSA public key, issuer and audience in production', () => {
    expect(() => validateJwtEnvironment({}, 'production')).toThrow(
      'Invalid configuration:',
    );
    expect(
      validateJwtEnvironment(production, 'production').publicKey
        ?.asymmetricKeyType,
    ).toBe('rsa');
  });
  it('accepts escaped PEM line breaks and enforces short lifetimes', () => {
    expect(
      validateJwtEnvironment(
        {
          ...production,
          JWT_PUBLIC_KEY: production.JWT_PUBLIC_KEY!.replace(/\n/g, '\\n'),
          JWT_ACCESS_TTL_SECONDS: '300',
        },
        'production',
      ).maxLifetimeSeconds,
    ).toBe(300);
    for (const ttl of [0, 901, 'invalid'])
      expect(() =>
        validateJwtEnvironment(
          { ...production, JWT_ACCESS_TTL_SECONDS: ttl },
          'production',
        ),
      ).toThrow('JWT_ACCESS_TTL_SECONDS');
  });
  it('rejects private, non-RSA and undersized keys without echoing values', () => {
    const small = generateKeyPairSync('rsa', { modulusLength: 1024 });
    const ec = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const keys = [
      small.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      small.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
      ec.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      'private-key-marker',
    ];
    for (const key of keys) {
      expect(() =>
        validateJwtEnvironment(
          { ...production, JWT_PUBLIC_KEY: key },
          'production',
        ),
      ).toThrow('Invalid configuration: JWT_PUBLIC_KEY');
    }
  });
});
