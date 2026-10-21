const { smoke, validateBaseUrl } = require('./smoke.cjs');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function preflight(env = process.env, fetcher = fetch) {
  const {
    RENDER_DEPLOY_HOOK_URL: rawHook,
    RENDER_API_KEY: key,
    RENDER_SERVICE_ID: serviceId,
    RELEASE_SHA: sha,
  } = env;
  if (
    !key ||
    !/^srv-[a-z0-9]+$/.test(serviceId ?? '') ||
    !/^[a-f0-9]{40}$/.test(sha ?? '')
  )
    throw new Error('Missing deploy configuration');
  const base = validateBaseUrl(env.SMOKE_BASE_URL);
  if (!base.startsWith('https://'))
    throw new Error('Production smoke requires HTTPS');
  const hook = new URL(rawHook);
  if (
    hook.origin !== 'https://api.render.com' ||
    hook.pathname !== `/deploy/${serviceId}` ||
    !hook.searchParams.get('key') ||
    hook.username ||
    hook.password ||
    hook.hash ||
    [...hook.searchParams.keys()].some((name) => name !== 'key')
  )
    throw new Error('Invalid hook');
  async function api(path) {
    const response = await fetcher(
      `https://api.render.com/v1/services/${serviceId}${path}`,
      {
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(15000),
        redirect: 'error',
      },
    );
    if (!response.ok) throw new Error('Render API request failed');
    return response.json();
  }
  const service = await api('');
  if (
    service.type !== 'web_service' ||
    service.autoDeploy !== 'no' ||
    (service.serviceDetails?.runtime ?? service.serviceDetails?.env) !==
      'docker' ||
    !service.serviceDetails?.plan ||
    service.serviceDetails.plan === 'free' ||
    service.serviceDetails.numInstances !== 1 ||
    service.serviceDetails.autoscaling?.enabled ||
    service.serviceDetails.healthCheckPath !== '/api/v1/health' ||
    validateBaseUrl(service.serviceDetails?.url) !== base ||
    service.preDeployCommand ||
    service.serviceDetails?.preDeployCommand ||
    service.serviceDetails?.envSpecificDetails?.preDeployCommand
  )
    throw new Error(
      'Render service does not match reviewed deployment configuration',
    );
  return { hook, sha, base, api };
}
async function deploy(env = process.env, fetcher = fetch, wait = sleep) {
  const { hook, sha, base, api } = await preflight(env, fetcher);
  hook.searchParams.set('ref', sha);
  const triggered = await fetcher(hook, {
    method: 'POST',
    signal: AbortSignal.timeout(15000),
    redirect: 'error',
  });
  if (triggered.status !== 200)
    throw new Error('Deploy was not uniquely started');
  const result = await triggered.json();
  const deployId = result.deploy?.id ?? result.id;
  if (!/^dep-[a-z0-9]+$/.test(deployId ?? ''))
    throw new Error('Missing deploy ID');
  for (let attempt = 0; attempt < 120; attempt++) {
    const current = await api(`/deploys/${deployId}`);
    if (current.commit?.id !== sha) throw new Error('Deploy commit mismatch');
    if (current.status === 'live') {
      await smoke(base, fetcher);
      console.log('Requested Render commit is live and smoke checks passed.');
      return;
    }
    if (
      [
        'build_failed',
        'update_failed',
        'pre_deploy_failed',
        'canceled',
        'deactivated',
      ].includes(current.status)
    )
      throw new Error('Render deploy failed');
    await wait(10000);
  }
  throw new Error('Render deployment timed out');
}
if (require.main === module)
  (process.argv[2] === '--check'
    ? preflight().then(() =>
        console.log(
          'Render release configuration verified; no deployment triggered.',
        ),
      )
    : deploy()
  ).catch(() => {
    console.error(
      'Render deployment failed or was refused. Secret URLs, credentials and response bodies were suppressed; inspect the service privately.',
    );
    process.exitCode = 1;
  });
module.exports = { deploy, preflight };
