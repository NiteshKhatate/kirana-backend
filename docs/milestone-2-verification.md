# Milestone 2 — Registration and email verification

Verified locally on 2026-10-13. All Milestone 2 tasks are complete, including `/auth/me`. Its RS256 access-token verification prerequisite was brought forward from Milestone 3. Login, access-token issuance, sessions, tenant APIs, deployment and frontend changes remain later work.

## Files and behavior

- `src/modules/auth/`: thin controller, registration/verify/resend DTOs and Swagger responses; transactional service; Argon2id passwords; opaque verification tokens; injectable clock; bounded request limiter and unit tests.
- `src/modules/email/`: private development outbox, TLS-required SMTP adapter, verification message service and mocked SMTP/filesystem tests. Development links are never printed to logs. Test mode disables real delivery unless its adapter is overridden.
- `src/modules/users/public-user.ts`: explicit safe user projection, excluding password/token hashes and private fields.
- `src/modules/users/users.service.ts`, `src/modules/auth/access-token*`, `src/config/jwt-environment*`: guarded current-user lookup, RS256 verification, validated public-key/issuer/audience/lifetime settings, and negative authentication tests. `scripts/setup-auth-keys.ts` generates/reuses ignored local keys without printing or overwriting them; production has no local-key fallback.
- `src/modules/audit/`: structured global security events with fixed event names and user IDs. Existing tenant-scoped `AuditLog` is unchanged.
- `src/config/mail-environment*`, `environment*`: mail/link/TTL validation, production requirements and tests; existing configuration snapshot remains authoritative.
- `test/auth.e2e-spec.ts`, `test/auth.integration-spec.ts`: HTTP contract tests and real PostgreSQL register → verify flows, race tests, rollback, delivery failure and validation coverage. The earlier foundation HTTP test now checks the still-unimplemented login route.
- `package.json` / lockfile: add pinned `@node-rs/argon2@2.2.2`, `nodemailer@10.1.0`, and development types `@types/nodemailer@8.0.2`. Existing dependency versions and CommonJS format are preserved.
- Access verification adds pinned `jsonwebtoken@9.0.3` and development types `@types/jsonwebtoken@9.0.10`; tests generate ephemeral keys independently of development/production.
- `.env.example`, `.gitignore`, `.prettierignore`, `README.md`, design/build documents: active mail settings, private outbox exclusions, verification commands and status. Generated `dist/` was still tracked in the current commit despite its ignore rule; it was removed from the index again while retaining local build files.

No Prisma schema or migration SQL changes were needed. Development database actions were read-only readiness/status/schema checks; no development accounts were created by verification. Integration tests use only the verified dedicated database and mock external mail. Concurrency tests require committed fixtures; cleanup removes only the suite's exact UUID-named fixture emails and their cascading token rows. Inspection afterward found zero remaining registration fixtures.

## Endpoints and retry contract

