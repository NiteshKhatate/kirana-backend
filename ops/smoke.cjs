function validateBaseUrl(value) {
  const url = new URL(value);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/' ||
    !['http:', 'https:'].includes(url.protocol) ||
    (url.protocol === 'http:' &&
      !['localhost', '127.0.0.1'].includes(url.hostname))
  )
    throw new Error('Invalid smoke target');
  return url.origin;
}
async function smoke(value, fetcher = fetch) {
  const base = validateBaseUrl(value);
  async function get(path, status) {
    const result = await fetcher(base + path, {
      signal: AbortSignal.timeout(10000),
      redirect: 'error',
      headers: { 'Cache-Control': 'no-cache' },
    });
    if (result.status !== status) throw new Error('Smoke status check failed');
    return result;
  }
  const ready = await (await get('/api/v1/health', 200)).json();
  if (ready.status !== 'ok' || ready.database !== 'connected')
    throw new Error('Readiness failed');
  const live = await (await get('/api/v1/health/live', 200)).json();
  if (live.status !== 'ok') throw new Error('Liveness failed');
  await get('/api/v1/auth/me', 401);
  await get('/api/v1/organizations', 401);
  const docs = await (await get('/api/docs-json', 200)).json();
  for (const path of [
    '/api/v1/auth/login',
    '/api/v1/auth/refresh',
    '/api/v1/organizations/{orgId}/stores',
    '/api/v1/organizations/{orgId}/onboarding/complete',
    '/api/v1/invitations/accept',
  ]) {
    if (!docs.paths?.[path]) throw new Error('OpenAPI smoke failed');
  }
}
if (require.main === module) {
  smoke(process.env.SMOKE_BASE_URL)
    .then(() => console.log('Smoke checks passed.'))
    .catch(() => {
      console.error(
        'Smoke checks failed; target and response details suppressed.',
      );
      process.exitCode = 1;
    });
}
module.exports = { smoke, validateBaseUrl };
