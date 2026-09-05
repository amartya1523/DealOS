# DealOS — Domain model and business rules

Status: design baseline. C/I/P classifications refer to [PRD.md](PRD.md). Proposed defaults are decisions for the initial implementation, not facts claimed from the source.

## Glossary

| Term | Meaning and context | Relationship |
|---|---|---|
| Customer | Buying business, assigned to a sales team and pricing tier | Has contacts, quotations and orders |
| Customer tier | Pricing/discount classification, e.g. Bronze/Silver/Gold | Referenced by price lists and policy versions |
| Product | Sellable hardware, service or subscription offering; this is domain language in the brief | Has category, variants and price rules |
| Product variant | Purchasable combination of attribute values with SKU and price adjustments | Stock balances and quote lines reference it |
| Price list | Effective pricing rules scoped to tier and currency | Resolved and snapshotted into quote lines |
| Quotation | Stable deal identity and owner; current revision can change | Has immutable submitted revisions |
| Quotation revision | Complete commercial snapshot: lines, terms, currency, prices, discounts and policy | Approval and acceptance bind to this ID |
| Effective discount | Combined line/order reduction relative to snapshotted list price | Used for risk, not just the visible line percentage |
| Blended risk | Explainable combination of worst-line and aggregate policy checks | Selects required approval route |
| Approval case | Required review of one quotation revision under one policy version | Has ordered Manager/Finance steps |
| Customer proposal | Request to change commercial terms; not an accepted order | Rep can adopt it as a new revision |
| Acceptance | Customer agreement to one exact revision | Can create an order only with matching approval |
| Sales order | Executable snapshot of accepted and approved terms | Owns fulfillment lines and billing obligations |
| Reservation | Stock committed to an order line in a warehouse | Reduces availability, not physical on-hand |
| Allocation | Suggested or accepted mapping from order quantities to warehouses | Accepted allocations create reservations |
| Shipment | Dispatch of reserved physical quantities | Reduces on-hand and reservations atomically |
| Backorder | Unfulfilled quantity after allocation/shipment | Can be consolidated after stock receipt |
| Subscription | Recurring obligation created from a recurring order line | Has plan/rule snapshot and billing periods |
| Billing period | Half-open interval [start, end) in a configured billing timezone | Unique recurring invoice charge per subscription/period |
| Proration | Charge/credit for part of a period after an effective change | Creates an adjustment, never silently rewrites an issued invoice |
| Invoice | Issued receivable with immutable financial lines | Has payment allocations and credit-note allocations |
| Recorded payment | Ledger evidence entered by Finance; not a gateway money transfer | Reduces invoice balance through an allocation |
| Credit note | Audited reversal/adjustment of invoice value | Does not itself prove cash refund execution |
| Deal-health alert | Current actionable stalled/discount/slippage condition | Links to quote/order and can generate in-app tasks |
| Audit event | Append-only actor/time/action/reason record | Links to affected domain resource and request ID |

## Actor matrix

| Actor | Goal / decisions | Visible information | Allowed actions | Restrictions / outputs |
|---|---|---|---|---|
| Sales Rep | Build viable deals and respond to negotiation | Own/assigned-team quotes and customer context; internal margin | Draft, revise, submit, send, propose, inspect allocation | Cannot approve own deal, change stock or record payments; receives stage/risk explanations |
| Sales Manager | Protect team pricing and progress | Team quotes, risk, review history, health, team reports | Approve/reject/return eligible step; configure approval policy | Cannot review a case they submitted; cannot skip Finance; receives reasons and audit |
| Finance/Operations | Control high-risk discounts, stock and receivables | Approved commercial details, stock, invoices, plans | Second review, allocate, ship, receive stock, change subscriptions, record payment/credit | Sequential approval and immutable ledger restrictions; receives reconciliation results |
| Customer | Understand and agree commercial offer | Own business's sent quotes, allowed terms/comments and invoices | Submit proposal/comment, accept current revision | Cannot access draft quotes, other customers, internal notes/cost/risk; receives confirmation/pending-review state |
| Admin | Maintain correct setup and identities | Organization configuration, identities and reports | Activate accounts; assign roles/team/customer links; configure catalog, warehouses/plans/policies | No implicit reviewer bypass; cannot edit issued financial history; receives configuration audit |
| Platform Super Admin / Platform Owner | Securely oversee the complete installation | Global organization/member and tenant operational summaries | Create/suspend/archive organizations; manage memberships; inspect records; enter read-only View As | Independent environment identity and session, never an organization user or role; privileged mutations are audited |
| System scheduler | Process due billing and health rules | Only job-required domain data | Claim due jobs, generate recurring invoices, resolve/reopen alerts | No interactive login; transaction/idempotency protections apply; receives durable job status |

