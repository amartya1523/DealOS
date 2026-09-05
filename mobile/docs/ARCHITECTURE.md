# Mobile architecture

DealOS mobile is a feature-first Flutter application. `lib/app` owns composition and routing; `lib/core` owns environment, transport, secure session storage, errors, formatting, theme, and shared widgets; feature folders own authentication, workspace/domain DTOs, quotations, approvals, fulfillment, billing, and administration.

The UI depends on typed immutable domain projections and repositories. `SessionController` is the Riverpod application boundary: it restores identity, loads the authorized workspace, blocks unsafe offline writes, performs mutations, refreshes authoritative server state, and clears protected state on revocation. GoRouter owns route state. Detail routes resolve records only from the active scoped workspace, preventing a deep link from widening access.

The existing backend uses cookie sessions, not access/refresh tokens. `ApiClient` captures only cookie name/value pairs from `Set-Cookie`, stores them through platform secure storage, adds the exact configured Origin and CSRF token, emits request IDs, parses the standard success/error envelope, and maps failures to safe UI messages. It does not log bodies or credentials. There is no automatic retry for mutations.

The backend remains authoritative for prices, taxes, totals, margin, risk, approval routing, revisions, stock, fulfillment, invoices, subscriptions, payments, roles, and tenant scope. Draft line arithmetic shown before saving is only a labeled display preview; every successful mutation reloads `/workspace`.

Responsive navigation uses a bottom bar plus drawer on phones and a navigation rail on wide layouts. The customer experience has a separate destination set and safe detail projections. Material 3 colors reuse the website’s graphite, warm cream, coral, amber, green, and violet tokens and follow system light/dark mode.

The encrypted workspace cache is deliberately single-context. A successful refresh overwrites it; logout, session revocation, and View As changes remove it. Network failures may retain the already-visible projection in read-only mode with its synchronization time. The backend exposes no WebSocket, SSE, push-registration, or notifications feed, so the app revalidates on resume and user refresh instead of simulating real-time delivery.
