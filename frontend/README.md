# DealOS frontend

Independent React and TypeScript application for the internal workspace and restricted customer portal. Requires Node.js 22 (`.nvmrc`).

From this directory:

```bash
npm ci
npm run dev
```

Vite serves the UI at `http://localhost:5173` and proxies `/api` to the backend at `http://localhost:4000`. Start the backend separately following [its README](../backend/README.md).

Run `npm run build` for production assets in `dist/`, and `npm test` for component tests. Dependencies, lockfile, configuration, source, and tests belong to this directory. Future browser environment files belong here and must contain only public values.

Shared [agent instructions](../backend/docs/agent.md), [project memory](../backend/docs/memory.me), and [product contracts](../backend/docs/PRD.md) apply to both applications.
