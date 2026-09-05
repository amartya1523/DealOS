# DealOS design and workflow verification

**Audit date:** 5 September 2026 • **Verdict:** Functional foundation present; end-to-end acceptance fails.

The main screens and several basic transitions work, but the application cannot yet be treated as a reliably connected quotation-to-cash system. Customer isolation, commercial recalculation, approval history, stock reservation, and payment consistency have reproducible defects. Several visible controls are placeholders.

## Scope and evidence

Entered the [DealFlow360 reference board](https://app.excalidraw.com/l/65VNwvy7c4X/7Fb5SR3WKu2) using authorized **read-only guest access**. Verified its 18-screen inventory and inspected the approval, portal, fulfillment, billing, invoice, and reporting connections. The board describes the intended product; its drawn buttons are not an executable application.

Compared that design with the local DealOS source, Prisma schema, existing tests, and running application. Browser checks used the Manager and Customer entry paths; all five roles were exercised through the API. Business mutations used synthetic fixtures in a newly created, isolated PostgreSQL schema, which was removed after testing. Existing demo business records were not reseeded or changed by this audit. Browser login/logout created normal development sessions.

| Verification | Result |
|---|---|
| Excalidraw guest access | Passed; room opened with read-only rights |
| Backend production build | Passed on final check |
| Frontend production build | Passed on final check |
| Existing backend tests | 5 passed: rules and signup tests |
| Existing frontend tests | 5 passed |
| Additional workflow/API checks | **44 checks: 24 passed, 20 failed** |
| Browser checks | Reproduced inactive filters/search/exports and incorrect quarterly schedule |
| Complete quote-to-cash acceptance | Failed: no implemented confirmed-order-to-billing generation flow |

These counts describe the checks executed, not a percentage of overall product completion. Some tests use direct database fixtures to isolate a state; the separately named draft-to-approval-to-confirmation check exercises those transitions through HTTP. The billing-link check combines absence of generated invoices with source inspection showing no generation endpoint.

The workspace was changing during the audit. Initial frontend checks encountered a JSX syntax error and the old server on port 5173 referenced missing root dependencies. Subsequent source changes resolved the syntax error; a fresh frontend server on port 5174 rendered successfully. Final builds and tests passed. Treat the early errors as transient observations, not outstanding release findings. Source hashes accompany this report.

## What each screen does and what is missing

“Partial” means the screen exists but its required behavior is incomplete or unsafe. Browser observations are supplemented by source/API review; every control was not exercised through all five role layouts.

| # | Reference screen / purpose | Verified implementation and gap |
|---|---|---|
| 1 | Login / Signup: establish identity and access | Five role logins, logout, pending signup, and inactive-account denial pass. No Admin activation endpoint/UI was found, leaving the pending-to-active handoff incomplete. |
| 2 | Sales Dashboard: show work needing attention | Data and navigation render. Pending count counts approval steps, including blocked Finance steps; it is not a count of actionable cases. Internal dataset lacks owner/team scope. |
| 3 | Quotations List: locate deals by stage | Kanban opens quotations. Search does not filter; list/table switch is missing. Rejected quotations have no Kanban lane. Negotiation state is defined but no transition sets it. |
| 4 | Quotation Detail: prepare commercial terms | Draft save, server price lookup, quantities, discounts, and submission work. Tax/cadence totals, order-discount editing, removal of lines, dirty-edit submission protection, and real recommendation ranking are missing or incorrect. |
| 5 | Approvals List: find review cases | Queue and Review navigation work. Pending/Returned/Approved buttons do not filter; assignee is absent. Returned/rejected cases can retain pending steps. |
| 6 | Approval Detail: explain and decide | Manager-before-Finance, required reason, role checks, and self-approval prevention pass. Routing differs from calculator/policy; revision history is overwritten; full audit trail is absent from this screen. |
| 7 | Fulfillment List: inspect inventory and eligible orders | Warehouse availability and confirmed-deal filtering render. Full per-SKU on-hand/reserved/available table is missing. The unchanged demo has no confirmed record, so detail verification used API/source coverage. |
| 8 | Fulfillment Detail: plan and execute stock split | Allocation writes exist and pre-confirmation allocation is blocked. Preview-before-commit, manual override, receipts, dispatch, and backorder consolidation are missing. Retries and duplicate SKUs corrupt reservations. |
| 9 | Subscriptions List: inspect recurring obligations | List opens billing detail with customer, cadence, amount, and date. Subscription records have no relation to quote/order/product IDs, so provenance is not guaranteed. |
| 10 | Billing Detail: schedule and adjust billing | Existing subscription amount/cancel endpoints exist. Quarterly schedule is displayed monthly. One-time/recurring combined detail, proration preview, credits, and billing execution are absent. |
| 11 | Customer Portal: negotiate and accept | Restricted visual shell and pending-confirmation guard exist. API leaks internal fields and accepts other customers’ IDs. Unsent drafts are returned. Counteroffers change terms without recalculation. No send/version-acceptance boundary exists. |
| 12 | Invoices List: locate receivables | Seeded invoice list and detail link render. Paid/Unpaid filters do nothing. New confirmed deals do not produce invoices through an implemented workflow. |
| 13 | Invoice Detail: reconcile settlement | Partial payments and simple overpayment rejection pass. Retries duplicate records; concurrent payments break the ledger/balance relationship. Payment history and order-to-payment progress are not rendered. |
| 14 | Deal Health: detect and act on risks | Seeded alert display exists. Alerts do not open affected records. Nudge sets a boolean/audit event; no assigned in-app task, live evaluator, acknowledgement, or escalation workflow was found. |
| 15 | Admin Reporting: filter and export metrics | Aggregate chart renders. Filters are not connected; PDF/XLS buttons have no handlers. Cadences are combined without an actual normalization calculation. |
| 16 | Product Dashboard: manage catalog | Catalog and product-detail links render. New Product, Manage Price Lists, and proper variant management are missing. |
| 17 | Product Details: edit sellable configuration | Price/cost update endpoint exists for Admin. Most identity/tax/category fields are disabled, and variant/plan configuration is absent. Historical UI still reads mutable product metadata. |
| 18 | Discount Tiers / Approval Setup: govern decisions | Tier values can be saved. Finance threshold is ignored during submission; no draft/publish/version lifecycle or configurable review chain exists. UI says within-policy deals need no approval, but API always adds Manager. |

## How the linkages currently behave

| Handoff | Current behavior | Required reliable linkage |
|---|---|---|
| Configuration → quotation | Product prices/costs are read on draft save; limits are copied to lines | Snapshot full commercial data and immutable policy version; calculate tax and amounts by cadence |
| Quotation → approval | Quote ID links steps; submission always adds Manager | Bind a calculated review plan to an immutable quotation revision |
| Approval → customer | Customer workspace directly returns matching quote names | Explicitly send an eligible revision; authorize by customer foreign key and safe response fields |
| Customer change → reapproval | Directly modifies order discount and resets existing approval records | Store a proposal; adopted changes create a new calculated revision and a fresh approval cycle |
| Customer acceptance → order | Only changes Quote.stage to CONFIRMED | Create one Order and CustomerAcceptance tied to the approved revision |
| Order → stock | Fulfillment is keyed directly to Quote; reservation increments on every call | Lock stock, reserve outstanding demand once, and retain movement/allocation history |
| Order → billing → subscriptions | Seeded invoices reference a Quote; subscriptions are independent | Generate immutable invoices and subscription schedules from confirmed commercial snapshots |
| Invoice → payment | Payment rows and paidAmount are written together after an unlocked balance read | Idempotent ledger posting with locked balance validation and consistent reconciliation |
| Workflow → health/reporting | Reads aggregates and seeded alerts | Derive scoped alerts and reports from actual events, with links to the exact underlying records |

## Priority defects and repair guidance

### Critical: resolve before exposing real customer or financial data

**C1 — Customer isolation is broken.** An Acme customer session confirmed an Other Company quotation with HTTP 200 and posted a message against it with HTTP 201. The workspace response also contained margin, risk score, line unit cost, product cost, and internal approval reasons. Draft quotations were visible before being sent. Customer listing uses a case-insensitive substring match on a customer name; mutations do not check customer ownership.

**Repair:** Add real Customer foreign keys, scope every read and mutation, introduce a sent-revision boundary, and construct dedicated customer DTOs. Add two-customer tests that assert both access denial and absence of sensitive fields. Source: `backend/src/app.ts:70`, `:150`, `:165`.

**C2 — Inventory can become negative.** Repeating allocation changed reserved stock from 2 to 4 for the same two-unit demand. With 100 on hand, two duplicate 60-unit SKU lines resulted in **124 reserved** including the prior four reservations. The allocator reuses the same availability for each duplicate line, and the endpoint increments on every request.

**Repair:** Aggregate duplicate SKUs, reserve only outstanding demand, apply idempotency keys and transactional row locks, and enforce nonnegative availability at the database boundary. Preserve allocations instead of replacing the fulfillment split after reserving again. Source: `backend/src/app.ts:173`, `backend/src/rules.ts`.

**C3 — Payments can corrupt financial balances.** Repeating a $100 payment reference created two payments and paidAmount $200. Two simultaneous $700 payments against a $1,000 invoice created **$1,400 of ledger entries while paidAmount remained $700**.

**Repair:** Lock the invoice during posting; validate against committed ledger balances; persist idempotency keys with a request fingerprint; define duplicate-reference semantics; add ledger reconciliation and concurrency tests. Source: `backend/src/app.ts:196`.

### High: approval and commercial correctness

**H1 — Negotiation updates the discount but leaves totals and risk stale.** A 50% counteroffer kept total at $164 when the recalculated value was $82; stored risk stayed 8 when it should have been 49. Any message resets approvals, even without a commercial change. The portal normally sends its counter-discount field, initialized to zero, with every request.

**Repair:** Separate comments from commercial proposals. Recalculate accepted proposals using the same backend calculator, snapshot a new revision, and rebuild the required review chain. Never let a comment silently change commercial values. Source: `backend/src/app.ts:150`, `frontend/src/App.tsx:56`.

**H2 — Approval policy and execution disagree.** A within-policy quote still got Manager review. A 5% margin quote did not get Finance, despite the calculator flagging low margin. Setting Finance threshold to 99 still produced Finance at 8 points excess. Submission uses `riskScore > 5`, ignoring the saved threshold and the calculator’s full decision.

**Repair:** Produce and persist one review plan from the versioned policy and authoritative calculation. Use it for the UI explanation and submission. Test line excess, weighted excess, margin floor, exact boundaries, and within-policy auto-approval. Source: `backend/src/app.ts:115`, `backend/src/rules.ts`.

**H3 — Approval history and pending status are misleading.** A counteroffer nulled reviewer reasons and reset both approved steps to Pending. Resubmission deleted the old cycle, leaving only two new steps. Manager rejection left `[REJECTED, PENDING]`; Manager return left a Draft quote with `[RETURNED, PENDING]`. The dashboard counts these pending rows, and also counts Finance before it is actionable.

**Repair:** Add immutable revision/cycle IDs and explicit waiting/actionable/superseded outcomes. Close remaining steps when a case is returned/rejected. Derive queue counts from current eligible cases and reviewer scope. Keep prior decisions and show their audit timeline. Source: `backend/src/app.ts:115`, `:129`, `:150`; `frontend/src/App.tsx:47`, `:50`, `:51`.

**H4 — Internal ownership is not enforced.** A Rep successfully edited an Admin-owned draft with HTTP 200. Internal workspace queries return the complete dataset, without owner/team filters.

**Repair:** Centralize resource-level access checks and team membership. Apply them to lists, detail projections, saves, submissions, decisions, and reporting. UI restrictions should match API permissions. Source: `backend/src/app.ts:70`, `:95`.

**H5 — Quotation calculations mix billing cadences and omit tax.** A $100 one-time service and $40 monthly plan produced one $140 total with no cadence breakdown. The calculation has no tax output despite product taxRate data. Money calculation converts database decimals to JavaScript Number.

**Repair:** Calculate decimal-safe subtotals, taxes, margins, and discounts separately for each cadence; define rounding and snapshot rules. Render those exact totals. Source: `backend/src/rules.ts`, `backend/src/app.ts:95`.

**H6 — Confirmation does not complete the downstream business flow.** Draft → submission → approval → customer confirmation passed, but no Order/Acceptance model exists, no invoice was generated, and no invoice-generation endpoint exists. Subscription records have only descriptive customer/product strings. Stock dispatch and billing execution cannot be tested to completion because those implementations are absent.

**Repair:** Introduce immutable quotation revisions, acceptance, and orders first. Then connect allocation/shipments, invoice generation, recurring schedules, credits, and payments to those IDs. Source: `backend/prisma/schema.prisma`, `backend/src/app.ts:165`.

**H7 — Quarterly billing is shown as monthly.** Beta Industries’ Quarterly plan displayed November 1, December 1, and January 1. Under its quarterly cadence, subsequent dates should advance by three months. Change/cancel actions have no proration or credit preview.

**Repair:** Generate schedules server-side from cadence, billing anchor, timezone, and immutable plan policy. Preview financial adjustments before committing. Source: `frontend/src/App.tsx:55`, `backend/src/app.ts:188`.

### Medium: usability and operational completeness

**M1 — Visible controls are not wired.** Searching `NO_MATCH_AUDIT_2026` left all three quotations visible. Selecting Approved left a pending case displayed. Selecting Paid left an unpaid invoice displayed. Both export buttons did nothing and have no source handlers. Report selectors have no filtering state.

**Repair:** Wire query/filter state to authorized data and URL parameters, render empty states, and implement exports from the same filtered result. Until implemented, clearly disable unfinished actions. Source: `frontend/src/App.tsx:48`, `:50`, `:57`, `:60`.

**M2 — Builder state can disagree with submitted terms.** Submit sends an empty body without saving local line edits. The visible line values can therefore differ from the persisted quotation submitted for approval. Inputs also remain editable on a pending quote, although Save is disabled. This issue is confirmed by source inspection; a browser mutation reproduction was not performed against the existing demo.

**Repair:** Save and submit atomically against the expected version, or require explicit save and show dirty state. Render submitted snapshots read-only. Use persisted prices and the order discount consistently in displayed line amounts. Source: `frontend/src/App.tsx:49`.

**M3 — Seed records do not reconcile.** Q-0102 visibly shows $2,112 + $328 + $1,140 in line nets, totaling $3,580, while the deal total is $3,952. Its invoice already exists while the quote is Pending Approval. Its $80 “Tax adjustment” is not derived from the displayed 18% product tax rates. This makes demo totals poor evidence of workflow correctness.

**Repair:** Generate seeds through authoritative services and add fixture reconciliation assertions. Keep one-time and recurring charges separate. Source: `backend/prisma/seed.ts`, observed quotation/invoice screens.

**M4 — Several required capabilities are missing.** These include Admin activation, price lists, new product creation, variants, warehouse receipts/manual override/dispatch/consolidation, live health evaluation and escalation, customer quotation selection, line-specific discussion IDs, and payment-history UI. Health records do not navigate to the affected quotation. Full details use component state under `/app`, so record-level URLs and browser history are absent.

**Repair:** Complete each missing vertical workflow with API, persistence, UI, permissions, and an acceptance test. Add real record routes and meaningful role-specific actions.

The customer browser check also reproduced stale navigation state: after Manager logout from Fulfillment and Customer login, the customer quotation rendered under the heading “Fulfillment & stock.” Reset the selected view/resource on identity change and use a dedicated portal heading.

Additional source-level hardening gaps include no explicit CSRF enforcement, login rate limiting, request-id audit context, or atomic optimistic-version check on draft writes. These were inspected, not penetration-tested. They should be addressed with the transactional and authorization work above.

## Repair sequence and acceptance criteria

| Order | Work package | Completion criteria |
|---|---|---|
| 1 | Customer/internal authorization and safe responses | Cross-customer reads/actions denied; internal fields absent from customer JSON; owner/team scopes enforced; pending users have a tested activation flow |
| 2 | Commercial revision and approval model | One calculator/immutable policy drives routing; counteroffers recalculate; old decisions remain intact; returned/rejected cases have no actionable pending steps; acceptance binds to the approved revision |
| 3 | Inventory and financial transactions | Duplicate SKU/retry/concurrency tests pass; stock never overreserves; payment ledger equals balance; a confirmed order produces correct one-time/recurring billing; shipment/backorder/credit flows work |
| 4 | UI wiring and operational features | All filters/search/exports work; quarterly dates are correct; dirty edits cannot be silently omitted; health and detail links resolve; missing product/configuration workflows are complete |
| 5 | Final acceptance | Repeat the 44 checks, add regression tests for every defect, and run browser journeys for Rep, Manager, Finance, Admin, and Customer, including returns, rejection, negotiation, shortage, cancellation, and payment retry |

Implement these in dependency order; improving dashboard polish alone will not resolve the broken data relationships.

## Deliverables and limits

- `api-results.json`: named checks and observed results, including exact failure values.
- `workflow-audit.mjs`: repeatable diagnostic harness. From `backend/`, run `node --import tsx docs/audit/workflow-audit.mjs`. It requires the existing generated Prisma client and a PostgreSQL account permitted to create/drop a disposable schema.
- `source-hashes.txt`: source fingerprints for the inspected implementation.

This audit added documentation and a diagnostic harness; it did not implement the recommended fixes. It is a design comparison, focused browser audit, and integration test pass—not a claim that every browser/device, accessibility case, load profile, external integration, or security threat has been tested. Full browser fulfillment execution and financial adjustments remain unverified where the required UI/workflow is absent. No external payment or customer communication was sent.
