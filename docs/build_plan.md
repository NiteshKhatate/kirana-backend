# Kirana Backend — Phase 1 Build Plan

**Goal:** complete the backend for account creation, secure login, tenant registration, first store, staff onboarding and authorization. **Stack:** NestJS + TypeScript + npm + Prisma 6.19 + PostgreSQL + Jest + Docker + Jenkins + Render. **Repo:** existing `kirana-backend`; **not** a monorepo.

## Current baseline — do not redo
- [x] Existing `kirana-frontend` and `kirana-backend` Git repositories cloned separately.
- [x] Frontend setup complete (not part of this backend plan).
- [x] NestJS backend starts locally and is wired to PostgreSQL in Docker.
- [x] Prisma registration schema (11 business tables, 7 enums) imported and migration applied, as reported by user.
- [x] Verify current git status, package versions, compiled NestJS startup, actual `prisma migrate status`, `npx prisma validate`, and existing tests before coding. Completed 2026-10-13; repairs, command results and remaining findings are in [baseline verification](baseline-verification.md).

**Scope note:** Phase 1 implements modular identity/tenant domains **within the one backend process** and `kirana_identity` DB. The `kirana_tenant` DB is reserved. Extracting separate deployable backend services is a future change and **not part of this plan** unless user explicitly changes scope. No POS, inventory, purchasing or reporting.

## Delivery rules
1. Implement tasks in order, in small reviewable commits. No destructive data operations.
2. Each task ends with tests + `npm run build`; if blocked, document exactly what did not run.
3. Controllers thin, DTO validation, service logic separate, sensitive fields never returned.
4. Every organization/store query enforces authenticated membership and role. Negative cross-tenant tests are mandatory.
5. Preserve existing Prisma schema/migrations unless an additive, reviewed migration is justified.
6. Use `npm install`, `npm ci`, `npm run ...` — never pnpm.

## Milestone 0 — Audit existing baseline
**Work**
- [x] Inspect `package.json`, `package-lock.json`, `tsconfig.json`, `nest-cli.json`, `.env.example`, Docker Compose, Prisma schema + migration history, current controller and module layout.
- [x] Ensure NestJS packages have compatible majors and CommonJS/ESM settings match installed packages; avoid previously encountered `ERR_REQUIRE_ESM` mismatch.
- [x] Confirm `DATABASE_URL` points to the intended local **`kirana_identity`** DB; test DB has a different URL.
- [x] Validate and generate Prisma client; run baseline Jest and build; record results.
- [x] Set `.gitignore` for `.env`, `dist`, key material, logs, coverage; ensure lockfile tracked.

Completed 2026-10-13; exit-gate evidence and remaining non-failing findings: [Milestone 0 verification](milestone-0-verification.md).

**Commands (Git Bash / from repo root):**
```bash
npm ci
npx prisma validate
npx prisma generate
npx prisma migrate status
npm test -- --runInBand
npm run build
```
**Exit gate:** NestJS boots; health query reaches PostgreSQL; migrations show no pending drift/conflict; baseline build/tests pass or failures are documented and repaired.

## Milestone 1 — Foundation and config
- [x] Implement validated environment config, separated dev/test/prod values; no hardcoded secrets.
- [x] Configure `ValidationPipe` (whitelist, forbid unknown fields, transform).
- [x] Configure Swagger docs `/api/docs`, versioned prefix `/api/v1`.
- [x] Add consistent safe exception formatting, request correlation ID/logging and health endpoints.
- [x] Implement organized `AuthModule`, `UsersModule`, `OrganizationsModule`, `StoresModule`, `MembershipsModule`, `OnboardingModule`, `InvitationsModule`, `AuditModule` scaffolds without premature APIs.
- [x] Set up a dedicated integration-test database and test helpers; ensure tests cannot run against dev/prod DB.
- [x] Test startup config, DTO validation and health checks.

Completed 2026-10-13 after closing the Milestone 0 audit; files, endpoint contracts, checks and remaining findings: [Milestone 1 verification](milestone-1-verification.md).

**Exit gate:** predictable configuration, API docs and readiness checks; app boots after fresh install; baseline Jest works.

