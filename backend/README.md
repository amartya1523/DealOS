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

Read [agent instructions](docs/agent.md), [project memory](docs/memory.me), and [architecture](docs/Architecture.md) before changes. Shared product contracts and original references are also kept in `docs/` to keep the repository root minimal.
