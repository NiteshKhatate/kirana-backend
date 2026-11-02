# Render preview preparation — 2026-11-02

The user confirmed Nitesh's workspace, free preview only, the Node 24 LTS upgrade, and that the frontend is not deployed. Read-only Render discovery found no existing web services or PostgreSQL instances. The user subsequently requested **local changes for review** and reported that Resend account setup is still in progress. No changes were pushed, no hosted resources were created, no runtime secrets were deployed, and no hosted migration or email was sent.

Prepared `render.yaml` with a free Docker web service, free PostgreSQL 17, Singapore region and private `fromDatabase` wiring to `kirana_identity`. The empty public database allow list disables external access until an operator explicitly permits a narrow source for reviewed initialization. Automatic deploys remain off; migrations do not run at startup. The original schema and both migration SQL files are unchanged.

Configured Node 24 for application/agent Dockerfiles, GitHub Actions, retained Jenkins validation and `.nvmrc`. No application dependency majors or npm lockfile were changed. Added Resend HTTPS transport with validated keys, fixed destination, redirect refusal, bounded requests, safe errors and explicit provider-acceptance status. Added explicit email-code mode for the frontend-less preview, preserving token expiry, hashing, single use, authentication and default link mode. Matching 3072-bit preview RSA keys were generated in ignored `.keys/render-preview/`; values were not printed or committed.

## Executed checks

- Explicit Node 24.22.1 + npm lockfile installation passed. An earlier Windows `npm.cmd` invocation used its adjacent Node 20 despite PATH; the successful reinstall invoked npm's CLI through Node 24 directly. The system Node installation was not replaced.
- Prisma 6.19 schema validation and client generation passed.
- Node 24 application build, non-mutating lint and TypeScript checks passed.
- Unit tests passed: **177 tests, 31 suites**, including HTTPS adapter/configuration/code-mode cases. Provider calls are mocked.
- HTTP e2e passed: **51 tests, 5 suites**. External email is mocked.
- Operations passed: **12 checks**, including mocked deployment calls; their output does not constitute an actual Render deployment.
- The Blueprint passed the current JSON Schema retrieved from `https://render.com/schema/render.yaml.json`. GitHub Actions passed actionlint. Changed source/config formatting and Git whitespace checks passed.
- Render CLI 2.34.0 was downloaded from the official release and its SHA-256 checked in ignored `.local-tools/render/`. Platform-aware validation was attempted but refused because this CLI is not authenticated; the connected Render integration does not supply a CLI login.
- Docker Desktop's Linux engine remained unavailable (missing engine pipe). Dedicated integration tests, live migration status, Node 24 Docker builds and Linux container smoke were **not verified in this run**. No development or production database was started, migrated or reset.

## Remaining before the preview is usable

Review and authorize publication of the local changes, obtain successful hosted CI/image/integration checks, finish free Resend setup, configure the real private sending key and matching RSA keys directly in Render, validate/apply the remote Blueprint in the confirmed workspace, verify the new empty database identity and reviewed original migrations, and verify the exact live deploy plus HTTP smoke. The test sender emails only the Resend account address until a domain is verified. Free database expiry and missing managed backups prohibit production data.
