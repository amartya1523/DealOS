# DealOS — PostgreSQL persistence design

Status: living persistence contract. Six migrations implement the current functional subset; the broader entity catalog remains target architecture. PostgreSQL is authoritative.

## Shared field conventions

Unless a table explicitly represents a join, each table has `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`, `created_at timestamptz NOT NULL DEFAULT now()` and `updated_at timestamptz NOT NULL`. Join tables also use UUID IDs initially for uniform audit referencing and enforce their natural composite uniqueness. Append-only tables use created/occurred time and do not permit updates; an unused updated_at need not be added to those tables. `?` means nullable, otherwise NOT NULL. `U` means UNIQUE. Every FK is explicitly named in migration and indexed unless already the leading key of an index. Numeric money values use `numeric(19,4)` internal precision and currency rounding at posting; rates use fixed precision, never float. Quantities use `numeric(14,3)` with integer enforcement for stock-tracked unit products. ISO currency, IANA timezone and email constraints are validated at the boundary. PostgreSQL `citext` is proposed for case-insensitive email; if unavailable use normalized email plus unique lower(email), documented in migration.

Lifecycle enums below are application enums plus DB CHECK constraints (or reviewed native PostgreSQL enums). Tenant-owned records carry required organization foreign keys. Normal access derives from server-side organization identity and membership; the independent Platform Owner crosses that boundary only through allowlisted control-plane operations.

## Entity catalog

### `users`

- **Owner:** identity.
- **Fields:** email citext U; display_name text; password_hash text; status enum(PENDING,ACTIVE,DISABLED); customer_id uuid? FK customers; session_version int default 1.
- **Constraints and indexes:** email unique; status indexed; a CUSTOMER role requires customer_id; disable instead of delete.

### `roles`

- **Owner:** identity.
- **Fields:** code text U; name text.
- **Constraints and indexes:** seed only REP,MANAGER,FINANCE_OPS,CUSTOMER,ADMIN; no public role creation.

### `user_roles`

- **Owner:** identity.
- **Fields:** user_id uuid FK users; role_id uuid FK roles.
- **Constraints and indexes:** unique(user_id,role_id); reject mixing CUSTOMER with internal roles.

### `teams`

- **Owner:** identity.
- **Fields:** name text U; active bool.
- **Constraints and indexes:** archive; referenced deals retain team.

### `team_memberships`

- **Owner:** identity.
- **Fields:** team_id uuid FK teams; user_id uuid FK users.
- **Constraints and indexes:** unique(team_id,user_id); index user_id.

### `sessions`

- **Owner:** identity.
- **Fields:** user_id uuid FK users; token_hash text U; csrf_hash text; absolute_expires_at timestamptz; last_seen_at timestamptz; revoked_at timestamptz?; user_session_version int.
- **Constraints and indexes:** index(user_id,revoked_at), expires; never store raw token.

### `customer_tiers`

- **Owner:** catalog.
- **Fields:** code text U; name text; active bool.
- **Constraints and indexes:** referenced policy ceilings, not hardcoded business caps.

### `customers`

- **Owner:** catalog.
- **Fields:** name text; tier_id uuid FK customer_tiers; team_id uuid FK teams; currency char(3); billing_contact_email citext?; billing_address jsonb; active bool.
- **Constraints and indexes:** index(team_id,name); scoped unique reference code can be added; addresses validated objects, not arbitrary system state.

### `categories`

- **Owner:** catalog.
- **Fields:** name text U; kind enum(HARDWARE,SERVICE,SUBSCRIPTION); active bool.
- **Constraints and indexes:** discount ceilings reference ID; archive only.

### `products`

- **Owner:** catalog.
- **Fields:** name text; description text; category_id uuid FK categories; unit text; tax_rate numeric(7,4); active bool.
- **Constraints and indexes:** tax_rate 0..100; index(category_id,active); costs held at variant level.

### `product_attributes`

- **Owner:** catalog.
- **Fields:** name text U.
- **Constraints and indexes:** example RAM, Color; controlled catalog.

### `attribute_values`

- **Owner:** catalog.
- **Fields:** attribute_id uuid FK product_attributes; value text.
- **Constraints and indexes:** unique(attribute_id,value).

### `product_variants`

