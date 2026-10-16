# Milestones 3 and 4 — Sessions and tenant authorization

Implemented locally on 2026-10-16 in the existing backend. No Prisma schema changes, new migrations, dependency changes, frontend edits or deployments. Existing CommonJS, NestJS 11 and Prisma CLI/Client 6.19.0 are preserved. Next: Milestone 5, stores and onboarding completion.

## Files and boundaries

- `src/config/session-environment*`, `jwt-environment*`, `environment*`: validated matching private/public RSA keys, short access TTL, refresh/reset lifetimes, secure production reset URL, active key ID and up to five previous public verification keys. Errors expose field names only.
- `src/modules/auth/access-token-issuer*`, `access-token-verifier.service.ts`, `session.service*`, `dto/session.dto.ts`, controller/module/limiter: RS256 issuance, opaque hashed refresh sessions, rotation/replay/logout, generic recovery and password reset. PasswordService and the existing opaque-token/clock abstractions are reused. Unit tests use mocks/controlled time; signing tests use ephemeral RSA keys.
- `src/modules/email/email.service.ts`, `src/modules/audit/security-events.service.ts`: reset emails through existing adapters and fixed safe identity event names. No raw credentials, emails or links in logs. Recovery mail uses a bounded, best-effort process queue, not a durable outbox.
- `src/modules/organizations/`: creation DTO, safe response projection, thin controller and transactional service; create/list/detail only.
- `src/modules/memberships/`: reusable organization role decorator/guard and an internal transactional membership-change service. Changes require a current active, verified OWNER; organization locking prevents concurrent demotion/suspension of the final active OWNER. Changes and audit records commit together. No membership mutation endpoint is exposed.
- `test/sessions.integration-spec.ts`, `organizations.integration-spec.ts`: real dedicated PostgreSQL and HTTP tests covering credentials, expiry, reuse/races, reset, rollback, tenant isolation and concurrent owner protection. Includes register → verify → login → create organization over HTTP with mocked SMTP.
- `test/sessions.e2e-spec.ts`: JSON/validation/no-store contracts, unknown-field and query-credential rejection, rate limiting and Swagger coverage. Existing foundation HTTP test now validates the implemented login route rather than expecting 404. Test helpers provide ephemeral matching signing keys.
- `.env.example`, README, build/design documents and [browser contract](browser-auth-contract.md): configuration and integration contracts. `docker-compose.test.yml` and `scripts/setup-test-db.ts` allow a configurable persistent test-volume name; newly generated `.env.test` uses a unique name. Files that already lack that setting retain the original volume default.

## API examples and retry behavior

Base `/api/v1`. Examples use placeholders only. Credentials belong in private tooling or a trusted BFF; never copy real values into logs, shell history or support messages.

| Endpoint | Request / response |
| --- | --- |
| `POST /auth/login` | `{ "email": "owner@example.com", "password": "a private passphrase" }` → 200 `{ "accessToken": "<JWT>", "refreshToken": "<opaque credential>", "tokenType": "Bearer", "expiresIn": 900 }`; generic 401 for wrong credentials, unknown/unverified/inactive users |
| `POST /auth/refresh` | `{ "refreshToken": "<opaque credential>" }` → 200 new credential pair; previous token is revoked; unknown/expired/reused/ineligible 401 |
| `POST /auth/logout` | Same refresh body → 204, including unknown/already-logged-out credentials; revokes the entire supplied family |
| `POST /auth/forgot-password` | `{ "email": "owner@example.com" }` → generic 200 whether eligible, missing, inactive, cooldown-limited or delivery failed |
| `POST /auth/reset-password` | `{ "token": "<one-time token>", "password": "a different private passphrase" }` → 200 message; invalid/expired/consumed 400; consumes all reset tokens and revokes all refresh sessions |
| `GET /auth/me` | Bearer access JWT → current allowlisted ACTIVE verified user profile |
| `POST /organizations` | Bearer JWT and `{ "name": "My Kirana", "slug": "my-kirana" }` → 201 safe organization fields plus `role: "OWNER"`, `status: "ONBOARDING"` |
| `GET /organizations` | Bearer JWT → array of safe organizations plus current role, only through ACTIVE memberships |
| `GET /organizations/:orgId` | Bearer JWT → safe organization/current role; unrelated/inactive membership or unavailable organization 403; deliberate 404 if membership changes between guard and scoped read |

Organization optional fields: `businessType`, `phone`, `email`, `gstin`. DTOs trim text, normalize emails/slugs and uppercase GSTIN, reject null optional values and unknown fields. Slugs must be lowercase alphanumeric segments separated by hyphens, maximum 100 characters. Timezone/currency use existing `Asia/Kolkata`/`INR` defaults. Status/roles/user IDs cannot be supplied in the creation body.

Organization creation locks the current user and the normalized slug, then creates the organization, OWNER/ACTIVE member, FIRST_STORE onboarding and audit in one transaction. The audit contains a SHA-256 digest of the normalized request for the resume policy. A repeated identical request by the active creator-owner returns the same organization and 201 without duplicate rows/audit. Changed payload, another creator, suspended owner or unavailable organization returns 409. The existing unique slug index remains the final conflict arbiter. Slugs are caller-chosen and never automatically suffixed on conflict. No idempotency table/migration was needed.

## Security and operational contracts

