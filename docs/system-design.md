# Kirana Backend — Phase 1 System Design

**Status:** Proposed implementation specification | **Scope:** registration, identity, tenancy and first-store onboarding | **Repository:** `kirana-backend`

## 1. Goals / non-goals
**Goals:** a user can register, verify email, log in, register one or more businesses, create the first branch, resume onboarding, see only authorized organizations/stores, invite staff, reset password and log out. Registration must be secure, consistent and repeatable.

**Not in Phase 1:** inventory, POS, products, purchasing, subscription payments, frontend implementation, distributed message queues, fully independent service deployments.

## 2. Deployment boundary (important)
- **Today:** `kirana-frontend` is a separate Next.js repository; `kirana-backend` is one NestJS HTTP application, with **identity and tenant domains as modules**. One Prisma client connects to `kirana_identity` PostgreSQL. Existing `kirana_tenant` database is reserved for later and remains unused in Phase 1.
- **Tomorrow:** identity and tenant domains can be extracted into separately deployed services/repositories with separate database ownership. That extraction requires a migration, APIs/events, and new authorization contracts; it is **not** achieved solely by NestJS modules.
- **Local:** Next.js `:3000` → NestJS `:3001` → Postgres container localhost `:5433`.
- **Production:** Render public backend service with managed PostgreSQL, or a private backend reached through a separately designed Next.js BFF; do not choose a private backend unless server-side routing is implemented. Jenkins is CI/CD, not an application server. TLS and Render env vars hold runtime secrets.

## 3. Proposed modules
```
src/
  config/             # validated environment and token/email config
  database/           # PrismaModule, PrismaService
  common/             # DTO helpers, guards, decorators, filters
  modules/
    auth/             # register/login/refresh/logout/me, JWT guard
    users/            # safe profile service
    email/            # SMTP adapter + development logger (never prod)
    organizations/    # create/list/details, membership authorization
    stores/           # create/list stores under an organization
    onboarding/       # progress, completion, resume
    invitations/      # issue/revoke/accept invitations
    memberships/      # organization/store role authorization
    audit/            # append-only sensitive action history
  health/             # liveness/readiness
```
Use controllers → services → Prisma repositories/queries; keep DTO validation at the HTTP boundary. Do not create circular module imports.

## 4. Data model (already migrated; do not recreate)
Use `prisma/schema.prisma` as the authoritative field-level schema. Its **11 tables** are:

| Domain | Table | Core purpose |
|---|---|---|
| Identity | `users` | Global accounts, Argon2id hashes, email verification time, user status |
| Identity | `refresh_sessions` | Hashed rotating refresh-token sessions, family grouping, expiration/revocation |
| Identity | `email_verification_tokens` | One-time hashed email verification tokens |
| Identity | `password_reset_tokens` | One-time hashed reset tokens |
| Tenant | `organizations` | Businesses with global unique slug and onboarding status |
| Tenant | `organization_members` | Unique `(organization_id,user_id)` membership, OWNER/ADMIN/MEMBER |
| Tenant | `stores` | Branches; unique `(organization_id,code)` and composite `(organization_id,id)` |
| Tenant | `store_members` | Store role, constrained to same-org store through composite FK |
| Tenant | `invitations` | Organization invites with hashed token and lifecycle status |
| Tenant | `onboarding_progress` | One row per organization: current step, completed time |
| Audit | `audit_logs` | Per-tenant append-only records of important actions |

Enums in the existing schema: `UserStatus`, `OrganizationStatus`, `MemberRole`, `MemberStatus`, `StoreStatus`, `StoreRole`, `InvitationStatus`.

**Known schema constraints:** `StoreMember` references user and store, but DB alone does not enforce that the user has an active `OrganizationMember` in that org. Check this transactionally in app logic (or propose a reviewed composite FK migration). Invitations currently address a user by email and an organization role; *store-specific invitations are not modelled* and should not be invented silently. Existing `AuditLog` is tenant-scoped; login/registration security events without an organization belong in structured security logging or require an explicitly approved additive table.

No plaintext passwords or raw tokens in PostgreSQL; never leak hash columns. Store timestamps in UTC.

