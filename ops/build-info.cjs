const { writeFileSync } = require('node:fs');
const { join } = require('node:path');
const commit = process.argv[2];
if (commit !== 'unknown' && !/^[a-f0-9]{40}$/.test(commit ?? '')) {
  console.error('BUILD_SHA must be a full Git commit or unknown.');
  process.exitCode = 1;
} else {
  writeFileSync(
    join(__dirname, 'build-info.json'),
    JSON.stringify({ commit }) + '\n',
  );
}