| Endpoint                                | Contract                                                                                                                                             |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/v1/auth/register`            | `{ fullName, email, password }`; 201 with `{ user, verificationEmailDelivery }`, duplicate normalized email 409, invalid DTO 400, request limit 429. |
| `POST /api/v1/auth/verify-email`        | `{ token }` in the JSON body; 200 `{ "message": "Email verified." }`; invalid, expired, consumed or inactive-account token 400.                      |
| `POST /api/v1/auth/resend-verification` | `{ email }`; generic 200 response for all eligible/ineligible/missing/cooldown/delivery-failure cases; malformed DTO 400 or request limit 429.       |

Registration trims full name and lowercases/strips surrounding email whitespace. Password whitespace is preserved; policy is 12–128 characters with a non-whitespace character. Hashes use Argon2id v19, 65536 KiB, three iterations, one lane, a 32-byte tag and random salt. Verification values are 32 cryptographically random bytes encoded as 64 lowercase hex characters. Only SHA-256 digests are stored in PostgreSQL. User creation and token persistence commit together.

`GET /api/v1/auth/me` accepts an Authorization Bearer RS256 access JWT and returns the current safe public-user projection with `Cache-Control: no-store`. Missing/invalid tokens and missing, suspended, disabled or unverified accounts return generic 401. Verification requires a configured RSA public key of at least 2048 bits, issuer/audience, header `typ: JWT`, `token_use: access`, UUID subject/token ID and integer issue/expiry timestamps. Expired/not-yet-valid tokens, future issuance and lifetimes over the configured bound (60–900 seconds, default 900) are rejected. Current database status is checked on every request; request user IDs and JWT email/role claims do not select the profile. This endpoint shares the 30-request/minute operation/IP limit. Missing development/test key configuration fails closed; production requires explicit public-key/issuer/audience values. Local setup creates a 3072-bit pair in ignored `.keys/` without exposing key values. Login/token issuance remains Milestone 3 work.

Registration's delivery status is `development-outbox`, `smtp-accepted` or `failed`. The account persists on mail failure. SMTP acceptance does not promise inbox delivery. Development emails live only in ignored `.local-mail/*.json` files; production uses SMTP with certificate validation and implicit TLS or required STARTTLS. Production configuration requires SMTP credentials, sender and an HTTPS verification link without credentials/query/fragment. No actual production SMTP delivery was attempted.

Verification/resend transactions lock the same user row, recheck active/verified status, and atomically consume or replace tokens. Tokens expire in 24 hours by default; resend has a database-backed 60-second cooldown, including failed sending attempts. Resend delivery uses a bounded 128-item in-memory queue so SMTP latency does not reveal eligibility through the HTTP response. Pending work drains on graceful shutdown. The queue is not durable; process loss or full-queue/delivery failure requires a later resend. A durable outbox is a future additive migration, not an implied guarantee.

The bounded, single-process request limiter permits 5 registrations, 10 resends and 30 verification requests per operation/transport IP per minute. It does not trust forwarded headers. Shared limits/trusted-proxy configuration must be designed explicitly before deployment scaling.

## Initial registration/verification checks

| Check                             | Result                                                                                                                                                                                                         |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm ci`                          | Passed with final lockfile, including the prebuilt Argon2id binding.                                                                                                                                           |
| `npx prisma validate`             | Passed.                                                                                                                                                                                                        |
| `npx prisma generate`             | Passed, Client 6.19.0.                                                                                                                                                                                         |
| `npx prisma migrate status`       | Both existing development migrations applied; no pending migrations.                                                                                                                                           |
| Read-only schema diff             | Exit 0, no differences.                                                                                                                                                                                        |
| `npm run build`                   | Passed.                                                                                                                                                                                                        |
| `npm test -- --runInBand`         | 66 tests passed in 13 suites.                                                                                                                                                                                  |
| `npm run test:e2e -- --runInBand` | 15 tests passed in two suites.                                                                                                                                                                                 |
| `npm run test:integration`        | 12 tests passed in two suites against dedicated PostgreSQL.                                                                                                                                                    |
| `npm run lint`                    | Passed.                                                                                                                                                                                                        |
| Compiled smoke                    | Database readiness, three documented auth routes, safe validation and correlation header passed. `/auth/me` correctly remains 404. Invalid production mail configuration rejected without echoing credentials. |

Tests cover password hashing/salting and preservation, normalized duplicates and concurrent registration, safe serialization/logging, token persistence rollback, expired/used/missing tokens, suspended accounts, repeated/concurrent verification, resend cooldown and prior-token invalidation, resend/verify races, failed SMTP, DTO privilege rejection, request limits and asynchronous resend shutdown draining. All SMTP tests use mocks; no real email was sent.

## Final checks including /auth/me

After completing the profile endpoint, `npm ci`, Prisma validate/generate/status and the read-only drift comparison passed again; both existing migrations remain applied and the schema has no differences. `npm run build` and `npm run lint` pass. The initial TypeScript decorated-interface import issue was fixed before the successful final build.

| Command                           | Final result                                                                   |
| --------------------------------- | ------------------------------------------------------------------------------ |
| `npm test -- --runInBand`         | 95 tests passed in 17 suites.                                                  |
| `npm run test:e2e -- --runInBand` | 21 tests passed in three suites.                                               |
| `npm run test:integration`        | 13 tests passed in two suites against dedicated PostgreSQL.                    |
| `npm run auth:keys`               | Generated local RSA keys, then repeated successfully preserving existing keys. |

Additional tests exercise valid authenticated profiles, no-store headers, missing/malformed credentials, signature tampering, wrong keys, HMAC/unsigned tokens, issuer/audience mismatch, expiry/issued-at/not-before/lifetime constraints, invalid subject/token ID/purpose, weak/private/non-RSA key rejection and current missing/unverified/inactive user state. Real PostgreSQL HTTP tests prove an unverified user is rejected, verification enables `/me`, and subsequent suspension immediately disables it despite the unchanged valid token. Profile fields come from the database rather than untrusted email/role claims.

The compiled backend was also booted on a temporary port against the verified dedicated test database. `/auth/me` returned 401 without a token, 200 with a valid RS256 token and the exact safe database projection plus `no-store`, then 401 immediately after the fixture user was suspended. Only that exact generated fixture was removed afterward. No token or key values were printed. The temporary process was stopped and the development watch server was restored.

The initial native `argon2` dependency required an unavailable Windows build toolchain and was replaced with the prebuilt binding. A clean install initially hit a Windows Prisma DLL lock from the running development server; only verified repository watch/app processes were stopped, installation succeeded, and the watch server was restored. Initial build/lint issues were corrected before the final passing checks.

## Manual verification

Use [README registration instructions](../README.md#test-registration-manually) for safe requests and hidden token input. Swagger is at `/api/docs`. Repeat automated checks from Git Bash:

```bash
# Stop the development server first on Windows, preserving containers/volumes.
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

The existing Node engine warning and npm audit count of 50 vulnerabilities (15 moderate, 35 high) remain findings; no automatic upgrades or advisory remediation were included. No credentials were deployed and no commit was created. All Milestone 2 checklist items are now checked. Next: Milestone 3 login, JWT signing/issuance, refresh and recovery.