## Entities and relationships

Customer 1→N Quotation; Quotation 1→N Revision; Revision 1→N Line; Revision 1→N ApprovalCase (at most one active); Case 1→N ordered Step. Revision 0→1 Acceptance and 0→1 SalesOrder. CustomerProposal references an exact revision and its lines. Product 1→N Variant; Variant N↔N Warehouse through StockBalance. Order 1→N OrderLine; OrderLine 1→N Reservation/ShipmentLine and 0→1 Subscription for recurring lines. Subscription 1→N BillingPeriod; Invoice 1→N InvoiceLine; Payment N↔N Invoice through allocations. Detailed fields and constraints belong to [Database.md](Database.md).

## Lifecycles and invariants

Quotation revision: `DRAFT → SUBMITTED → SENT → SUPERSEDED` describes document publication; rejection/return creates a new editable draft revision. Approval case: `PENDING → APPROVED | REJECTED | RETURNED | SUPERSEDED`; steps execute in sequence. Customer review: `NOT_SENT → SENT → UNDER_NEGOTIATION → ACCEPTED | SUPERSEDED`. A consolidated pipeline stage is derived, not a freely writable authorization field.

Order: `CONFIRMED → PARTIALLY_FULFILLED → FULFILLED`; cancellation of unshipped balance is a distinct audited operation. Billing status runs independently. Subscription: `PENDING → ACTIVE → CANCELED`; a plan modification is a dated change event. Pause/resume is shown in the mockup but not specified by B7; defer it until billing semantics are approved rather than implement a misleading button.

Invoice: `DRAFT → ISSUED → PARTIALLY_PAID → PAID`, with credit-adjusted balance and a separate void state for legally eligible unposted drafts. Issued invoices are not editable. Alerts: `OPEN → ACKNOWLEDGED → RESOLVED`; recurrence may reopen a resolved alert with history.

## Workflow definitions

### W-01 Identity and access

- Trigger/actor: internal email/password signup, Google signup, email/password login, Admin activation, or provisioned Customer login.
- Input: email/password or a Google Identity Services ID credential on sign-up; authenticated Admin supplies roles and team/customer link.
- Processing/logic: hash passwords, normalize email, verify Google token signature/audience/expiry and verified email server-side, rate limit, deny inactive accounts; rotate session on login. Public signup grants no active privileged role. Google is not exposed as a sign-in method.
- Database: user, role assignment, password hash, session token hash, audit.
- Output: session cookie and minimal identity/permission projection.
- Failure/recovery: generic invalid-credential response; expired session forces login; Admin activates pending signup. No fallback demo identity.

### W-02 Sales backend configuration

- Trigger/actor: Admin configures products/prices, tier/category caps, warehouses/stock and subscription plans; Manager may configure discount policy.
- Input: validated category/variant, fixed-precision price/cost, plan cadence, ceilings, approval thresholds, stock adjustment reason.
- Processing/logic: validate completeness, publish policy version, reject impossible ranges; archived referenced products remain in historical snapshots.
- Database: configuration tables, stock movement ledger, policy version and audit in transaction.
- Output: selectable active catalog, operational stock availability and effective policy.
- Failure/recovery: invalid overlapping rules rejected; stale update gives 409; correct and retry with latest version. Prior published policy remains effective on failure.

