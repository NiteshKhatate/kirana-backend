import { ConfigService } from '@nestjs/config';
import { createPrivateKey } from 'node:crypto';
import { decode } from 'jsonwebtoken';
import { validateJwtEnvironment } from '../../config/jwt-environment';
import { AccessTokenIssuer } from './access-token-issuer.service';
import { AccessTokenVerifier } from './access-token-verifier.service';

describe('Access token issuance', () => {
  it('issues verifiable short-lived RS256 identity claims with the active kid', () => {
    const jwt = validateJwtEnvironment(process.env, 'test');
    const config = new ConfigService({
      JWT: jwt,
      SESSION: { privateKey: createPrivateKey(process.env.JWT_PRIVATE_KEY!) },
    });
    const clock = { now: () => new Date('2026-10-16T12:00:00Z') };
    const subject = '1c77f744-7363-4005-b644-a4a2e65c740d';
    const token = new AccessTokenIssuer(config, clock).issue(subject);
    expect(new AccessTokenVerifier(config, clock).subject(token)).toBe(subject);
    const result = decode(token, { complete: true });
    expect(result?.header).toMatchObject({
      alg: 'RS256',
      kid: jwt.keyId,
      typ: 'JWT',
    });
    expect(result?.payload).toMatchObject({
      sub: subject,
      iss: jwt.issuer,
      aud: jwt.audience,
      token_use: 'access',
      exp: 1792152900,
      iat: 1792152000,
    });
  });
  it('fails closed when a signing key is absent', () => {
    const config = new ConfigService({
      JWT: {},
      SESSION: { privateKey: null },
    });
    expect(() =>
      new AccessTokenIssuer(config, { now: () => new Date() }).issue('user'),
    ).toThrow();
  });
});
