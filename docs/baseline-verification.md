# Baseline verification — 2026-10-13

Completed the pending **Current baseline** prerequisite in `build_plan.md`, before starting milestone implementation. Read both planning documents, inspected source/configuration, the Prisma schema and both migration SQL files, and began with a clean Git working tree.

## Observed baseline

- Node 20.16.0, npm 10.8.2; npm lockfile tracked. No package versions or module settings changed.
- Locked NestJS common/core/platform-express/testing: 11.2.7. Prisma CLI and Client: 6.19.0. TypeScript: 5.9.3.
- `package.json` uses CommonJS; TypeScript uses Node16 resolution. The compiled app boots without `ERR_REQUIRE_ESM`.
- Redacted database target: PostgreSQL at `localhost:5433/kirana_identity`. Docker's existing `kirana-postgres` container is healthy. The reserved tenant database is not used.
- Applied migrations: `20261012064735_init_identity` and `20261013081144_registration_schema`, both finished and neither rolled back. The database contains 11 business tables; the schema defines seven enums.
- Prefix, global validation pipe, Swagger and database readiness already exist. The starter controller/service remain unused by `AppModule`.
- The registration migration contains historical text-to-varchar narrowing warnings. It is already applied; no migration was replayed or modified.

## Baseline repairs

- Replaced the stale root/Hello World e2e assertion with HTTP tests for the existing `/api/v1/health` readiness endpoint: healthy database and safe 503 failure response. Override Prisma before app initialization so this suite never opens a database connection. Close the app after the suite.
- Added `.env.example` containing placeholders only. Added Git ignores for environment variants, keys, logs, coverage, build output, local database backups and local Docker data directories.
- Removed `dist/` and `kirana_identity_backup.sql` from the Git index while preserving the local files. This does not remove them from existing Git history.
- No application behavior, dependency versions, Prisma schema, migrations or database data changed. No deployment performed.

## Executed checks

| Check                                                                                                                          | Result                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm ci`                                                                                                                       | Passed; 821 packages installed from the lockfile. Engine/deprecation/audit warnings below.                                                                   |
| `npx prisma validate`                                                                                                          | Passed.                                                                                                                                                      |
| `npx prisma generate`                                                                                                          | Passed, Client 6.19.0. Required after the clean install.                                                                                                     |
| `npx prisma migrate status`                                                                                                    | Passed, both migrations applied; database up to date.                                                                                                        |
| `npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --exit-code` | Passed, exit 0, no schema difference; read-only comparison.                                                                                                  |
| `npm run build`                                                                                                                | Passed.                                                                                                                                                      |
| `npm test -- --runInBand`                                                                                                      | Passed, one existing starter unit test.                                                                                                                      |
| `npm run test:e2e -- --runInBand`                                                                                              | Passed after repair, two HTTP health tests with mocked Prisma.                                                                                               |
| `npm run lint`                                                                                                                 | Passed after Prisma generation and repair.                                                                                                                   |
| Compiled startup using `node dist/src/main.js`                                                                                 | Passed on a temporary port; `/api/v1/health` returned 200 with database connected and `/api/docs` returned 200. The temporary process was stopped afterward. |
| `git diff --check`                                                                                                             | Passed.                                                                                                                                                      |

Initial checks exposed missing generated Prisma runtime/types after `npm ci`; generation cleared those errors. The subsequent original e2e test failed with 404 because the application no longer registers the starter root controller. The repaired suite passes. HTTP tests use a mock; the compiled readiness smoke check separately executes the existing read-only `SELECT 1` against local development PostgreSQL. No persistence/transaction integration tests were run.

## Findings carried into Milestone 0

- `npm ci` reports an engine mismatch: locked `eslint-visitor-keys@5.0.1` requires Node `^20.19.0 || ^22.13.0 || >=24`, while the installed runtime is 20.16.0. The checks passed on this machine, but the runtime compatibility finding remains open.
- npm reports **50 dependency vulnerabilities (15 moderate, 35 high)** and deprecation warnings. These are installation summary counts, not a completed advisory assessment. No automatic dependency fixes or upgrades were applied.
- `DATABASE_URL_TEST` is not configured. The example is a placeholder, not a provisioned test database. Dedicated database setup and safeguards remain Milestone 1 work.
- Docker Compose currently contains a literal local development password; moving configuration to local environment values needs to preserve the credentials of the existing persistent volume. No credential changes were made during verification.
- The backup was previously tracked. Removing it from the index does not sanitize prior commits; its contents were not printed or assessed in this task.

This initial prerequisite did not close the milestone checklists. The subsequent completed audit is recorded in [Milestone 0 verification](milestone-0-verification.md), with foundation results in [Milestone 1 verification](milestone-1-verification.md).

## Repeat local checks (Git Bash)

```bash
npm ci
npx prisma validate
npx prisma generate
npx prisma migrate status
npm run build
npm test -- --runInBand
npm run test:e2e -- --runInBand
npm run lint
```

Keep `.env` local and verify its database target before running database commands. No migration application is required for these repairs.