## 5. Trust boundaries / authorization
- `AuthGuard`: validates JWT signature, algorithm, issuer, audience, expiration and user status (with carefully chosen cache/DB strategy). Access JWT represents **user identity**, not an unrestricted organization authorization.
- `OrganizationRoleGuard`: load `organization_members` using authenticated user ID + organization ID; ensure ACTIVE membership, then check OWNER/ADMIN/MEMBER.
- `StoreRoleGuard`: ensure store belongs to organization; check active org membership + store assignment or permitted owner/admin organization-wide access.
- Error policy: return 401 for missing/invalid authentication, 403 for lack of authorization, 404 when resource existence should be hidden. Never fetch tenant resources by ID without verifying organization ownership.
- Admin membership cannot automatically impersonate a Kirana platform administrator. Platform superadmin is outside Phase 1.

## 6. Auth and token design
**Password:** Argon2id with parameters documented in config; min reasonable password length, never reversible.

**Access JWT:** short TTL (suggest 15 min), server-signed; `sub`=user UUID, `iss`, `aud`, `iat`, `exp`, `jti`. Do not treat tenant IDs in JWT as sole proof of membership. RS256 public-key verification is preferred for future extracted services; configure key rotation (`kid`) before exposing public verification, otherwise a well-protected symmetric key can serve current single-process deployment temporarily. Keep keys out of Git.

**Refresh token:** cryptographically random (>=32 bytes) opaque string; hash with SHA-256 or keyed digest before persistence. Store one row per issued refresh token with `familyId`. Rotate atomically: consume/revoke old session + insert replacement in transaction using conditional update/unique invariant. A previously used/revoked token triggers replay response and revocation of its token family; test simultaneous refresh requests. No plaintext refresh token in logs. Set token expiration (suggest 7 days) and session revocation on logout/password reset.

**Email verification:** generate single-use random token, store only hash, expiry (suggest 24h), mark used atomically; resend throttled; production SMTP or transactional email service required. Development-only fallback may output links to console, never production.

**Password reset:** generic response whether account exists; one-time 30–60 min hashed token, invalidate after use, revoke all refresh sessions, invalidate previous reset tokens. Rate-limit attempts and resends.

**Browser integration contract:** Frontend is a separate repo. A secure server-side BFF / HttpOnly Secure SameSite cookies with CSRF defense is preferred for browser refresh tokens. If interim frontend calls API directly, use an explicitly documented cross-origin and cookie policy; **never persist access or refresh tokens in localStorage**. Do not put wildcard CORS with credentials.

## 7. Registration and onboarding consistency
1. `POST /auth/register`: normalize email, uniqueness check (DB is final arbiter), create `users` and verification token in a transaction, enqueue or send verification email safely; response contains only safe profile/status.
2. `POST /auth/verify-email`: validate token hash, expiry and unused state; mark used + user verified transactionally.
3. `POST /auth/login`: verify status, email verified and Argon2id password; return/access token + rotate-capable refresh credential via chosen BFF contract.
4. `POST /organizations`: authenticated verified user supplies name/type/contact. Transaction creates organization (`ONBOARDING`), OWNER organization membership, onboarding row; normalize unique slug, handle collisions and retries. Repeated request should not create duplicates (idempotency key or resume policy).
5. `POST /organizations/:orgId/stores`: active OWNER/ADMIN may create a store; validate parent organization and unique code; update onboarding progress on first store in same transaction.
6. `POST /organizations/:orgId/onboarding/complete`: only OWNER/ADMIN; verify at least one store and owner, mark `ACTIVE` and completion atomically. A repeated completion call should succeed idempotently.
7. `GET /organizations` and `GET /organizations/:orgId/onboarding`: only accessible for authenticated, active members. User may belong to multiple organizations.
8. Staff invitation: OWNER/ADMIN issues expiring hashed token; acceptance must check invited email identity, ensure active verified account, create/activate membership transactionally. Reinvitation and duplicate membership must be safe.

When app-level side effects (email) fail after a successful transaction, do not undo account creation. Use an email-outbox pattern if delivery reliability warrants an additive migration; otherwise record retry state without inventing guaranteed email delivery.

**Milestone 2 implementation contract:** registration returns an allowlisted user plus `verificationEmailDelivery` (`development-outbox`, `smtp-accepted` or `failed`); email failure preserves the account and hashed token for a later resend. SMTP acceptance is not guaranteed inbox delivery. Development writes private emails to ignored `.local-mail/` files rather than logging raw links. Production requires validated SMTP credentials, TLS and a configured HTTPS verification link; tests override the mail adapter. Passwords are 12–128 characters, preserve whitespace and require a non-whitespace character. Argon2id v19 uses 65536 KiB, three iterations, one lane and a 32-byte tag with a random salt.

