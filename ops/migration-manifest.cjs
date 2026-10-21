const { createHash } = require('node:crypto');
const { readdirSync, readFileSync } = require('node:fs');
const { join, resolve } = require('node:path');
function migrationManifest(root = resolve(__dirname, '..')) {
  const directory = join(root, 'prisma', 'migrations');
  const migrations = readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  if (
    !migrations.length ||
    migrations.some((name) => !/^\d{14}_[a-zA-Z0-9_-]+$/.test(name))
  )
    throw new Error('Invalid migration history');
  const digest = createHash('sha256');
  const entries = migrations.map((name) => {
    const sha256 = createHash('sha256')
      .update(readFileSync(join(directory, name, 'migration.sql')))
      .digest('hex');
    digest.update(`${name}:${sha256}\n`);
    return { name, sha256 };
  });
  return { digest: digest.digest('hex'), migrations: entries };
}
if (require.main === module)
  console.log(JSON.stringify(migrationManifest(), null, 2));
module.exports = { migrationManifest };
