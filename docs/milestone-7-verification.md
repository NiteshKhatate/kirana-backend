# Milestone 7 — Deployment preparation and local evidence

Prepared and locally verified on 2026-10-16. **Local implementation is complete; the full milestone exit gate is still pending real Jenkins and production Render execution.** No existing Jenkins controller/job or Render service/credentials were supplied in this session. No production secrets were deployed, paid resources created, backup claimed or production migration/deployment performed. Node 20 remains the current major pending the requested upgrade approval.

## Files and behavior

- `Dockerfile`: Debian/OpenSSL multi-stage build, `npm ci`, Linux Prisma 6.19.0 generation, compiled NestJS, pruned runtime, UID 1000, direct Node startup, PORT-aware readiness health check. The separate `migration` target contains the matching CLI and original migrations. Runtime explicitly removes the CLI retained by npm's optional peer relationship. No migration runs on API start/restart.
- `.dockerignore`: build-context allowlist excludes all local dotenv files, key material, mail, backups, volumes, Git metadata, host modules, tests and tools. Original migration SQL remains available to the migration target. No real credential is passed at build time.
- `docker-compose.yml`: preserves the existing PostgreSQL volume/name, moves the database's existing password to private configuration and binds PostgreSQL to loopback. Optional `app` profile adds API build/startup, health dependency, private runtime env file, read-only keys, private mail bind mount, non-root image and graceful shutdown.
- `ops/setup-docker-local.cjs`: verifies the existing local DB/role using the existing URL, preserves existing dotenv values and writes only ignored local Docker configuration. It appends the matching `POSTGRES_PASSWORD` if absent, without printing or rotating it. `.env.docker` uses the Compose network database host. The private config must exist before API startup; setup is not a database provision/reset tool.
- `Jenkinsfile`: protected-main, opt-in, operator-approved release; checkout/install/Prisma/lint/type/unit/operations/HTTP/integration/build/image/smoke stages, shared test/release locks, scoped credential bindings and reviewed migration evidence. Groovy syntax was parsed locally; **no actual Jenkins Pipeline/DSL/plugin execution has occurred**. The Linux host-network runtime smoke stage must still run on its real agent.
- `ops/migration-manifest.cjs`, `ops/migrate.cjs`: original SQL digests and SHA-bound migration release; explicit production URL, TLS, expected host/DB/role, operator backup reference and reviewed digest; live identity and prior migration checksums validated; matching installed CLI `migrate deploy` with private output; completed history checked. Local/test/mismatched/unmanaged/failed/modified history is refused. LF/CRLF-only variants of original migration SQL are supported.
- `ops/render-deploy.cjs`: read-only preflight before migration, service/HTTPS origin/Docker/paid-plan/single-instance/readiness/no-auto-deploy/no-double-migration checks, secret hook with exact tested `ref`, deployment-ID/commit/status polling, then smoke. Queued/missing-ID/wrong-commit/failed/timed-out releases fail closed. Tests use mocks, not a Render account.
- `render.yaml`: reviewed Docker web-service template with one instance, readiness path, auto-deploy off, secret runtime values marked `sync: false` and no new DB. Starter is a **paid** template because free instances block current SMTP ports; it was not applied and authorizes no purchase/upgrade by itself.
- `ops/healthcheck.cjs`, `ops/smoke.cjs`, `ops/container-smoke.cjs`: DB health, liveness, auth-denial and API-document smoke without users/mail/data writes; Linux-only CI container cleanup never removes database volumes. Local Windows evidence uses Compose running a Linux runtime image.
- `ops/operations.test.cjs`: native Node test runner covers migration release/target/history guards, smoke failure behavior, Render preflight/pinning/failure/timeout and context exclusions. Fake fixture keys/URLs never contact external services.
- `package.json`: only adds non-mutating lint/typecheck, operations tests, Docker setup, smoke and manifest scripts; no dependency or lockfile changes. `.prettierrc` uses automatic newline detection so Windows checkout line endings pass the non-mutating lint gate as well as Linux LF. `.gitignore`/`.prettierignore` exclude private backup/local-tool/generated release files. README, env example, design/plan and [deployment runbook](deployment.md) cover final operations.

## Observed baseline and corrections

Inspection started with a clean worktree, the original schema and two original migration directories. The running development DB reported both migrations applied. No schema/migration SQL was changed. `npm ci` passed using the existing lockfile. Generate/validate/status and all existing app tests/build passed.

