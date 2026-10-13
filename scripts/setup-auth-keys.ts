import { createPublicKey, generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

try {
  if (process.env.NODE_ENV === 'production') throw new Error();
  const directory = resolve(__dirname, '../.keys');
  const privatePath = join(directory, 'jwt-private.pem');
  const publicPath = join(directory, 'jwt-public.pem');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (!existsSync(privatePath)) {
    if (existsSync(publicPath)) throw new Error();
    const pair = generateKeyPairSync('rsa', {
      modulusLength: 3072,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    writeFileSync(privatePath, pair.privateKey, { flag: 'wx', mode: 0o600 });
  }
  const parsedPublic = createPublicKey(readFileSync(privatePath));
  if (
    parsedPublic.asymmetricKeyType !== 'rsa' ||
    (parsedPublic.asymmetricKeyDetails?.modulusLength ?? 0) < 2048
  )
    throw new Error();
  const publicKey = parsedPublic.export({
    type: 'spki',
    format: 'pem',
  });
  if (!existsSync(publicPath))
    writeFileSync(publicPath, publicKey, { flag: 'wx', mode: 0o600 });
  else if (
    createPublicKey(readFileSync(publicPath)).export({
      type: 'spki',
      format: 'pem',
    }) !== publicKey
  )
    throw new Error();
  console.log(
    'Local RSA keys are ready in ignored .keys/; existing keys were preserved.',
  );
} catch {
  console.error(
    'Local key setup failed. Check .keys/ and runtime mode; no key values were printed or overwritten.',
  );
  process.exitCode = 1;
}