- **Owner:** catalog.
- **Fields:** product_id uuid FK products; sku text U; base_price numeric(19,4); cost numeric(19,4); currency char(3); stock_tracked bool; active bool.
- **Constraints and indexes:** base_price,cost>=0; index(product_id,active); cost required to submit margin-dependent quotes.

### `variant_attribute_values`

- **Owner:** catalog.
- **Fields:** variant_id uuid FK product_variants; attribute_value_id uuid FK attribute_values; extra_price numeric(19,4).
- **Constraints and indexes:** unique(variant_id,attribute_value_id); one value per attribute per variant enforced by service/constraint trigger.

### `price_lists`

- **Owner:** catalog.
- **Fields:** name text; tier_id uuid? FK customer_tiers; currency char(3); valid_from timestamptz; valid_to timestamptz?; active bool.
- **Constraints and indexes:** index(tier_id,currency,valid_from); reject overlapping active resolution windows of equal specificity.

### `price_rules`

- **Owner:** catalog.
- **Fields:** price_list_id uuid FK price_lists; variant_id uuid? FK product_variants; category_id uuid? FK categories; adjustment_kind enum(FIXED,PERCENT); value numeric(19,4); min_quantity numeric(14,3).
- **Constraints and indexes:** exactly one variant/category target; unique target/min_quantity/list; min_quantity>0; deterministic priority variant before category.

### `discount_policies`

- **Owner:** catalog.
- **Fields:** name text; version int; state enum(DRAFT,PUBLISHED,RETIRED); effective_at timestamptz; aggregate_caps jsonb; minimum_margins jsonb.
- **Constraints and indexes:** unique(name,version); only one current published policy for organization; JSON has validated currency/cadence schema.

### `discount_ceilings`

- **Owner:** catalog.
- **Fields:** policy_id uuid FK discount_policies; tier_id uuid? FK customer_tiers; category_id uuid? FK categories; ceiling_percent numeric(7,4).
- **Constraints and indexes:** exactly one tier/category per row; 0..100; partial unique(policy_id,tier_id), (policy_id,category_id).

### `approval_bands`

- **Owner:** catalog.
- **Fields:** policy_id uuid FK discount_policies; metric enum(WORST_EXCESS,WEIGHTED_EXCESS,AGGREGATE_DISCOUNT,MIN_MARGIN); threshold numeric(12,4); comparator enum(GT,GTE,LT); required_level enum(MANAGER,FINANCE).
- **Constraints and indexes:** unique(policy_id,metric,threshold,comparator); published immutable; highest matched level wins.

### `subscription_plans`

- **Owner:** catalog.
- **Fields:** name text; version int; interval_months int; billing_timezone text; proration_method enum(ACTUAL_DAYS); cancellation_policy jsonb; active bool.
- **Constraints and indexes:** unique(name,version); interval_months IN(1,3,12); valid IANA zone and typed policy; referenced version immutable.

### `product_plan_links`

- **Owner:** catalog.
- **Fields:** variant_id uuid FK product_variants; plan_id uuid FK subscription_plans; recurring_price numeric(19,4); recurring_cost numeric(19,4); currency char(3).
- **Constraints and indexes:** unique(variant_id,plan_id); nonnegative prices/costs; explicit cost per billing cadence.

### `recommendation_rules`

- **Owner:** recommendations.
- **Fields:** source_variant_id uuid FK product_variants; suggested_variant_id uuid FK product_variants; promotion_start timestamptz?; promotion_end timestamptz?; promotion_weight numeric(8,4); minimum_margin numeric(7,4); active bool.
- **Constraints and indexes:** source != suggestion; unique(source,suggestion); nonnegative weight; optional curated-rule setup.

### `quotations`

- **Owner:** quotations.
- **Fields:** number text U; customer_id uuid FK customers; owner_id uuid FK users; team_id uuid FK teams; current_revision_id uuid? FK quotation_revisions; lock_version int; last_activity_at timestamptz; archived_at timestamptz?.
- **Constraints and indexes:** index(team_id,last_activity_at), (customer_id,created_at); current revision belongs to same quote, validated transactionally.

### `quotation_revisions`

- **Owner:** quotations.
- **Fields:** quotation_id uuid FK quotations; revision_number int; document_state enum(DRAFT,SUBMITTED,SENT,SUPERSEDED); currency char(3); tier_id uuid FK customer_tiers; policy_id uuid? FK discount_policies; order_discount numeric(7,4); valid_until timestamptz; promised_delivery_at timestamptz?; terms text; totals_by_cadence jsonb; lock_version int; submitted_by uuid? FK users; submitted_at timestamptz?; sent_at timestamptz?.
- **Constraints and indexes:** unique(quotation_id,revision_number); one draft per quotation partial index; snapshots freeze on submit; totals JSON is validated derived cache, line snapshots are canonical.

