# DealOS

DealOS is a browser-based B2B quotation-to-cash workspace. It connects quotation preparation, discount governance, customer negotiation, multi-warehouse fulfillment, hybrid billing, payments, deal health, and reporting in one auditable flow.

## Stack

- `frontend/`: React 19, TypeScript, Vite, authored CSS
- `backend/`: Node.js, Express 5, TypeScript, Prisma
- PostgreSQL 17 as the authoritative application database

## Start locally

Requirements: Node.js 22 and Docker.

```bash
cp backend/.env.example backend/.env  # first setup only; preserve existing configuration
npm ci --prefix backend
npm ci --prefix frontend
docker compose up -d postgres
npm --prefix backend run db:generate
npm --prefix backend run db:migrate
npm --prefix backend run db:seed
```

Start the servers in separate terminals:

```bash
npm --prefix backend run dev
npm --prefix frontend run dev
```

Open `http://localhost:5173` for the new landing page. Sign in at `/sign-in`, request an account at `/sign-up`, and open the protected workspace at `/app`. New accounts remain pending until administrator activation (activation UI is not implemented yet). Every demo account uses password `DealOS2026!`:

| Role | Email |
|---|---|
| Sales Rep | `rep@dealos.demo` |
| Sales Manager | `manager@dealos.demo` |
| Finance / Operations | `finance@dealos.demo` |
| Admin | `admin@dealos.demo` |
| Customer | `customer@dealos.demo` |

The credentials are development seed data only. Replace the seed and bootstrap process before production use.

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

The implementation is a functional demo of the reference flow with durable PostgreSQL records and role-specific actions. It includes the 18 reference screens and core transitions. Before production deployment, complete the hardening items in `backend/docs/memory.me`, including CSRF enforcement, full quote-revision tables, idempotency storage, transaction locking, production account bootstrap, export generation, and expanded end-to-end coverage.

Frontend hosting must use SPA fallback to `index.html` for `/sign-in`, `/sign-up`, `/app`, and aliases while proxying `/api` to the backend. Apply the pending-account migration with `npx prisma migrate deploy` inside `backend/` before running the updated API.
