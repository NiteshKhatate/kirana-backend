# Docker, Jenkins and Render runbook

One NestJS process and Prisma client serve identity and tenant modules using `kirana_identity`. `kirana_tenant` remains unused. These files prepare deployment; a local build is not evidence that a Jenkins controller or Render release actually ran. See [Milestone 7 verification](milestone-7-verification.md) for executed versus pending gates.

## Runtime decision

The Dockerfile and Jenkins agent check preserve Node **20**, the repository's existing major. The image uses Debian Bookworm, OpenSSL and the Linux-generated Prisma 6.19.0 client; native Argon2 bindings are installed on Linux rather than copied from Windows. `NODE_IMAGE` can pin a reviewed base-image digest. A release should pin the digest and retain its image/commit evidence.

Node 20 is now out of maintenance according to the [official lifecycle page](https://nodejs.org/en/about/eol). AGENTS.md prohibits unapproved major upgrades. Approve and validate a supported Node major before production use; no major was silently upgraded here. Existing application dependency majors and npm lockfile remain unchanged. The existing npm advisory findings also require separate review; no automatic audit fix is part of this milestone.

## Local Compose

The original PostgreSQL volume and service name are preserved. PostgreSQL now binds only loopback port 5433. Its existing password comes from private configuration, not a committed credential. Changing its environment does not rotate a password in a populated volume. Never reset a volume to resolve credential problems.

```bash
npm ci
npx prisma validate
npx prisma generate
npx prisma migrate status
npm run auth:keys
# Reads the existing .env DATABASE_URL and verifies live database/role identity.
# Adds matching POSTGRES_PASSWORD only if absent; does not replace an existing value.
npm run docker:setup
docker compose config --quiet
docker compose --profile app up --build -d --wait
SMOKE_BASE_URL=http://127.0.0.1:3001 npm run smoke
```

`docker:setup` requires the existing local `kirana_identity` database on localhost:5433 as `kirana`; it fails safely for other targets. It creates ignored `.env.docker` with the container-network URL (`postgres:5432`) and development mail mode. Existing files are preserved. For a fresh checkout, first set private `.env` credentials, set `POSTGRES_PASSWORD` to match, and start only `docker compose up -d postgres`, then run setup. Inspect migration status and apply reviewed development migrations explicitly if required; the backend never migrates on startup.

The `app` profile is opt-in: plain Compose PostgreSQL commands remain available without starting the API. The backend publishes only `127.0.0.1:${BACKEND_PORT:-3001}`. Override `BACKEND_PORT` in the launching environment if a host watch server already uses 3001. Inside the container it listens on `0.0.0.0:3001`; Render overrides `PORT` at runtime. Keys are mounted read-only and development mail is bind-mounted into ignored `.local-mail/`. On Linux, give UID 1000 read access to keys and write access to the mail directory; do not make keys world-readable. No mail or key directories are copied into images.

Use `docker compose config --quiet` to validate configuration. The full `docker compose config`, `docker inspect` environment output, `env`, and container logs can expose private configuration and must not be pasted into tickets or archived. To stop the API while preserving PostgreSQL and data:

```bash
docker compose --profile app stop backend
```

Never use volume-removal commands. A transient Windows port-binding failure after container recreation can be retried once the old proxy releases its port; it is not a reason to delete data.

## Image boundaries

`Dockerfile` has dependency/build, `migration`, and default `runtime` targets. The runtime prunes development packages and explicitly removes the CLI that npm may retain through Prisma Client's peer relationship. It runs as UID 1000, starts Node directly, handles shutdown signals through Nest's existing hooks, and has a database-readiness health check. The migration target retains the matching CLI and original SQL. Neither target receives real credentials during build. A deliberately unusable build-only URL is used only for client generation.

`.dockerignore` is an allowlist. Local dotenv files, Git metadata, private keys, mail, databases, backups, generated host dependencies, tests and local tools never enter the build context. All original Prisma SQL remains included in the migration target. Do not add secret build arguments or copy `.env` to resolve configuration errors. Render runtime configuration belongs in Render env vars; Jenkins deployment secrets belong in its credentials store.

```bash
RELEASE_SHA=$(git rev-parse HEAD)
docker build --target runtime --build-arg BUILD_SHA="$RELEASE_SHA" -t "kirana-backend:$RELEASE_SHA" .
docker build --target migration --build-arg BUILD_SHA="$RELEASE_SHA" -t "kirana-backend-migration:$RELEASE_SHA" .
npm run migration:manifest
```

For local uncommitted testing the Dockerfile accepts `BUILD_SHA=unknown`. A migration image with unknown metadata refuses production migrations. Images built from a dirty worktree with HEAD supplied are only local evidence; Jenkins builds from its checked-out commit. Commit/review changes before using the release path.

## Jenkins setup and pipeline

For free local learning with the existing Docker Desktop controller, use [local Jenkins setup](jenkins-local.md). It prepares a separate Linux agent and isolated CI Docker daemon and keeps production deployment disabled.

Use a protected multibranch Pipeline and the repository's `Jenkinsfile`, with a dedicated trusted Linux agent labeled `kirana-backend-ci`. Required: approved Node 20/npm versions, Docker Engine/Compose, Git, and Jenkins Pipeline, Git, Credentials Binding and Lockable Resources plugins. After the approved runtime-major change, update the agent check and base image together. Do not expose production credentials to untrusted PR Jenkinsfiles, shared agents, shell tracing, or arbitrary build parameters. Only protected main builds may enter deployment; non-main/PR builds never bind deployment secrets.

Stages: checkout → `npm ci` → Prisma validate/generate → non-mutating lint/typecheck → unit/operations/HTTP tests → verified dedicated PostgreSQL integration → production build → both Docker targets → runtime-image smoke. Lockable Resources serialize loopback test port 5434 across jobs, and a separate release lock serializes migration/deploy jobs. Existing test configuration/volumes are preserved. No CI step truncates databases or removes volumes.

The runtime-image smoke uses Linux host networking and the verified dedicated local test URL, ephemeral RSA keys and test mail mode. It starts only an ephemeral API container, checks HTTP readiness/authorization/OpenAPI and removes that container without volume flags. On Windows, the equivalent verified local evidence is the Compose API smoke; the Jenkins Linux-specific stage must still run on the real agent. Set no development/production URL in test variables.

`DEPLOY_RENDER` defaults false. After all checks, protected `main` may request an operator input for the exact tested SHA. The operator must review migration SQL and the archived manifest digest, verify an available backup/restore point, confirm compatibility with the currently running application and approve use of production credentials. The backup reference is an operator attestation, not a claim that the script created or independently verified a backup.

Configure these **Secret text** credentials in the trusted job scope:

| Jenkins credential ID | Value |
| --- | --- |
| `kirana-production-database-url` | Existing production PostgreSQL migration URL, explicit TLS and public schema; do not use local/test DB |
| `kirana-render-deploy-hook` | Existing Render service's secret deploy hook URL |
| `kirana-render-api-key` | API key authorized to read the selected service/deployment |

Job parameters contain only the existing service ID, HTTPS origin, and separately reviewed expected DB host/name/role. They do not contain credentials. Render's backend runtime `DATABASE_URL` must address the same database as the migration credential (internal and external hostnames can differ); verify this privately before approving.

The release step performs a read-only Render preflight, runs the approved migration image once, then triggers Render for the tested commit through the hook's `ref` parameter. The watcher requires the new deployment ID, waits for that deployment's matching commit to become `live`, and only then runs HTTP smoke. A 202 queued hook response, failed deploy, unknown ID or wrong commit never counts as a successful release. It does not retry a hook request that may have already started a deployment. No hook/API response bodies or secret URLs are logged. [Render deploy hooks](https://render.com/docs/deploy-hooks), [specific-commit deploys](https://render.com/docs/deploys), [Jenkins Pipeline reference](https://www.jenkins.io/doc/book/pipeline/syntax/).

## Render service and runtime configuration

`render.yaml` describes a Docker web service with one instance, readiness `/api/v1/health`, auto-deploys **off**, and no database provisioning. The manifest selects the **paid Starter plan** because [free Render services block SMTP ports 25/465/587](https://render.com/docs/free), which the current mail adapter requires. No paid resource was created or upgraded. Review the existing service's plan, name, region, limits and billing before importing; provisioning/upgrading a paid resource requires user approval. Importing a Blueprint can cause an initial deployment, so do not import it before the credential/runtime/migration review. Existing services must use the reviewed configuration; avoid competing dashboard auto-deploys.

Required process env vars (all examples are placeholders):

| Setting | Production requirement |
| --- | --- |
| `NODE_ENV`, `PORT` | `production`, Render-assigned port (manifest uses 10000) |
| `DATABASE_URL` | Existing managed PostgreSQL `kirana_identity` connection, private runtime credential |
| `JWT_PUBLIC_KEY`, `JWT_PRIVATE_KEY` | Matching RSA PEMs ≥2048 bits, escaped newlines accepted; never use local-key fallback |
| `JWT_ISSUER`, `JWT_AUDIENCE` | Explicit identity/API values |
| `MAIL_TRANSPORT`, `EMAIL_FROM` | `smtp`, real sender |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD` | Existing provider, implicit TLS or required STARTTLS; no credentials in Git |
| `VERIFY_EMAIL_URL`, `RESET_PASSWORD_URL` | HTTPS frontend URLs without credentials, query or fragment |

Optional validated settings: `JWT_KEY_ID`, `JWT_PREVIOUS_PUBLIC_KEYS`, access TTL 60–900 seconds, refresh TTL 300–2592000, reset TTL 300–3600, invitation TTL 300–604800, verification TTL 300–86400, resend cooldown 60–3600. See `.env.example`. Never put deploy hook/API key/migration-approval flags in application env vars. No wildcard credentialed CORS is enabled. The separate frontend still needs the documented BFF/cookie/CSRF implementation. Limits are process-local, so keep one instance until shared limiter/trusted proxy behavior is designed; a proxy's peer IP may concentrate traffic.

The Render preflight requires the service's default HTTPS URL, Docker runtime, a paid plan, one instance without autoscaling, database readiness health check, auto-deploy disabled and no pre-deploy migration command. This avoids double-running migrations. Render rebuilds the selected Git commit; the locally tested image digest is not automatically pushed to a registry. Pinning the base image and lockfile improves reproducibility, but do not claim Render ran the identical local image digest. [Blueprint reference](https://render.com/docs/blueprint-spec), [Docker on Render](https://render.com/docs/docker).

## Production migration and backup procedure

1. Identify the existing production database and role through approved private configuration. Verify the runtime and migration URLs address the same DB. Obtain a fresh restorable managed backup/PITR reference and verify restore access. Keep backup contents and restore credentials out of Git, build artifacts and logs. No backup has been created by this repository change.
2. Review every pending migration and previously applied history; inspect SQL and compare the archived manifest to the tested commit. Review compatibility with the still-running app because migration precedes deployment. Keep original migrations; no destructive SQL is introduced here.
3. Approve the exact commit, manifest digest, expected host/database/user and backup reference through the Jenkins input. Runtime keys/SMTP/service changes and paid resources require separate review when provisioning.
4. The migration runner validates a production-only explicit TLS URL and public schema, rejects local/test targets and URL target overrides, verifies live database/role identity, and rejects missing/modified/failed migration history. It accepts only byte-equivalent LF/CRLF variants of original SQL.
5. It invokes the installed matching Prisma CLI's `migrate deploy` once, with output captured to avoid credential leakage, then verifies all reviewed migrations are applied. Failed migration state requires operator diagnosis; it never resets, resolves, or rolls back a database automatically. Inspect detailed failures privately.
6. Deploy the tested Git commit and retain the Jenkins stage result, reviewed manifest, Render deployment ID/commit/status and smoke result. Only then mark the live release gate complete.

## Smoke and rollback

`npm run smoke` reads `SMOKE_BASE_URL` from the environment, never credentials. It checks DB readiness, liveness, unauthorized `/auth/me` and organization access, and the implemented OpenAPI routes. It does not create production users, send mail or change tenant data. Post-deploy business-flow verification with a designated account and production SMTP is a separate approved exercise; no production delivery success is claimed by HTTP readiness.

On build/preflight/migration failure: stop the release and keep the previous application active. Migration failure may leave a failed migration record; preserve evidence and repair only with reviewed operator action. Never use reset or automatic destructive reversal.

On Render deployment/smoke failure: inspect the selected deployment privately. If the prior version is schema-compatible, redeploy the last known-good commit through the same approved release path (and matching backward-compatible migration history) or use Render's rollback UI after review. A rollback to an older migration image is deliberately refused if the database contains newer applied migrations. **Application rollback does not undo database migrations.** For an incompatible database change, restore the verified backup into a separate managed target, validate it, obtain approval to repoint credentials, then smoke-check. Do not overwrite the live DB automatically. Retain old JWT verification keys through their maximum token lifetime when rotating.
