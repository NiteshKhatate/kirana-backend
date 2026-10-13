import { PasswordService } from './password.service';

describe('Argon2id password hashing', () => {
  const service = new PasswordService();
  it('uses the specified Argon2id parameters, unique salts and verifies passwords', async () => {
    const password = 'a long passphrase  ';
    const first = await service.hash(password);
    const second = await service.hash(password);
    expect(first).toMatch(/^\$argon2id\$v=19\$m=65536,t=3,p=1\$/);
    expect(first).not.toBe(second);
    expect(first).not.toContain(password);
    await expect(service.verify(first, password)).resolves.toBe(true);
    await expect(service.verify(first, password.trim())).resolves.toBe(false);
    await expect(service.verify('invalid-hash', password)).resolves.toBe(false);
  });
});