## Milestone 2 — Identity registration and email verification
- [x] Add Argon2id password hashing and minimal password policy.
- [x] Implement `POST /api/v1/auth/register` with trimmed/lowercased email, safe response, duplicate-email 409; create `User` plus hashed verification token safely.
- [x] Add development mail adapter and production SMTP adapter (no production link logging). Do not assume email delivery success when sending fails.
- [x] Implement `POST /api/v1/auth/verify-email` and `POST /api/v1/auth/resend-verification` with expiry, single-use consumption and resend rate limit.
- [x] Implement `GET /api/v1/auth/me` for a verified, authenticated user; includes RS256 verification and current active/verified database status checks, with an explicit safe profile projection.
- [x] Audit user sign-up events safely (without exposing raw tokens).
- [x] Unit tests for hashing, email normalization, duplicate registration, expired/used tokens, safe serialization.
- [x] Integration/e2e tests for register → verify.

All Milestone 2 tasks completed 2026-10-13, including `/auth/me`. Its JWT verification prerequisite was brought forward; login/token issuance remains Milestone 3 work. Files, API contracts, checks and retry limitations: [Milestone 2 verification](milestone-2-verification.md). No schema migration required.

**Exit gate:** a new user can register, verify email, and has no plaintext credential/token persisted.

## Milestone 3 — Login, JWT, refresh and recovery
- [x] Complete signing-key configuration and token issuance/key rotation (prefer RS256); public-key config, issuer/audience/expiry validation and access JWT guard were completed with Milestone 2's `/auth/me` prerequisite.
- [x] Implement `POST /api/v1/auth/login` requiring verified, active account; use safe errors and rate limiting.
- [x] Implement `POST /api/v1/auth/refresh`: opaque random refresh token, hash in `RefreshSession`, atomic rotation, family-based replay handling, concurrent requests safe.
- [x] Implement `POST /api/v1/auth/logout`: revoke refresh session; document behavior of still-valid short-lived access tokens.
- [x] Implement `POST /api/v1/auth/forgot-password` and `/reset-password` using one-time hashed tokens and generic responses; revoke sessions after reset.
- [x] Define Next.js BFF/cookie and CSRF contract without requiring frontend changes in this backend milestone.
- [x] Jest tests for incorrect password, user status, unverified login, JWT claims, refresh expiration/replay/race, logout, reset and abuse/rate-limit behavior.

**Exit gate:** registered and verified user can log in, access `/auth/me`, refresh credentials once, log out and reset password; replay is contained.

## Milestone 4 — Tenant creation and authorization
- [x] Implement organization DTO and `POST /api/v1/organizations` using one Prisma transaction to create: `Organization` (`ONBOARDING`), `OrganizationMember` (`OWNER`, `ACTIVE`), `OnboardingProgress`.
- [x] Handle unique slug collisions and retries/idempotency safely; never generate duplicate organizations from a repeated request.
- [x] Implement `GET /organizations` listing only ACTIVE user memberships and `GET /organizations/:orgId` with membership checks.
- [x] Build organization role decorator/guard: OWNER, ADMIN, MEMBER; reject inactive/suspended members and stale claims.
- [x] Prevent last active OWNER demotion/removal as future membership endpoints are added.
- [x] Record org creation/administrative changes in `AuditLog` in transaction where practical.
- [x] Jest unit + DB integration tests for rollback, ownership, repeated submission, duplicate slug and tenant A/B isolation.

**Exit gate:** verified user creates organization and becomes its OWNER; an unrelated account cannot read it.

Completed 2026-10-16. Both milestones use the existing schema without a migration. Contracts, files, validation and limitations: [Milestones 3 and 4 verification](milestones-3-4-verification.md). Browser responsibilities: [BFF/cookie and CSRF contract](browser-auth-contract.md). Next: Milestone 5.

## Milestone 5 — Stores and onboarding completion
- [x] Implement `POST /organizations/:orgId/stores` (OWNER/ADMIN) with org-bound store code uniqueness and validated location/contact fields.
- [x] Implement `GET /organizations/:orgId/stores` with authorized organization-scoped filtering.
- [x] Implement `GET /organizations/:orgId/onboarding` to resume incomplete registration.
- [x] Implement `POST /organizations/:orgId/onboarding/complete`: ensure owner + at least one store; transition ONBOARDING → ACTIVE atomically; repeated completion is idempotent.
- [x] Clarify ownership: OWNER/ADMIN can access all stores; store staff require active org membership + explicit store membership.
- [x] Tests for no-store completion failure, cross-org store injection, duplicate code, store creation role restrictions, retry/resume and transaction rollback.

