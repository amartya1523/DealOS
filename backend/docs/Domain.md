# DealOS — Domain model and business rules

Status: living domain contract. C/I/P classifications refer to [PRD.md](PRD.md). Proposed defaults are implemented initial decisions, not facts claimed from the source.

## Glossary

| Term | Meaning and context | Relationship |
|---|---|---|
| Customer | Buying business, assigned to a sales team and pricing tier | Has contacts, quotations and orders |
| Organization profile | Explicit allowlisted public directory identity controlled by an organization Admin | Belongs one-to-one to an Organization and may be hidden |
| Directory join request | A visitor's pending request to become a customer of one discoverable organization | Approval may create exactly one Customer; decline retains a reason and creates none |
| Customer tier | Pricing/discount classification, e.g. Bronze/Silver/Gold | Referenced by price lists and policy versions |
| Product | Sellable hardware, service or subscription offering; this is domain language in the brief | Has category, variants and price rules |
| Product variant | Purchasable combination of attribute values with SKU and price adjustments | Stock balances and quote lines reference it |
| Portal request | Immutable raw customer requirements submitted through an accepted portal identity | May produce one Lead or one private Draft while retaining its own customer-safe status |
| Lead | Deliberately small pre-quotation qualification record in Lead-first mode | Assigned to the customer's current primary Rep; converts once or is dismissed with a reason |
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
| Public visitor | Discover an organization and request a buying relationship | Discoverable organization display name, short description and category only | Submit email, company name and a message to one listed organization | Receives pending confirmation only; no account, Customer, Lead, RFQ or quotation is created before approval |
| Sales Rep | Build viable deals and respond to negotiation | Own/assigned-team quotes, assigned Leads and customer context; internal margin | Qualify/convert/dismiss own Leads; draft, revise, submit, send, propose, inspect allocation | Cannot convert another Rep's Lead, approve own deal, change stock or record payments; receives stage/risk explanations |
| Sales Manager | Protect team pricing and progress | Team Leads/quotes, risk, review history, health, team reports | Inspect/dismiss managed-team Leads; approve/reject/return eligible step; configure approval policy | Cannot convert Leads or review a case they submitted; cannot skip Finance; receives reasons and audit |
| Finance/Operations | Control high-risk discounts, stock and receivables | Approved commercial details, stock and invoices | Second review, allocate, ship, receive stock and record payment | No subscription-module access; sequential approval and immutable ledger restrictions apply |
| Customer | Request, understand and agree commercial offers | Own safe request history, sent quotes, allowed terms/comments and invoices | Submit quote request/proposal/comment; accept current revision | Cannot access Drafts, other customers, owner/dismiss/internal notes/cost/risk; receives honest safe progress state |
| Admin | Maintain correct setup, identities and recurring obligations | Organization configuration, identities, subscriptions and reports | Activate accounts; assign roles/team/customer links; configure catalog, warehouses/plans/policies and RFQ mode; preview and commit subscription changes/cancellations | Subscription/RFQ mode controls are Admin-only; no implicit reviewer bypass; cannot edit issued financial history; receives configuration audit |
| Platform Super Admin / Platform Owner | Securely oversee the complete installation | Global organization/member and tenant operational summaries | Create/suspend/archive organizations; manage memberships; inspect records; enter read-only View As | Independent environment identity and session, never an organization user or role; privileged mutations are audited |
| System scheduler | Process due billing and health rules | Only job-required domain data | Claim due jobs, generate recurring invoices, resolve/reopen alerts | No interactive login; transaction/idempotency protections apply; receives durable job status |

## Entities and relationships

