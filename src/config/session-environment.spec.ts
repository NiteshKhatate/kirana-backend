import { generateKeyPairSync } from 'node:crypto';
import { validateJwtEnvironment } from './jwt-environment';
import { validateSessionEnvironment } from './session-environment';
import { ConfigService } from '@nestjs/config';
import { AccessTokenVerifier } from '../modules/auth/access-token-verifier.service';
import { testAccessToken } from '../../test/helpers/access-token';

describe('Signing, rotation and recovery configuration', () => {
  const jwt = () => validateJwtEnvironment(process.env, 'test');
  const input = () => ({
    JWT_PRIVATE_KEY: process.env.JWT_PRIVATE_KEY,
    RESET_PASSWORD_URL: 'https://app.example.com/reset-password',
  });
  it('requires a matching private RSA signing key and secure reset URL in production', () => {
    expect(
      validateSessionEnvironment(input(), 'production', jwt()).privateKey?.type,
    ).toBe('private');
    expect(() => validateSessionEnvironment({}, 'production', jwt())).toThrow(
      'JWT_PRIVATE_KEY',
    );
    expect(() =>
      validateSessionEnvironment(
        { ...input(), RESET_PASSWORD_URL: 'http://app.example.com/reset' },
        'production',
        jwt(),
      ),
    ).toThrow('RESET_PASSWORD_URL');
    const other = generateKeyPairSync('rsa', { modulusLength: 2048 });
    expect(() =>
      validateSessionEnvironment(
        {
          ...input(),
          JWT_PRIVATE_KEY: other.privateKey
            .export({ type: 'pkcs8', format: 'pem' })
            .toString(),
        },
        'production',
        jwt(),
      ),
    ).toThrow('JWT_PRIVATE_KEY');
    expect(() =>
      validateSessionEnvironment(
        { ...input(), JWT_PRIVATE_KEY: 'secret-marker' },
        'production',
        jwt(),
      ),
    ).toThrow('Invalid configuration: JWT_PRIVATE_KEY');
  });
  it.each([
    { REFRESH_TTL_SECONDS: 0 },
    { PASSWORD_RESET_TTL_SECONDS: 3601 },
    { RESET_PASSWORD_URL: 'https://app.example.com/reset?token=secret' },
  ])('rejects unsafe settings %p', (values) => {
    expect(() =>
      validateSessionEnvironment({ ...input(), ...values }, 'test', jwt()),
    ).toThrow('Invalid configuration:');
  });
  it('accepts a previous key by kid and rejects unknown or removed kids', () => {
    const current = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const config = validateJwtEnvironment(
      {
        JWT_PUBLIC_KEY: current.publicKey
          .export({ type: 'spki', format: 'pem' })
          .toString(),
        JWT_KEY_ID: 'current',
        JWT_PREVIOUS_PUBLIC_KEYS: JSON.stringify({
          previous: process.env.JWT_PUBLIC_KEY,
        }),
      },
      'test',
    );
    const clock = { now: () => new Date() };
    const verifier = new AccessTokenVerifier(
      new ConfigService({ JWT: config }),
      clock,
    );
    const subject = '1c77f744-7363-4005-b644-a4a2e65c740d';
    expect(
      verifier.subject(testAccessToken(subject, {}, { keyid: 'previous' })),
    ).toBe(subject);
    expect(() =>
      verifier.subject(testAccessToken(subject, {}, { keyid: 'missing' })),
    ).toThrow();
    config.verificationKeys = new Map([['current', current.publicKey]]);
    expect(() =>
      verifier.subject(testAccessToken(subject, {}, { keyid: 'previous' })),
    ).toThrow();
  });
  it.each(['not-json', '[]', '{"current":"bad"}', '{"old":"private-marker"}'])(
    'rejects malformed rotation key sets',
    (keys) => {
      expect(() =>
        validateJwtEnvironment(
          {
            ...process.env,
            JWT_KEY_ID: 'current',
            JWT_PREVIOUS_PUBLIC_KEYS: keys,
          },
          'test',
        ),
      ).toThrow('JWT_PREVIOUS_PUBLIC_KEYS');
    },
  );
});
