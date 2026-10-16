# Milestones 5 and 6 — Stores, onboarding and staff

Implemented locally on 2026-10-16, in the existing NestJS backend and `kirana_identity` database. No schema/migration changes, dependency changes, frontend changes or deployments. Existing npm lockfile, CommonJS, NestJS 11 and Prisma CLI/Client 6.19.0 are preserved. Next: Milestone 7, Docker packaging, Jenkins and Render readiness.

## Implementation and files

- `src/modules/stores/`: validated store DTO, safe response projection, thin create/list/detail controller and transactional service. Stable org/code supports identical creation retries; different payload is 409. First-store creation advances FIRST_STORE → REVIEW and records audit in the same transaction. OWNER/ADMIN see all org stores; staff see only active assigned stores.
- `src/modules/onboarding/`: guarded resume and completion APIs. Completion requires an active verified OWNER and an ACTIVE store in that organization, updates organization ACTIVE/progress COMPLETE atomically, and audits once. Concurrent/repeated completion preserves its original timestamp. Store creation cannot regress completed progress.
- `src/modules/memberships/tenant-access.service*`, `store-role.guard*`: shared transactional authorization, organization locking, current-user/member/status checks and reusable StoreRoles guard. Scoped queries repeat membership constraints. Every store must belong to the supplied organization, and staff need both org membership and store assignment. OWNER/ADMIN access does not require an assignment. Original last-owner protection remains intact.
- `src/modules/memberships/membership-access.service*`, `memberships.controller.ts`, `dto/membership.dto.ts`: OWNER/ADMIN member directory with minimal user fields; explicit MANAGER/CASHIER/INVENTORY assignment, role change or suspension. Requires current ACTIVE verified target org membership. Assignments and audit commit together; identical retries do not duplicate writes/audit.
- `src/modules/invitations/`: issue, revoke and accept DTO/controller/service with unit tests. SHA-256 token persistence, expiry, cooldown, reissue invalidation, current inviter-authority checks, matching-email acceptance and transactional audit. No raw token/hash in responses. Invitation codes are mailed as text, never URL credentials.
- `src/modules/auth/auth.module.ts`, `auth-rate-limit.guard.ts`: reuse/export existing identity clock, opaque-token and bounded limiter services; authenticated invitation-operation rate limits.
- `src/config/invitation-environment*`, `environment.ts`, `.env.example`: bounded invitation TTL setting, default seven days. `src/modules/email/email.service.ts` reuses the existing private development/TLS SMTP adapters. `SecurityEvents` adds a fixed safe delivery-failure event without mail content.
- `test/helpers/tenant-fixture.ts`, `stores-onboarding.integration-spec.ts`, `staff.integration-spec.ts`: real dedicated PostgreSQL and HTTP scenarios with mocked SMTP and controlled time. Exact UUID fixtures are cleaned up in FK order, never by truncation/reset. `organizations.integration-spec.ts` extends the full owner flow through first store and completion.
- `test/tenant.e2e-spec.ts`: HTTP DTO/normalization/status/no-store/rate-limit/OpenAPI contracts with explicit service/guard mocks; authorization/isolation are independently exercised with real guards and DB in integration tests. Guard/service/config unit tests cover role filtering, invitation state and session-independent tenant authorization.
- README, build/design plans and [staff access contract](staff-access-contract.md): final API and operational contracts. No changes to migration SQL or dependency versions.

## APIs and safe examples

See [staff access contract](staff-access-contract.md) or Swagger `/api/docs` for complete payloads, status codes and role policy. All routes use a verified ACTIVE user's Bearer JWT. Examples contain no live credentials.

```text
POST /api/v1/organizations/:orgId/stores
{ "code": "MAIN", "name": "Main Store", "city": "Pune", "country": "IN" }
→ 201 { "id": "<uuid>", "organizationId": "<uuid>", "code": "MAIN", ...safe store fields }

GET /api/v1/organizations/:orgId/onboarding
→ 200 { "organizationId": "<uuid>", "currentStep": "REVIEW", "completedAt": null, ... }

POST /api/v1/organizations/:orgId/onboarding/complete
→ 200 { "currentStep": "COMPLETE", "organizationStatus": "ACTIVE", "completedAt": "<UTC timestamp>", ... }

POST /api/v1/organizations/:orgId/invitations
{ "email": "staff@example.com", "role": "MEMBER" }
→ 201 { "invitation": { "id": "<uuid>", "status": "PENDING", ...safe fields }, "emailDelivery": "development-outbox" }

POST /api/v1/invitations/accept
{ "token": "<one-time code from private email>" }
→ 200 { "organizationId": "<uuid>", "userId": "<uuid>", "role": "MEMBER", "status": "ACTIVE", "joinedAt": "<UTC timestamp>" }

PUT /api/v1/organizations/:orgId/stores/:storeId/members/:userId
{ "role": "CASHIER", "status": "ACTIVE" }
→ 200 safe explicit store assignment
```