Organization 0→1 public OrganizationProfile and 1→N DirectoryJoinRequest. An approved DirectoryJoinRequest produces exactly one normal Customer; it does not create a reusable cross-organization identity. Customer N→1 primary SalesTeam and Customer 1→N historical CustomerRepresentative assignments, with at most one active PRIMARY and optional active COLLABORATOR rows. Customer 1→N PortalRequest; PortalRequest 1→N PortalRequestLine and produces at most one Lead or one source-linked Quotation. Lead belongs to one customer/request/assigned Rep and converts to at most one Quotation. Customer 1→N Quotation; each quotation snapshots one owner, team and creator independently of later account reassignment. Quotation 1→N Revision; Revision 1→N Line; Revision 1→N ApprovalCase (at most one active); Case 1→N ordered Step. Revision 0→1 Acceptance and 0→1 SalesOrder. CustomerProposal references an exact revision and its lines. Product 1→N Variant; Variant N↔N Warehouse through StockBalance. Order 1→N OrderLine; OrderLine 1→N Reservation/ShipmentLine and 0→1 Subscription for recurring lines. Subscription 1→N BillingPeriod; Invoice 1→N InvoiceLine; Payment N↔N Invoice through allocations. Detailed fields and constraints belong to [Database.md](Database.md).

## Lifecycles and invariants

Quotation revision: `DRAFT → SUBMITTED → SENT → SUPERSEDED` describes document publication; rejection/return creates a new editable draft revision. Approval case: `PENDING → APPROVED | REJECTED | RETURNED | SUPERSEDED`; steps execute in sequence. Customer review: `NOT_SENT → SENT → UNDER_NEGOTIATION → ACCEPTED | SUPERSEDED`. A consolidated pipeline stage is derived, not a freely writable authorization field.

Portal request: `NEW → PROCESSED | DISMISSED`. Lead-first keeps the request NEW while its Lead is NEW; conversion marks both Lead CONVERTED and request PROCESSED, while reasoned dismissal marks Lead/request DISMISSED. Direct-draft marks the request PROCESSED in the creation transaction. Customer status is a separate safe projection: NEW=`Received`, PROCESSED=`In progress`, DISMISSED=`Declined`.

Directory join request: `PENDING → APPROVED | DECLINED`. PENDING has no decision/result metadata. APPROVED requires the deciding Manager/Admin, decision time and resulting Customer. DECLINED requires the deciding actor, time and nonblank retained reason and must not reference a Customer. No state returns to PENDING.

Order: `CONFIRMED → PARTIALLY_FULFILLED → FULFILLED`; cancellation of unshipped balance is a distinct audited operation. Billing status runs independently. Subscription: `ACTIVE ↔ PAUSED → CANCELLED`; every amount or lifecycle modification is a dated, reasoned change event with an optimistic version. Amount changes affect future periods only and never rewrite an issued invoice.

Invoice: `DRAFT → ISSUED → PARTIALLY_PAID → PAID`, with credit-adjusted balance and a separate void state for legally eligible unposted drafts. Issued invoices are not editable. Alerts: `OPEN → ACKNOWLEDGED → RESOLVED`; recurrence may reopen a resolved alert with history.

## Workflow definitions

### W-01 Identity and access

- Trigger/actor: internal email/password signup, Google signup, email/password login, Admin activation, Admin-created temporary customer credentials, or provisioned Customer login.
- Input: email/password or a Google Identity Services ID credential on sign-up; authenticated Admin supplies roles and team/customer link or the one-time-displayed initial customer password.
- Processing/logic: hash passwords, normalize email, verify Google token signature/audience/expiry and verified email server-side, rate limit, deny inactive accounts; rotate session on login. Admin customer creation atomically activates a customer-only portal identity and never persists or returns the plaintext temporary password. Public signup grants no active privileged role. Google is not exposed as a sign-in method.
- Database: user, role assignment, password hash, session token hash, audit.
- Output: session cookie and minimal identity/permission projection.
- Failure/recovery: generic invalid-credential response; expired session forces login; Admin activates pending signup. No fallback demo identity.

### W-01A Public directory and customer association

