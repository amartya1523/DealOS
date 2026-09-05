# DealOS backend

Independent Express, TypeScript, Prisma, and PostgreSQL application. Requires Node.js 22 (`.nvmrc`).

From this directory:

```bash
cp .env.example .env  # first setup only
npm ci
docker compose -f ../compose.yaml up -d postgres
npm run db:generate
npm run db:migrate
npm run db:seed       # resets demo data; run only when intended
npm run dev
```

`npm run build` compiles to `dist/`; `npm start` runs `dist/src/server.js`. Run `npm test` for backend rule tests. Configuration is loaded from this directory's `.env` when using these npm scripts. Dependencies and the generated Prisma client remain in `node_modules/` here.

Read [agent instructions](docs/agent.md), [project memory](docs/memory.me), and [architecture](docs/Architecture.md) before changes. Shared product contracts and original references are also kept in `docs/` to keep the repository root minimal.