Initial local Docker setup ran before client generation and failed safely; generation fixed it. The first operations test command used a shell glob unsupported by Windows Node 20, so the npm script now names the test file explicitly. Non-mutating lint initially rejected Windows CRLF; automatic newline detection corrected the configuration without rewriting application code. Image inspection found npm retained Prisma CLI as a peer; runtime now removes only the CLI, preserving generated Client/native engines. A transient Windows port-proxy bind error after PostgreSQL container recreation resolved on retry; the original volume/data were preserved. These failed attempts were corrected, not skipped or reported as successful checks.

Official current Render API/schema documentation was reviewed. It located Docker pre-deploy settings under `envSpecificDetails` and the current `runtime` property; the preflight and mocks follow those fields, with legacy fallback where appropriate. Render's free SMTP restriction led to a paid-plan template and free-plan release refusal. No live Render response has been observed, so server execution remains a separate gate.

## Executed checks

| Check | Actual result |
| --- | --- |
| `npm ci` | Passed; lockfile/dependencies unchanged |
| Prisma validate/generate/status | Passed, CLI/Client 6.19.0; both original dev migrations applied |
| Read-only live SQL history comparison | Passed against the original dev migration checksums, including checkout newline handling |
| `npm run build` | Passed |
| `npm test -- --runInBand` | 157 tests passed in 30 suites |
| `npm run test:e2e -- --runInBand` | 51 tests passed in 5 suites |
| `npm run test:integration` | 51 tests passed in 6 suites, verified dedicated test PostgreSQL |
| `npm run test:ops` | 12 checks passed, external Render requests mocked |
| Lint/typecheck | `npm run lint`, `lint:check` and `typecheck` passed after newline configuration correction |
| Runtime and migration image builds | Passed on Docker Desktop Linux engine |
| Compose config/startup | `config --quiet` passed; PostgreSQL/API became healthy using the persistent original DB volume |
| Runtime contents/user | UID 1000; no `.env`, `.env.test`, source tree or Prisma CLI |
| Runtime HTTP smoke | Passed against Compose API: DB readiness/liveness, authentication denial, implemented OpenAPI |
| Jenkinsfile syntax | Parsed with Groovy 3.0.22/Java 17; actual Jenkins validation/run pending |
| Render manifest | Validated locally against Render's official 2020-12 JSON schema; validator warned about ignored URI format in an unused schema field |

The tested base image resolves to Node 20.20.2 / `node:20-bookworm-slim`, digest `sha256:2cf067cfed83d5ea958367df9f966191a942351a2df77d6f0193e162b5febfc0`. This preserves the existing major but is out of maintenance. A supported-major update needs the approval required by AGENTS.md before a production release. Local image tags based on existing HEAD are **dirty-worktree local evidence**, not a claim those changes are committed/deployed. The real Jenkins job must build the reviewed new commit.

Local PostgreSQL and the Compose backend remain running; test PostgreSQL remains separate. The setup created private `.env.docker` and appended the existing password to ignored `.env`; no password was rotated. No new database volume or schema was introduced. Integration suites removed only their exact dedicated test fixtures. No commit/push, paid provisioning, production migration, Render deployment or real SMTP delivery took place.

## Pending exit gates

- Approve/validate a supported Node runtime major, or explicitly resolve the existing EOL runtime before production use.
- Supply/connect the existing Jenkins controller/job and execute the full protected Pipeline, including plugins, credential scope and Linux container-smoke stage, from the reviewed commit. Groovy syntax and locally passing component commands do not prove a successful Jenkins run.
- Supply/connect the existing Render service, approved hosting plan, runtime DB/JWT/SMTP/frontend settings and Jenkins deployment credentials privately. A new/updated paid resource and credential deployment require approval. Free Render hosting cannot use the current SMTP ports.
- Verify a real restorable backup, review actual pending SQL/digest/compatibility and expected target, then approve and run the single controlled production migration job. No production DB target or backup was supplied here.
- Trigger the exact tested commit, observe its deployment ID/commit/live status, pass production HTTP smoke, and retain evidence. Do not mark the overall milestone or Phase 1 deployment gate complete until this is actually executed.

See [runbook](deployment.md) for commands, required credential IDs/env vars, backup/migration review and non-destructive rollback. The existing Node-engine warning and npm audit report (50 vulnerabilities: 15 moderate, 35 high) remain findings; no automatic audit fixes or dependency major upgrades were performed.
