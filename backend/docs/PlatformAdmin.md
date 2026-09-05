# Platform Super Admin / Platform Owner control plane

Status: corrected implementation and live verification completed on 2026-09-05 for the repository's React/Express/Prisma architecture.

## Identity boundary

The Platform Super Admin is the platform owner, not an organization user. It has no `User` row, no `OrganizationMembership`, no business role and no grant/revoke API. The only credentials accepted by the dedicated login are:

```dotenv
PLATFORM_OWNER_LOGIN_ID="superadmin"
PLATFORM_OWNER_PASSWORD="set-a-unique-password-of-at-least-16-characters"
```

The actual values live in the ignored `backend/.env`; `.env.example` contains safe setup placeholders. The login ID must be non-empty and the password must contain at least 16 characters or the endpoint returns 503 `PLATFORM_OWNER_NOT_CONFIGURED`. Open `/login/super-admin` to sign in. `POST /api/v1/auth/super-admin/login` compares hashed representations of both supplied values in constant time and does not query the organization-user table. Five failed attempts for an IP/login pair block further attempts for 15 minutes in the current process.

On success, the backend creates a four-hour `PlatformOwnerSession` containing only an opaque session-token hash, CSRF hash, configured login ID and optional View As state. The raw password is never written to PostgreSQL. The owner cookie is HttpOnly, Secure in production and SameSite=Strict. Owner login clears the normal user cookie; normal login clears the owner cookie.

## Authorization and organization visibility

- Every `/api/v1/platform/*` route requires `actorType=PLATFORM_OWNER`, derived only from a valid owner session.
- An Organization Admin, member, portal user or public request cannot reach the control plane, even by calling the endpoint directly.
- `User.organizationId` scopes the current compatibility business API, while synchronized `OrganizationMembership` rows drive control-plane roles and View As validation. Caller-supplied organization IDs never create access.
- The owner dashboard reads live global metrics, organizations, users and privileged activity.
- Organization details show the currently implemented quotation/approval, inventory, subscription, invoice/payment and audit data.
- View As Organization/User provides all existing workspace modules in an explicit tenant context. It is read-only, displays a persistent banner and requires explicit exit.
- Suspended or archived organizations retain history while normal business operations are blocked.

## Privileged audit

`PrivilegedAudit` is append-only through the API. An event contains exactly one real actor representation: `actorId` for a rejected authenticated organization-user mutation, or `platformActorId` for the environment Platform Owner. It can also contain the simulated user, target organization/user, action, model/record, allowlisted before/after JSON, written reason, request ID, safe IP/user-agent metadata and success/failure.

Passwords, raw cookies, CSRF values, invitation tokens, password hashes, payment credentials and private session data are never returned or audited.

## Local use

Configure the owner credential in `backend/.env`, start PostgreSQL and apply migrations:

```bash
docker compose up -d postgres
docker compose exec postgres pg_isready -U dealos -d dealos
npm --prefix backend run db:generate
npm --prefix backend run db:migrate
```

Then run both applications in separate terminals:

```bash
npm --prefix backend run dev
```

```bash
npm --prefix frontend run dev
```

Open `http://localhost:5173/login/super-admin`. Organization users continue to use `/sign-in`.

The backend resolves `backend/.env` relative to its own module rather than the shell working directory. This makes `npm --prefix backend run dev` from the repository root and `npm run dev` from `backend/` equivalent. Restart the backend after changing credentials because existing processes do not reload `.env` values automatically.

## 60-second verification

1. Open `/login/super-admin` and try an Organization Admin email/password; show `INVALID_PLATFORM_CREDENTIALS`.
2. Enter the two values from `backend/.env`; the global organization dashboard opens.
3. Open two organizations and inspect their members and tenant records.
4. Open Members, disable a test user with a reason, and show the resulting privileged audit event. Re-enable the account if the demo should remain usable.
5. Open an organization and choose View as organization; show all workspace modules and the persistent read-only banner.
6. Attempt a write and show `VIEW_AS_READ_ONLY`, then select Exit View and sign out.

## Verification evidence

- The environment owner credential created a separate owner session and loaded the global dashboard with two organizations.
- `admin@dealos.demo`, an Organization Admin, received HTTP 403 `PLATFORM_OWNER_REQUIRED` from the platform dashboard.
- Owner View As loaded tenant-scoped quotations, products, warehouses, subscriptions, invoices and alerts.
- Explicit View As exit and owner logout succeeded; the test `PlatformOwnerSession` count returned to zero.
- Starting the backend from the repository root loaded `backend/.env`; login as `superadmin` returned HTTP 200 through the Vite `/api` proxy, while an organization credential returned HTTP 401 `INVALID_PLATFORM_CREDENTIALS`.

## Production hardening

- Store owner credentials in a deployment secret manager rather than a filesystem `.env`.
- Add MFA and rotate the owner password before production.
- Replace the process-local login throttle with shared proxy/distributed rate limiting when multiple API replicas are deployed.
- Send failed-login and owner-session events to centralized security monitoring.
- Enforce TLS, Secure cookies and trusted reverse-proxy configuration.
- Define privileged-audit retention/export and immutable storage policy.
- Add PostgreSQL integration and browser end-to-end suites around the unit/component coverage.