### W-03 Prepare quotation and suggestions

- Trigger/actor: Rep creates quote for accessible customer, edits draft or adopts proposal.
- Input: variant/quantity, requested discounts, cadence, commercial dates; never client-authoritative prices/margin.
- Processing/logic: resolve pricing; combine discounts; snapshot costs/tax/plan; compute margin by cadence; rank suggestions. Draft preview uses same pure calculator as persistence.
- Database: quote, draft revision/lines and audited saves; suggestion dismissals scoped to revision/user.
- Output: calculated lines/totals, risk explanation, suggestions and draft revision token.
- Failure/recovery: inactive product or missing cost/price rule prevents submit; return field error; stale revision conflict requires refresh and explicit reconciliation.

### W-04 Evaluate and approve discounts

- Trigger/actor: submit by Rep or submission of revised commercial terms.
- Input: current revision ID, expected version, reason.
- Processing/logic: freeze snapshot and policy, compute risk, create ordered steps or auto-approve. Manager then Finance when needed; no self-approval.
- Database: submission, approval case/steps and audit in one transaction.
- Output: required reviewers and per-line/aggregate reasons.
- Failure/recovery: missing reviewer leaves clearly blocked case, never auto-approves. Rejected/returned cases need a new revision. Repeated decision returns existing result only for identical idempotency key/body.

### W-05 Customer review, negotiation and acceptance

- Trigger/actor: Rep sends eligible quotation; linked Customer comments/proposes/accepts; Rep adopts/rejects proposal.
- Input: exact sent revision, line IDs and proposed terms; acceptance includes revision ID and expected version.
- Processing/logic: proposals do not overwrite prices; adoption creates revision and invalidates prior commercial authorization. Evaluate before execution. Acceptance of pending-review terms may be recorded as conditional; never dispatch until matching approval succeeds.
- Database: comment/proposal, new revision and approval case if adopted; acceptance plus unique order creation transaction when eligible.
- Output: customer-safe terms, proposal response and confirmed/pending-approval status.
- Failure/recovery: stale acceptance returns 409 with current revision ID; expired quotation cannot be accepted; retry cannot create duplicate orders.

### W-06 Fulfillment and backorders

- Trigger/actor: order confirmation creates allocation demand; Operations requests preview/commit/override; stock receipt prompts re-evaluation.
- Input: order version and quantities per warehouse; override reason; shipment reservation IDs.
- Processing/logic: compute available=on-hand−reserved; prefer fewer/cost-weighted shipments with deterministic ties; preview makes no promises. Commit locks stock in sorted order, validates again and reserves. Shipment atomically consumes physical and reserved stock.
- Database: allocation version, reservations, stock movements, shipment lines, backorder remainder and audit.
- Output: accepted split, estimated cost and outstanding demand; consolidation prompt for unshipped remainder.
- Failure/recovery: stock race produces fresh preview/409; no negative stock. Partial operations roll back; shipped stock never moves during consolidation.

### W-07 Hybrid billing and subscription changes

- Trigger/actor: confirmed order, due billing job, Finance change/cancel request.
- Input: order line snapshots; effective change date; plan/quantity; expected version and reason.
- Processing/logic: separate one-time and recurring buckets; generate period keys; actual-period day proration; credit only according to snapshotted plan rules; sequential calendar advancement.
- Database: subscriptions, periods, invoice/lines, change event and credit notes atomically.
- Output: invoice amounts, next bill dates, charge/credit preview and committed schedule.
- Failure/recovery: duplicate job is a no-op with existing invoice; invalid effective date rejected; failed transaction retains due job for bounded retry. No fake payment-provider refund.

### W-08 Invoice and recorded payment

- Trigger/actor: Finance issues eligible invoice and records verified offline payment.
- Input: invoice/version, amount/currency/date/reference, idempotency key.
- Processing/logic: validate positive amount and remaining balance under lock; derive status from posted allocation and credit totals.
- Database: immutable payment, allocation and audit in one transaction; no external transfer.
- Output: receipt record, new balance and invoice status.
- Failure/recovery: overpayment rejected in initial scope; retries with same key/body return same receipt; correction uses audited reversal, not deletion.

