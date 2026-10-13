# AGENTS.md — Kirana Backend

## Mission and current state
Build **Phase 1 backend registration** for Kirana, a multi-tenant store-management SaaS. Work **only in the existing `kirana-backend` repository**. The user has a separate `kirana-frontend` repository. Use **npm, not pnpm**. NestJS, TypeScript, Prisma 6.19, PostgreSQL, Docker (local), and Jest are already initialized. The registration-oriented Prisma schema has been migrated. **Inspect the repository and migration history before changing anything.** Do not regenerate the application or reset databases.

Read `build_plan.md` and `system-design.md` before implementing features; follow their order and acceptance criteria. If files differ from the documented assumptions, report differences and adapt conservatively.

## Scope
Phase 1 includes registration/login, email verification, refresh-token lifecycle, password reset, organization (tenant) creation, owner membership, first store, onboarding completion/resumption, staff invitations and basic membership/store authorization, API docs, backend Jest tests, Docker, Jenkins, and Render deployment readiness. Product inventory, POS, supplier, customer, advanced reporting and billing are **out of scope**.

Current deployment boundary: one NestJS process and Prisma client using `kirana_identity` database, with identity and tenant code **modularized inside the backend**. `kirana_tenant` may exist but is **not** used yet. Future independent services require explicit extraction and data migration; do not pretend separate NestJS modules are deployed microservices or join the databases directly.

## Mandatory engineering rules
1. **Never wipe data.** No `prisma migrate reset`, `db push --force-reset`, `docker compose down -v`, dropping databases/tables, or destructive SQL without explicit approval. Keep old migrations; review newly generated SQL before applying. Development: `npx prisma migrate dev`; production: `npx prisma migrate deploy`.
2. **Never expose secrets.** Do not commit `.env`, private keys, raw refresh/reset/verification tokens, credentials, Docker volumes, or sensitive personal data in logs. Provide `.env.example` placeholders only.
3. **Use existing package manager and version conventions.** npm + `package-lock.json`; `npm ci` in CI. Keep NestJS dependencies on compatible majors, Prisma CLI and Client on matching versions; do not upgrade major versions without approval. Preserve project module format (CommonJS) unless a coordinated conversion is explicitly planned.
4. **Tenant safety is critical.** Every organization- or store-scoped query checks authenticated user membership and required role. Never trust `organizationId`, `storeId`, or `role` from the request by themselves. Cross-tenant access must yield 403 or a deliberate 404, never data.
5. **Use the existing Prisma models and field names** from `prisma/schema.prisma` (e.g. `User`, `RefreshSession`, `Organization`, `OrganizationMember`, `Store`, `StoreMember`, `Invitation`, `OnboardingProgress`, `AuditLog`). No unreviewed renames or parallel SQL schema. Prefer small additive migrations.
6. **Validation and errors.** Global `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })`; DTOs with class-validator and class-transformer; consistent HTTP statuses and safe error messages. Normalize emails to lowercase and trim inputs. Never send `passwordHash`, `tokenHash`, or secret fields in responses.
7. **Security.** Hash passwords with Argon2id. JWT access tokens must be short-lived and signed with a secret from validated configuration (prefer RS256/asymmetric keys if other services will verify independently); verify issuer, audience, algorithm and expiry. Refresh tokens must be random high-entropy opaque strings, stored **hashed**, rotated on every refresh, revoked on logout, and protected against replay/concurrent reuse. One-time email and password-reset tokens are also hashed and expiring. Password resets revoke existing sessions. Implement rate limiting and generic recovery responses against account enumeration. No auth tokens in URL query strings except one-time verification/reset links as intentionally designed; avoid logging them.
8. **Ownership and transactions.** Creating an organization + its OWNER membership + onboarding state is one DB transaction. Creating a first store and advancing onboarding must be consistent and retry-safe. Enforce `@@unique`/composite constraints; return 409 for conflicts. Ensure the final active OWNER cannot be removed/demoted.
9. **Testing required.** Unit tests for services/guards/token logic; integration tests against a dedicated test database for persistence and transactions; HTTP e2e tests for core flows and isolation. Mock external SMTP, time where needed, and randomness deterministically. Never run destructive tests against the development database.
10. **Source hygiene.** Put modules under `src/modules/<domain>` (or preserve consistent existing layout), thin controllers, service/business logic separate from DTOs, dependency injection, meaningful names, no `any` without documented need. Swagger decorators for APIs; health check does not leak secrets. Use UTC for persisted timestamps, ISO strings in API.
11. **Minimal changes.** Before edits: inspect files, schema, current migration status, package versions and tests. After edits: run `npm run build`, `npm test -- --runInBand`, plus e2e and lint scripts where configured; record results honestly. Do not claim deployment or successful tests unless actually run.

## Standard workflow for an AI coding agent
For **one build-plan task at a time**: (1) inspect relevant code and requirements; (2) identify the smallest cohesive change; (3) implement code + DTOs + tests + migration if needed; (4) run validation; (5) summarize files changed, commands, tests, limitations and next task. Never silently skip failing tests. Ask for approval only when a decision entails destructive migrations, credential deployment or new paid external services.

## Source of truth / document priority
1. Existing code and applied database migration (observed reality)
2. `system-design.md` (design invariants and contracts)
3. `build_plan.md` (implementation tasks and completion gates)
4. This `AGENTS.md` (working conventions)

When a design change is necessary, update both planning documents and explain the migration impact.

## Required local checks
```bash
npm ci
npx prisma validate
npx prisma generate
npx prisma migrate status
npm run build
npm test -- --runInBand
# plus: npm run lint, npm run test:e2e when scripts exist
```

**Never execute `migrate dev` or `migrate deploy` against an unverified DATABASE_URL.**
