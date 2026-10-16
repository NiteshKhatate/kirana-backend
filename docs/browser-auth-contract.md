# Browser authentication contract

This milestone implements the NestJS API only. The separate Next.js repository has not been modified. Browser integration should use a same-origin Next.js BFF; it is a contract for future frontend work, not an implemented BFF or cookie middleware in this backend.

## Backend transport

The BFF sends login `{ email, password }`, refresh/logout `{ refreshToken }`, recovery `{ email }`, and reset `{ token, password }` as JSON bodies to `/api/v1/auth/*` over TLS. Login/refresh return `{ accessToken, refreshToken, tokenType: "Bearer", expiresIn }` with `Cache-Control: no-store`. The BFF sends access JWTs through `Authorization: Bearer …` for `/auth/me` and tenant routes. Backend authentication never reads browser cookies. CORS remains disabled; no browser credentialed cross-origin contract is enabled.

The BFF must never forward backend token responses to browser JavaScript, put credentials in URLs, cache them, or persist them in localStorage/sessionStorage. Backend logs omit bodies, headers and URLs; the BFF and proxies must apply the same protection.

## Cookies and CSRF responsibilities of the BFF

Prefer an opaque browser session ID with server-side storage of access/refresh credentials. If credentials are placed directly in cookies, use `HttpOnly; Secure; SameSite=Lax; Path=/`, omit `Domain`, and use a `__Host-` cookie name. Cookie expiry must not exceed the backend refresh family's absolute expiry (default seven days); rotation must not extend it. A server-side session can track that expiry. Development localhost cookies need a deliberately isolated development policy; production always uses HTTPS/Secure.

For every state-changing browser request, including login, refresh and logout, require an exact configured Origin match and a session-bound CSRF token in a custom header. Reject missing/mismatched Origin and CSRF values; validate Referer against the exact origin only if a deliberate fallback is implemented. Issue a pre-login CSRF session for login. Do not rely on SameSite alone. Browser state changes use POST; no mutating GET routes. Cross-site email links open a page, which then submits its one-time token in the POST body. Use `Referrer-Policy: no-referrer`, avoid third-party resources on those pages, and clear the one-time token from browser history after reading it.

## Rotation and logout

Serialize refresh per browser session on the BFF, including across tabs and BFF instances. Save the rotated pair atomically. The backend deliberately treats duplicate/concurrent refresh as reuse: at most one succeeds, then the reused token revokes the entire family, including the winner. Do not blindly retry an old refresh token after a lost response; clear the browser session and require login on 401 or uncertain rotation outcome. Backend family containment remains correct without a BFF mutex, but the user must log in again.

Logout revokes the supplied credential's entire family, including descendants if an old rotated token is submitted. Unknown/already-logged-out credentials return 204. Clear the BFF cookies and server-side session even when the backend is unreachable. Other independently logged-in families remain active. Password reset revokes every refresh family for that user and consumes all outstanding reset tokens. Access JWTs issued before logout/reset remain usable until their short expiry (maximum 15 minutes); `/auth/me` and tenant guards still check current active/verified user status. There is no access-token denylist or claim of immediate JWT revocation.

## Abuse and delivery

The backend currently runs one process. Login, forgot-password and reset-password permit ten requests per operation/IP/minute; login and forgot-password also share ten attempts per normalized account/minute across IPs. Refresh/logout permit thirty per operation/IP/minute. The limiter uses the transport peer and ignores forwarded headers. A BFF/proxy concentrates traffic onto its peer IP; define trusted proxy handling and suitable limits before public deployment. Multi-instance deployment requires a shared limiter. Account recovery responses remain generic, with a database-enforced 60-second per-account issue cooldown.

Recovery mail uses the same private development outbox or TLS SMTP adapter as verification. The bounded 128-item process queue is best-effort and drains on graceful shutdown; a process crash, full queue or delivery failure requires a later recovery request. Generic success does not promise delivery. SMTP and browser deployment have not been performed by this milestone.