**Exit gate:** end-to-end register → verify → login → create tenant → create first store → complete onboarding works and is secure.

## Milestone 6 — Staff invitations and membership access
- [x] Implement `POST /organizations/:orgId/invitations` with expiring hashed token and OWNER/ADMIN guard.
- [x] Implement invitation acceptance for verified matching-email users, creating/activating organization membership atomically.
- [x] Implement `GET /organizations/:orgId/members` scoped to owner/admin; never expose sensitive user fields.
- [x] Add explicit store-assignment service using existing `StoreMember` for MANAGER/CASHIER/INVENTORY, with active org membership checks. Define/API-doc any needed endpoint before exposing it.
- [x] Reject cross-organization store assignments, suspended members, expired/revoked invitation, unauthorized inviter and duplicate acceptance.
- [x] Audit invitation issue/revoke/accept and staff access changes.
- [x] Unit/integration/e2e tests for valid and invalid invites and store membership scope.

**Exit gate:** invited staff can join with correct org scope; access can be checked by store and role.

Completed 2026-10-16. Milestones 5 and 6 use the existing schema without a migration. API/role policy: [staff access contract](staff-access-contract.md). Files, tests, limitations and manual checks: [Milestones 5 and 6 verification](milestones-5-6-verification.md). Next: Milestone 7.

## Milestone 7 — Docker, Jenkins and Render readiness
- [ ] Multi-stage `Dockerfile` for npm install/build/runtime; correct Prisma generation, `PORT` binding, non-root execution when feasible, and `.dockerignore`.
- [ ] `docker-compose.yml` supports local Postgres, backend startup and volume persistence (without discarding user data).
- [ ] Jenkinsfile: checkout, `npm ci`, Prisma generate, lint/typecheck, unit tests, test DB integration/e2e, production build, Docker build, *approved* deployment to Render.
- [ ] Use Jenkins credentials store for deployment trigger/secrets; Render env vars for runtime secrets; never bake `.env` into image.
- [ ] Production migrate with `npx prisma migrate deploy` in a controlled, single-run job; backup and inspect migrations beforehand.
- [ ] Implement readiness/smoke checks; deploy only if checks pass; document rollback steps.
- [ ] Update `.env.example` and README with local commands, API endpoints and production configuration checklist.

**Exit gate:** CI passes from clean checkout; Docker image builds; production deployment/migrations/smoke tests are verified **only after actual execution** (do not mark them complete prematurely).

## Acceptance matrix / release blockers
| Scenario | Must pass |
|---|---|
| Register unique email; prevent duplicates and normalize email | ✅ |
| Email verify is single-use, expiring and securely stored | ✅ |
| Login only verified active account; no password/hash leak | ✅ |
| JWT validation and refresh rotation; replay/logout/reset handled | ✅ |
| Organization creation atomically creates active OWNER and onboarding | ✅ |
| First store created under correct organization; scoped unique code | ✅ |
| Onboarding resumes and completes only with valid first store | ✅ |
| User A cannot read/write User B's organization or store | ✅ |
| Staff access requires appropriate membership/role | ✅ |
| Swagger, health, error validation, logging and secrets safety | ✅ |
| Jest unit + integration + e2e tests, build and Docker checks pass | ✅ |
| Jenkins/Render deployment evidence obtained (when configured) | ✅ |

## Working agreement with coding agents
At the end of each milestone, provide:
1. Files created/modified and any schema changes.
2. Endpoints implemented with example safe request/response.
3. Tests executed and results (or exact reason not run).
4. Manual verification commands (Git Bash-compatible; avoid PowerShell backticks).
5. Unfinished work, risks and next milestone.

## Phase 1 completion definition
From a clean environment and migrated database, a first-time business owner can register, verify email, log in, create an organization, register its first store, complete onboarding, invite a staff member, and access only authorized data. Logout, password recovery and session rotation work. The backend builds, unit/integration/e2e tests pass, the Docker image runs, and Jenkins/Render integration is demonstrated when deployment credentials/services are available.