Verification tokens are 32 random bytes encoded as 64 lowercase hex characters; PostgreSQL stores only their SHA-256 digests. Verification and resend lock the same user row with `FOR UPDATE`, then conditionally consume unexpired tokens/replace prior tokens in the same transaction. Verification rejects inactive accounts, expired/used/missing tokens and repeat consumption. The TTL defaults to 86400 seconds, configurable from 300 to 86400. The database-backed resend cooldown defaults to 60 seconds, configurable from 60 to 3600. Resend responds generically and dispatches mail through a bounded 128-item process queue without waiting for SMTP, with safe failure events and graceful-shutdown draining. This queue is best-effort, not durable; after process failure users may retry once the cooldown expires. A durable outbox would require a separate additive migration.

Auth requests use a bounded in-memory per-operation/IP limiter: five registrations, ten resends or thirty verifications/profile requests per minute. It uses the transport peer and does not trust forwarded headers. This matches the current single-process deployment; trusted proxies or multi-instance/shared limiting require an explicit later operational design. Global identity events use structured security logs with fixed event names and user UUIDs, not the tenant-scoped `AuditLog`. No schema migration or deployment boundary change is required.

`GET /auth/me` is implemented in Milestone 2 with its access-JWT verification prerequisite. Accept only an Authorization Bearer RS256 token signed by the configured RSA public key (at least 2048 bits), with the configured issuer/audience, UUID `sub`/`jti`, integer `iat`/`exp`, `token_use: access`, header `typ: JWT`, expiry and not-before checks. Reject future issuance and lifetimes longer than the configured 60–900 seconds (default 900). Load the current user's ACTIVE and email-verified state from PostgreSQL for every request and return only the existing public-user projection with `Cache-Control: no-store`. Missing/invalid tokens and missing/ineligible accounts yield generic 401. JWT email/role claims never determine the returned identity or tenant access. Development keys are generated locally in ignored `.keys/`; production requires explicit public-key/issuer/audience configuration and has no local-key fallback. Missing development/test key configuration fails closed with 401. Login and access-token issuance/private signing config remain Milestone 3 work; no token-minting endpoint is exposed by this prerequisite.

## 8. Draft REST contract

**Milestones 3–4 implementation (2026-10-16):** login/refresh return JSON credentials with `no-store` to a trusted caller. The intended browser client is a future same-origin Next.js BFF; NestJS does not authenticate cookies and CORS remains disabled. Cookie flags, CSRF checks, refresh serialization and loss/retry behavior are defined in [browser auth contract](browser-auth-contract.md). No frontend changes or cookie implementation are implied.

Access issuance uses validated matching RSA public/private keys, an active `kid` (explicit or SHA-256-derived), and a bounded map of up to five previous public keys. Verification resolves the `kid` only against configured keys; legacy no-kid JWTs use the active key. Rotation requires a process restart; keep old public keys through the last old token's maximum 900-second lifetime. Production requires explicit keys and HTTPS reset/verify links. Development keys remain ignored local files.

Refresh families have an absolute default seven-day expiry. Login, rotation, logout, reset issuance and reset consumption serialize on the same user row. Rotation revokes the predecessor and inserts a replacement in one transaction. Reuse, expiry or ineligible user status revokes the entire family; denial is thrown after that transaction commits. Concurrent reuse therefore revokes even the successful request's replacement. Logout accepts a refresh credential and idempotently revokes its entire family. Reset consumes all outstanding reset tokens and revokes every user session; reset tokens default to 30 minutes with a fixed 60-second issue cooldown and generic recovery responses. Access JWTs remain valid until expiry after logout/reset, subject to active/verified database checks; immediate access-token revocation is not implemented.

Login, forgot-password and reset-password have ten attempts per operation/IP/minute; login and recovery also have a normalized-account bucket across transport IPs. Refresh/logout have thirty attempts per operation/IP/minute. Limits remain bounded and local to the one process. Reset mail uses the existing bounded best-effort delivery pattern; no delivery guarantee or durable outbox was added.

Organization creation requires `name` and a caller-chosen stable `slug`, plus optional business type/contact/GSTIN. Normalized slug is the idempotency identity under the allowed resume policy: a per-slug transaction advisory lock and unique index protect creation; the transactional creation audit stores a digest of the normalized request. An identical retry returns the existing organization only for its active creator-owner, while a different payload/creator or unavailable organization returns 409. This avoids an idempotency-table migration. The organization, OWNER/ACTIVE membership, FIRST_STORE onboarding and audit commit or roll back together. Current timezone/currency use existing schema defaults.

