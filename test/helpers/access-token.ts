import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { JwtPayload, sign, SignOptions } from 'jsonwebtoken';

// Ephemeral test keys; never persisted or copied from development/production.
const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
export const testJwtPrivateKey = pair.privateKey
  .export({ type: 'pkcs8', format: 'pem' })
  .toString();
export const testJwtPublicKey = pair.publicKey
  .export({ type: 'spki', format: 'pem' })
  .toString();

export function testAccessToken(
  subject: string,
  claims: JwtPayload = {},
  options: SignOptions = {},
): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: JwtPayload = {
    sub: subject,
    iss: 'kirana-identity',
    aud: 'kirana-api',
    jti: randomUUID(),
    iat: now,
    exp: now + 900,
    token_use: 'access',
    ...claims,
  };
  for (const key of Object.keys(payload))
    if (payload[key] === undefined) delete payload[key];
  return sign(payload, pair.privateKey, { algorithm: 'RS256', ...options });
}
