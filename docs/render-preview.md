# Free Render Docker and PostgreSQL preview

This is a preview in the confirmed **Nitesh's workspace**, not a production release. The default `render.yaml` defines `kirana-backend-preview` (Docker, free) and `kirana-identity-preview` (PostgreSQL 17, free), both in Singapore. The logical database remains `kirana_identity` with role `kirana`. No existing development data is copied or reset.

Free web services sleep after inactivity. Free PostgreSQL expires after 30 days and has no managed backups; use synthetic preview data only, export anything needed before expiry, and never treat this deployment as durable production storage. Do not upgrade or add paid resources without separate approval.

## Prepare email and keys

1. Create a free [Resend account](https://resend.com/signup). Create a sending-only API key and keep it private. Set it in Render as `RESEND_API_KEY`, never in Git or chat.
2. The Blueprint selects `MAIL_TRANSPORT=resend` and `EMAIL_FROM=onboarding@resend.dev`. This test sender can email only your Resend account address. To test with other people, verify a domain you own and change the sender to an address on that domain. The free account has provider quotas; do not enable a paid plan or overage billing for this preview.
3. Generate a separate matching RSA key pair (at least 2048 bits) for this preview. The current local preparation placed a matching 3072-bit pair in ignored `.keys/render-preview/`. Set the contents privately as `JWT_PRIVATE_KEY` and `JWT_PUBLIC_KEY` in Render; preserve PEM line breaks or encode them as literal `\n`. These are not the local development signing keys.
4. No frontend is deployed yet. The Blueprint explicitly selects `AUTH_EMAIL_MODE=code`, so verification and password-reset messages contain one-time codes for API entry and need no frontend URLs. Use the emailed value as `token` in `POST /api/v1/auth/verify-email` or `POST /api/v1/auth/reset-password` (the latter also requires `password`). Never paste tokens into chat or logs. Once the frontend exists, change to `AUTH_EMAIL_MODE=link` and set real HTTPS `VERIFY_EMAIL_URL` and `RESET_PASSWORD_URL` pages. Production/test environment validation and token expiry/single-use rules remain enforced.

The new Resend adapter posts text email to the fixed HTTPS endpoint, refuses redirects, times out after 10 seconds and reports only safe errors. Registration/invitation responses may now report `resend-accepted`; this confirms provider acceptance, not inbox delivery. SMTP remains supported for other environments.

## Publish and apply the Blueprint

1. Review the Node 24, HTTPS mail and Blueprint changes, then commit/push them to the repository. GitHub Actions must pass for that commit. Render reads the remote file, not uncommitted local edits.
2. Validate with `render blueprints validate render.yaml --workspace tea-d9q0dfnlk1mc73eatn9g --output json` after privately authenticating the Render CLI. JSON Schema validation alone does not prove platform acceptance.
3. Open **New → Blueprint** in the Render Dashboard, connect the existing backend repository, select `master` and use `render.yaml`. Review that every resource is **Free** in the confirmed workspace. Supply the private values above. Avoid applying the old paid-service instructions in `deployment.md`.
4. Applying creates both resources and starts the initial build. The Dockerfile's final `runtime` stage starts the NestJS app as a non-root user. No custom Docker start command, shell migration, or pre-deploy command is configured. Automatic deployment remains off so schema changes are reviewed before subsequent releases.

## Initialize the new preview database once

Free web services do not provide shell access, one-off jobs or pre-deploy commands. Run Prisma 6.19 from a trusted local environment using the new database's external TLS URL, not the development/test URL and not a URL printed into command history or chat.

Before any write:

1. Identify the newly created preview database by its Render database ID, region, host, role and logical database name.
2. Temporarily allow only the operator's public IP in its external inbound rules; the Blueprint defaults to internal-only access (`ipAllowList: []`). Keep the credential in an ignored, private local file. Do not open access to every IP.
3. Verify the connection's live `current_database()` and `current_user()` match the reviewed target, and check the public schema is empty. Review both original migration SQL files and their manifest. If there are existing tables or user data, stop and investigate; do not reset, truncate or treat it as a fresh database.
4. Apply only the original migrations with `npx --no-install prisma migrate deploy`, using the verified preview URL through private process configuration. Then run migration status and verify both history entries completed. Never run `migrate dev`, `migrate reset` or `db push` against this hosted database.
5. Restore internal-only external inbound rules after initialization. A later Blueprint sync also restores the declared empty allow list. Production migrations still require the separate backup/review/approval procedure; this new empty preview is not a substitute for a production backup.

Do not report the preview usable until migrations and all required runtime configuration are verified. The existing readiness endpoint checks connectivity, so a green health check alone does not prove application tables exist.

## Verify the exact deploy

Record the new deploy ID and Git commit. Wait for that deploy to become `live`, then check `/api/v1/health`, `/api/v1/health/live`, `/api/docs`, and unauthorized access to `/api/v1/auth/me`. The existing smoke tool can check the service's HTTPS origin without creating users or sending mail. Registration/verification testing with the designated Resend account address is a separate explicit test; never expose tokens through logs, chat, or public test artifacts.

No actual hosted deployment, migration, email acceptance or inbox delivery is implied by this document or by a successful local build.

References: [Render free limitations](https://render.com/docs/free), [Docker](https://render.com/docs/docker), [Blueprint specification](https://render.com/docs/blueprint-spec), [Resend test-sender restriction](https://resend.com/docs/knowledge-base/403-error-resend-dev-domain), [Resend quotas](https://resend.com/docs/knowledge-base/account-quotas-and-limits).
