import { createHash } from 'node:crypto';
import { VerificationTokenService } from './verification-token.service';

describe('Verification tokens', () => {
  const service = new VerificationTokenService();
  it('creates 256-bit opaque values and stores deterministic SHA-256 digests', () => {
    const token = service.create();
    expect(token).toMatch(/^[a-f0-9]{64}$/);
    expect(service.create()).not.toBe(token);
    const known = 'a'.repeat(64);
    expect(service.hash(known)).toBe(
      createHash('sha256').update(known).digest('hex'),
    );
    expect(service.hash(known)).not.toBe(known);
  });
});
