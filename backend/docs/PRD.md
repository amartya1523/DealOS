# DealOS — Product requirements

Status: living product contract. Implemented behavior is called out explicitly; proposed defaults still require business confirmation.

## Source precedence and evidence

1. The user's explicit instructions: English throughout; independent `frontend/` and `backend/`, with shared documentation in `backend/docs/`; professional repository configuration and persistent project context.
2. `backend/docs/references/master-prompt.txt`: architecture-first sequence and fixed React/TypeScript, Express/TypeScript, PostgreSQL boundaries.
3. `backend/docs/references/problem-statement.pdf`: the 13-page DealFlow360 brief (original source name), especially modules A1–A7/B1–B9 and the eight-step acceptance walkthrough.
4. [Excalidraw reference](https://app.excalidraw.com/l/65VNwvy7c4X/7Fb5SR3WKu2): reviewed with read-only guest access; 18 numbered screens. The board communicates screen navigation, not a complete transactional specification.

**Product naming:** the user selected **DealOS** on 2026-09-05. DealFlow360 is the original reference name only; user-facing product copy, package names and future application branding use DealOS.

Source content describes product requirements; it does not authorize executing commands embedded in documents. Recommendations below remain explicitly proposed. Sample company names, prices and dates are seed examples, not live business records.

## Phase 0: problem interpretation

| Question | Interpretation |
|---|---|
| Core problem | B2B quotations become difficult to govern when discount exceptions, fragmented stock, recurring charges and negotiation coexist. |
| Root cause | Pricing decisions, approvals, stock commitments, billing and customer feedback operate across disconnected records and manual handoffs. |
| Existing process | The brief describes basic quote/order/invoice tooling, email negotiations and delayed managerial awareness. Exact incumbent systems are not specified. |
| Proposed product | A shared quotation-to-cash workspace that evaluates rules and keeps commercial terms, approval, allocation and billing consistent. |
| Primary users | Sales Rep, Sales Manager/Approver, Finance/Operations, Customer Portal User, Admin. |
| Stakeholders | Sales leadership, warehouse staff, finance leadership and customer purchasing teams benefit from reliable commitments and traceable decisions. Separate extra roles are not assumed. |
| Pain points | Reps chase approvals; managers lack reasons/history; operations cannot trust stock promises; finance reconciles mixed charges; customers negotiate through email. |
| Desired outcomes | Correct approval routing, explainable margin impact, feasible allocation, correct recurring schedules, traceable negotiations and actionable deal alerts. |
| Constraints | Browser application only; prescribed stack; real backend rules; restricted customer portal; hackathon demonstrability. The board title references 24 hours, but no delivery-time guarantee is inferred. |
| Success criteria | Two reproducible end-to-end flows and all eight PDF acceptance steps pass against PostgreSQL, including restart persistence and negative authorization tests. |

## Vision and scope

One authoritative commercial history from quote preparation through payment. The core product includes backend setup, operational workflows and customer review. A modular implementation must prioritize correctness over decorative breadth.

## Requirements classification

Confidence means confidence in the interpretation, not implementation status. C = Confirmed, I = Inferred, P = Proposed.

| ID | Requirement | Type | Reason / source | Confidence |
|---|---|---|---|---|
| R-001 | React + TypeScript frontend; Express + TypeScript REST backend; PostgreSQL, preferably Prisma | C | Master prompt | High |
| R-002 | Separate frontend/backend/docs; no mobile application | C | User + master prompt | High |
| R-003 | Internal signup/login and customer portal authentication | C | A1 | High |
| R-004 | Five roles with server-enforced access | C | PDF user roles + technical guidelines | High |
| R-005 | Products, variants, units, descriptions, taxes and tier price lists | C | A2 | High |
| R-006 | Editable customer-tier ceilings and editable Hardware, Services and Subscriptions ceilings; validated, reasoned publication; configurable sequential approval chain | C | A3 | High |
| R-007 | Mixed-category blended risk; highest required approval; audit user/time/reason | C | A3, section 10 | High |
| R-008 | Warehouse stock, replenishment rules and shipment cost weighting | C | A4 | High |
| R-009 | Monthly/quarterly/yearly plans, proration and cancellation credit/refund rules | C | A5 | High |
| R-010 | Live ranked cross-sell/upsell with promotions and margin delta | C | B5, acceptance step 3 | High |
| R-011 | Optional administration of recommendation pairings | C | A6 explicitly optional; suggestions themselves remain core | High |
| R-012 | Filtered reporting and PDF/XLS export | C | A7; board labels reporting optional, treated as later release scope rather than silently removed | High |
| R-013 | Workspace navigation, refresh and close workspace | C | B1 | High |
| R-014 | Quotation cards/list and Kanban pipeline | C | B2, reference screen 3 | High |
| R-015 | Line and order discounts, quantities, totals and margin | C | B3 | High |
| R-016 | Approve/reject/return for revision with reason and audit | C | B4 | High |
| R-017 | Suggested warehouse split, manual override and backorder consolidation | C | B6 | High |
| R-018 | One-time plus recurring billing on one order; subscription list, detail and lifecycle controls restricted to organization Admin | C | B7 + user direction | High |
| R-019 | Portal comments, change requests, counter-discount and confirmation; reapproval | C | B8 | High |
| R-020 | Stalled quotes, unusual discounts, delivery slippage and nudge/escalation | C | B9 | High |
| R-021 | Invoice listing/detail and payment recording | C | Reference 12/13 and acceptance step 8 | High |
| R-022 | Seed data, 5-minute two-flow demo, one-page architecture and future-work note | C | Deliverables | High |
| R-023 | Quote versioning and approval/acceptance binding to exact terms | I | Prevent negotiation from bypassing approvals | High |
| R-024 | Atomic stock reservation and duplicate prevention for billing/payment | I | Prevent overselling and duplicate money movements | High |
| R-025 | Product cost snapshots and cadence-specific margins | I | Required to compute meaningful margin impact | High |
| R-026 | Multiple isolated organizations with one configured transaction currency per quote | C | Explicit Platform Owner direction supersedes the earlier single-organization proposal | High |
| R-027 | Opaque database-backed cookie sessions with CSRF protection | P | Revocable browser sessions fit the same-origin deployment | High |
| R-028 | Approval formula combines worst-line excess and value-weighted excess | P | Brief gives examples but no mathematical formula; see BR-004 | Medium |
| R-029 | Day-based proration using actual billing-period length | P | Exact proration convention not specified | Medium |
| R-030 | Restricted self-signup creates pending reps; Admin activates and assigns roles | P | Supports signup without granting unauthenticated privileged access | High |
| R-031 | Customer portal email/password initially; magic links deferred | P | A1 allows either method; avoids unconfigured email delivery | High |
| R-032 | In-app nudges with durable PostgreSQL job records; no external messages by default | P | Meets alert-action flow without pretending email/SMS is configured | High |
| R-033 | Single service deploy, no Redis/Kafka/microservices | P | Low operational complexity; no requirement justifies them | High |
| R-034 | Offer verified Google account creation only on the public sign-up page; keep sign-in email/password only | C | User request, 2026-09-05 | High |
| R-035 | Dedicated environment-authenticated Platform Owner, separate from every organization user and role | C | Corrected explicit Super Admin direction | High |
| R-036 | Global organization/member control plane with live metrics, search, status, paging and privileged audit | C | Explicit Super Admin request | High |
| R-037 | Read-only View As Organization/User retains the real owner actor and blocks writes | C | Explicit Super Admin request | High |
| R-038 | Organization credentials can never authenticate to the owner console | C | Corrected explicit Super Admin direction | High |
| R-039 | A customer account has one primary sales team, one active primary Rep and optional same-team collaborators; quotations snapshot an explicitly valid owner/team and never change automatically when the account is reassigned | C | User-directed customer ownership feature, 2026-09-05 | High |
| R-040 | Manager/Admin may issue a single-use customer portal invitation only after primary assignment; the raw link is returned once for manual sharing, while only its hash is stored. Acceptance creates a Customer-scoped portal identity and no external email delivery is implied | C | User-directed customer intake/onboarding flow, 2026-09-05 | High |
| R-041 | Saving a quote creates an immutable Draft snapshot; submission creates a policy-bound submitted revision and routes any effective discount through Manager, adding Finance only after Manager for configured high-excess, aggregate-discount, or margin-floor risk. Return supersedes unfinished steps and creates a new Draft revision. The builder may show unranked active-product add-ons calculated by the authoritative pricing engine; ranking, promotions, dismissals, and recommendation history are outside this increment | C | User-directed quotation builder and governance flow, 2026-09-06 | High |
| R-042 | Exact-revision confirmation atomically creates one immutable Order, one combined mixed Invoice and one Subscription per recurring line; manual payments/reversals and Admin subscription changes remain audited evidence/state operations and never move money | C | Supplied sections 5/6B/7 implementation prompt, 2026-09-06 | High |
| R-043 | Initial confirmation Invoice is due after 14 days until an organization policy is confirmed | P | Diagram gives sequencing but not a confirmed due-term policy | Medium |
| R-044 | Separate one-time/recurring invoices, due-period scheduler, automated proration/cancellation credits and customer self-payment remain explicit GAP/TARGET/future capabilities | C | Supplied diagram labels and Architecture no-payment-provider boundary | High |
| R-045 | Confirmed Order hardware lines drive live on-hand-minus-reserved previews, deterministic suggested or reasoned manual splits, atomic row-locked idempotent reservations, persisted backorders, stock receipts and consolidation | C | Supplied section 6A implementation prompt, 2026-09-06 | High |
| R-046 | `FULFILLED` currently means every hardware quantity is reserved; it does not prove pick, dispatch, tracking, delivery, or physical on-hand consumption | I | Explicitly identified semantic limitation in the supplied section 6A diagram; dispatch remains a later phase | High |
| R-047 | An accepted portal customer with a current active primary Rep may submit a raw quotation request; every submission is retained and becomes either a Lead or a private Draft according to an Admin-configured organization mode | C | User-directed portal RFQ implementation prompt, 2026-09-06 | High |
| R-048 | `LEAD_FIRST` is the initial `RfqHandlingMode` default and five requests per customer/user/hour is the initial limit | P | Safer human-review default and bounded anti-automation control; both require explicit business confirmation | Medium |
| R-049 | Portal request processing is synchronous in the submission transaction; valid catalog lines alone may become priced lines, unmatched input remains internal context, and the assigned Rep receives a recipient-scoped in-app alert | I | Preserves one-draft/one-lead atomicity without an unrequired queue or email provider | High |
| R-050 | When an Admin creates a customer, the Admin must generate an initial temporary password; the customer email becomes an active customer-scoped portal login and the plaintext credential is shown only in the creating browser for manual sharing | C | Explicit user direction, 2026-09-06 | High |
| R-051 | An organization Admin may publish an allowlisted public business profile; a visitor may submit an association request, but only Manager/Admin approval creates the normal Customer, active primary assignment and customer-scoped portal credential. This is discovery/onboarding, not platform-wide multi-business customer identity | C | User-directed public directory and join-request feature, 2026-09-06 | High |

## Actors, outcomes and access

- Sales Rep: see customers with an active account assignment, create quotations only for those customers, own and mutate their own quotations, inspect teammates' quotations read-only, and qualify/convert/dismiss only Leads assigned to them. Cannot approve own exceptions or manage stock/payments.
- Sales Manager: reassign customers and eligible open quotations for teams they manage, inspect/dismiss their teams' Leads, review team quotes, manage discount chains, and see team deal health/reports. Account reassignment never silently rewrites deal history.
- Finance/Operations: second-level discount approval, stock allocation, invoice reconciliation and payment recording. The subscription module is not visible or callable.
- Customer: only quotations/orders/invoices and raw request-status projections associated with their linked customer account; may submit requirements after assignment revalidation, but cannot see private Drafts, internal costs, margins, risk, owner IDs, degradation reasons or dismissal notes.
- Admin: activate identities, manage configuration and organization reporting, choose the audited organization RFQ handling mode, and exclusively manage subscription plans, proration previews, lifecycle changes, cancellations and related credits. Admin status alone does not bypass approval segregation; a separately assigned reviewer role is required.
- Platform Super Admin / Platform Owner: authenticate only at `/login/super-admin` with server environment credentials, administer all organizations from a separate global control plane, and enter explicitly read-only tenant/user contexts. This identity is never an organization user or role.

Multi-role internal users are supported; permissions compose, but self-approval restrictions still apply.

## Principal workflows

W-01 Identity and role activation or W-01A public discovery/association approval → W-02 commercial/inventory setup → W-03 quote preparation or W-03A portal request intake → W-04 approval → W-05 customer negotiation and acceptance → W-06 order/allocation → W-07 subscription billing → W-08 invoice/payment. W-09 deal health and W-10 reporting operate across those workflows. Full triggers, transactions and recovery appear in [Domain.md](Domain.md).

## Workflow interpretation decisions

The board shows fulfillment/billing before portal review as a navigation sequence. The PDF also says actual fulfillment follows customer confirmation. Proposed resolution: previews are available before acceptance; executable order creation requires acceptance and valid approval for the current revision. Internal approval, customer acceptance, shipment and invoice/payment each have separate states.

The PDF describes aggregate margin erosion even when individual limits appear acceptable. The implementation therefore needs an explicit aggregate discount/margin policy; it must not claim that averaging within-limit line excess detects this by itself.

## MVP and release scope

MVP demo: authenticated configuration, saved quotations, discounts and sequential approval, real recommendations, restricted negotiation, version-safe acceptance, stock splitting/backorder, hybrid invoice/schedule and recorded payments. Deal-health rules and reporting complete the specified release. Optional pairing-rule UI and multi-currency conversion/multi-company are not MVP gates.

Future scope: email delivery integration, real payment gateway, recurring-period scheduler, hybrid one-time/recurring invoice separation, proration/credit automation, multi-company, exchange-rate conversion, sophisticated warehouse optimization and statistical recommendation training. These are not secretly included as dependencies. The former dotted “Future portal intake” RFQ branch is no longer a gap: it is implemented as described below. The customer portal still exposes no payment-processing route or Pay button until a real compliant provider is selected.

## Confirmed customer intake and portal onboarding — 2026-09-05

The original solid-line flow is organization setup → Manager/Admin customer profile → primary team/Rep assignment → manual-share portal invitation → assigned Rep quotation draft for that configured customer. Customer profiles already include billing/shipping addresses and payment terms, so no duplicate address model or optional origination note was added. Invitation issuance remains blocked until the current primary assignment exists. Portal users link to `customerId` only, never a sales representative. The invitation token is single-use, hashed at rest, expires after seven days, can be revoked, and is returned only in the creation response as a copyable frontend link. No email service or delivery success is claimed.

The user subsequently confirmed an Admin-provisioned credential path on 2026-09-06. Admin customer creation now requires an email and generated temporary password and atomically creates the active customer-scoped portal identity; only the hash is persisted, and the creating browser shows the plaintext once for manual sharing. Managers can still create a profile without credentials and use the assignment-gated invitation flow later. Early portal login does not bypass customer ownership: portal RFQ submission and internal quotation creation still require the active primary team/Rep assignment.

## Public business discovery and association approval — 2026-09-06

An organization Admin controls a separate public `OrganizationProfile` with display name, short description, category and discoverability. The public directory returns only those allowlisted fields plus the opaque organization identifier needed to submit a request; it never exposes the organization’s internal name, users, customers, catalog pricing/cost/tax, stock, policies or metrics. Catalog preview remains an explicitly omitted optional extension.

A visitor may submit email, company name and a message to one discoverable active organization. One pending request per organization/email is enforced by PostgreSQL and public submission is bounded per email/IP. Submission creates no User, Customer, Lead, RFQ or quotation. A Manager/Admin reviews the tenant-scoped request. Approval selects an eligible primary team/Rep, uses the same customer-profile and relationship services as CAT-02/CAT-03A, provisions a server-generated initial password, and marks the request approved in one transaction. The raw password is returned only in that approval response for manual sharing; only its bcrypt hash is persisted. Decline requires a retained reason and creates no related account records.

The existing singular `User.customerId`/organization membership remains authoritative: approved access belongs to exactly the organization/customer created by the approval. Multi-business identity, organization self-signup from the directory, marketplace ratings/reviews, geographic search, KYB and catalog/pricing disclosure remain out of scope.

## Implemented customer-originated RFQ intake — 2026-09-06

The formerly dotted optional branch is now an implemented extension of the accepted portal identity and customer-assignment boundary. A portal customer submits requirements, optional delivery date and up to 50 catalog/free-text lines. The server locks and revalidates the active primary team/Rep, removes unresolved, inactive or cross-organization product references while retaining the customer's wording with a visible internal degradation marker, and limits each customer/user to five submissions per rolling hour. The raw `PortalRequest` is always retained.

`Organization.rfqHandlingMode` explicitly chooses the processing branch. `LEAD_FIRST` creates a deliberately simple assigned Lead (`NEW → CONVERTED | DISMISSED`); only the assigned Rep converts it through the shared `quotations.createDraft` service, and retries return the same quotation. The managed-team Manager can inspect/dismiss but cannot convert. `DIRECT_DRAFT` invokes that same service synchronously and server-derives customer, team, owner, catalog prices, costs, taxes, policy and risk. Only resolved positive whole-quantity catalog lines are priced; all other text remains an internal revision note. Both paths create a recipient-scoped in-app alert and no email.

Customer history projects only `Received`, `In progress` or `Declined`, the original customer text and safe catalog labels. It never includes owner IDs, Lead dismissal reason, draft links/pricing, internal notes or degradation reasons. The setting change is Admin-only and audited. **Proposed pending explicit confirmation:** `LEAD_FIRST` remains the default and the rolling limit remains five requests per customer/user/hour.

## Acceptance scenarios

### A: governed hybrid deal

1. Configure Gold tier, Hardware/Services limits, two warehouse balances and monthly care plan.
2. Rep creates a hardware/services/recurring quote; service discount 18% exceeds its 10% cap.
3. Adding a valid suggestion updates totals and the appropriate margin bucket from backend calculations.
4. Submit produces Manager step and Finance when configured risk policy requires it.
5. Reviewers act in order; the submitter cannot self-approve.
6. Customer accepts the approved revision; one order is created even when request is retried.
7. Allocate stock across two warehouses without negative availability; any shortage remains a backorder.
8. Generate one-time billing and recurring schedule; record payment and verify invoice balance/status.

Fulfillment UI acceptance: the list shows every warehouse/product balance as backend-derived on-hand, reserved and available, and eligible confirmed hardware orders open a detail screen. The detail screen previews the server-calculated warehouse split before committing it, displays product ordered/fulfilled/backordered quantities and configured cost by warehouse, permits Finance/Admin to submit a reasoned manual split, rejects stale preview fingerprints, and exposes remaining shortage as a backorder. A recorded stock receipt activates the transactional consolidation action and completing the remaining demand updates the fulfillment/order state.

The implemented P6 reservation boundary uses immutable OrderLines rather than mutable quotation/catalog values. Preview is read-only. Suggested and manual reservation converge on the same row-locked service, with `Idempotency-Key` replay and `409 STOCK_CHANGED` fresh availability on a race. Reservation, Backorder and receipt StockMovement are durable records; the JSON split on Fulfillment is only a compatibility read projection. Receipt against an order automatically attempts its outstanding backorder, while the explicit reasoned consolidate action remains available when stock arrived through another process.

**Current fulfillment limitation (R-046):** the required current lifecycle still moves an Order to `FULFILLED` when its hardware is fully reserved. The UI/API call this reservation completion and expressly do not claim that anything was picked, dispatched, tracked, delivered, or deducted from physical on-hand. Those actions remain the next GAP/TARGET phase.

### B: negotiation and operational change

1. Customer submits a larger discount proposal against a sent revision.
2. Rep adopts the proposal as a new revision; old approvals/acceptance cannot authorize it.
3. Required reapproval executes; customer accepts final terms.
4. Partial stock is allocated; new stock receipt prompts consolidation of unshipped remainder only.
5. Admin changes a future recurring amount or pauses/resumes/cancels the obligation; dated history and audit remain visible without rewriting an issued invoice. Automated proration/credit generation remains future work.
6. A stale quote alert links to its deal; an in-app nudge is persisted; a filtered report matches source records.

P5 also confirms the alternate resolution: when the Rep declines a counter proposal with a reason, that proposal closes, the unchanged approved SENT revision becomes acceptable again, and the customer may submit a new, separate counter proposal later. P7 now consumes that stable boundary in the same confirmation transaction: acceptance creates the confirmed Order snapshot, one combined first Invoice using the proposed +14-day due policy, and one Subscription per recurring OrderLine. Fulfillment remains an independent downstream consumer.

## Confirmation billing and continuing operations — 2026-09-06

The implemented current path is intentionally honest about billing scope. Confirmation creates one invoice for the full mixed accepted total; it does not yet split one-time charges from future recurring-period invoices. Each recurring line creates one active subscription whose next date advances by its monthly, quarterly, or yearly cadence. Finance/Admin record evidence of an already-settled payment and can reverse it only with a compensating entry. Admin subscription changes are versioned, dated, reasoned, and future-facing. Portal customers can download invoices and persist a due-date request note, but cannot mutate the due date or initiate payment. Deal-health evaluates real persisted inactivity, revision risk, and promised-delivery state; scoped sales reports aggregate frozen order lines and actual receivables and export genuine PDF or HTML-based XLS files.

## Non-functional acceptance

- Persistence survives process restart; no localStorage/JSON fallback for business data.
- Server validates every commercial calculation and privileged action.
- Transactions roll back failed confirmation, allocation, billing and payment operations.
- Idempotent retries produce one order, one charge per period and one recorded payment per key.
- Keyboard access, explicit labels, readable tabular money, useful loading/empty/error states.
- No exposed secrets, cost/margin in customer payloads, or production seed credentials.
- README commands are verified at the phase where they become runnable; planned commands are not presented as existing functionality.

## Repository organization update — 2026-09-05 [Confirmed]

The user requires application content inside `frontend/` and `backend/`. Each owns its npm manifest, lockfile, dependencies, and configuration; there is no root workspace. Backend environment examples and local configuration live in `backend/`. Shared project documentation lives in `backend/docs/`. Only README.md, compose.yaml, and .gitignore remain as root files. This supersedes the original root documentation/workspace layout.

## Confirmed visual expansion — 2026-09-05

The user explicitly requested an English landing page, polished site-wide visuals, parallax and scroll animation inspired by the supplied GSAP reference, and sign-in/sign-up routes. This adds the public landing page alongside the existing application. Confirmed: retain all business screens. Inferred design choices: forest green, lime and warm paper, Manrope typography, original product illustrations, GSAP ScrollTrigger, reduced-motion support, and mobile layouts. Public preview values are illustrative, never live workspace metrics.

## Confirmed audit repair instruction — 2026-09-05

The user instructed implementation of the backend audit findings and supplied a QA gate requiring preservation of 24 previously passing cases. The repair preserves those cases and separately validates formerly failing customer isolation, commercial recalculation, approval history, owner scope, inventory retry/duplicate demand, payment retry/concurrency, cadence/tax, and downstream billing. Larger unimplemented product verticals remain governed by the open business decisions above and are not mislabeled as completed by this repair.

## Confirmed visual revision — 2026-09-05

User rejected the invented dashboard preview and requested a more ambitious visual and parallax treatment. Removed the public sample dashboard and all invented metrics. The actual authenticated workspace remains at `/app`. Confirmed direction: original imagery, stronger scroll storytelling inspired by the reference repository. Implemented original chrome/glass artwork, oversized type, layered hero parallax, text-color scroll reveal, clipped/pinned connection scene, desktop horizontal workflow, mobile vertical chapters, and an explicit motion pause control.
