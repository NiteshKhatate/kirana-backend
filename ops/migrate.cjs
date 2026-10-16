const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { migrationManifest } = require('./migration-manifest.cjs');

function migrationTarget(env, buildCommit, digest) {
  const url = new URL(env.DATABASE_URL);
  const database = decodeURIComponent(url.pathname.slice(1));
  const username = decodeURIComponent(url.username);
  if (
    env.NODE_ENV !== 'production' ||
    !/^[a-f0-9]{40}$/.test(buildCommit) ||
    env.MIGRATION_APPROVED_SHA !== buildCommit ||
    env.MIGRATION_REVIEWED_DIGEST !== digest ||
    !env.MIGRATION_BACKUP_REFERENCE?.trim()
  )
    throw new Error('Missing release approval');
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !url.password ||
    !database ||
    url.hash ||
    [
      'localhost',
      '127.0.0.1',
      '::1',
      '[::1]',
      'postgres',
      'host.docker.internal',
    ].includes(url.hostname) ||
    database.endsWith('_test') ||
    url.hostname !== env.MIGRATION_EXPECTED_HOST ||
    database !== env.MIGRATION_EXPECTED_DATABASE ||
    username !== env.MIGRATION_EXPECTED_USER
  )
    throw new Error('Unexpected migration target');
  if (
    [...url.searchParams.keys()].some(
      (key) =>
        ![
          'schema',
          'sslmode',
          'connection_limit',
          'connect_timeout',
          'pool_timeout',
        ].includes(key),
    ) ||
    [...url.searchParams.keys()].some(
      (key) => url.searchParams.getAll(key).length !== 1,
    ) ||
    (url.searchParams.get('schema') ?? 'public') !== 'public' ||
    !['require', 'verify-ca', 'verify-full'].includes(
      url.searchParams.get('sslmode'),
    )
  )
    throw new Error('Unsafe migration connection settings');
  return { database, username };
}

function assertMigrationHistory(rows, manifest, complete = false) {
  for (const row of rows) {
    if (row.rolled_back_at) continue;
    if (!row.finished_at)
      throw new Error('An existing migration needs operator resolution');
    const entry = manifest.migrations.find(
      (entry) => entry.name === row.migration_name,
    );
    if (!entry)
      throw new Error('Database contains a migration absent from the release');
    const source = readFileSync(
      join(__dirname, '../prisma/migrations', entry.name, 'migration.sql'),
      'utf8',
    );
    // Prisma migration files may have Windows checkout line endings. Only those
    // byte-equivalent newline variants are accepted; SQL edits are never ignored.
    const normalized = source.replace(/\r\n/g, '\n');
    const checksums = [
      source,
      normalized,
      normalized.replace(/\n/g, '\r\n'),
    ].map((text) => createHash('sha256').update(text).digest('hex'));
    if (!checksums.includes(row.checksum))
      throw new Error('Applied migration SQL differs from this release');
  }
  if (
    complete &&
    manifest.migrations.some(
      (entry) =>
        !rows.some(
          (row) =>
            row.migration_name === entry.name &&
            row.finished_at &&
            !row.rolled_back_at,
        ),
    )
  )
    throw new Error('Migration did not finish the reviewed history');
}

async function migrate(env = process.env) {
  const { commit } = JSON.parse(
    readFileSync(join(__dirname, 'build-info.json'), 'utf8'),
  );
  const manifest = migrationManifest();
  const target = migrationTarget(env, commit, manifest.digest);
  // Import only after explicit URL and release checks; never read a dotenv file.
  const { PrismaClient } = require('@prisma/client');
  const client = new PrismaClient({
    datasources: { db: { url: env.DATABASE_URL } },
  });
  try {
    const [identity] =
      await client.$queryRaw`SELECT current_database() AS database, current_user AS username`;
    if (
      identity?.database !== target.database ||
      identity?.username !== target.username
    )
      throw new Error('Live database identity mismatch');
    const [history] =
      await client.$queryRaw`SELECT to_regclass('public._prisma_migrations')::text AS table_name`;
    if (history.table_name) {
      const rows =
        await client.$queryRaw`SELECT migration_name, checksum, finished_at, rolled_back_at FROM public._prisma_migrations`;
      assertMigrationHistory(rows, manifest);
    } else {
      const tables =
        await client.$queryRaw`SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname = 'public'`;
      if (tables.length)
        throw new Error('Refusing to migrate an unmanaged database');
    }
  } finally {
    await client.$disconnect();
  }
  const result = spawnSync(
    process.execPath,
    [
      join(__dirname, '../node_modules/prisma/build/index.js'),
      'migrate',
      'deploy',
    ],
    {
      env: { ...env },
      encoding: 'utf8',
      timeout: 20 * 60 * 1000,
      windowsHide: true,
    },
  );
  // Prisma errors can include the database URL. Keep captured output private.
  if (result.status !== 0) throw new Error('Migration deploy failed');
  try {
    const rows =
      await client.$queryRaw`SELECT migration_name, checksum, finished_at, rolled_back_at FROM public._prisma_migrations`;
    assertMigrationHistory(rows, manifest, true);
  } finally {
    await client.$disconnect();
  }
  console.log('Reviewed migrations deployed to the verified database.');
}
if (require.main === module)
  migrate().catch(() => {
    console.error(
      'Migration refused or failed; no connection details printed. Check approval, target identity and reviewed migration evidence.',
    );
    process.exitCode = 1;
  });
module.exports = { migrationTarget, assertMigrationHistory };
