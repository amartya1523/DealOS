# DealOS

DealOS is a browser-based B2B quotation-to-cash workspace. It connects quotation preparation, discount governance, customer negotiation, multi-warehouse fulfillment, hybrid billing, payments, deal health, and reporting in one auditable flow.

## Stack

- `frontend/`: React 19, TypeScript, Vite, authored CSS
- `backend/`: Node.js, Express 5, TypeScript, Prisma
- PostgreSQL 17 as the authoritative application database

## Start locally

Requirements: Node.js 22 and Docker Desktop. Start Docker Desktop and wait until its engine reports that it is running before executing the database commands.

If `backend/.env` does not exist yet, the first command creates it without overwriting an existing configuration:

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

Open `http://localhost:5173` for the landing page. Sign in at `/sign-in`, request an account at `/sign-up`, and open the protected workspace at `/app`. New accounts remain pending until a Platform Super Admin activates them. Every seeded demo account uses password `DealOS2026!`:

| Role | Email |
|---|---|
| Sales Rep | `rep@dealos.demo` |
| Sales Manager | `manager@dealos.demo` |
| Finance / Operations | `finance@dealos.demo` |
| Organization Admin | `admin@dealos.demo` |
| Customer | `customer@dealos.demo` |
| Northstar Organization Admin | `orgadmin@northstar.demo` |
| Northstar Sales Rep | `rep@northstar.demo` |

The Platform Super Admin is an independent Platform Owner identity and is not one of these organization users. Its credentials exist only in `backend/.env`:

```dotenv
PLATFORM_OWNER_LOGIN_ID="superadmin"
PLATFORM_OWNER_PASSWORD="set-a-unique-password-of-at-least-16-characters"
```

Open `http://localhost:5173/login/super-admin` to authenticate with those values. Organization login IDs and passwords are always rejected by the Platform Owner endpoint. A successful login uses a separate four-hour session and clears any organization-user session in that browser.

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

The implementation is a functional demo of the reference flow with durable PostgreSQL records, role-specific actions, organization isolation and an environment-authenticated Platform Owner control plane. Same-origin CSRF enforcement, independent owner sessions and owner-login throttling are implemented. Before production deployment, complete the remaining hardening items in `backend/docs/memory.me`, including full quote-revision tables, idempotency storage, transaction locking, external invitation/reset delivery, export generation, MFA and expanded end-to-end coverage.

Frontend hosting must use SPA fallback to `index.html` for `/sign-in`, `/sign-up`, `/login/super-admin`, `/app`, and aliases while proxying `/api` to the backend. Apply all committed migrations with `npm --prefix backend run db:migrate` before running the API.