Other routes: GET stores/store detail, GET members, and POST invitation revocation; the contract documents them before implementation. OWNER can invite ADMIN/MEMBER; ADMIN can invite MEMBER only. No staff invitation grants ownership or store access automatically. Existing ACTIVE memberships cannot be changed by invitation; SUSPENDED membership blocks acceptance and assignment. Only INVITED membership may be activated by invitation. Role/organization/store injection in bodies is rejected by DTOs. Missing membership is 403; wrong-org/unassigned stores are deliberately 404.

## Validation evidence

Repository inspection began with a clean worktree. The schema still has the two original migration directories. A read-only live migration query and Prisma status both confirmed both migrations applied to local development `kirana_identity`. The existing dedicated test service/config was available; test helpers verified its URL and live `kirana_identity_test`/`kirana_test` identity. No migrations, new volumes, credential changes, resets or development fixture writes were needed this time.

Milestone 5 initially passed build, 135 unit tests and seven new real PostgreSQL tests before proceeding to Milestone 6. Staff validation subsequently passed all fourteen new integration scenarios; combined integration coverage includes the earlier milestones. Final commands/results are recorded below after final validation.

The first lint pass found an unused test import and an unsafe Supertest response destructuring; both were corrected before the final passing lint. No failing checks were skipped.

| Final command/check | Result |
| --- | --- |
| `npm ci` | Passed with unchanged lockfile; existing engine/audit warnings below |
| `npx prisma validate` | Passed |
| `npx prisma generate` | Passed, Client 6.19.0 |
| `npx prisma migrate status` | Passed; both original development migrations applied |
| `npm run build` | Passed |
| `npm test -- --runInBand` | 157 tests passed, 30 suites |
| `npm run test:e2e -- --runInBand` | 51 tests passed, 5 suites |
| `npm run test:integration` | 51 tests passed, 6 suites, verified dedicated PostgreSQL |
| `npm run lint` | Passed |
| Compiled application smoke | Passed: development DB readiness 200, new store/onboarding/invitation/member/assignment OpenAPI routes present, unauthenticated tenant/staff routes 401; temporary listener closed |
| `git diff --check` | Passed |
| Schema/migration/package/lockfile diff | No changes |

All Milestone 5 and 6 checklist items are complete. Integration data writes were limited to generated fixtures in the dedicated test database, and those fixtures were removed afterward. Development database actions were read-only. Existing containers/volumes were preserved; no test credentials changed and no new volume was created. The application smoke listener was closed. No commit or deployment was created.

Coverage includes full register → verify → login → org → first store → complete onboarding; invited new staff register → verify → login → accept → assignment → scoped store access; no-store/no-owner/inactive-store completion failure; atomic creation/completion rollback; same-code retries, concurrent store submissions and code scope; member/admin/owner restrictions; unassigned/cross-tenant stores; hashed invitation values; missing/mismatched/expired/revoked/used codes; reissue/cooldown; concurrent acceptance/revocation; stale inviter role/status; membership suspension; honest SMTP failure; safe member lists; role-specific store authorization; assignment suspension/idempotency; and invitation/assignment/audit rollback.

## Manual verification (Git Bash)

```bash
npm ci
npx prisma validate
npx prisma generate
npx prisma migrate status
npm run build
npm test -- --runInBand
npm run test:e2e -- --runInBand
npm run test:integration
npm run lint
npm run auth:keys
npm run start:dev
```

The dedicated test DB must already be running; otherwise use `npm run db:test:setup`, which validates its target before applying existing migrations. Stop development watch processes before clean install/Prisma generation on Windows. Use Swagger/private tooling for Bearer credentials. Read development verification links and invitation codes only in the ignored private mail outbox; never paste real credentials into shell history or logs. To manually exercise roles, invite a second registered/verified account, accept its code with that account's JWT, then assign it to a store as owner/admin and compare its store list before/after assignment.

## Limits and next work

No frontend/BFF or email-entry page was implemented; the separate frontend must follow the existing browser auth contract. Invitation delivery is synchronous after DB commit, with explicit failure reporting; SMTP acceptance does not prove inbox delivery. Retry after 60 seconds to issue a new code and invalidate the old one. Expired invitations are rejected by `expiresAt`; no background expiry/cleanup job is claimed. Codes never go into URLs.

Rate limits remain bounded to this single process: invitation issue ten/minute per IP/user; accept/revoke thirty per operation/IP/user. Shared limits/trusted proxy policy remain a deployment concern. Store assignments do not replace current org membership; suspending org membership blocks all its store access even if assignment rows remain active. There are no new public org-member demotion/removal endpoints. Persisted state uses existing schema defaults and UTC timestamps.

The existing Node 20.16.0 engine warning and npm audit report of 50 vulnerabilities (15 moderate, 35 high) remain dependency findings; no automatic upgrades or audit fixes were performed. Next is Milestone 7. No Docker application image, Jenkins pipeline or Render deployment is claimed by these milestones.