### `quotation_lines`

- **Owner:** quotations.
- **Fields:** revision_id uuid FK quotation_revisions; position int; variant_id uuid FK product_variants; plan_id uuid? FK subscription_plans; description text; sku text; category_id uuid FK categories; quantity numeric(14,3); unit_price numeric(19,4); unit_cost numeric(19,4); tax_rate numeric(7,4); line_discount numeric(7,4); effective_discount numeric(7,4); allowed_discount numeric(7,4); net_amount numeric(19,4); tax_amount numeric(19,4); cadence_months int?; pricing_snapshot jsonb; origin enum(MANUAL,SUGGESTION).
- **Constraints and indexes:** unique(revision_id,position); quantity>0; discount/tax bounds; plan/cadence consistency; integer quantities for stock-tracked unit products.

### `suggestion_dismissals`

- **Owner:** recommendations.
- **Fields:** revision_id uuid FK quotation_revisions; variant_id uuid FK product_variants; user_id uuid FK users.
- **Constraints and indexes:** unique(revision_id,variant_id,user_id); ephemeral preference, may expire on revision supersession.

### `approval_cases`

- **Owner:** governance.
- **Fields:** revision_id uuid FK quotation_revisions; policy_id uuid FK discount_policies; state enum(PENDING,APPROVED,REJECTED,RETURNED,SUPERSEDED); required_level enum(NONE,MANAGER,FINANCE); risk_components jsonb; submitted_by uuid FK users; completed_at timestamptz?.
- **Constraints and indexes:** one active case per revision partial unique; index(state,created_at); validated explainable component snapshot.

### `approval_steps`

- **Owner:** governance.
- **Fields:** case_id uuid FK approval_cases; sequence int; reviewer_role text; assigned_user_id uuid? FK users; state enum(WAITING,PENDING,APPROVED,REJECTED,RETURNED); decided_by uuid? FK users; decided_at timestamptz?; reason text?.
- **Constraints and indexes:** unique(case_id,sequence); pending assigned-role index; decision fields required together; service checks self-approval and sequence.

### `negotiation_proposals`

- **Owner:** portal.
- **Fields:** revision_id uuid FK quotation_revisions; customer_id uuid FK customers; proposed_by uuid FK users; state enum(OPEN,ADOPTED,DECLINED,SUPERSEDED); proposed_order_discount numeric(7,4)?; requested_delivery_at timestamptz?; message text; responded_by uuid? FK users; response_reason text?; adopted_revision_id uuid? FK quotation_revisions.
- **Constraints and indexes:** index(revision_id,state); at least one requested change; bounds for discount.

### `proposal_lines`

- **Owner:** portal.
- **Fields:** proposal_id uuid FK negotiation_proposals; quotation_line_id uuid FK quotation_lines; proposed_quantity numeric(14,3)?; proposed_discount numeric(7,4)?; message text?.
- **Constraints and indexes:** unique(proposal_id,quotation_line_id); line must belong to proposal revision; changes are proposals, not canonical price writes.

### `quotation_comments`

- **Owner:** portal.
- **Fields:** revision_id uuid FK quotation_revisions; quotation_line_id uuid? FK quotation_lines; author_id uuid FK users; visibility enum(CUSTOMER,INTERNAL); body text.
- **Constraints and indexes:** index(revision_id,created_at); length bound; line must belong to revision; portal only CUSTOMER visibility.

### `acceptances`

- **Owner:** portal.
- **Fields:** revision_id uuid U FK quotation_revisions; customer_id uuid FK customers; accepted_by uuid FK users; accepted_at timestamptz; terms_hash text.
- **Constraints and indexes:** one acceptance per revision; immutable; customer belongs to quote.

### `orders`

- **Owner:** orders.
- **Fields:** number text U; revision_id uuid U FK quotation_revisions; acceptance_id uuid U FK acceptances; customer_id uuid FK customers; team_id uuid FK teams; currency char(3); state enum(CONFIRMED,PARTIALLY_FULFILLED,FULFILLED,CANCELED); promised_delivery_at timestamptz?; lock_version int.
- **Constraints and indexes:** unique revision is retry defense; index(customer_id,created_at), (state,promised_delivery_at); no destructive delete.

