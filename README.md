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

Application configuration validates database, verification-mail and access-JWT verification settings. Development defaults to a private local email outbox; production requires SMTP credentials, `EMAIL_FROM`, and an HTTPS `VERIFY_EMAIL_URL`, plus `JWT_PUBLIC_KEY`, `JWT_ISSUER` and `JWT_AUDIENCE`. See `.env.example` for settings. JWT signing/login and CORS policy follow in Milestone 3. No cross-origin browser policy is enabled yet. Keep dotenv files, the local mail outbox and private keys out of deployments and Git.

```bash
npm run build
# Supply production database and mail settings through the host environment.
npm run start:prod
```

## Existing endpoints

| Method/path                             | Result                                                               |
| --------------------------------------- | -------------------------------------------------------------------- |
| `GET /api/v1/health`                    | Readiness; read-only PostgreSQL `SELECT 1`, 200 or safe 503          |
| `GET /api/v1/health/live`               | Liveness; no database query                                          |
| `GET /api/docs`                         | Swagger UI                                                           |
| `GET /api/docs-json`                    | OpenAPI document                                                     |
| `POST /api/v1/auth/register`            | Create an account awaiting verification; 201 or duplicate-email 409  |
| `POST /api/v1/auth/verify-email`        | Consume an unexpired one-time token; 200 or invalid/used/expired 400 |
| `POST /api/v1/auth/resend-verification` | Generic 200 response; request rate limit 429                         |

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

Global DTO validation transforms input, rejects unknown fields and validates declared constraints. Registration normalizes email and trims full name. Passwords preserve whitespace and require 12–128 characters with at least one non-whitespace character. Argon2id uses v19, 64 MiB, three iterations, one lane and a 32-byte tag with a random salt. Responses contain an explicit safe user projection; no credential/token hash is returned.

## Test registration manually

The authenticated profile endpoint is `GET /api/v1/auth/me`; registration, verification and resend remain the three public auth endpoints.

`GET /api/v1/auth/me` accepts only short-lived RS256 access JWTs in the Authorization Bearer header. It returns the current verified/active user profile and never trusts email or role claims for the profile. Missing/invalid/expired authentication and suspended, disabled, unverified or deleted users return 401. Successful profile responses use `Cache-Control: no-store`.

```bash
npm run auth:keys
# Restart the backend to load the generated local public key.
curl -i http://localhost:3001/api/v1/auth/me
# Expected without a Bearer token: 401 Unauthorized.
```

The key command creates a 3072-bit RSA pair in ignored `.keys/`, preserves existing keys, and never prints key contents. Production has no local-key fallback and requires an RSA public PEM (minimum 2048 bits), issuer and audience in its process environment. Default token lifetime is 900 seconds, configurable from 60 to 900. The verification contract requires `sub`, `jti`, `iat`, `exp`, `iss`, `aud`, `token_use: access` and `typ: JWT`. Login/token issuance is still Milestone 3 work. Full 200-path testing currently uses ephemeral signed tokens in automated tests; no public token-minting endpoint is provided.

```bash
curl -i -X POST http://localhost:3001/api/v1/auth/register \
  -H 'Content-Type: application/json' \
  --data '{"fullName":"Store Owner","email":"owner@example.com","password":"a long local test passphrase"}'
```

A 201 response contains `user` and `verificationEmailDelivery`. `development-outbox` means a local email file was written; `smtp-accepted` means the SMTP server accepted the recipient, not guaranteed inbox delivery. `failed` means the account exists but email sending failed; retry through resend after the cooldown. Repeating registration with the same normalized email returns 409.

In development, open the newest JSON file in `.local-mail/` privately in your editor. Its text contains the one-time link. Enter its token at the hidden prompt below to keep it out of terminal output and shell history. Never paste a real token into logs, commits or support messages. The frontend verification page is outside this backend milestone, so the link alone does not implement the frontend workflow.

```bash
read -r -s -p 'Verification token: ' KIRANA_VERIFY_TOKEN
printf '\n'
printf '{"token":"%s"}' "$KIRANA_VERIFY_TOKEN" | \
  curl -i -X POST http://localhost:3001/api/v1/auth/verify-email \
    -H 'Content-Type: application/json' --data-binary @-
unset KIRANA_VERIFY_TOKEN

curl -i -X POST http://localhost:3001/api/v1/auth/resend-verification \
  -H 'Content-Type: application/json' \
  --data '{"email":"owner@example.com"}'
```

Verification succeeds once, within 24 hours by default. Resend invalidates previous tokens atomically and allows one issue per account per 60 seconds by default. Missing, verified, inactive, cooldown-limited and delivery-failed accounts receive the same generic response. Resend does not wait for SMTP; its bounded process queue drains on graceful shutdown but is not durable. If the process stops unexpectedly or delivery fails, retry after the cooldown. Production SMTP requires TLS (STARTTLS or implicit TLS) and never logs links or SMTP contents.

Per transport IP, each one-minute window allows five registrations, ten resends and thirty verification attempts. The bounded in-memory limiter assumes the current single-process deployment and does not trust forwarded headers. Proxy/multi-instance limits need an explicit shared limiter/trusted-proxy design before scaling. Global identity security logs contain fixed event names and user IDs, without email addresses, passwords or tokens; the existing tenant-scoped `AuditLog` is unchanged.

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

The test target is restricted to PostgreSQL on `localhost` or `127.0.0.1`, port **5434**, database **kirana_identity_test**, role **kirana_test**, public schema. Unknown URL parameters, other hosts/ports/roles/databases, production modes and missing integration configuration are rejected before persistence tests connect. Helpers additionally check `current_database()` and `current_user`. They pass the URL directly to Prisma and support transactional fixture rollback; they never truncate tables. HTTP concurrency tests use committed transactions and clean up only their exact UUID-named fixture emails in the dedicated database. Future persistence tests must use these helpers and the integration setup file. SMTP is mocked and tests do not write to the development outbox.

The local development database remains on port 5433. The separate test container and volume can remain running. To stop the test container while preserving its volume:

```bash
docker compose --env-file .env.test -f docker-compose.test.yml stop
```

## Delivery status

Milestone 1 evidence is in [Milestone 1 verification](docs/milestone-1-verification.md); all Milestone 2 tasks, including `/auth/me`, are recorded in [Milestone 2 verification](docs/milestone-2-verification.md). Login, token issuance and session/recovery flows remain Milestone 3 work. Tenant APIs, Docker packaging, Jenkins and Render deployment remain later milestones; nothing has been deployed. Stop the local development server before `npm ci` on Windows so its Prisma DLL can be replaced, then restart after generation/build.
