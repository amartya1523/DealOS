# DealOS backend audit repair report

**Repair date:** 5 September 2026
**Automated result:** 44/44 isolated workflow checks pass. This includes all 24 preserved cases plus the previously failing backend checks.
**Safety:** migration validation and API checks used disposable PostgreSQL schemas. After those checks passed, the reviewed migration was applied to the local development schema without reseeding; all five demo users and three demo quotes were preserved and backfilled.

## Fix 1 — Customer isolation, real ownership, and safe DTOs (C1)

Customers now have durable IDs and foreign keys. Portal workspace, confirmation, messages, and invoices are scoped by the authenticated customer ID. Drafts are hidden until the exact approved revision is sent. Portal DTOs explicitly omit costs, margin, risk, reviewer notes, internal product cost, and payment references. Rep workspace access is owner-scoped.

Manual test:

1. Sign in as a Rep, create two quotes for two different customers, approve and send both.
2. Sign in as Customer A and verify only Customer A's sent quote is listed.
3. Copy Customer B's quote ID into Customer A's confirm/message request; expect HTTP 404.
4. Inspect Customer A's workspace JSON; verify `margin`, `riskScore`, `unitCost`, product `cost`, and approval reasons are absent.

## Fix 2 — Decimal-safe tax and cadence calculation (H5)

Pricing now uses Prisma Decimal arithmetic with half-up currency rounding. It returns subtotal, explicit tax, total, margin, risk components, and distinct One-time/Monthly/Quarterly/Yearly buckets. Published policy finance thresholds drive the same calculation used during save and submit.

Manual test:

1. Add a $100 one-time line and a $40 monthly line, both at 18% tax.
2. Save the draft and inspect `calculation.totalsByCadence`.
3. Verify One-time is $100 + $18 tax and Monthly is $40 + $7.20 tax; verify they are not collapsed into one unlabeled cadence.

## Fix 3 — Immutable revisions and approval history (H2, H3)

Every quote has a current revision. Submission freezes its calculated/policy snapshot. Approval rows carry revision and cycle IDs; resubmission creates a new cycle without deleting earlier decisions. Finance is WAITING until Manager approval. Return/reject supersedes remaining actionable steps, and return creates a new draft revision.

Manual test:

1. Submit an 18%-discount service quote requiring Manager and Finance.
2. Verify Finance cannot decide first and its state is WAITING.
3. Approve as Manager, then return as Finance.
4. Verify the quote is Draft, no old step is PENDING, and the original reasons remain present.
5. Resubmit and verify a new cycle is added rather than replacing the old cycle.

## Fix 4 — Comments versus commercial proposals (H1)

A comment creates a COMMENT record and never changes commercial values or approval state. A counter-discount creates an open PROPOSAL. Only an authorized owner/Admin can adopt it; adoption recalculates tax, totals, margin, and risk, creates a new draft revision, and preserves prior approvals as history.

Manual test:

1. On a sent quote, post a comment without a counter discount; verify totals/stage/approvals do not change.
2. Post a 50% counter proposal; verify the approved revision is still unchanged.
3. As the owning Rep, adopt the proposal.
4. Verify a new Draft revision, recalculated total/risk, cleared send boundary, and retained old approval reasons.

## Fix 5 — Acceptance, Order, invoice, and recurring provenance (H6)

Confirmation locks and validates the customer-scoped sent revision, then atomically creates one acceptance, one order, immutable order-line snapshots, a generated invoice, and linked subscriptions for recurring lines. Unique revision/quote constraints make confirmation retry-safe.

Manual test:

1. Approve and send a mixed one-time/recurring quote.
2. Confirm it from the linked customer account, then repeat the same request.
3. Verify only one acceptance, order, invoice, and subscription per recurring order line exist.
4. Verify every generated invoice/subscription links back to the order/quote/product IDs.

## Fix 6 — Idempotent, bounded stock reservation (C2)

Duplicate SKU demand is aggregated before allocation. The endpoint locks the confirmed order/quote and all relevant stock rows in stable order. An existing fulfillment is returned on retry. Conditional updates plus database checks enforce `0 <= reserved <= onHand`.

Manual test:

1. Confirm a quote containing two 60-unit lines for the same SKU while only 100 units are available.
2. Allocate once; verify 100 reserved and 20 backordered.
3. Repeat allocation; verify reserved remains 100 and no second fulfillment is created.

## Fix 7 — Payment ledger concurrency and retry safety (C3)

Payment posting locks the invoice, derives the committed ledger sum, validates remaining balance, and atomically writes payment, invoice status, idempotency record, and audit event. Invoice/reference is unique; same-key different-payload requests return 409. Database checks prevent invalid balances.

Manual test:

1. On a $1,000 invoice, post $100 twice with the same reference/key; verify one payment and paidAmount $100.
2. Reuse the key with a different amount; expect HTTP 409.
3. Concurrently post two different $700 payments; verify one succeeds, one gets 422, and ledger sum equals paidAmount ($700).

## Fix 8 — Admin activation and request hardening

Admins can list and update account status/role/customer link. Privilege or status changes revoke sessions and are audited. Mutations enforce allowed Origin plus a session-derived CSRF token. Login has bounded rate limiting; responses include safe request IDs. Draft saves use an atomic optimistic version predicate.

Manual test:

1. Sign up a new account and confirm login returns 403 ACCOUNT_INACTIVE.
2. Sign in as Admin, list users, activate the pending account, then sign in successfully as that account.
3. Repeat a mutation without `X-CSRF-Token` or with a foreign Origin; expect 403 CSRF_INVALID.
4. Submit the same draft version from two clients; verify only one save succeeds and the other gets 409 STALE_VERSION.

## Fix 9 — Quarterly schedules (H7)

Recurring schedules are generated server-side. Monthly, quarterly, and yearly cadences advance by 1, 3, and 12 calendar months respectively while preserving/clamping the UTC anchor day. The UI renders the returned schedule.

Manual test:

1. Open a Quarterly subscription whose next bill date is 1 November 2026.
2. Verify the next three dates are 1 November 2026, 1 February 2027, and 1 May 2027.

## Fix 10 — Reconciled seeds and catalog mutation support (M3 and backend M4 subset)

Seed quote totals now come from the authoritative calculator, include explicit cadence/tax data, and no invoice is attached to a pending quote. The backend supports Admin product creation and broader identity/tax/category/unit updates while historical order/revision snapshots remain unchanged.

Manual test:

1. In a disposable database, run the seed and open Q-0102.
2. Add its cadence bucket totals and verify they reconcile to the displayed calculated totals/tax.
3. Verify Q-0102 has no invoice while Pending Approval.
4. Create or edit a product as Admin, then verify a previously submitted revision retains its old snapshot.

## Remaining product-expansion items

The reproducible backend defects from the audit are repaired. The audit also lists larger, previously absent vertical features—not regressions in the 44-case harness—including team administration, price-list/variant lifecycle, manual allocation/receipt/dispatch/consolidation, proration/credit notes, alert acknowledgement/escalation tasks, and report export generation. Their exact team-visibility, proration/cancellation, and XLS-format decisions remain explicitly open in the repository contracts and should not be silently invented in this repair.