### `order_lines`

- **Owner:** orders.
- **Fields:** order_id uuid FK orders; quotation_line_id uuid U FK quotation_lines; variant_id uuid FK product_variants; quantity numeric(14,3); commercial_snapshot jsonb; stock_tracked bool; cadence_months int?.
- **Constraints and indexes:** quantity>0; immutable accepted commercial snapshot; index order_id.

### `warehouses`

- **Owner:** fulfillment.
- **Fields:** name text U; priority int; base_shipping_cost numeric(19,4); per_unit_shipping_cost numeric(19,4); shipping_weight numeric(8,4); active bool.
- **Constraints and indexes:** costs and weight>=0; archive only.

### `stock_balances`

- **Owner:** fulfillment.
- **Fields:** warehouse_id uuid FK warehouses; variant_id uuid FK product_variants; on_hand numeric(14,3); reserved numeric(14,3); lock_version int.
- **Constraints and indexes:** unique(warehouse_id,variant_id); CHECK on_hand>=reserved AND reserved>=0; index variant_id.

### `replenishment_rules`

- **Owner:** fulfillment.
- **Fields:** warehouse_id uuid FK warehouses; variant_id uuid FK product_variants; reorder_point numeric(14,3); target_quantity numeric(14,3); active bool.
- **Constraints and indexes:** unique(warehouse_id,variant_id); target>=reorder_point>=0; provides replenishment demand, no supplier-order integration assumed.

### `stock_movements`

- **Owner:** fulfillment.
- **Fields:** stock_balance_id uuid FK stock_balances; kind enum(RECEIPT,ADJUSTMENT,SHIPMENT); quantity_delta numeric(14,3); reference text; reason text; actor_id uuid? FK users; shipment_line_id uuid? FK shipment_lines.
- **Constraints and indexes:** append-only; nonzero delta; index(balance,created_at); balance update and movement atomic.

### `allocations`

- **Owner:** fulfillment.
- **Fields:** order_id uuid FK orders; version int; state enum(ACCEPTED,SUPERSEDED); estimated_cost numeric(19,4); shipment_count int; overridden bool; reason text?.
- **Constraints and indexes:** unique(order_id,version); one ACCEPTED current allocation per order; previews not persisted as reservations.

### `reservations`

- **Owner:** fulfillment.
- **Fields:** allocation_id uuid FK allocations; order_line_id uuid FK order_lines; stock_balance_id uuid FK stock_balances; quantity numeric(14,3); shipped_quantity numeric(14,3); released_quantity numeric(14,3).
- **Constraints and indexes:** quantity>0; shipped+released<=quantity; index(order_line_id), (stock_balance_id); open balance derived.

### `shipments`

- **Owner:** fulfillment.
- **Fields:** order_id uuid FK orders; warehouse_id uuid FK warehouses; dispatched_at timestamptz; reference text; dispatched_by uuid FK users.
- **Constraints and indexes:** append-only after dispatch; index(order_id,dispatched_at).

### `shipment_lines`

- **Owner:** fulfillment.
- **Fields:** shipment_id uuid FK shipments; reservation_id uuid FK reservations; order_line_id uuid FK order_lines; quantity numeric(14,3).
- **Constraints and indexes:** quantity>0; order/warehouse must match reservation; unique(shipment_id,reservation_id).

### `subscriptions`

- **Owner:** billing.
- **Fields:** order_line_id uuid U FK order_lines; plan_id uuid FK subscription_plans; state enum(PENDING,ACTIVE,CANCELED); quantity numeric(14,3); recurring_price numeric(19,4); currency char(3); anchor_day int; interval_months int; billing_timezone text; starts_at timestamptz; next_bill_at timestamptz; canceled_at timestamptz?; policy_snapshot jsonb; lock_version int.
- **Constraints and indexes:** index(state,next_bill_at); anchor_day 1..31; interval 1/3/12; one subscription per recurring line.

### `subscription_changes`

- **Owner:** billing.
- **Fields:** subscription_id uuid FK subscriptions; effective_at timestamptz; old_terms jsonb; new_terms jsonb; reason text; actor_id uuid FK users; adjustment_invoice_line_id uuid? FK invoice_lines; credit_note_id uuid? FK credit_notes.
- **Constraints and indexes:** append-only; index(subscription_id,effective_at); no overlapping duplicated adjustment intervals.

