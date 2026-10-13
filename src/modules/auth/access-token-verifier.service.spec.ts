import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { JwtPayload, sign } from 'jsonwebtoken';
import { testAccessToken } from '../../../test/helpers/access-token';
import { validateJwtEnvironment } from '../../config/jwt-environment';
import { AuthClock } from './auth-clock.service';
import { AccessTokenVerifier } from './access-token-verifier.service';

describe('Access JWT verification', () => {
  const id = randomUUID();
  const now = Math.floor(Date.now() / 1000);
  const base = { iat: now, exp: now + 900 };
  const clock = new AuthClock();
  const config = validateJwtEnvironment(
    { JWT_PUBLIC_KEY: process.env.JWT_PUBLIC_KEY },
    'test',
  );
  const verifier = new AccessTokenVerifier(
    new ConfigService({ JWT: config }),
    clock,
  );
  beforeEach(() =>
    jest.spyOn(clock, 'now').mockReturnValue(new Date(now * 1000)),
  );
  afterEach(() => jest.restoreAllMocks());

  it('validates an RS256 access JWT and returns only its subject', () => {
    expect(verifier.subject(testAccessToken(id, base))).toBe(id);
  });
  it.each<[string, JwtPayload]>([
    ['issuer', { ...base, iss: 'other-issuer' }],
    ['audience', { ...base, aud: 'other-api' }],
    ['expired', { iat: now - 901, exp: now }],
    ['missing expiry', { iat: now, exp: undefined }],
    ['missing issued-at', { exp: now + 900 }],
    ['future issued-at', { iat: now + 1, exp: now + 900 }],
    ['future not-before', { ...base, nbf: now + 60 }],
    ['long lifetime', { iat: now, exp: now + 901 }],
    ['invalid subject', { ...base, sub: 'not-a-uuid' }],
    ['invalid token ID', { ...base, jti: 'not-a-uuid' }],
    ['wrong purpose', { ...base, token_use: 'refresh' }],
  ])('rejects %s', (_name, claims) => {
    // Omit exp entirely for the missing-expiry case; jsonwebtoken rejects
    // an explicit undefined claim while signing, before the verifier runs.
    const overrides = { ...claims };
    const options = _name === 'missing issued-at' ? { noTimestamp: true } : {};
    const token = testAccessToken(id, overrides, options);
    expect(() => verifier.subject(token)).toThrow('Unauthorized');
  });
  it('rejects tampering, other keys, HMAC and unsigned tokens', () => {
    const original = testAccessToken(id, base);
    const parts = original.split('.');
    const changed = Buffer.from(
      JSON.stringify({ sub: randomUUID(), ...base }),
    ).toString('base64url');
    const foreign = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const payload = {
      sub: id,
      iss: config.issuer,
      aud: config.audience,
      jti: randomUUID(),
      token_use: 'access',
      ...base,
    };
    for (const token of [
      `${parts[0]}.${changed}.${parts[2]}`,
      sign(payload, foreign.privateKey, { algorithm: 'RS256' }),
      sign(payload, 'synthetic-test-secret', { algorithm: 'HS256' }),
      sign(payload, '', { algorithm: 'none' }),
    ])
      expect(() => verifier.subject(token)).toThrow('Unauthorized');
  });
  it('fails closed when local verification keys have not been configured', () => {
    const disabled = new AccessTokenVerifier(
      new ConfigService({ JWT: { ...config, publicKey: null } }),
      clock,
    );
    expect(() => disabled.subject(testAccessToken(id, base))).toThrow(
      'Unauthorized',
    );
  });
});
