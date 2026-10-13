# Milestone 1 — Foundation and config

Implemented and verified locally on 2026-10-13. The original baseline changes remain in the working tree; no commit or deployment was created.

## Changes

| Files                                                                                                                      | Purpose                                                                                                                                                                                         |
| -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/config/environment.ts`, `load-environment.ts`, `database-safety.ts`                                                   | Validate active settings, select development/test/production sources, capture configuration before Prisma imports, and restrict test database targets.                                          |
| `src/configure-app.ts`, `src/main.ts`, `src/app.module.ts`                                                                 | Share production/test HTTP setup, use validated port, enable shutdown hooks, and register configuration/domain modules.                                                                         |
| `src/common/http/request-context.ts`, `safe-exception.filter.ts`, `error-response.dto.ts`                                  | Correlation IDs, allowlisted request metadata logs, safe standardized JSON errors and documented error schema.                                                                                  |
| `src/database/prisma.service.ts`                                                                                           | Inject the validated URL directly into Prisma; sanitize connection failures.                                                                                                                    |
| `src/health/health.controller.ts`                                                                                          | Preserve database readiness, add database-independent liveness, document responses with Swagger.                                                                                                |
| `src/modules/{auth,users,organizations,stores,memberships,onboarding,invitations,audit}/*.module.ts`                       | Eight registered domain scaffolds with no premature business APIs.                                                                                                                              |
| `docker-compose.test.yml`, `scripts/setup-test-db.ts`                                                                      | Separate loopback-only PostgreSQL service, generated ignored test credentials, live identity verification, safe repeatable application of existing migrations.                                  |
| `test/helpers/*.ts`, `test/setup-*.ts`, `test/jest-*.json`                                                                 | Isolated test setup, target checks, explicit Prisma connections, transaction rollback helpers and separate integration suite.                                                                   |
| `src/config/*.spec.ts`, `src/database/prisma.service.spec.ts`, `test/app.e2e-spec.ts`, `test/database.integration-spec.ts` | Startup/environment, lifecycle, DTO, HTTP, logging, database and rollback coverage.                                                                                                             |
| `package.json`, `package-lock.json`, `tsconfig.build.json`                                                                 | Test/setup commands, test setup registration, script lint coverage and build exclusions. Declare already locked `dotenv@17.4.1` as a runtime dependency; no existing package versions upgraded. |
| `.env.example`, `README.md`, `docs/system-design.md`, `docs/build_plan.md`                                                 | Environment placeholders, setup commands, error/test contracts and milestone status.                                                                                                            |

No schema or migration files changed. Development data was not modified. The new dedicated test database received the two existing migrations after URL and live identity verification. No database resets, table truncation, volume removal or destructive SQL were used. Fixture writes roll back. The test service and its persistent volume remain available locally; `.env.test` is ignored and contains its generated credentials.

## API contract

| Request                   | Safe success response                          |
| ------------------------- | ---------------------------------------------- |
| `GET /api/v1/health`      | `200 {"status":"ok","database":"connected"}`   |
| `GET /api/v1/health/live` | `200 {"status":"ok"}` without a database query |
| `GET /api/docs`           | Swagger UI                                     |
| `GET /api/docs-json`      | OpenAPI JSON                                   |

Every response has an `x-request-id`. Accepted incoming IDs use `[A-Za-z0-9_-]{1,64}`; invalid or absent IDs are replaced by a UUID. Error envelopes contain `statusCode`, `error`, `message`, `requestId` and UTC ISO `timestamp`. Message/error use standard status text, including 400/404/500/503. They do not expose exception details, stack traces, URLs or input values. Logs include only ID, method, status and duration. Global DTO validation allows only declared fields, rejects extra fields, and transforms/validates values. The validation probe controller exists only in tests and is excluded from the production build.

Foundation configuration validates `NODE_ENV`, `PORT` and `DATABASE_URL`. Production configuration cannot be satisfied by local dotenv files. ConfigService exposes only the captured validated settings and does not fall back to unvalidated process variables. JWT, mail, frontend-link and CORS validation belongs with the consuming Milestone 2/3 features; no auth or tenant endpoints are exposed yet.

## Validation evidence

| Command/check                      | Result                                                                                                                                                                       |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm ci`                           | Passed using the lockfile; engine, deprecation and audit warnings described below.                                                                                           |
| `npx prisma validate`              | Passed.                                                                                                                                                                      |
| `npx prisma generate`              | Passed, Prisma Client 6.19.0.                                                                                                                                                |
| `npx prisma migrate status`        | Local development database up to date with both existing migrations.                                                                                                         |
| `npm run db:test:setup`            | Passed: dedicated container healthy, live identity checked, both migrations applied to `kirana_identity_test`.                                                               |
| `npm run build`                    | Passed.                                                                                                                                                                      |
| `npm test -- --runInBand`          | Passed: 31 tests in four suites, including the existing starter test.                                                                                                        |
| `npm run test:e2e -- --runInBand`  | Passed: 13 HTTP tests with database operations mocked.                                                                                                                       |
| `npm run test:integration`         | Passed: two tests against the dedicated PostgreSQL service, including real HTTP readiness and transaction rollback.                                                          |
| `npm run lint`                     | Passed.                                                                                                                                                                      |
| Compiled startup smoke checks      | Readiness, liveness, Swagger UI and OpenAPI JSON returned 200 with the correlation header; unfinished auth route returned safe 404. Temporary app process stopped afterward. |
| Compiled production failure checks | Missing database despite local `.env`, a local database target, and invalid port were all rejected with exit 1 without echoing the test credential marker.                   |
| Test database inspection           | Both migrations applied; zero user fixtures remained after integration tests.                                                                                                |

During implementation, the first dedicated setup attempt was rejected because importing Prisma had loaded development `.env` before configuration selection. Startup configuration now executes before Prisma imports; setup imports Prisma only after selecting the verified test settings. Unit tests and compiled production checks cover the fix. Initial lint findings were repaired, and lint subsequently passed. No failing check was skipped.

## Repeat verification (Git Bash, repository root)

```bash
npm ci
npx prisma validate
npx prisma generate
npx prisma migrate status
npm run db:test:setup
npm run build
npm test -- --runInBand
npm run test:e2e -- --runInBand
npm run test:integration
npm run lint
npm run start:dev
```

In another terminal:

```bash
curl -i -H 'x-request-id: local-check-123' http://localhost:3001/api/v1/health
curl -i http://localhost:3001/api/v1/health/live
```

Preserve existing `.env` and volumes. Verify local database targets before migration commands. `db:test:setup` rejects production runtime mode and mismatched credentials; it does not rotate an existing volume's password. Never replace a test URL with a development or production URL.

## Remaining work

- The installed Node 20.16.0 is below the locked lint dependency's declared range (`^20.19.0 || ^22.13.0 || >=24`). Checks passed locally; this compatibility finding remains open.
- npm reports 50 dependency vulnerabilities (15 moderate, 35 high) and deprecations. No advisory remediation or automatic dependency upgrade was included.
- The existing development Compose password and prior tracked backup history remain findings in [baseline verification](baseline-verification.md). Test setup introduces no hardcoded credential and does not change the existing development volume's credentials.
- No registration/authentication/tenant business APIs, production SMTP, deployment or CI pipeline were implemented in this milestone. These remain in their planned milestones.

Next task: Milestone 2 identity registration and email verification, using the registered modules and isolated persistence test helpers.