### `billing_periods`

- **Owner:** billing.
- **Fields:** subscription_id uuid FK subscriptions; period_start timestamptz; period_end timestamptz; state enum(DUE,INVOICED); invoice_line_id uuid? U FK invoice_lines.
- **Constraints and indexes:** unique(subscription_id,period_start,period_end); end>start; no overlapping period ranges; index(state,period_start).

### `invoices`

- **Owner:** billing.
- **Fields:** number text U; order_id uuid FK orders; customer_id uuid FK customers; currency char(3); state enum(DRAFT,ISSUED,PARTIALLY_PAID,PAID,VOID); issued_at timestamptz?; due_at timestamptz; subtotal numeric(19,4); tax_total numeric(19,4); total numeric(19,4); lock_version int.
- **Constraints and indexes:** index(customer_id,due_at), (state,due_at); totals>=0; issued lines immutable; balance derived from postings.

### `invoice_lines`

- **Owner:** billing.
- **Fields:** invoice_id uuid FK invoices; order_line_id uuid FK order_lines; description text; kind enum(ONE_TIME,RECURRING,ADJUSTMENT); quantity numeric(14,3); unit_price numeric(19,4); net_amount numeric(19,4); tax_amount numeric(19,4); period_start timestamptz?; period_end timestamptz?; charge_key text U.
- **Constraints and indexes:** charge_key prevents repeat one-time/period billing; nonnegative normal charges; credits separate; period fields paired.

### `payments`

- **Owner:** billing.
- **Fields:** customer_id uuid FK customers; currency char(3); amount numeric(19,4); paid_at timestamptz; external_reference text; recorded_by uuid FK users; reversal_of_id uuid? U FK payments; reason text?.
- **Constraints and indexes:** amount>0; immutable; reversal uses positive compensating amount and explicit link; index(customer_id,paid_at).

### `payment_allocations`

- **Owner:** billing.
- **Fields:** payment_id uuid FK payments; invoice_id uuid FK invoices; amount numeric(19,4).
- **Constraints and indexes:** unique(payment_id,invoice_id); amount>0; currency/customer must match; sum locked against payment and invoice limits.

### `credit_notes`

- **Owner:** billing.
- **Fields:** number text U; invoice_id uuid FK invoices; subscription_id uuid? FK subscriptions; amount numeric(19,4); tax_amount numeric(19,4); reason text; issued_by uuid FK users; interval_start timestamptz?; interval_end timestamptz?; credit_key text U; cash_refund_status enum(NOT_REQUIRED,PENDING,RECORDED).
- **Constraints and indexes:** amount>0; append-only; sum credits/payments cannot over-reduce invoice; provider execution outside initial scope.

### `health_rules`

- **Owner:** deal-health.
- **Fields:** name text U; kind enum(STALLED,DISCOUNT_ANOMALY,DELIVERY_SLIPPAGE); config jsonb; active bool.
- **Constraints and indexes:** typed validated config; minimum history and threshold explicit.

### `deal_alerts`

- **Owner:** deal-health.
- **Fields:** rule_id uuid FK health_rules; quotation_id uuid? FK quotations; order_id uuid? FK orders; state enum(OPEN,ACKNOWLEDGED,RESOLVED); severity enum(INFO,WARNING,CRITICAL); reason text; evidence jsonb; first_seen_at timestamptz; last_seen_at timestamptz; resolved_at timestamptz?.
- **Constraints and indexes:** exactly one quote/order; partial unique active(rule,resource); scope joins to authoritative resource.

### `notifications`

- **Owner:** deal-health.
- **Fields:** alert_id uuid? FK deal_alerts; recipient_id uuid FK users; actor_id uuid? FK users; kind enum(NUDGE,ESCALATION,BACKORDER); body text; read_at timestamptz?; dedup_key text U.
- **Constraints and indexes:** index(recipient_id,read_at,created_at); in-app delivery only.

### `jobs`

- **Owner:** shared.
- **Fields:** kind enum(BILLING,HEALTH_SCAN,BACKORDER_SCAN); business_key text U; payload jsonb; state enum(PENDING,RUNNING,SUCCEEDED,FAILED); run_after timestamptz; lease_expires_at timestamptz?; attempts int; last_error_code text?.
- **Constraints and indexes:** index(state,run_after); bounded retry; payload validated, no credentials.