Organization reads filter ACTIVE memberships and ONBOARDING/ACTIVE organizations. The reusable role decorator/guard reads current membership instead of JWT role claims. Internal membership changes require a current verified active OWNER, lock the organization row, protect its final active OWNER, and audit in the same transaction. No public membership mutation API is exposed yet; future endpoints must use this boundary. All existing Prisma models/migrations remain unchanged. Files, test evidence and limitations: [Milestones 3–4 verification](milestones-3-4-verification.md).
Base path: `/api/v1`; Swagger: `/api/docs`; readiness: `/api/v1/health`.

| Method | Endpoint | Auth | Result |
|---|---|---|---|
| POST | `/auth/register` | Public | Account awaiting verification |
| POST | `/auth/verify-email` | Public, token | Email verified |
| POST | `/auth/resend-verification` | Public | Generic success |
| POST | `/auth/login` | Public | Access + refresh credentials |
| POST | `/auth/refresh` | Refresh credential | Rotated credentials |
| POST | `/auth/logout` | Session | Session revoked |
| POST | `/auth/forgot-password` | Public | Generic success |
| POST | `/auth/reset-password` | Public, token | Password changed; sessions revoked |
| GET | `/auth/me` | Access JWT | Safe user profile |
| POST | `/organizations` | Access JWT | New org + owner membership |
| GET | `/organizations` | Access JWT | Only member organizations |
| GET | `/organizations/:orgId` | Member | Authorized org |
| GET | `/organizations/:orgId/onboarding` | Member | Progress |
| POST | `/organizations/:orgId/stores` | OWNER/ADMIN | New store |
| GET | `/organizations/:orgId/stores` | Member | Authorized stores only |
| POST | `/organizations/:orgId/onboarding/complete` | OWNER/ADMIN | Active org |
| POST | `/organizations/:orgId/invitations` | OWNER/ADMIN | Invitation created |
| POST | `/invitations/accept` | Verified account + token | Member added |
| GET | `/organizations/:orgId/members` | OWNER/ADMIN | Member list |

DTOs should use explicit allow-listed fields. Do not include passwords, hashes or tokens in returned profile records. Use standard NestJS status codes (201 created, 200 retrieval, 204 logout as appropriate, 400 validation, 401, 403, 404, 409 conflicts, 429 throttling).

## 9. Configuration and operational controls

**Milestones 5–6 implementation:** store creation, progress advancement, completion, invitation lifecycle and explicit store assignments are implemented in the existing process/database. [Staff access contract](staff-access-contract.md) defines the additional store-detail, invitation-revocation and store-assignment endpoints, roles, payloads and statuses. No Prisma schema or migration changes were needed.

Store code is a required stable organization-scoped identifier, normalized to uppercase. Identical normalized creation retries return the same store; changed payload returns 409. Creation locks the organization, rechecks OWNER/ADMIN status, creates the store, advances incomplete FIRST_STORE progress to REVIEW, and audits in one transaction. Completion uses the same lock, requires an ACTIVE verified OWNER and ACTIVE store in that organization, and atomically sets organization ACTIVE/progress COMPLETE. Repeated completion preserves the completion timestamp and produces no duplicate audit. All tenant mutations share the organization-row lock with membership changes.

OWNER/ADMIN can read all organization stores. MEMBER requires ACTIVE organization membership plus ACTIVE explicit store membership, and can see only ACTIVE stores. Queries repeat current scoped membership conditions; store IDs never select data across organizations. The reusable StoreRoles decorator/guard checks MANAGER/CASHIER/INVENTORY against current assignments and permits organization OWNER/ADMIN access. Member listing is OWNER/ADMIN-only and projects minimal membership and user identity fields. Explicit assignment/reassignment/suspension uses `PUT /organizations/:orgId/stores/:storeId/members/:userId` with an active verified target organization member. Identical retries do not repeat writes/audits. Organization suspension immediately blocks its stores and staff operations.

Staff invitations can grant MEMBER or ADMIN, never OWNER. OWNER may issue/revoke both; ADMIN may issue/revoke MEMBER only, including during reissue. Existing ACTIVE membership cannot be overwritten; SUSPENDED membership cannot be bypassed. Acceptance can create membership or activate INVITED membership and rechecks matching verified account email, current inviter authority, organization status, expiry and one-time consumption inside the locked transaction. Reissue has an org/email 60-second cooldown and revokes prior pending invitations transactionally. Concurrent acceptance/revocation cannot leave partial membership. Issue/revoke/accept and store access changes have transactional AuditLog records without raw codes or hashes.