Access JWTs have UUID subject/token ID, issuer, audience, `iat`, `exp`, `token_use: access`, `typ: JWT` and an active `kid`. Only configured RS256 keys are accepted. Lifetimes are 60–900 seconds, default 900. Production requires explicit matching RSA public/private PEMs of at least 2048 bits. Development `npm run auth:keys` creates/preserves ignored local 3072-bit keys; missing signing material fails closed. Optional `JWT_KEY_ID` otherwise derives from the public-key SHA-256 digest.

Rotation uses `JWT_PREVIOUS_PUBLIC_KEYS`, a JSON object of at most five old IDs to public PEMs. Provision a new matching active pair and retain the previous public key under its old ID. Restart to load the configuration snapshot. Remove old keys only after the maximum lifetime has elapsed since the final old-key issuance, then restart. Unknown/removed key IDs fail closed. Legacy no-kid tokens use only the active key. No public JWKS endpoint is exposed.

Refresh/reset values are 32 random bytes encoded as 64 lowercase hex characters; only SHA-256 digests persist. Refresh expiry is absolute per family, default seven days (`REFRESH_TTL_SECONDS`, 300–2592000). Rotation consumes the old token and inserts a new row atomically. User-row serialization coordinates login, refresh, logout and reset. Revocation on failed refresh commits before returning 401. Concurrent reuse gives at most one successful response, then revokes its descendant; clients must serialize refresh and log in again on uncertain/lost rotation responses. Logout preserves independently logged-in families. Reset invalidates every family. Already-issued JWTs remain valid until their short expiry, subject to current active/verified account checks; there is no denylist/immediate access revocation.

Reset lifetime defaults to 1800 seconds (`PASSWORD_RESET_TTL_SECONDS`, 300–3600). A database-enforced 60-second issue cooldown also covers delivery failure. Production requires an HTTPS `RESET_PASSWORD_URL` without query, fragment or credentials. The queue is bounded to 128 pending deliveries and drains on graceful shutdown; restart/full-queue/SMTP failure can require a later request. Generic success does not promise delivery. SMTP is mocked in automated tests.

Each operation uses the bounded single-process limiter. Per minute: login/forgot/reset ten requests per transport IP; login/forgot additionally ten per normalized email across IPs; refresh/logout thirty per transport IP. JWT roles never authorize tenant operations. Every tenant read checks current membership and ONBOARDING/ACTIVE organization status. Future mutation endpoints must keep their checks and writes in the existing transactional boundaries.

The [BFF/cookie and CSRF contract](browser-auth-contract.md) defines future frontend responsibilities, secure cookie flags, Origin/CSRF checks and refresh serialization. Backend cookies and frontend changes are not implemented; CORS remains disabled. Proxy/shared limiting must be designed before production scaling.

## Validation and local environment

The initial audit found a clean worktree and two existing migration directories. `npm ci` succeeded with the existing lockfile. Prisma validate/generate succeeded with 6.19.0. Docker was initially stopped; the first migration-status attempt returned a schema-engine error. Docker Desktop and the existing development PostgreSQL service were started; repeated status confirmed both existing migrations applied, no pending migrations. Development database operations were read-only.

`.env.test` was absent while the original test volume persisted, so newly generated credentials could not authenticate it. The original volume was preserved. A separate newly named test volume was configured, the guarded setup verified its live database/role, and applied only the two existing reviewed migrations. No database reset, truncation, drop or old-volume deletion occurred. Integration fixtures are exact generated IDs/slugs and are removed in foreign-key order from the verified test database only. SMTP was never contacted.

Initial validation found and repaired a Nest guard dependency export, a Prisma void-result cast in the advisory-lock query, a test failure-injection method that did not intercept transaction delegates, and test lint errors. Those failed runs are not counted as passing checks. Final command results are recorded below after completion.

| Final check | Result |
| --- | --- |
| `npm ci` | Passed with unchanged lockfile; existing engine/audit warnings below |
| `npx prisma validate` | Passed |
| `npx prisma generate` | Passed, Client 6.19.0 |
| `npx prisma migrate status` | Passed after starting Docker; both existing development migrations applied |
| `npm run db:test:setup` | Passed after selecting the new separate test volume; verified live identity before applying existing migrations |
| `npm run build` | Passed |
| `npm test -- --runInBand` | 128 tests passed, 23 suites |
| `npm run test:e2e -- --runInBand` | 34 tests passed, 4 suites |
| `npm run test:integration` | 30 tests passed, 4 suites, dedicated PostgreSQL |
| `npm run lint` | Passed |
| `npm run auth:keys` | Passed; local key material remains ignored |
| Compiled app smoke | Passed against development DB: readiness 200, unauthenticated organizations 401, invalid login 400, session/tenant OpenAPI routes present; temporary HTTP listener closed |
| `git diff --check` | Passed |

All Milestone 3 and 4 checklist items are complete. Only generated fixtures were written to the dedicated test database. Development data was not modified. Docker Desktop and both PostgreSQL containers are left running with persistent volumes; the compiled smoke listener was closed. No commit or deployment was created.

## Repeat checks (Git Bash)

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
npm run auth:keys
npm run start:dev
```

Stop a development watch server before clean install/Prisma generation on Windows to release its DLL. Keep the local dotenv files and volumes. Manual API requests are available through Swagger at `/api/docs`; inspect development one-time email links only in the private ignored outbox. No deployment, production SMTP delivery or browser cookie/CSRF implementation has been claimed.

Existing dependency findings remain: Node 20.16.0 triggers the locked lint dependency's engine warning, and npm reports 50 vulnerabilities (15 moderate, 35 high). No automatic upgrades/audit fixes were included in these milestones.
