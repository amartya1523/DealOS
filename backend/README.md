# DealOS backend

Independent Express, TypeScript, Prisma, and PostgreSQL application. Requires Node.js 22 (`.nvmrc`).

From this directory:

```bash
test -f .env || cp .env.example .env
npm ci
docker compose -f ../compose.yaml up -d postgres
docker compose -f ../compose.yaml exec postgres pg_isready -U dealos -d dealos
npm run db:generate
npm run db:migrate
npm run db:seed
npm run dev
```

`npm run db:seed` resets application data and is only for an intentional local demo reset. It creates two isolated organizations but never creates a Platform Super Admin user. The Platform Owner is authenticated only with `PLATFORM_OWNER_LOGIN_ID` and a password of at least 16 characters from `.env` through `/login/super-admin`; organization accounts cannot use that login.

`npm run build` compiles to `dist/`; `npm start` runs `dist/src/server.js`. Run `npm test` for backend tests. The environment loader resolves `backend/.env` relative to the backend module, so both commands run correctly from this directory and through `npm --prefix backend ...` at the repository root. Deployment-provided environment variables retain precedence. Dependencies and the generated Prisma client remain in `node_modules/` here.

The DealOS assistant uses Groq from the backend so its secret is never sent to the browser. Set `GROQ_API_KEY` in `.env`; `GROQ_MODEL` defaults to `openai/gpt-oss-120b`. Public pages receive product guidance only. Authenticated workspace conversations receive a tenant-scoped snapshot, and invoice creation remains protected by the existing role, CSRF, stock, and audit controls.

## Razorpay Test Mode

Customer portal invoice payments use a backend-created Razorpay order. Add all three values to the ignored `backend/.env` file and restart the API:

```dotenv
RAZORPAY_KEY_ID="rzp_test_your_key_id"
RAZORPAY_KEY_SECRET="your_test_key_secret"
RAZORPAY_WEBHOOK_SECRET="your_test_webhook_secret"
```

Only an `rzp_test_` key is accepted. The key secret and webhook secret stay on the backend; the mobile app receives only the publishable test key with the server-calculated order amount. Apply migrations with `npm run db:migrate` before testing.

For local webhook testing, expose port 4000 with ngrok and configure this Test Mode URL in the Razorpay dashboard:

```text
https://YOUR-NGROK-DOMAIN/api/v1/payments/webhook
```

Subscribe to `payment.captured`, `payment.failed`, and `order.paid`, and set the dashboard webhook secret to exactly the same value as `RAZORPAY_WEBHOOK_SECRET`. Checkout completion and webhook delivery are both idempotent; only a server-verified success contributes to the invoice paid amount.

Read [agent instructions](docs/agent.md), [project memory](docs/memory.me), and [architecture](docs/Architecture.md) before changes. Shared product contracts and original references are also kept in `docs/` to keep the repository root minimal.
