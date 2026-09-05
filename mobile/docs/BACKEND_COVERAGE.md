# Backend-to-mobile coverage

Inventory date: 2026-09-05. Source inspected: actual routes in `backend/src/app.ts` and `backend/src/platform.ts`, plus `backend/docs/API.md`. “Integrated” means the mobile app calls the real endpoint. “Workspace” means the screen reads the real tenant-scoped `/workspace` projection. “Backend gap” means the documented product capability has no implemented route and is not simulated.

## Implemented endpoint coverage

| Capability | Actual endpoint | Backend role | Mobile surface | Operation | Status |
|---|---|---|---|---|---|
| Liveness/readiness | `GET /health/live`, `/health/ready` | Public | Operational setup only | Read | Available; not a user screen |
| Organization signup | `POST /auth/signup` | Public | Sign-up dialog | Write | Integrated |
| Password login | `POST /auth/login` | Public | Organization sign in | Write | Integrated |
| Google configuration/signup/login/customer | `GET /auth/google/config`; `POST /auth/google/*` | Public | — | Read/write | Backend available; native Google client not configured |
| Platform Owner login | `POST /auth/super-admin/login` | Environment owner | Dedicated sign in | Write | Integrated |
| Restore identity | `GET /auth/me` | Any session | Launch/resume gate | Read | Integrated |
| Platform identity | `GET /auth/super-admin/me` | Platform Owner | Session middleware | Read | Covered through `/auth/me`; dedicated route available |
| Logout/revocation | `POST /auth/logout` | Any session | Account menu | Write | Integrated; local protected state always cleared |
| Organization user directory/detail | `GET /admin/users`, `/admin/users/:id` | Admin | Members | Read | Workspace list integrated; detail endpoint not needed for current projection |
| Provision internal user | `POST /admin/users` | Admin | New member dialog | Write | Integrated |
| Change status/role/modules | `PATCH /admin/users/:id` | Admin | Member editor | Write | Integrated |
| Tenant workspace projection | `GET /workspace` | Any active identity | All tenant/customer screens | Read | Integrated |
| Customer create/update | `POST /customers`; `PATCH /customers/:id` | Admin, Manager | Customers | Write | Integrated |
| Customer portal invitation | `POST /customers/:id/portal-invite` | Admin, Manager | Customer editor | Write | Integrated |
| Quote create/draft/submit/send | `POST /quotations`; `PUT /quotations/:id/draft`; `POST .../submit`; `POST .../send` | Rep, Admin | Quote list/detail | Read/write | Integrated |
| Approval decision | `POST /approvals/:id/decision` | Manager, Finance, Admin per active step | Approval detail | Write | Integrated; reason required |
| Customer comment/counteroffer | `POST /portal/quotations/:id/message` | Customer | Customer quote room | Write | Integrated |
| Counteroffer adopt/decline | `POST /quotations/:id/proposals/:proposalId/respond` | Rep, Admin | Quote activity | Write | Integrated |
| Approved revision confirmation/order | `POST /portal/quotations/:id/confirm` | Customer | Customer quote detail | Write | Integrated |
| Warehouse stock | `GET /warehouses/stock` | Internal fulfillment roles | Fulfillment | Read | Equivalent live stock is integrated through `/workspace` |
| Warehouse settings | `PATCH /warehouses/:id` | Admin | Warehouse action dialog | Write | Integrated; reason required |
| Stock receipt | `POST /warehouses/:id/restock` | Finance, Admin | Warehouse action dialog | Write | Integrated; reason required |
| Fulfillment list | `GET /fulfillment` | Internal fulfillment roles | Fulfillment orders | Read | Equivalent scoped order/fulfillment data uses `/workspace` |
| Fulfillment preview/detail | `GET /fulfillment/:quoteId/preview`, `GET /fulfillment/:quoteId` | Internal fulfillment roles | Fulfillment detail | Read | Integrated |
| Suggested/manual allocation | `POST /fulfillment/:quoteId/allocate`, `/allocate-manual` | Finance, Admin | Fulfillment detail | Write | Integrated; fingerprint/idempotency/reason applied |
| Backorder consolidation | `POST /fulfillment/:quoteId/consolidate-backorder` | Finance, Admin | Fulfillment detail | Write | Integrated |
| Invoice create | `POST /invoices` | Finance, Admin | Invoice list | Write | Integrated |
| Invoice PDF | `GET /invoices/:id/pdf` | Authorized invoice actor | Invoice detail | Download | Integrated to app documents directory |
| Finance payment record | `POST /invoices/:id/payments` | Finance, Admin | Invoice detail | Write | Integrated |
| Customer payment | `POST /portal/invoices/:id/pay` | Customer | Customer invoice detail | Write | Integrated; backend records simulated portal payment, not a gateway transfer |
| Customer due-date request | `POST /portal/invoices/:id/request-change` | Customer | Customer invoice detail | Write | Integrated |
| Subscription change/lifecycle | `POST /subscriptions/:id/change` | Admin | Subscriptions | Write | Integrated; reason required |
| Health nudge/escalate/resolve | `POST /alerts/:id/nudge`, `/escalate`, `/resolve` | Authorized internal roles | Deal health | Write | Integrated |
| Product create/update | `POST /products`; `PATCH /products/:id` | Admin | Product catalogue | Write | Integrated |
| Policy publish | `PATCH /policies/:id` | Admin, Manager | Policies | Write | Integrated with all ceilings and reason |
| Platform dashboard | `GET /platform/dashboard` | Platform Owner | Global dashboard | Read | Integrated |
| Platform organization detail | `GET /platform/organizations/:id` | Platform Owner | Organization dialog | Read | Integrated |
| Organization create/update/status | `POST /platform/organizations`; `PATCH .../:id` | Platform Owner | Global dashboard | Write | Integrated; confirmation/reason applied |
| Global member search | `GET /platform/members` | Platform Owner | Global users | Read | Integrated with backend paging limit |
| Platform invitation | `POST /platform/invitations` | Platform Owner | Organization dialog | Write | Integrated |
| Assign existing member | `POST /platform/organizations/:id/members` | Platform Owner | Organization dialog | Write | Integrated |
| Membership role/status | `PATCH /platform/memberships/:id` | Platform Owner | Organization detail | Write | Integrated; confirmation/reason applied |
| Global user status/reset | `PATCH /platform/users/:id/status`; `POST .../reset-access` | Platform Owner | Global user dialog | Write | Integrated |
| Read-only View As/exit | `POST /platform/view-as`, `/view-as/exit` | Platform Owner | Organization/global shells | Write context | Integrated with tenant-cache purge |