### W-09 Deal health and nudges

- Trigger/actor: scheduled evaluation; Manager/Rep opens dashboard or acts on alert.
- Input: inactivity threshold, baseline sample policy, promise/fulfillment state.
- Processing/logic: derive stalled and slipped conditions; flag discount outliers only with adequate sample; deduplicate active alerts; nudge creates internal task/notification.
- Database: rule config, alert lifecycle, notification/job and audit.
- Output: actionable alert with reason, timestamp and authorized deep link.
- Failure/recovery: job lease/retry; unavailable baseline is shown as insufficient data; repeat nudge is idempotent. No imaginary delivery success.

### W-10 Reports and exports

- Trigger/actor: authorized Rep/Manager/Finance/Admin requests report/export.
- Input: bounded date range, rep/team, approval state, product/category and requested format.
- Processing/logic: apply permission scope before aggregation; use same snapshot for screen/export; separate currency and recurring cadence; neutralize spreadsheet formula cells.
- Database: read committed records; optional export job/audit for large exports.
- Output: filtered totals, approval duration and upsell attribution, PDF/XLS file.
- Failure/recovery: invalid filters rejected; large range constrained or queued; failed export does not report ready. No unbounded full-database download.

## Numbered business rules

Each rule includes condition, behavior, reason, ownership, workflow and edge cases.

### BR-001 — Authoritative prices and money [I]
Condition: quote preview/save/submit. Behavior: backend resolves price and calculates using decimal arithmetic; API money is decimal string, currency ISO code. Reason: client manipulation/rounding must not change terms. Owner: quotations/pricing; W-03. Edge cases: no currency conversion, reject negative/NaN amounts; round line totals with a documented half-up currency scale; preserve calculation snapshot.

### BR-002 — Combined discount [C/I]
Condition: line discount `l` and order discount `o` apply. Behavior: proposed sequential composition `effective = 1 − (1−l)(1−o)`; allocate order discount to eligible lines and evaluate the resulting rate. Reason: an order discount must not bypass line policy. Owner: pricing/governance; W-03/04. Edge cases: 10% + 10% becomes 19%, not 20%; 100% discount has explicit zero-revenue/margin handling; excluded charges are disclosed.

### BR-003 — Effective ceiling [C/P]
Condition: both tier and category caps exist. Behavior: proposed effective cap is `min(tierCap, categoryCap)` unless an explicit versioned override exists. Reason: preserve stricter category protection demonstrated by Gold services example. Owner: governance; W-04. Edge cases: missing rule blocks submission rather than unlimited discretion.

### BR-004 — Explainable blended risk [C/P]
Condition: quote submission or commercial revision. Behavior: for each line compute excess points `e=max(0,effectiveDiscount−cap)`; compute `worst=max(e)` and `weighted=Σ(baseValue×e)/Σ(baseValue)` within comparable cadence/currency buckets. Route to the highest level from any worst-line band, weighted band, aggregate-discount ceiling or minimum-margin breach. Any excess requires at least Manager. Reason: a small violating service line cannot disappear in an average, and aggregate rules cover margin erosion. Owner: governance; W-04/05. Edge cases: zero base value blocks undefined ratios; multiple small excesses still require review; incomparable monthly/yearly/one-time revenue is never directly summed. **Proposed example defaults:** Finance if worst exceeds 5 percentage points, weighted exceeds 3 points or configured minimum margin is breached. These values are seed policy, not hardcoded constants or source requirements. Service 18% vs 10% yields excess 8 and Finance under these defaults. Store all component values and policy version; do not display an invented opaque score as fact.

### BR-005 — Revision-bound authorization [I]
Condition: any commercial term changes after submit/send. Behavior: create a new revision; previous approval/acceptance cannot execute revised terms. Reason: prevent approval bypass. Owner: quotations/governance/portal; W-04/05. Edge cases: internal-only comments do not invalidate terms; draft optimistic version increments; archived policy still explains historical approval.