- Trigger/actor: a public visitor opens the directory and requests a relationship; a Manager/Admin reviews a pending request; an Admin changes public profile visibility.
- Input: allowlisted organization display profile; visitor email/company/message; approval team, primary Rep, customer tier and currency; or a required decline reason.
- Processing/logic: list only active organizations with `isDiscoverable=true`; normalize email; enforce one pending organization/email request and proposed rolling limits of five per email and twenty per IP/hour. Submission creates only DirectoryJoinRequest. Approval locks/scopes the pending row, calls the shared customer creation and CustomerRepresentative assignment services, generates and hashes one initial customer password, and finalizes the request atomically. Decline writes reason/audit only.
- Database: OrganizationProfile; DirectoryJoinRequest; on approval the existing Customer, User, OrganizationMembership, CustomerRepresentative and audit records.
- Output: public pending confirmation; internal scoped request history; approval returns raw credential exactly once to the approving browser for manual sharing.
- Failure/recovery: hidden/inactive/cross-tenant targets return 404; duplicate pending returns 409; invalid team/Rep uses the exact CAT-03A validation error and rolls back every approval write; declined requests create no customer/account. No email delivery is claimed.

### W-02 Sales backend configuration

- Trigger/actor: Admin configures products/prices, tier/category caps, warehouses/stock and subscription plans; Manager may configure discount policy.
- Input: validated category/variant, fixed-precision price/cost, plan cadence, ceilings, approval thresholds, stock adjustment reason.
- Processing/logic: edit the tier, Hardware, Services and Subscriptions ceilings together; require a change reason; reject category ceilings above the overall tier ceiling; publish a new version marker. Archived referenced products remain in historical snapshots.
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

### W-03A Customer-originated quotation request

- Trigger/actor: a linked active Customer portal identity submits requirements after invitation acceptance; Admin changes the organization handling mode.
- Input: 5–5000 character requirement, optional delivery date, and up to 50 optional catalog/free-text lines with positive quantity. Owner, team, pricing, cost, tax, margin and risk are never accepted from the customer.
- Processing/logic: lock the Customer; revalidate exactly one active PRIMARY Rep on its primary team; enforce five requests per customer/user/rolling hour; resolve products only inside the active organization catalog. An unavailable/inactive/cross-tenant product loses its structured reference while retaining customer text and an internal degradation reason. Persist the raw request, then synchronously branch on `RfqHandlingMode`: create an assigned Lead, or use the shared quotation `createDraft` service. Recipient-scoped Alert is the in-app notification; no email side effect exists.
- Database: PortalRequest/PortalRequestLine plus either Lead or source-linked Quote/Revision, Alert, AuditEvent and IdempotencyRecord in one transaction.
- Output: Customer receives only request ID and safe status. Rep sees original text/degradation context. A directly created Draft is internal until the normal approved SENT boundary.
- Failure/recovery: stale/missing assignment returns 422 without an orphan request; rate excess returns 429 plus Retry-After; same submission key replays one result and a payload mismatch returns 409. Lead conversion locks the Lead and returns the existing quotation after a repeated conversion.

### W-04 Evaluate and approve discounts

- Trigger/actor: submit by Rep or submission of revised commercial terms.
- Input: current revision ID, expected version, reason.
- Processing/logic: saving creates an immutable Draft snapshot; submission creates a separate frozen revision and policy snapshot, computes risk, and creates ordered steps or auto-approves. Any effective discount requires Manager. High excess, aggregate-discount ceiling, or margin-floor risk adds Finance strictly after Manager; no Finance-first route and no self-approval.
- Database: submission, approval case/steps and audit in one transaction.
- Output: required reviewers and per-line/aggregate reasons.
- Failure/recovery: missing reviewer leaves clearly blocked case, never auto-approves. Rejected/returned cases need a new revision. Repeated decision returns existing result only for identical idempotency key/body.

### W-05 Customer review, negotiation and acceptance

