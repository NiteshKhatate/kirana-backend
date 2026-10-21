const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { randomUUID, generateKeyPairSync } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { parse } = require('dotenv');
const { smoke } = require('./smoke.cjs');
function docker(args, env) {
  const result = spawnSync('docker', args, {
    env,
    encoding: 'utf8',
    timeout: 30000,
    windowsHide: true,
  });
  if (result.status !== 0) throw new Error('Container operation failed');
  return result.stdout;
}
async function main() {
  const image = process.env.SMOKE_IMAGE;
  if (!/^kirana-backend:[a-f0-9]{40}$/.test(image ?? '')) throw new Error();
  // Dedicated Linux Jenkins agent; loopback policy is preserved by host networking.
  if (process.platform !== 'linux')
    throw new Error('This CI smoke requires Linux host networking');
  const file = parse(readFileSync(resolve(__dirname, '../.env.test')));
  const url = new URL(file.DATABASE_URL_TEST);
  if (
    !['localhost', '127.0.0.1'].includes(url.hostname) ||
    url.port !== '5434' ||
    url.pathname !== '/kirana_identity_test' ||
    url.username !== 'kirana_test' ||
    !url.password ||
    [...url.searchParams].some(
      ([name, value]) => name !== 'schema' || value !== 'public',
    )
  )
    throw new Error();
  const pair = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  const env = {
    ...process.env,
    NODE_ENV: 'test',
    PORT: '3009',
    DATABASE_URL: url.toString(),
    DATABASE_URL_TEST: url.toString(),
    JWT_PRIVATE_KEY: pair.privateKey,
    JWT_PUBLIC_KEY: pair.publicKey,
    JWT_ISSUER: 'kirana-identity',
    JWT_AUDIENCE: 'kirana-api',
  };
  const name = `kirana-ci-smoke-${randomUUID()}`;
  const cleanup = () =>
    spawnSync('docker', ['rm', '-f', name], {
      stdio: 'ignore',
      timeout: 30000,
      windowsHide: true,
    });
  const interrupted = () => {
    cleanup();
    process.exit(1);
  };
  process.once('SIGTERM', interrupted);
  process.once('SIGINT', interrupted);
  try {
    docker(
      [
        'run',
        '-d',
        '--name',
        name,
        '--network',
        'host',
        ...[
          'NODE_ENV',
          'PORT',
          'DATABASE_URL',
          'DATABASE_URL_TEST',
          'JWT_PRIVATE_KEY',
          'JWT_PUBLIC_KEY',
          'JWT_ISSUER',
          'JWT_AUDIENCE',
        ].flatMap((key) => ['--env', key]),
        image,
      ],
      env,
    );
    for (let attempt = 0; attempt < 30; attempt++) {
      try {
        await smoke('http://127.0.0.1:3009');
        console.log(
          'Runtime container smoke passed against dedicated test PostgreSQL.',
        );
        return;
      } catch {
        if (
          docker(
            ['inspect', '--format', '{{.State.Running}}', name],
            env,
          ).trim() !== 'true'
        )
          throw new Error();
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    throw new Error('Container readiness timed out');
  } finally {
    cleanup();
    process.removeListener('SIGTERM', interrupted);
    process.removeListener('SIGINT', interrupted);
  }
}
main().catch(() => {
  console.error(
    'Runtime container smoke failed; logs and private configuration suppressed.',
  );
  process.exitCode = 1;
});