### `idempotency_records`

- **Owner:** shared.
- **Fields:** actor_id uuid? FK users; operation text; resource_key text; key text; payload_hash text; response_status int; response_body jsonb; expires_at timestamptz.
- **Constraints and indexes:** unique(actor_scope,operation,resource_key,key) using normalized system actor scope; bounded retention; avoid storing secrets in response.

### `audit_events`

- **Owner:** shared.
- **Fields:** actor_id uuid? FK users; action text; resource_type text; resource_id uuid; revision_id uuid?; reason text; request_id text; safe_changes jsonb; occurred_at timestamptz.
- **Constraints and indexes:** append-only; index(resource_type,resource_id,occurred_at), (actor_id,occurred_at); polymorphic resource reference validated in service; no secrets.

## Relationships and integrity

- Users N↔N roles through user_roles; users N↔N teams through team_memberships. Customer identity links to one customer; customer has many portal users.
- Product 1→N variants; variant N↔N attribute values. Rules distinguish product category versus exact variant. Plan links supply explicit cadence price/cost.
- Quotation 1→N revisions 1→N lines. `current_revision_id` is created after initial revision inside a transaction to resolve the circular reference. A DB constraint trigger or composite FK must prevent referencing another quote's revision.
- Revision 1→N approval cases over history, at most one active. Approval case 1→N ordered steps. Revision 0→1 acceptance; eligible revision 0→1 order.
- Proposal lines/comments must reference lines from the same revision. Use composite `(id,revision_id)` unique references where possible rather than relying solely on client validation.
- Stock balance is the warehouse/variant join. Reservations link order lines to balances. Shipment lines preserve which reservation was consumed. `sum(active reservations)` must agree with reserved quantity; update both atomically and include reconciliation query.
- Backorder quantity is derived from ordered quantity minus shipped, canceled and open reserved quantities; no separate mutable counter without a consistency rule. Initial schema needs `canceled_quantity numeric(14,3) default 0` on order_lines if unshipped cancellation is implemented; add it with that phase's migration and enforce 0≤canceled≤quantity−shipped.
- One recurring order line produces one subscription. Periods link to exactly one recurring charge; charge_key and period uniqueness prevent job duplicates.
- Payment N↔N invoice through allocations. Initial UI records payment against one invoice; relational model can support split allocation later without changing financial identity. Reversals subtract allocations through explicit reversal linkage; never edit the original payment.
- Credit notes reduce invoice receivable; cash-refund status does not imply the application transferred money. If actual refunds are later recorded, add immutable refund payment records with bank/provider reference and reconciliation contract first.

## Canonical, derived and historical data

Canonical: submitted quote snapshots, accepted order lines, physical movements, invoice postings, payment allocations, credit notes. Derived: pipeline stage, available stock, outstanding demand, invoice balance and aggregated reports. Cached totals/risk snapshots carry calculator/policy version and are recalculated on draft change. Historical records retain product name/SKU, resolved price, tax, cost, plan and policy even after catalog edits. Never join current product prices to recalculate old invoices.

## Critical transaction design

| Operation | Lock / isolation | Atomic writes | Failure invariant |
|---|---|---|---|
| Draft save | quote/revision optimistic lock_version | revision/lines + version + audit | Stale update cannot overwrite newer draft |
| Submit | lock current quote/revision | freeze revision, risk/case/steps, audit | No submitted ungoverned revision |
| Approval decision | lock case + current step | decision + next step/case + audit | One decision wins; no Finance-before-Manager |
| Adopt proposal | quote lock, check current revision | new revision, proposal state, supersession, audit | Old acceptance/approval cannot authorize changed terms |
| Confirm order | lock quote/revision and acceptance; unique revision | acceptance/order/lines + audit + due job | At most one order for eligible revision |
| Allocate/override | lock balances sorted by warehouse/variant; lock order | reservations, balance increments, allocation and audit | No overselling or partially committed split |
| Ship | lock reservations/balances/order | shipment/lines, movements, balance decrement and audit | On-hand/reserved reconcile |
| Receive/reconcile | lock stock balance | movement + on-hand + backorder job + audit | Receipt cannot silently replace balance |
| Generate billing | lock subscription/due period; unique charge_key | period, invoice/lines, next bill, job and audit | Retry generates no duplicate receivable |
| Change/cancel subscription | lock subscription/affected period | change/credit/next schedule + audit | No overlapping duplicate credit |
| Record payment | lock invoice and idempotency scope | payment/allocation + derived status + audit | Concurrent payments cannot exceed balance |