Invitation codes reuse the 32-random-byte opaque-token mechanism with SHA-256 persistence. `INVITATION_TTL_SECONDS` defaults to 604800 and validates 300–604800. Codes are delivered in email text for authenticated entry; invitation credentials never appear in URLs. Delivery is attempted after commit with explicit `development-outbox`, `smtp-accepted` or `failed` response, no inbox-delivery guarantee, and reissue after cooldown for failures. Invitations are organization-wide; accepting one grants no store assignment. Issuance permits ten requests per minute per transport IP and per authenticated user; acceptance/revocation thirty per operation/IP/user. Limits remain bounded and process-local. Frontend pages/BFF and deployment remain separate work.
Required configuration categories: `DATABASE_URL`, `PORT`, `NODE_ENV`, `JWT_ISSUER`, `JWT_AUDIENCE`, JWT signing key material (or secure symmetric secret), access/refresh TTLs, public frontend URL, approved CORS origins, SMTP sender/host/auth, reset/verify URL templates. Validate all required environment variables on boot; `.env.example` contains fake placeholders only.

**Implemented foundation contract (Milestone 1):** validate the currently consumed `NODE_ENV`, `PORT` and PostgreSQL `DATABASE_URL` before importing Prisma, whose generated client automatically loads dotenv files. Capture the validated configuration and disable ConfigService's fallback to unvalidated process variables. Select the environment through the launching process: development uses process variables over `.env.development` over `.env`; test uses `.env.test` without development fallback; production requires process variables and dotenv files cannot supply required application settings. JWT, email, link and CORS settings become validated requirements when their consuming features are implemented in Milestones 2 and 3. CORS is not enabled by the foundation.

All HTTP exceptions use `{ statusCode, error, message, requestId, timestamp }`, with standard HTTP status text and UTC ISO timestamps. Exception details, validation values and URLs are omitted. Accept `x-request-id` only when it matches `[A-Za-z0-9_-]{1,64}`, otherwise generate a UUID; return it as a response header. Request logs allow only correlation ID, method, status and duration, never bodies, headers, raw URLs/query strings or exception objects. Readiness remains `/api/v1/health`; `/api/v1/health/live` provides database-independent liveness. Swagger documents both. Domain scaffolds expose no business endpoints yet.

Persistence tests use a separate PostgreSQL container, bound only to loopback port 5434, with database `kirana_identity_test`, role `kirana_test` and its own persistent volume. The setup command generates local credentials in ignored `.env.test` and verifies the URL and live database identity before applying existing reviewed migrations. Helpers reject development/production targets and roll back fixture transactions rather than truncating tables. This adds no schema migration or deployment boundary change.

Provide `/api/v1/health` database readiness and a cheap liveness check where useful. Never report DB credentials, user emails or tokens in health responses. Render backend runs behind TLS, listens on `0.0.0.0:$PORT`. Production migrations are controlled (`npx prisma migrate deploy`) and backups are taken first. Jenkins uses `npm ci`, lint/typecheck, Jest, build and Docker build; never embeds secrets in images. Disable competing Render auto-deploy when Jenkins is the deployment gate.

## 10. Test plan and invariants
- Auth: normalize duplicate emails; password not stored raw; unverified login denied; invalid/expired JWT; refresh rotation/replay/simultaneity; logout; password reset revokes sessions; token invalidation/expiry; no user enumeration.
- Registration: organization + owner + onboarding committed atomically; slug collision; first store unique scoped code; retries idempotent; onboarding cannot complete without store.
- Isolation: User A cannot access B's org/store; a MEMBER cannot create store; store member in wrong org rejected; suspended members denied; cannot remove last active OWNER.
- API: DTO rejects extra fields; sensitive fields excluded; Swagger documented; tests use isolated `DATABASE_URL_TEST` or dedicated test DB and never destroy dev data.
- Ops: `npm run build`, unit Jest, e2e Jest, Docker build, migration status, Render smoke test (upon actual deployment).

## 11. Future extraction to actual microservices
When specifically authorized: extract identity and tenant modules into separate NestJS deployments, move tenant tables from `kirana_identity` to `kirana_tenant`, eliminate SQL cross-domain FKs, verify identity via signed JWT/public keys, and introduce resilient asynchronous integration for email/onboarding where needed. Plan data backfill and rollback before migration. Do **not** perform this during Phase 1 without approval.