### BR-006 — Sequential independent review [C/I]
Condition: active approval step. Behavior: only assigned role/scope acts; Finance waits for Manager; author/submitter cannot self-approve; reason required for all decisions. Reason: pricing governance and audit. Owner: governance; W-04. Edge cases: Admin needs reviewer role; unavailable reviewer blocks visibly; concurrent decisions yield one winner.

### BR-007 — Acceptance and confirmation [C/I]
Condition: customer accepts or approval completes for conditionally accepted terms. Behavior: require current unexpired revision, correct customer and matching approval; transaction creates at most one order. Reason: reliable commitment. Owner: portal/orders; W-05. Edge cases: stale links show latest safe quote; preview allocation does not imply dispatch authorization.

### BR-008 — Customer isolation [C]
Condition: any portal request/export. Behavior: scope query by authenticated customer ID; explicitly project safe fields. Reason: portal must be genuinely restricted. Owner: identity/portal; all portal workflows. Edge cases: guessed line/comment/invoice IDs return 404; never serialize internal DTOs and merely hide fields with CSS.

### BR-009 — Stock conservation [I]
Condition: reserve/reallocate/ship/receive. Behavior: nonnegative on-hand/reserved, reserved≤on-hand; sum allocation never exceeds remaining demand; lock balances in deterministic order. Reason: avoid overselling. Owner: fulfillment; W-06. Edge cases: manual override obeys same checks; service/subscription lines do not reserve stock; deadlock/serialization retry is bounded.

### BR-010 — Split recommendation [C/P]
Condition: allocation preview. Behavior: proposed deterministic greedy selection minimizes practical shipment count first and configured weighted cost second; return shortages explicitly. Reason: meet real stock constraints with understandable initial algorithm. Owner: fulfillment; W-06. Edge cases: do not claim global mathematical optimum; tie-break by warehouse priority/ID; shipping estimates are estimates, not carrier quotes.

### BR-011 — Backorder consolidation [C]
Condition: replenishment with outstanding unshipped demand. Behavior: offer revised split; commit releases/re-reserves only unshipped quantities transactionally. Reason: reduce avoidable shipments without corrupting dispatch history. Owner: fulfillment; W-06. Edge cases: prompt is a proposal, not an automatic physical movement; stock consumed elsewhere forces re-preview.

### BR-012 — Cadence-aware billing and margin [C/I]
Condition: mixed order. Behavior: separate one-time, monthly, quarterly and yearly totals/margins; invoice one-time items according to configured issue trigger; generate recurring periods separately. Reason: monthly $40 is not directly comparable with $1,200 one-time revenue. Owner: billing/pricing; W-03/07. Edge cases: normalized annual contract value may be added only as a labeled derived report; never imply all future periods are immediately payable.

### BR-013 — Proration and calendar [C/P]
Condition: effective mid-period plan/quantity change. Behavior: proposed actual-calendar-day proration `(newPeriodPrice−oldPeriodPrice)×remainingDays/periodDays`; [start,end), billing timezone, half-up final rounding. Reason: deterministic charge/credit. Owner: billing; W-07. Edge cases: Jan 31 anchors clamp in February then restore original anchor; leap years and DST must be tested; no backdating into settled periods in initial scope.

### BR-014 — Cancellation and credits [C/I]
Condition: cancellation under snapshotted plan policy. Behavior: stop future billing at effective date, create eligible unused-period credit note; record refund obligation separately from any cash refund. Reason: preserve ledger and avoid fake integration. Owner: billing; W-07/08. Edge cases: never issue both a proration credit and duplicate cancellation credit for the same interval; issued invoices remain immutable.

