# DealOS

DealOS is a browser-based B2B quotation-to-cash workspace built for Indian revenue teams. It brings customer management, quotations, approvals, orders, invoices, payments, subscriptions, warehouse operations, and deal health into one organization-scoped application.

All monetary values are represented in Indian rupees (INR) and displayed using Indian number formatting.

## Product capabilities

- Organization onboarding with email/password or Google authentication
- User creation with generated login IDs and module-level access
- Organization-isolated workspaces and session-based authentication
- Customer management
- Quotations with items, taxes, discounts, margins, and billing cadence
- Approval rules, immutable quotation revisions, and idempotent workflow actions
- Customer-safe quotation views and proposal generation
- Order creation and multi-warehouse stock allocation
- Invoices, subscriptions, and payment recording
- Deal health indicators, activity history, and audit events
- Responsive public landing, login, and signup experiences

## Technology stack

| Layer | Technology |
| --- | --- |
| Frontend | React 19, TypeScript, Vite, GSAP, Lucide React |
| Backend | Node.js 22, Express 5, TypeScript, Zod |
| Database | PostgreSQL 17, Prisma ORM |
| Testing | Vitest, Testing Library, API workflow audit |

## Repository structure

```text
DealOS/
├── backend/
│   ├── docs/                 # Product, domain, database, and API documentation
│   ├── prisma/               # Prisma schema, migrations, and seed data
│   ├── src/                  # Express API and business rules
│   └── tests/                # Backend unit and integration tests
├── frontend/
│   └── src/                  # React application and frontend tests
├── compose.yaml              # Local PostgreSQL service
└── README.md
```

## Prerequisites

- Node.js 22 or later
- npm
- Docker Desktop or a locally available PostgreSQL 17 instance

## Local setup

### 1. Configure the backend

```bash
cd backend
cp .env.example .env
```

The default environment file expects PostgreSQL at `localhost:5432`.

### 2. Install dependencies

```bash
cd backend
npm ci

cd ../frontend
npm ci
```

### 3. Start PostgreSQL

From the repository root:

```bash
docker compose up -d
```

### 4. Generate Prisma Client and run migrations

```bash
cd backend
npm run db:generate
npm run db:migrate
```

### 5. Seed demo data

```bash
npm run db:seed
```

The seed script replaces existing DealOS demo data in the configured database. Do not run it against a database containing information you need to preserve.

### 6. Start the application

Backend:

```bash
cd backend
npm run dev
```

Frontend, in a second terminal:

```bash
cd frontend
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). The API runs at [http://localhost:4000](http://localhost:4000).

## Environment variables

The backend reads the following values from `backend/.env`:

| Variable | Purpose | Local default |
| --- | --- | --- |
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://dealos:dealos@localhost:5432/dealos?schema=public` |
| `PORT` | Backend HTTP port | `4000` |
| `FRONTEND_ORIGIN` | Allowed browser origin for CORS | `http://localhost:5173` |
| `SESSION_COOKIE_NAME` | Authentication cookie name | `dealos_session` |
| `GOOGLE_CLIENT_ID` | Google OAuth web client ID | Required for Google authentication |
| `NODE_ENV` | Runtime environment | `development` |

Never commit real credentials or production secrets.

## Authentication

Users can sign up or sign in using:

- Email and password
- Google authentication
- A generated DealOS login ID and password

For Google authentication:

1. Create a Web application OAuth client in Google Cloud Console.
2. Add `http://localhost:5173` as an authorized JavaScript origin.
3. Set the client ID as `GOOGLE_CLIENT_ID` in `backend/.env`.
4. Restart the backend and frontend development servers.

Google identity tokens are verified by the backend before a session is created.

## Demo accounts

After seeding, the following users are available. All demo accounts use the password `DealOS2026!`.

| Role | Email |
| --- | --- |
| Sales representative | `rep@dealos.demo` |
| Sales manager | `manager@dealos.demo` |
| Finance | `finance@dealos.demo` |
| Admin | `admin@dealos.demo` |
| Customer | `customer@dealos.demo` |

## User access and modules

An administrator can create a user, select permitted modules, and issue a generated login ID. The user can then sign in using that ID and sees only the modules granted to them. Newly generated access users receive the representative role; existing user roles and account status can be managed separately by an administrator.

Available modules include:

- Dashboard
- Quotations
- Approvals
- Fulfillment and stock
- Invoices
- Subscriptions
- Deal health
- Reports
- Products
- Rules

Organization membership and module authorization are validated on the backend; hiding navigation in the frontend is not treated as an access-control boundary.

## Core workflow

```text
Customer
   ↓
Quotation → Approval → Customer decision
                           ↓
                         Order
                           ↓
               Warehouse / Dispatch
                           ↓
                        Invoice
                           ↓
                        Payment
```

Quotation revisions preserve historical versions. Mutation endpoints use CSRF protection and supported workflow operations use idempotency controls to prevent accidental duplicate processing.

## Validation commands

Run backend checks:

```bash
cd backend
npm test
npm run build
```

Run frontend checks:

```bash
cd frontend
npm test
npm run build
```

Run the end-to-end API workflow audit while the backend is running:

```bash
cd backend
node docs/audit/workflow-audit.mjs
```

The audit exercises authentication, organization isolation, user access, quotations, approvals, revisions, orders, invoices, payments, and related authorization rules.

## API and security model

- JSON API served under `/api/v1`
- HTTP-only session cookies
- CSRF token validation for state-changing authenticated requests
- Organization-scoped data access
- Role and module authorization
- Zod request validation
- Immutable audit history for important workflow events
- Liveness and readiness endpoints at `GET /api/v1/health/live` and `GET /api/v1/health/ready`

Detailed contracts and domain behavior are documented in:

- [API documentation](backend/docs/API.md)
- [Domain model](backend/docs/Domain.md)
- [Database design](backend/docs/Database.md)
- [Product requirements](backend/docs/PRD.md)
- [Architecture](backend/docs/Architecture.md)

## Production checklist

Before deploying:

- Use a managed PostgreSQL database and a production-only `DATABASE_URL`.
- Configure the exact frontend origin in `FRONTEND_ORIGIN`.
- Configure the production Google OAuth client and authorized origin.
- Run all Prisma migrations before starting the API.
- Build both applications and run the complete test suite.
- Serve the frontend with SPA fallback to `index.html`.
- Terminate TLS at the platform or reverse proxy.
- Store environment values in the hosting provider's secret manager.
- Do not run the demo seed against production.

## Development guidance

- Keep backend business rules in `backend/src/rules.ts` where practical.
- Update tests whenever authorization or workflow behavior changes.
- Add a Prisma migration for every schema change.
- Preserve organization isolation in every database query.
- Format currency with the `en-IN` locale and `INR` currency code.