Use READ COMMITTED plus explicit row locks and uniqueness for these invariants; SERIALIZABLE can be selected for multi-row predicates, with at most three bounded retries for serialization/deadlock errors. Retry only pure DB transactions. Advisory job locks are coordination aids, not business uniqueness guarantees. HTTP retries reuse original keys.

## Migration strategy

P1 adds identity/session/team tables. P2 adds configuration/stock foundation. P3 adds quotations/recommendations. P4 adds approval history. P5 adds portal/order records. P6 adds operational reservation/shipment tables. P7 adds billing ledger. P8 adds health/jobs/report indexes. Shared audit/idempotency are introduced with the first governed mutation, not deferred until hardening.

Prisma schema is not a replacement for migrations. Commit reviewed SQL under backend/prisma/migrations. Use expand/backfill/validate/contract for incompatible production changes. Never run `prisma db push` against production. Validate migration on an empty database and on a previous-phase fixture. Data migrations must preserve snapshots and use explicit rollback/forward-fix instructions. Production migrations run with a separate credential and backup checkpoint.

## Deletion, retention and ownership

Archive customers/products/warehouses/plans; deactivate users and revoke sessions. Financial documents, submitted revisions, approvals, stock movements and audit history are append-only; no cascade deletion from catalog/customer into history. Draft-only dependent lines may cascade with their draft in a controlled service operation. Join records/session rows may be deleted on permitted lifecycle cleanup. Database FK delete actions default RESTRICT; choose CASCADE only for truly subordinate nonhistorical rows.

Proposed retention: expired sessions/idempotency payloads and terminal jobs pruned by a configured maintenance job; financial/audit retention is a deployment policy requiring owner input, not an invented statutory duration. Customer personal-data removal requires explicit export/anonymization policy that preserves financial integrity. Backups encrypted, access restricted, restoration tested in an isolated database.

## Index and query review

List queries constrain team/customer/state/date and use stable `(created_at,id)` cursor ordering. Add composite indexes based on actual query plans; no index on every field by reflex. Limit quotation line count (proposed 200) and export date range. Reports read posted records with scoped SQL aggregation; avoid N+1 line/case lookups. Do not introduce materialized views until measured report latency justifies refresh consistency work.

## Current database state

The merged history contains eight ordered migrations through `20260905220000_platform_owner_control_plane`. The final migration runs after the customer tenant-isolation repairs and adds organization status/slug, `OrganizationMembership`, `OrganizationInvitation`, `PlatformOwnerSession`, `PrivilegedAudit`, CSRF/View As session fields and organization-scoped uniqueness. It backfills memberships from the latest-main `User.organizationId` relationship and does not persist the Platform Owner password.

The former feature-only `20260905130000`–`20260905150000` migration sequence was consolidated because it independently created tables later introduced on `main`. Retaining both sequences would make fresh and existing-main deployments fail. The consolidated migration was verified from an empty PostgreSQL database followed by the merged deterministic seed.

The merged migration chain and deterministic seed were executed against a disposable PostgreSQL database. The developer's primary database was not reset during conflict resolution. The larger table inventory remains a phased contract beyond the implemented Prisma models.

## Implemented identity delta — 2026-09-05

Migration `20260905120000_pending_accounts` adds PostgreSQL `AccountStatus` (PENDING, ACTIVE, DISABLED) and `User.status`. Latest-main onboarding creates a new organization and its first ACTIVE Admin through email/password or verified Google signup; generated organization users are also ACTIVE and module-scoped. Login and session middleware require ACTIVE.

## Implemented audit-hardening delta — 2026-09-05

Migration `20260905190000_audit_backend_hardening` adds Customer foreign keys, QuoteRevision snapshots, revision/cycle-bound approvals, proposal classification, CustomerAcceptance, Order/OrderLine, downstream order/customer/product provenance, IdempotencyRecord, request/revision audit context, and stock/invoice/payment CHECK constraints. Existing quote/customer text is backfilled without deleting business history. Payment references are unique per invoice. Quote current-revision circular integrity is established after revision backfill. The migration was validated from the initial migrations in a disposable PostgreSQL schema.