### BR-015 — Retry-safe money and orders [I]
Condition: confirm, allocate, bill, record payment or credit request is retried. Behavior: scoped idempotency key and canonical payload hash; same key/body returns original response, conflicting body gives 409. Unique period/order constraints remain final defense. Reason: retries must not duplicate obligations. Owner: orders/fulfillment/billing; W-05–08. Edge cases: rollback removes incomplete result; expiry is never relied on as the sole duplicate guard.

### BR-016 — Payment balance [C/I]
Condition: record payment. Behavior: lock invoice; require matching currency and `0<amount≤outstanding`; persist payment+allocation; derive status. Reason: reconcile payment correctly. Owner: billing; W-08. Edge cases: concurrent payments cannot overallocate; partial payments show remaining balance; reversals require a linked compensating record and reason.

### BR-017 — Auditable mutations [C/I]
Condition: commercial edit, reviewer decision, stock adjustment, configuration publish or financial action. Behavior: append actor/time/reason/resource/revision/request ID in the same transaction. Reason: accountable operations. Owner: each owning service with audit helper; all mutations. Edge cases: never log password/session/raw cookie; audit failure fails the governed transaction.

### BR-018 — Health evaluation [C/P]
Condition: periodic refresh. Behavior: stalled threshold configurable; discount baseline uses same rep/comparable scope and minimum sample; delivery slippage compares promised date with outstanding demand. Reason: explain alerts. Owner: deal-health; W-09. Edge cases: insufficient history produces no fabricated anomaly; resolved condition resolves alert; timezone boundaries explicit.

### BR-019 — Recommendation integrity [C/I]
Condition: request suggestions. Behavior: rank active valid products by co-purchase frequency/promotion subject to margin threshold; calculate delta with quote pricing engine. Reason: relevant commercially healthy suggestions. Owner: recommendations; W-03. Edge cases: no history yields promoted/curated valid suggestions or honest empty state; no hidden ML service required; unavailable stock is disclosed.

### BR-020 — Scope-preserving reporting [C/I]
Condition: report/export. Behavior: apply role/team/customer constraints before grouping; reuse report calculation; group incompatible currency/cadence. Reason: exports must not widen access or misstate revenue. Owner: reporting; W-10. Edge cases: untrusted spreadsheet strings beginning `=`, `+`, `-`, `@` are escaped; export dates/filters shown.

### BR-021 — Tenant isolation [C]
Condition: a request reads or changes tenant data. Behavior: resolve the organization server-side and constrain every business query by `organizationId`; caller-supplied identifiers never create access. Suspended organizations retain history but reject normal operations. The Platform Owner may inspect another organization only through its independent session and explicit View As context.

### BR-022 — Protected Platform Owner administration [C]
Condition: owner login or a high-risk organization/user change. Behavior: accept only the exact environment login ID and password at `/login/super-admin`, require a password of at least 16 characters, compare credentials in constant time, throttle failures, require the independent owner session and audit privileged changes. No organization user—including an Admin—can be granted owner access.

### BR-023 — Read-only View As [C]
Condition: the Platform Owner enters View As Organization/User. Behavior: retain the environment owner as the real audit actor, expose the selected tenant context, show a persistent banner, and reject all business and privileged writes until explicit exit.

## Implemented audit-repair decisions — 2026-09-05

- [Inferred] Customer ownership is now a real foreign key; portal resource misses outside that customer return 404.
- [Proposed, existing documented default] finance routing uses the published tier policy's finance threshold for worst/weighted excess and a 12% minimum margin floor. Any excess still requires Manager; a low-margin quote can require Finance without Manager.
- [Inferred] Customer comments never mutate terms. A counter-discount is an open proposal; owner adoption creates a new calculated draft revision.
- [Inferred] Confirmation requires the current sent and approved revision and atomically creates acceptance/order/billing records. Retries return the existing order result.
- [Proposed, existing documented default] generated invoice due date is acceptance plus 14 days until a configurable issue/due policy is introduced.
- [Proposed] recurring calendar display uses UTC anchor-day month advancement (1/3/12 months for Monthly/Quarterly/Yearly). Proration/credit policy remains unimplemented pending the documented business decision.
