# DealOS

DealOS is a browser-based B2B quotation-to-cash workspace. It connects quotation preparation, discount governance, customer negotiation, multi-warehouse fulfillment, hybrid billing, payments, deal health, and reporting in one auditable flow.

## Stack

- `frontend/`: React 19, TypeScript, Vite, authored CSS
- `backend/`: Node.js, Express 5, TypeScript, Prisma
- PostgreSQL 17 as the authoritative application database

## Start locally

Requirements: Node.js 22 and Docker Desktop. Start Docker Desktop and wait for its engine before running the database commands.

```bash
test -f backend/.env || cp backend/.env.example backend/.env
npm ci --prefix backend
npm ci --prefix frontend
docker compose up -d postgres
docker compose exec postgres pg_isready -U dealos -d dealos
npm --prefix backend run db:generate
npm --prefix backend run db:migrate
npm --prefix backend run db:seed
```

Start the servers in separate terminals:

```bash
npm --prefix backend run dev
npm --prefix frontend run dev
```

Open `http://localhost:5173` for the landing page. Sign in at `/sign-in`, create an organization at `/sign-up`, and open the protected workspace at `/app`. The first account is the active organization administrator and can create module-scoped user access with generated login credentials from the admin workspace. Every demo account uses password `DealOS2026!`:

To enable Google on the sign-up page, create a Google OAuth 2.0 Web client, add the frontend URL (for local development, `http://localhost:5173`) as an authorized JavaScript origin, and set its public client ID as `GOOGLE_CLIENT_ID` in `backend/.env`. Restart the backend afterward. DealOS verifies Google ID tokens server-side against that exact client ID. Google is intentionally offered only on `/sign-up`; `/sign-in` remains email/password only.

| Role | Email |
|---|---|
| Sales Rep | `rep@dealos.demo` |
| Sales Manager | `manager@dealos.demo` |
| Finance / Operations | `finance@dealos.demo` |
| Admin | `admin@dealos.demo` |
| Customer | `customer@dealos.demo` |
| Northstar Organization Admin | `orgadmin@northstar.demo` |
| Northstar Sales Rep | `rep@northstar.demo` |

The credentials are development seed data only. Replace the seed and bootstrap process before production use.

The Platform Super Admin is an independent Platform Owner identity, not an organization user. Configure it only in ignored `backend/.env`:

```dotenv
PLATFORM_OWNER_LOGIN_ID="superadmin"
PLATFORM_OWNER_PASSWORD="set-a-unique-password-of-at-least-16-characters"
```

Open `http://localhost:5173/login/super-admin`. Organization credentials are rejected by this endpoint. Owner login uses a separate four-hour session and can inspect every organization or enter an explicitly read-only View As context.

## Commands

```bash
npm --prefix backend run build
npm --prefix frontend run build
npm --prefix backend test
npm --prefix frontend test
npm --prefix backend run start       # compiled API after backend build
npm --prefix backend run db:migrate
npm --prefix backend run db:seed      # resets demo data; run only when intended
```

Each application owns its `package.json`, lockfile, `node_modules/`, `.nvmrc`, compiler configuration, tests, and build output. Run `npm ci` inside an application directory or use `--prefix` as above; there is no root npm workspace. Backend configuration lives in `backend/.env`. Any future browser environment configuration belongs in `frontend/.env` and must contain only public values.

```text
DealOS/
├── frontend/          # React application and its dependencies
├── backend/           # API, Prisma, environment, dependencies, and docs/
├── compose.yaml       # local PostgreSQL
├── .gitignore
└── README.md
```

## Architecture and handoff

Read [agent instructions](backend/docs/agent.md) and [project memory](backend/docs/memory.me) before making changes. The detailed product and technical contracts are under `backend/docs/`, beginning with [PRD.md](backend/docs/PRD.md) and [Architecture.md](backend/docs/Architecture.md).

## Current scope

The implementation is a functional demo with durable PostgreSQL records, organization isolation, revision-bound quote workflows, CSRF protection, selected idempotency/locking controls, Google organization signup and an environment-authenticated Platform Owner control plane. Before production deployment, complete the remaining hardening items in `backend/docs/memory.me`, including a secret manager, MFA, distributed throttling, export generation and expanded end-to-end coverage.

Frontend hosting must use SPA fallback to `index.html` for `/sign-in`, `/sign-up`, `/login/super-admin`, `/app`, and aliases while proxying `/api` to the backend. Apply all committed migrations with `npm --prefix backend run db:migrate` before running the API.