- Trigger/actor: Rep sends eligible quotation; linked Customer comments/proposes/accepts; Rep adopts/rejects proposal.
- Input: exact sent revision, proposed order discount and optional requested delivery date; acceptance includes revision ID, expected version, terms hash and an idempotency key.
- Processing/logic: comments are append-only and never change the SENT state. Proposals do not overwrite prices. Adoption supersedes SENT, re-resolves catalog/policy inputs on the backend, creates a new Draft and requires a fresh Submit/approval cycle. Decline closes that proposal, restores the unchanged approved SENT revision as acceptable, and leaves a visible reason. Only an already approved, unexpired SENT revision may be accepted.
- Database: comment/proposal and response metadata; a recalculated revision if adopted; acceptance plus unique order/order-line creation in one transaction when eligible. Acceptance does not create invoices, subscriptions, reservations, shipments or fulfillment records.
- Output: frozen customer-safe terms, durable proposal response, and exactly one confirmed order for an accepted revision.
- Failure/recovery: every portal lookup is organization/customer scoped and a cross-customer identifier returns 404; stale/superseded acceptance returns 409; expired quotation cannot be accepted; same-key retries replay the original order and unique quote/revision keys remain the final duplicate defense.

### W-06 Fulfillment and backorders

- Trigger/actor: order confirmation creates allocation demand; Operations requests preview/commit/override; stock receipt prompts re-evaluation.
- Input: order version and quantities per warehouse; override reason; shipment reservation IDs.
- Processing/logic: compute available=on-hand−reserved from current balances; prefer fewer/cost-weighted planned shipments with deterministic ties; preview makes no promises. Commit locks the Order and every relevant StockBalance in sorted order, validates the selected split again and reserves atomically. A manual split requires a reason at the request-schema boundary. Receipt records physical stock entering on-hand and automatically attempts the target order's open backorder under the same lock discipline.
- Database: versioned Fulfillment read model, first-class Reservation, quantified Backorder, append-only receipt StockMovement, balance increments, idempotency result and audit. Shipment tables/physical consumption are not implemented in this phase.
- Output: accepted reservation split, estimated planned-shipment cost and outstanding demand; a reasoned explicit consolidation action remains available when stock was received outside the order-scoped route.
- Failure/recovery: stock race produces `409 STOCK_CHANGED` with fresh availability; no negative availability. Every multi-warehouse operation rolls back as one transaction. Same-key retry replays the persisted result and unique order/reservation keys prevent double commitment.
- Current implemented behavior: `GET /fulfillment/:orderId/preview` reads immutable hardware OrderLines, while `/reserve`, `/receive` and `/consolidate` write only fulfillment-owned records. Full reservation sets `Order.FULFILLED`; shortage sets `PARTIALLY_FULFILLED` with a real Backorder. `FULFILLED` is explicitly reservation completion only—not pick, dispatch, tracking, delivery, or on-hand consumption.

### W-07 Hybrid billing and subscription changes

- Trigger/actor: confirmed order, due billing job, or Admin change/cancel request. Interactive subscription access is Admin-only.
- Input: order line snapshots; effective change date; plan/quantity; expected version and reason.
- Processing/logic: separate one-time and recurring buckets; generate period keys; actual-period day proration; credit only according to snapshotted plan rules; sequential calendar advancement.
- Database: subscriptions, periods, invoice/lines, change event and credit notes atomically.
- Output: invoice amounts, next bill dates, charge/credit preview and committed schedule.
- Failure/recovery: duplicate job is a no-op with existing invoice; invalid effective date rejected; failed transaction retains due job for bounded retry. No fake payment-provider refund.
- Current implementation: confirmation issues one combined invoice for the full accepted mixed total and creates one subscription per recurring OrderLine. The proposed first-invoice due date is confirmation +14 days. A recurring line's next bill advances 1/3/12 UTC calendar months. Separate one-time/recurring invoices, due-period jobs, proration, and cancellation credits remain future work.

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
- Processing/logic: derive stalled and slipped conditions from persisted activity/promise/order state; use the persisted current-revision discount-risk score for policy anomalies; deduplicate active alerts. Nudge/acknowledge/resolve are audited in-application actions and do not claim external delivery.
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
- Current implementation: confirmed Order snapshots are filtered by period, Rep, Order status and product after role/team scope. Totals remain separated by currency and reconcile against actual invoice paid/outstanding values. The same aggregation produces JSON, a real PDF, or formula-neutralized HTML-based XLS.

