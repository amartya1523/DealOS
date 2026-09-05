# DealOS — Product requirements

Status: living product contract, 2026-09-05. The current functional slice and remaining limitations are recorded in `memory.me`.

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
| R-006 | Customer tier and category discount ceilings; configurable sequential approval chain | C | A3 | High |
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
| R-018 | One-time plus recurring billing on one order | C | B7 | High |
| R-019 | Portal comments, change requests, counter-discount and confirmation; reapproval | C | B8 | High |
| R-020 | Stalled quotes, unusual discounts, delivery slippage and nudge/escalation | C | B9 | High |
| R-021 | Invoice listing/detail and payment recording | C | Reference 12/13 and acceptance step 8 | High |
| R-022 | Seed data, 5-minute two-flow demo, one-page architecture and future-work note | C | Deliverables | High |
| R-023 | Quote versioning and approval/acceptance binding to exact terms | I | Prevent negotiation from bypassing approvals | High |
| R-024 | Atomic stock reservation and duplicate prevention for billing/payment | I | Prevent overselling and duplicate money movements | High |
| R-025 | Product cost snapshots and cadence-specific margins | I | Required to compute meaningful margin impact | High |
| R-026 | Multiple isolated organizations with one configured transaction currency per quote | C | Superseded by the explicit Platform Super Admin request on 2026-09-05 | High |
| R-027 | Opaque database-backed cookie sessions with CSRF protection | P | Revocable browser sessions fit the same-origin deployment | High |
| R-028 | Approval formula combines worst-line excess and value-weighted excess | P | Brief gives examples but no mathematical formula; see BR-004 | Medium |
| R-029 | Day-based proration using actual billing-period length | P | Exact proration convention not specified | Medium |
| R-030 | Restricted self-signup creates pending reps; Admin activates and assigns roles | P | Supports signup without granting unauthenticated privileged access | High |
| R-031 | Customer portal email/password initially; magic links deferred | P | A1 allows either method; avoids unconfigured email delivery | High |
| R-032 | In-app nudges with durable PostgreSQL job records; no external messages by default | P | Meets alert-action flow without pretending email/SMS is configured | High |
| R-033 | Single service deploy, no Redis/Kafka/microservices | P | Low operational complexity; no requirement justifies them | High |
| R-034 | Dedicated environment-authenticated Platform Owner identity, separate from every organization user and role | C | Corrected explicit Platform Super Admin direction | High |
| R-035 | Global organization/member control plane with live metrics, search, status, paging and privileged audit | C | Explicit Platform Super Admin request | High |
| R-036 | Read-only View As Organization/User retains the real actor and has a persistent exit banner | C | Explicit Platform Super Admin request | High |
| R-037 | Organization suspension blocks normal business operations without deleting history | C | Explicit Platform Super Admin request | High |
| R-038 | High-risk platform changes require a reason and confirmation; organization credentials can never authenticate to the owner console | C | Corrected explicit Platform Super Admin direction | High |

## Actors, outcomes and access

- Sales Rep: prepare assigned/customer-team quotes, explain discounts, respond to requests, inspect fulfillment. Cannot approve own exceptions or manage stock/payments.
- Sales Manager: review team quotes, manage discount chains, see team deal health and reports. Cannot masquerade as a customer or record payments unless separately assigned Finance role.
- Finance/Operations: second-level discount approval, stock allocation, billing changes, payment recording and credit notes.
- Customer: only quotations/orders/invoices associated with their linked customer account; see commercial prices but not internal costs, margins, risk or reviewer notes.
- Admin: activate identities, manage configuration and organization reporting. Admin status alone does not bypass approval segregation; a separately assigned reviewer role is required.
- Platform Super Admin / Platform Owner: authenticate only at `/login/super-admin` using server environment credentials, then inspect and administer all organizations from a separate global control plane. This identity is not a database user, organization member or organization role. The owner can enter a read-only simulated organization/user context while the environment login ID remains the audit actor.

Multi-role internal users are supported; permissions compose, but self-approval restrictions still apply.

## Principal workflows

W-01 Identity and role activation → W-02 commercial/inventory setup → W-03 quote preparation → W-04 approval → W-05 customer negotiation and acceptance → W-06 order/allocation → W-07 subscription billing → W-08 invoice/payment. W-09 deal health and W-10 reporting operate across those workflows. Full triggers, transactions and recovery appear in [Domain.md](Domain.md).

## Workflow interpretation decisions

The board shows fulfillment/billing before portal review as a navigation sequence. The PDF also says actual fulfillment follows customer confirmation. Proposed resolution: previews are available before acceptance; executable order creation requires acceptance and valid approval for the current revision. Internal approval, customer acceptance, shipment and invoice/payment each have separate states.

The PDF describes aggregate margin erosion even when individual limits appear acceptable. The implementation therefore needs an explicit aggregate discount/margin policy; it must not claim that averaging within-limit line excess detects this by itself.

## MVP and release scope

MVP demo: authenticated configuration, saved quotations, discounts and sequential approval, real recommendations, restricted negotiation, version-safe acceptance, stock splitting/backorder, hybrid invoice/schedule and recorded payments. Deal-health rules and reporting complete the specified release. Optional pairing-rule UI and multi-currency conversion/multi-company are not MVP gates.

Future scope: email delivery integration, real payment gateway, exchange-rate conversion, sophisticated warehouse optimization and statistical recommendation training. Multi-organization isolation and the global platform control plane are now implemented scope; richer company accounting remains future scope.

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

### B: negotiation and operational change

1. Customer submits a larger discount proposal against a sent revision.
2. Rep adopts the proposal as a new revision; old approvals/acceptance cannot authorize it.
3. Required reapproval executes; customer accepts final terms.
4. Partial stock is allocated; new stock receipt prompts consolidation of unshipped remainder only.
5. Mid-cycle recurring quantity change creates an auditable proration adjustment; eligible cancellation creates a credit note.
6. A stale quote alert links to its deal; an in-app nudge is persisted; a filtered report matches source records.

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
