const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { migrationTarget, assertMigrationHistory } = require('./migrate.cjs');
const { migrationManifest } = require('./migration-manifest.cjs');
const { smoke, validateBaseUrl } = require('./smoke.cjs');
const { deploy, preflight } = require('./render-deploy.cjs');
const sha = 'a'.repeat(40),
  digest = 'b'.repeat(64);
const release = () => ({
  NODE_ENV: 'production',
  DATABASE_URL:
    'postgresql://app:unused@db.example.invalid/kirana_identity?schema=public&sslmode=require',
  MIGRATION_EXPECTED_HOST: 'db.example.invalid',
  MIGRATION_EXPECTED_DATABASE: 'kirana_identity',
  MIGRATION_EXPECTED_USER: 'app',
  MIGRATION_APPROVED_SHA: sha,
  MIGRATION_REVIEWED_DIGEST: digest,
  MIGRATION_BACKUP_REFERENCE: 'private-backup-id',
});

test('migration requires exact image, reviewed SQL digest and backup approval', () => {
  assert.deepEqual(migrationTarget(release(), sha, digest), {
    database: 'kirana_identity',
    username: 'app',
  });
  for (const field of [
    'MIGRATION_APPROVED_SHA',
    'MIGRATION_REVIEWED_DIGEST',
    'MIGRATION_BACKUP_REFERENCE',
  ])
    assert.throws(() =>
      migrationTarget({ ...release(), [field]: '' }, sha, digest),
    );
  assert.throws(() => migrationTarget(release(), 'unknown', digest));
  assert.throws(() =>
    migrationTarget({ ...release(), NODE_ENV: 'test' }, sha, digest),
  );
});
test('migration rejects mismatched hosts/databases/users, local/test targets and URL overrides', () => {
  for (const field of [
    'MIGRATION_EXPECTED_HOST',
    'MIGRATION_EXPECTED_DATABASE',
    'MIGRATION_EXPECTED_USER',
  ])
    assert.throws(() =>
      migrationTarget({ ...release(), [field]: 'different' }, sha, digest),
    );
  for (const suffix of [
    '&host=other.invalid',
    '&schema=other',
    '&sslmode=disable',
    '&sslmode=require',
  ])
    assert.throws(() =>
      migrationTarget(
        { ...release(), DATABASE_URL: release().DATABASE_URL + suffix },
        sha,
        digest,
      ),
    );
  for (const host of [
    'localhost',
    '127.0.0.1',
    'postgres',
    'host.docker.internal',
  ])
    assert.throws(() =>
      migrationTarget(
        {
          ...release(),
          DATABASE_URL: release().DATABASE_URL.replace(
            'db.example.invalid',
            host,
          ),
          MIGRATION_EXPECTED_HOST: host,
        },
        sha,
        digest,
      ),
    );
  assert.throws(() =>
    migrationTarget(
      {
        ...release(),
        DATABASE_URL: release().DATABASE_URL.replace(
          'kirana_identity?',
          'kirana_identity_test?',
        ),
        MIGRATION_EXPECTED_DATABASE: 'kirana_identity_test',
      },
      sha,
      digest,
    ),
  );
  assert.throws(() =>
    migrationTarget(
      {
        ...release(),
        DATABASE_URL: release().DATABASE_URL.replace('&sslmode=require', ''),
      },
      sha,
      digest,
    ),
  );
});
test('migration manifest hashes both original migrations without altering history', () => {
  const result = migrationManifest();
  assert.match(result.digest, /^[a-f0-9]{64}$/);
  assert.deepEqual(
    result.migrations.map((item) => item.name),
    ['20261012064735_init_identity', '20261013081144_registration_schema'],
  );
  assert.deepEqual(result, migrationManifest());
});
test('migration refuses altered/missing/failed applied history and requires every migration after deployment', () => {
  const manifest = migrationManifest();
  const rows = manifest.migrations.map((entry) => ({
    migration_name: entry.name,
    checksum: entry.sha256,
    finished_at: new Date(),
    rolled_back_at: null,
  }));
  assertMigrationHistory(rows, manifest, true);
  assert.throws(() =>
    assertMigrationHistory(
      [{ ...rows[0], checksum: '0'.repeat(64) }],
      manifest,
    ),
  );
  assert.throws(() =>
    assertMigrationHistory(
      [{ ...rows[0], migration_name: 'unknown' }],
      manifest,
    ),
  );
  assert.throws(() =>
    assertMigrationHistory([{ ...rows[0], finished_at: null }], manifest),
  );
  assert.throws(() => assertMigrationHistory(rows.slice(0, 1), manifest, true));
});
test('smoke refuses credential URLs, query strings and unencrypted remote origins', () => {
  for (const target of [
    'https://user:secret@example.invalid',
    'https://example.invalid?token=secret',
    'http://remote.invalid',
    'https://example.invalid/private',
  ])
    assert.throws(() => validateBaseUrl(target));
  assert.equal(
    validateBaseUrl('http://127.0.0.1:3001'),
    'http://127.0.0.1:3001',
  );
});
function smokeResponse(path) {
  if (path === '/api/v1/auth/me' || path === '/api/v1/organizations')
    return { status: 401 };
  if (path === '/api/docs-json')
    return {
      status: 200,
      json: async () => ({
        paths: Object.fromEntries(
          [
            '/api/v1/auth/login',
            '/api/v1/auth/refresh',
            '/api/v1/organizations/{orgId}/stores',
            '/api/v1/organizations/{orgId}/onboarding/complete',
            '/api/v1/invitations/accept',
          ].map((path) => [path, {}]),
        ),
      }),
    };
  return {
    status: 200,
    json: async () => ({ status: 'ok', database: 'connected' }),
  };
}
test('smoke checks readiness, liveness, authentication and the implemented API contract', async () => {
  await smoke('https://app.example.invalid', async (url) =>
    smokeResponse(new URL(url).pathname),
  );
  await assert.rejects(
    smoke('https://app.example.invalid', async () => ({ status: 503 })),
  );
  await assert.rejects(
    smoke('https://app.example.invalid', async (url) =>
      new URL(url).pathname === '/api/docs-json'
        ? { status: 200, json: async () => ({ paths: {} }) }
        : smokeResponse(new URL(url).pathname),
    ),
  );
});
const deployEnv = () => ({
  RENDER_DEPLOY_HOOK_URL:
    'https://api.render.com/deploy/srv-fixture?key=private-fixture',
  RENDER_API_KEY: 'private-api-fixture',
  RENDER_SERVICE_ID: 'srv-fixture',
  RELEASE_SHA: sha,
  SMOKE_BASE_URL: 'https://app.example.invalid',
});
function renderMock({
  auto = 'no',
  commit = sha,
  triggerStatus = 200,
  status = 'live',
  preDeploy = '',
  plan = 'starter',
  url = 'https://app.example.invalid',
  hookId = 'dep-fixture',
} = {}) {
  const calls = [];
  return {
    calls,
    fetcher: async (raw, options = {}) => {
      const target = new URL(raw);
      calls.push({ target, options });
      if (target.pathname === '/v1/services/srv-fixture')
        return {
          ok: true,
          json: async () => ({
            type: 'web_service',
            autoDeploy: auto,
            serviceDetails: {
              runtime: 'docker',
              plan,
              numInstances: 1,
              healthCheckPath: '/api/v1/health',
              url,
              envSpecificDetails: { preDeployCommand: preDeploy },
            },
          }),
        };
      if (target.pathname.startsWith('/deploy/'))
        return {
          status: triggerStatus,
          json: async () => ({ deploy: { id: hookId } }),
        };
      if (target.pathname.includes('/deploys/'))
        return {
          ok: true,
          json: async () => ({ status, commit: { id: commit } }),
        };
      return smokeResponse(target.pathname);
    },
  };
}
test('Render deploy pins the tested commit and waits for that deployment before smoke', async () => {
  const mock = renderMock();
  await deploy(deployEnv(), mock.fetcher);
  const hook = mock.calls.find((call) =>
    call.target.pathname.startsWith('/deploy/'),
  );
  assert.equal(hook.target.searchParams.get('ref'), sha);
  assert.equal(hook.options.method, 'POST');
  assert(
    mock.calls.some(
      (call) =>
        call.target.pathname === '/v1/services/srv-fixture/deploys/dep-fixture',
    ),
  );
  assert(mock.calls.some((call) => call.target.pathname === '/api/v1/health'));
});
test('Render preflight verifies configuration without starting a deploy or smoke', async () => {
  const mock = renderMock();
  await preflight(deployEnv(), mock.fetcher);
  assert.equal(mock.calls.length, 1);
  assert.equal(mock.calls[0].target.pathname, '/v1/services/srv-fixture');
});
test('Render refuses wrong service URLs, auto-deploy and a second migration mechanism before triggering', async () => {
  for (const settings of [
    { auto: 'yes' },
    { plan: 'free' },
    { url: 'https://different.invalid' },
    { preDeploy: 'prisma migrate deploy' },
  ]) {
    const mock = renderMock(settings);
    await assert.rejects(deploy(deployEnv(), mock.fetcher));
    assert(
      !mock.calls.some((call) => call.target.pathname.startsWith('/deploy/')),
    );
  }
  for (const hook of [
    'https://attacker.invalid/deploy/srv-fixture?key=secret',
    'https://api.render.com/deploy/srv-other?key=secret',
  ])
    await assert.rejects(
      deploy({ ...deployEnv(), RENDER_DEPLOY_HOOK_URL: hook }, async () =>
        assert.fail('No request expected'),
      ),
    );
});
test('Render does not treat queued, failed or wrong-commit deployments as success', async () => {
  for (const settings of [
    { triggerStatus: 202 },
    { commit: 'c'.repeat(40) },
    { status: 'build_failed' },
    { hookId: 'invalid' },
  ]) {
    const mock = renderMock(settings);
    await assert.rejects(deploy(deployEnv(), mock.fetcher));
    assert(
      !mock.calls.some((call) => call.target.pathname === '/api/v1/health'),
    );
  }
});
test('Render polling times out without declaring the old live application a successful release', async () => {
  const mock = renderMock({ status: 'build_in_progress' });
  await assert.rejects(deploy(deployEnv(), mock.fetcher, async () => {}));
  assert(!mock.calls.some((call) => call.target.pathname === '/api/v1/health'));
});
test('Docker context allowlist keeps secrets/backups/volumes out and preserves migration SQL', () => {
  const ignore = readFileSync(join(__dirname, '../.dockerignore'), 'utf8');
  assert.match(ignore, /^\*\*$/m);
  assert.match(ignore, /!prisma\/\*\*/);
  assert.match(ignore, /\*\*\/\.env\*/);
  const dockerfile = readFileSync(join(__dirname, '../Dockerfile'), 'utf8');
  assert(!/COPY\s+\.\s+\./.test(dockerfile));
  assert(!/ARG\s+DATABASE_URL|ENV\s+DATABASE_URL/.test(dockerfile));
});