## Numbered business rules

Each rule includes condition, behavior, reason, ownership, workflow and edge cases.

### BR-001 — Authoritative prices and money [I]
Condition: quote preview/save/submit. Behavior: backend resolves price and calculates using decimal arithmetic; API money is decimal string, currency ISO code. Reason: client manipulation/rounding must not change terms. Owner: quotations/pricing; W-03. Edge cases: no currency conversion, reject negative/NaN amounts; round line totals with a documented half-up currency scale; preserve calculation snapshot.

### BR-002 — Combined discount [C/I]
Condition: line discount `l` and order discount `o` apply. Behavior: proposed sequential composition `effective = 1 − (1−l)(1−o)`; allocate order discount to eligible lines and evaluate the resulting rate. Reason: an order discount must not bypass line policy. Owner: pricing/governance; W-03/04. Edge cases: 10% + 10% becomes 19%, not 20%; 100% discount has explicit zero-revenue/margin handling; excluded charges are disclosed.

### BR-003 — Effective ceiling [C/P]
Condition: both tier and category caps exist. Behavior: the editor permits each tier and each Hardware, Services and Subscriptions ceiling to be changed, but a category cap cannot exceed its overall tier cap. Quote evaluation uses `min(tierCap, categoryCap)` unless an explicit versioned override exists. Every change requires an audit reason and advances the published version marker. Reason: preserve stricter category protection demonstrated by the Gold services example. Owner: governance; W-04. Edge cases: missing rule blocks submission rather than unlimited discretion.

### BR-004 — Explainable blended risk [C/P]
Condition: quote submission or commercial revision. Behavior: for each line compute excess points `e=max(0,effectiveDiscount−cap)`; compute `worst=max(e)` and `weighted=Σ(baseValue×e)/Σ(baseValue)` within comparable cadence/currency buckets. Any effective customer discount requires Manager review, even when within its ceiling. A worst/weighted excess above the published Finance threshold, aggregate discount above its published ceiling, or margin below its published floor adds Finance after Manager. Reason: a small violating service line cannot disappear in an average, aggregate rules cover margin erosion, and no Finance-only path may bypass commercial ownership. Owner: governance; W-04/05. Edge cases: zero base value blocks undefined ratios; a single small violating line is retained even beside a much larger safe line; incomparable monthly/yearly/one-time revenue is evaluated independently; no-discount low-margin quotes still route Manager then Finance. Store all component values and policy version; do not display an invented opaque score as fact.

### BR-005 — Revision-bound authorization [I]
Condition: any commercial term changes after submit/send. Behavior: create a new revision; previous approval/acceptance cannot execute revised terms. Reason: prevent approval bypass. Owner: quotations/governance/portal; W-04/05. Edge cases: internal-only comments do not invalidate terms; draft optimistic version increments; archived policy still explains historical approval.

### BR-006 — Sequential independent review [C/I]
Condition: active approval step. Behavior: only assigned role/scope acts; Finance waits for Manager; author/submitter cannot self-approve; reason is required for approve, reject, and return. A return closes the case, supersedes every unfinished step, and creates a new Draft revision copied from the frozen source; resubmission creates a fresh case and recomputes the route. Reason: pricing governance and immutable audit. Owner: governance; W-04. Edge cases: Admin is not a reviewer by status alone; unavailable reviewer blocks visibly; concurrent or stale-version decisions yield one winner.