## Role-to-screen and action matrix

| Role | Primary mobile screens | Authorized mobile actions | Explicit exclusions |
|---|---|---|---|
| Platform Owner | Global metrics, organizations, global users, privileged audit, organization detail | Create/suspend/archive organization, invite/assign/change memberships, disable/reset users, enter read-only View As | No organization writes while viewing as; no secrets or arbitrary database access |
| Organization Admin | Dashboard, customers, products, quotes, fulfillment, subscriptions, invoices, health, reports, policies, members, audit | Configuration, member access, quote work, invoice creation/payment, subscription lifecycle, warehouse settings | Approval still follows backend step/self-approval rules |
| Sales Rep | Personal dashboard, own quotes, catalogue when module-enabled, health, fulfillment status | Create/edit/submit/send quote; adopt/decline counteroffer; nudge alerts | Cannot approve own quote, allocate stock, record payments, or administer members |
| Sales Manager | Team dashboard/quotes, approval inbox, customers, policies, health, reports | Manager decision with reason; customer/policy management | Cannot record Finance decision unless backend role is Finance; no subscription lifecycle |
| Finance/Operations | Finance dashboard, approval inbox, fulfillment, invoices, reports | Finance decision, stock receipt, allocation/override, invoice/payment | No quote authoring or subscription administration |
| Customer | My quotes, invoices, plans | Comment, structured counter-discount, confirm exact approved/sent revision, pay/request due-date change, download invoice | No cost, margin, risk, reviewer notes, internal comments, supplier/warehouse stock, users, policy, audit, or unrelated records |

## Backend gaps and limitations

- No ordinary-user organization switch endpoint or multiple active organization memberships are exposed to the business session. Mobile cannot safely invent organization switching. Platform Owner View As is the only implemented context switch and is read-only.
- No access-token/refresh-token API exists. Session restoration reuses the revocable opaque cookie until backend expiry; a 401 returns to sign in.
- No MFA/OTP challenge contract exists.
- No WebSocket, SSE, push token registration, notification feed, or notification deep-link contract exists. Mobile uses foreground/resume refresh and does not simulate notifications.
- `/workspace` is an aggregate, unpaginated read. The mobile UI filters locally after the backend scopes it, but large-data cursor pagination, server search/sort, cancellation, and per-resource detail endpoints need backend support.
- The documented catalogue variants, price lists, customer tiers as first-class resources, teams, recommendation pairings, complete quote revision diff/history DTOs, and configurable approval-chain endpoints are not implemented as actual routes.
- Shipment creation/dispatch/delivery tracking is not implemented. Current fulfillment covers preview, reservation/allocation, stock receipt, and backorder consolidation.
- Credit-note, refund, proration preview/commit, recurring invoice jobs, and payment-gateway reconciliation endpoints are not implemented. The existing subscription endpoint supports amount and pause/resume/cancel only.
- Filtered reporting endpoints and PDF/XLS exports are not implemented. The mobile report shows clearly labeled aggregates derived from the already-authorized workspace and does not offer exports.
- The backend alert mutations exist, but a durable notification/task inbox is not exposed.
- Google endpoints accept a Google ID credential, but this app does not ship a native OAuth client ID/configuration. Password authentication is fully integrated.
- API documentation describes a larger target API than the current Express route implementation. This matrix reflects runtime code, not unimplemented target contracts.

## Production hardening recommendations

Add backend-native mobile origin/app-attestation policy instead of reusing the browser Origin allowlist; add MFA, native Google client configuration, certificate pinning policy and centralized redacted telemetry; split `/workspace` into cursor-paginated resources; add real notification registration and reconciliation; implement missing financial/shipment contracts; use release keystore/provisioning through CI; run the opt-in integration suite against disposable PostgreSQL and representative devices; add accessibility/device-lab and performance profiling for production data volumes.
