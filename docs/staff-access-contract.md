# Stores, onboarding and staff API contract

Base `/api/v1`; all routes require an ACTIVE, verified user through a Bearer access JWT. Current memberships and roles are read from PostgreSQL. These are backend APIs; the separate frontend is unchanged.

| Method | Path | Authorization and behavior |
| --- | --- | --- |
| POST | `/organizations/:orgId/stores` | OWNER/ADMIN; `{code,name,phone?,addressLine1?,addressLine2?,city?,state?,postalCode?,country?}`; 201. Stable code is uppercase and organization-scoped. Identical normalized retry returns the original; changed payload 409. |
| GET | `/organizations/:orgId/stores` | Active org member; OWNER/ADMIN see all stores, MEMBER only active explicitly assigned stores. |
| GET | `/organizations/:orgId/stores/:storeId` | Same access policy; wrong-org/unassigned store 404. Reusable store-role guard supports MANAGER/CASHIER/INVENTORY restrictions on future APIs; OWNER/ADMIN bypass store assignments. |
| GET | `/organizations/:orgId/onboarding` | Active org member; progress for resumption. FIRST_STORE → REVIEW after first store → COMPLETE. |
| POST | `/organizations/:orgId/onboarding/complete` | OWNER/ADMIN; requires an ACTIVE verified OWNER and at least one ACTIVE store in that organization; 200, repeat-safe; missing prerequisites 409. |
| POST | `/organizations/:orgId/invitations` | OWNER may invite ADMIN or MEMBER; ADMIN may invite MEMBER only. `{email,role?}` defaults MEMBER. 201 safe invitation and `emailDelivery`; no raw token/hash. |
| POST | `/organizations/:orgId/invitations/:invitationId/revoke` | OWNER/ADMIN, with the same role ceiling. 200; repeated revocation succeeds, accepted invitation 409, wrong organization 404. |
| POST | `/invitations/accept` | Verified matching-email user, `{token}` in JSON only. 200 active organization membership. Repeated acceptance 409; invalid/expired/revoked/mismatched token 400; suspended membership 403. |
| GET | `/organizations/:orgId/members` | OWNER/ADMIN; allowlisted membership and user identity fields, no credentials or tokens. |
| PUT | `/organizations/:orgId/stores/:storeId/members/:userId` | OWNER/ADMIN; `{role:MANAGER\|CASHIER\|INVENTORY,status?:ACTIVE\|SUSPENDED}` defaults ACTIVE. Explicit assignment/reassignment/suspension, 200; target needs ACTIVE org membership and ACTIVE verified account; wrong-org store 404. |

This contract defines the assignment, store detail and invitation revocation endpoints before exposing them. Store-specific invitations are not modeled: accepting an org invitation grants no store assignment. Owners cannot be invited through the staff API. Invitations never change an already ACTIVE membership or bypass a SUSPENDED membership; they may activate an INVITED membership. Acceptance rechecks the inviter's current role and status so a stale invitation cannot grant privileges its issuer has lost.

Invitation values are high-entropy, hashed, expiring one-time codes. Email contains the code in its text for entry into the future authenticated UI; it does not put a credential into a URL. Default expiry is seven days, configurable from 300 to 604800 seconds via `INVITATION_TTL_SECONDS`. Issue/reissue uses a 60-second org/email cooldown. Reissue revokes prior pending codes transactionally. Mail is attempted after commit, with explicit development-outbox/smtp-accepted/failed response; acceptance by SMTP is not inbox delivery. On failure the admin may retry after the cooldown. No token is returned through the API, logged, or stored raw in PostgreSQL.

All mutations serialize on the organization row and recheck authorization inside the transaction. Store/progress creation, completion, invitation lifecycle changes, assignments and their audit writes are atomic. The existing schema and its uniqueness/composite foreign keys are used; no migration is needed. Cross-tenant access returns 403 or a deliberate 404. Suspended organizations, memberships, assignments and inactive staff stores are rejected. Tenant mutation endpoints do not let callers choose an organization from the JSON body.