### BR-007 — Acceptance and confirmation [C/I]
Condition: customer accepts or approval completes for conditionally accepted terms. Behavior: require current unexpired revision, correct customer and matching approval; transaction creates at most one order. Reason: reliable commitment. Owner: portal/orders; W-05. Edge cases: stale links show latest safe quote; preview allocation does not imply dispatch authorization.

### BR-008 — Customer isolation [C]
Condition: any portal request/export. Behavior: scope query by authenticated customer ID; explicitly project safe fields. Reason: portal must be genuinely restricted. Owner: identity/portal; all portal workflows. Edge cases: guessed line/comment/invoice IDs return 404; never serialize internal DTOs and merely hide fields with CSS.

### BR-009 — Stock conservation [I]
Condition: reserve/consolidate/receive. Behavior: nonnegative on-hand/reserved, reserved≤on-hand; sum allocation never exceeds immutable OrderLine demand; lock the Order first and balances in deterministic order; persist each commitment as a Reservation and each receipt as a StockMovement. Reason: avoid overselling and make reconciliation durable. Owner: fulfillment; W-06. Edge cases: manual override obeys the same checks; service/subscription lines do not reserve stock; retry cannot double-reserve.

### BR-010 — Split recommendation [C/P]
Condition: allocation preview. Behavior: proposed deterministic greedy selection minimizes practical shipment count first and configured weighted cost second; return shortages explicitly. Reason: meet real stock constraints with understandable initial algorithm. Owner: fulfillment; W-06. Edge cases: do not claim global mathematical optimum; tie-break by warehouse priority/ID; shipping estimates are estimates, not carrier quotes.

### BR-011 — Backorder consolidation [C]
Condition: receipt or explicit consolidation with outstanding unreserved demand. Behavior: order-scoped receipt automatically reserves as much of its open Backorder as current availability permits; a reasoned explicit consolidation does the same for stock recorded elsewhere. It never changes an already reserved quantity except to add the remaining commitment. Reason: satisfy shortages without double reservation. Owner: fulfillment; W-06. Edge cases: receipt is a real on-hand movement but consolidation is only a reservation; stock claimed elsewhere yields fresh `STOCK_CHANGED`; dispatch history does not yet exist.

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

### BR-024 — Account relationship and deal ownership [C]

Condition: customer assignment, quotation creation or quotation access. Behavior: one primary team owns the account; one active PRIMARY Rep and optional same-team COLLABORATOR Reps serve it. A Rep can create a quotation only while actively assigned. The backend snapshots owner, team, customer name, tier and currency at creation. Team members may inspect a teammate's quotation, but only its owner may edit, submit, send or respond to a commercial proposal. A Manager may change accounts and eligible Draft/Pending Approval quotations only for a team they manage. Account reassignment ends removed assignment rows, increments the optimistic version and never updates an existing Quote. Approved, Sent, Accepted and Confirmed deals cannot be automatically or implicitly reassigned. Customer portal identities remain linked only to Customer. Owner: catalog/identity/quotations; W-01/W-03. Edge cases: cross-organization team/user IDs, inactive or CUSTOMER actors, out-of-team Reps and stale versions are rejected; unresolved migrated accounts remain visible to Manager/Admin for review.

### BR-025 — Assignment-gated portal onboarding [C]

Condition: Manager/Admin creates, inspects, accepts, or revokes a customer portal invitation. Behavior: invitation creation requires an active customer email, primary team and exactly one active primary Rep; a Manager must manage that team. A cryptographically random token is returned once in a manual-share link while only its SHA-256 hash is persisted. Tokens expire after seven days, are single-use, and use the same non-leaking unavailable response for unknown, expired, accepted, or revoked values. Acceptance atomically claims the pending invitation, creates or activates one `CUSTOMER` User plus `PORTAL_USER` membership linked only to `customerId`, records acceptance time/audit, and starts the normal database-backed session. Issuing a replacement revokes the prior pending link; creation is limited to five links per customer per hour. Owner: identity/portal; W-01/W-05. Edge cases: cross-organization customer/invitation IDs return scoped misses; an active portal account cannot be reinvited; email delivery remains out of scope. Customer-originated RFQ intake is implemented separately by BR-026 after acceptance.

