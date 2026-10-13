# Kirana backend

NestJS 11, TypeScript/CommonJS, Prisma 6.19 and PostgreSQL. Identity and tenant domains run in one backend process using `kirana_identity`. The frontend has a separate repository. See [build plan](docs/build_plan.md) and [system design](docs/system-design.md).

## Local setup

Use npm and the checked-in lockfile. The current machine uses Node 20.16.0; the locked lint dependency reports that it needs Node `^20.19.0 || ^22.13.0 || >=24`. No runtime or dependency upgrades are performed by these setup commands.

```bash
npm ci
# For a fresh checkout only; preserve an existing local .env.
cp -n .env.example .env
# Replace placeholders with your local credentials.
docker compose up -d postgres
npx prisma validate
npx prisma generate
npx prisma migrate status
npm run start:dev
```

For an existing database, inspect migration status before any application of migrations. Never reset the database or remove Docker volumes. Prisma CLI uses `.env` via the existing `prisma.config.ts`; verify `DATABASE_URL` before migration commands. Application environment selection is described below.

## Configuration

Set `NODE_ENV` in the launching environment to select a mode; it defaults to `development`. A conflicting `NODE_ENV` inside a dotenv file is rejected.

| Mode        | Configuration source                                                             | Database                                                                             |
| ----------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Development | Process variables override `.env.development`, which overrides `.env`            | Local `kirana_identity`; hosts `localhost`, `127.0.0.1` or Docker service `postgres` |
| Test        | Process variables and `.env.test`; no development-file fallback                  | Dedicated local test service described below                                         |
| Production  | Process variables only; dotenv files cannot supply required application settings | Non-local PostgreSQL; test databases rejected                                        |

`PORT` defaults to 3001 and must be an integer from 1 to 65535. `DATABASE_URL` is required and must be a PostgreSQL URL with credentials and a database name. Test mode selects `DATABASE_URL_TEST` and rejects a conflicting `DATABASE_URL`. Configuration errors name fields without printing their values. Prisma receives the validated URL explicitly. Configuration is captured before Prisma's automatic dotenv loading and ConfigService does not fall back to unvalidated process values.

Foundation validates the settings currently consumed by the application. JWT, email, frontend-link and CORS settings will be added and validated when their modules are implemented in Milestones 2 and 3. No cross-origin browser policy is enabled yet. Keep dotenv files and private keys out of deployments and Git.

```bash
npm run build
# Supply NODE_ENV=production, PORT and DATABASE_URL through the host environment.
npm run start:prod
```

## Existing endpoints

| Method/path               | Result                                                      |
| ------------------------- | ----------------------------------------------------------- |
| `GET /api/v1/health`      | Readiness; read-only PostgreSQL `SELECT 1`, 200 or safe 503 |
| `GET /api/v1/health/live` | Liveness; no database query                                 |
| `GET /api/docs`           | Swagger UI                                                  |
| `GET /api/docs-json`      | OpenAPI document                                            |

```bash
curl -i -H 'x-request-id: local-check-123' http://localhost:3001/api/v1/health
# {"status":"ok","database":"connected"}
curl -i http://localhost:3001/api/v1/health/live
# {"status":"ok"}
```

Requests receive an `x-request-id` response header. Incoming IDs must match `[A-Za-z0-9_-]{1,64}`; otherwise the backend generates a UUID. JSON request logs include only the ID, HTTP method, status and duration. They omit URLs, query strings, bodies, headers, credentials and exception objects.

Errors have one safe shape; messages use standard HTTP status text and omit exception details, stacks, payloads and validation values:

```json
{
  "statusCode": 503,
  "error": "Service Unavailable",
  "message": "Service Unavailable",
  "requestId": "local-check-123",
  "timestamp": "2026-10-13T12:00:00.000Z"
}
```

Global DTO validation transforms input, rejects unknown fields and validates declared constraints. The auth, users, organizations, stores, memberships, onboarding, invitations and audit modules are scaffolds; business endpoints are not exposed yet.

## Tests and isolated PostgreSQL

Unit and HTTP boundary suites mock database operations and do not require Docker. Integration tests require the dedicated PostgreSQL service. Never point test variables at development or production.

```bash
npm test -- --runInBand
npm run test:e2e -- --runInBand
npm run db:test:setup
npm run test:integration
npm run lint
npm run build
```

`db:test:setup` creates an ignored `.env.test` if absent, generates a random local password, starts `docker-compose.test.yml`, verifies the live database identity, and runs `prisma migrate deploy` using only the existing reviewed migrations. It preserves existing files, volumes and records. Repeat it to check/apply pending migrations without resetting anything. Set `NODE_ENV=test` or leave it unset when running setup. The password in `.env.test` must match the persistent test volume; the setup command does not rotate existing credentials.

The test target is restricted to PostgreSQL on `localhost` or `127.0.0.1`, port **5434**, database **kirana_identity_test**, role **kirana_test**, public schema. Unknown URL parameters, other hosts/ports/roles/databases, production modes and missing integration configuration are rejected before persistence tests connect. Helpers additionally check `current_database()` and `current_user`. They pass the URL directly to Prisma and roll fixtures back transactionally; they never truncate tables. Future persistence tests must use these helpers and the integration setup file.

The local development database remains on port 5433. The separate test container and volume can remain running. To stop the test container while preserving its volume:

```bash
docker compose --env-file .env.test -f docker-compose.test.yml stop
```

## Delivery status

Milestone 1 evidence and remaining environment findings are in [Milestone 1 verification](docs/milestone-1-verification.md). Registration, email verification and authentication follow in Milestones 2 and 3. Docker packaging, Jenkins and Render deployment remain Milestone 7 work; nothing has been deployed.
