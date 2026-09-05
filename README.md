# DealOS

DealOS is a browser-based B2B quotation-to-cash workspace built for Indian revenue teams. It brings customer management, quotations, approvals, orders, invoices, payments, subscriptions, warehouse operations, and deal health into one organization-scoped application.

All monetary values are represented in Indian rupees (INR) and displayed using Indian number formatting.

## Product capabilities

- Organization onboarding with email/password or Google authentication
- Environment-authenticated Platform Owner control plane across organizations
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

The full-cycle seed creates 20 named quotation checkpoints plus reconciled orders, invoices, payments, subscriptions, fulfillment/backorders, portal invitations, RFQs, Leads, alerts, audit events, two public business profiles, and Pending/Approved/Declined directory requests. Follow the [full-cycle usability guide](backend/docs/FULL-CYCLE-USABILITY-GUIDE.md) to exercise both the directory onboarding flow and `Q-0102` from approval through customer acceptance, fulfillment, payment, and subscription management.

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
| `PLATFORM_OWNER_SESSION_COOKIE_NAME` | Independent Platform Owner cookie name | `dealos_platform_session` |
| `PLATFORM_OWNER_LOGIN_ID` | Platform Owner login ID | Set explicitly; no secure default |
| `PLATFORM_OWNER_PASSWORD` | Platform Owner password (minimum 16 characters) | Set explicitly; no secure default |
| `GOOGLE_CLIENT_ID` | Google OAuth web client ID | Required for Google authentication |
| `RAZORPAY_KEY_ID` | Razorpay publishable Test Mode key (`rzp_test_…`) | Required for customer payments |
| `RAZORPAY_KEY_SECRET` | Razorpay Test Mode signing secret | Required for customer payments |
| `RAZORPAY_WEBHOOK_SECRET` | Secret used to validate raw Razorpay webhooks | Required for payment reconciliation |
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

### Platform Owner access

The Platform Owner is independent from every organization and cannot sign in with an organization account. Configure its credentials only in the ignored `backend/.env` file:

```dotenv
PLATFORM_OWNER_LOGIN_ID="superadmin"
PLATFORM_OWNER_PASSWORD="set-a-unique-password-of-at-least-16-characters"
```

Restart the backend, then open [http://localhost:5173/login/super-admin](http://localhost:5173/login/super-admin). Platform Owner sessions expire after four hours and use a separate cookie. The control plane can inspect organizations and users and can enter an explicitly read-only View As context; simulated writes are rejected by the backend.

## Demo accounts

After seeding, the following users are available. All demo accounts use the password `DealOS2026!`.

| Role | Email |
| --- | --- |
| Sales representative | `rep@dealos.demo` |
| Collaborating sales representative | `collaborator@dealos.demo` |
| Sales manager | `manager@dealos.demo` |
| Finance | `finance@dealos.demo` |
| Admin | `admin@dealos.demo` |
| Acme customer | `customer@dealos.demo` |
| Beta customer | `buyer@beta.demo` |
| Northstar organization admin | `orgadmin@northstar.demo` |
| Northstar sales representative | `rep@northstar.demo` |
| Northstar sales manager | `manager@northstar.demo` |
| Orion customer | `buyer@orion.demo` |

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
- Separate, environment-authenticated Platform Owner sessions
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
- [Platform Owner administration](backend/docs/PlatformAdmin.md)

## Production checklist

Before deploying:

- Use a managed PostgreSQL database and a production-only `DATABASE_URL`.
- Configure the exact frontend origin in `FRONTEND_ORIGIN`.
- Configure the production Google OAuth client and authorized origin.
- Store Platform Owner credentials in a secret manager and add MFA before production use.
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