### BR-026 — Assignment-gated portal RFQ processing [C/I/P]

Condition: portal request submission, Lead conversion/dismissal, or organization RFQ mode change. Behavior: revalidate the current active primary Rep and team at submission; retain the raw request even when product references degrade; synchronously create exactly one assigned Lead or private Draft under the configured mode. `LEAD_FIRST` and five requests per customer/user/hour are Proposed defaults. Only the assigned Rep converts a NEW Lead via the same server-authoritative draft service; Rep or managed-team Manager may reasonedly dismiss it. A customer projection exposes only Received/In progress/Declined and customer-safe line context. Admin alone changes the mode, and a real change is audited. Owner: portal intake/quotations; W-03A. Edge cases: stale assignment rejects before persistence; cross-tenant/inactive/malformed product references become text-only, never catalog data; non-whole structured quantity remains context only; free text never becomes a priced line; repeated submit/convert does not duplicate a commercial document; no Draft identifier, price, owner ID, internal note, degradation reason or dismissal reason crosses the customer boundary.

### BR-027 — Admin-provisioned initial customer access [C]

Condition: an organization Admin creates a customer profile. Behavior: customer email and a 12–128 character generated temporary password are required; Customer, active `CUSTOMER` User, active `PORTAL_USER` membership and both creation/access audits commit in one transaction. Only the bcrypt hash is persisted; neither plaintext nor hash is returned by the API. The creating browser retains and displays the plaintext once for secure manual sharing. Managers cannot submit a temporary password and retain the profile → assignment → invitation path. The resulting customer may authenticate immediately, but BR-024 and BR-026 still require a current primary team/Rep before quotation creation or RFQ submission. Owner: catalog/identity/portal; W-01/W-03A. Edge cases: email collision rolls back the whole customer creation; no external email is claimed; later reset revokes active sessions.

### BR-028 — Approval-gated public association [C/P]

Condition: public directory listing, visitor association request or internal decision. Behavior: only an Admin publishes the four-field organization profile; only discoverable active organizations accept requests; submission writes no customer/account/commercial record. Manager/Admin approval locks the organization-scoped PENDING request and atomically reuses customer creation, primary relationship validation and customer portal provisioning. The server generates the initial password, persists only its bcrypt hash and returns plaintext only in the successful approval response. Decline requires a reason and creates no related rows. One `(organization,email,PENDING)` request is allowed; initial five/email and twenty/IP/hour bounds are Proposed anti-abuse defaults. Owner: directory orchestration with catalog/identity service calls; W-01A. Edge cases: cross-organization decisions return 404; existing customer name/email or global user email rolls back; Manager team scope is unchanged; multi-organization customer identity and catalog preview remain outside this rule.

## Implemented audit-repair decisions — 2026-09-05

- [Inferred] Customer ownership is now a real foreign key; portal resource misses outside that customer return 404.
- [Confirmed, user-directed 2026-09-06] any effective discount requires Manager. Published high-excess, aggregate-discount, or minimum-margin triggers add Finance only after Manager; low margin can never create a Finance-first route.
- [Inferred] Customer comments never mutate terms. A counter-discount is an open proposal; owner adoption creates a new calculated draft revision.
- [Inferred] Confirmation requires the current sent and approved revision and atomically creates acceptance/order/billing records. Retries return the existing order result.
- [Proposed, existing documented default] generated invoice due date is acceptance plus 14 days until a configurable issue/due policy is introduced.
- [Proposed] recurring calendar display uses UTC anchor-day month advancement (1/3/12 months for Monthly/Quarterly/Yearly). Proration/credit policy remains unimplemented pending the documented business decision.
