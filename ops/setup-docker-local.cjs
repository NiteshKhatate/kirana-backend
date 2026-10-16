const {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  appendFileSync,
} = require('node:fs');
const { resolve } = require('node:path');
const { parse } = require('dotenv');
let stage = 'local configuration';
async function setup() {
  if (process.env.NODE_ENV && process.env.NODE_ENV !== 'development')
    throw new Error();
  const root = resolve(__dirname, '..');
  const path = resolve(root, '.env');
  const file = parse(readFileSync(path));
  const url = new URL(file.DATABASE_URL);
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !['localhost', '127.0.0.1'].includes(url.hostname) ||
    url.port !== '5433' ||
    url.pathname !== '/kirana_identity' ||
    url.username !== 'kirana' ||
    !url.password
  )
    throw new Error();
  stage = 'generated Prisma client and database identity';
  const { PrismaClient } = require('@prisma/client');
  const client = new PrismaClient({
    datasources: { db: { url: url.toString() } },
  });
  try {
    const [identity] =
      await client.$queryRaw`SELECT current_database() AS database, current_user AS username`;
    if (
      identity?.database !== 'kirana_identity' ||
      identity?.username !== 'kirana'
    )
      throw new Error();
  } finally {
    await client.$disconnect();
  }
  stage = 'private Docker configuration';
  const password = decodeURIComponent(url.password);
  if (file.POSTGRES_PASSWORD && file.POSTGRES_PASSWORD !== password)
    throw new Error();
  if (!file.POSTGRES_PASSWORD)
    appendFileSync(path, `\nPOSTGRES_PASSWORD=${JSON.stringify(password)}\n`);
  url.hostname = 'postgres';
  url.port = '5432';
  const dockerEnv = resolve(root, '.env.docker');
  if (!existsSync(dockerEnv))
    writeFileSync(
      dockerEnv,
      `DATABASE_URL=${url.toString()}\nMAIL_TRANSPORT=development\n`,
      { flag: 'wx', mode: 0o600 },
    );
  mkdirSync(resolve(root, '.local-mail'), { recursive: true, mode: 0o700 });
  console.log(
    'Private local Docker configuration is ready; existing configuration and database records were preserved. Run npm run auth:keys before starting the backend.',
  );
}
setup().catch(() => {
  console.error(
    `Local Docker setup failed at ${stage}. Verify existing local database access and ignored .env files; no credentials were printed or rotated.`,
  );
  process.exitCode = 1;
});
