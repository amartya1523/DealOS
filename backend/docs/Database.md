# DealOS — PostgreSQL persistence design

Status: living persistence contract. Twenty-six migrations implement the current functional subset; the broader entity catalog remains target architecture. PostgreSQL is authoritative.

## Shared field conventions

Unless a table explicitly represents a join, each table has `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`, `created_at timestamptz NOT NULL DEFAULT now()` and `updated_at timestamptz NOT NULL`. Join tables also use UUID IDs initially for uniform audit referencing and enforce their natural composite uniqueness. Append-only tables use created/occurred time and do not permit updates; an unused updated_at need not be added to those tables. `?` means nullable, otherwise NOT NULL. `U` means UNIQUE. Every FK is explicitly named in migration and indexed unless already the leading key of an index. Numeric money values use `numeric(19,4)` internal precision and currency rounding at posting; rates use fixed precision, never float. Quantities use `numeric(14,3)` with integer enforcement for stock-tracked unit products. ISO currency, IANA timezone and email constraints are validated at the boundary. PostgreSQL `citext` is proposed for case-insensitive email; if unavailable use normalized email plus unique lower(email), documented in migration.

Lifecycle enums below are application enums plus DB CHECK constraints (or reviewed native PostgreSQL enums). Tenant-owned records carry required organization foreign keys. Normal access derives from server-side organization identity and membership; the independent Platform Owner crosses that boundary only through allowlisted control-plane operations.

## Entity catalog

### `users`

- **Owner:** identity.
- **Fields:** email citext U; display_name text; password_hash text; status enum(PENDING,ACTIVE,DISABLED); customer_id uuid? FK customers; session_version int default 1.
- **Constraints and indexes:** email unique; status indexed; a CUSTOMER role requires customer_id; disable instead of delete. Admin-created customer access stores only `password_hash`; Customer, User, PORTAL_USER membership and audit rows are created atomically without a plaintext credential column.

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

### `organization_invitations`

- **Owner:** identity/portal. The existing generic organization invitation record is reused for customer portal onboarding; no parallel `PortalInvitation` table exists.
- **Fields:** organization_id FK; customer_id uuid? FK customers; normalized email; access_role; business_role; token_hash U; status enum(PENDING,ACCEPTED,EXPIRED,REVOKED); invited_by_id FK users; expires_at; accepted_at?; revoked_at?; created_at is the invitation issue time.
- **Constraints and indexes:** token hash unique; partial unique `(customer_id,lower(email)) WHERE customer_id IS NOT NULL AND status='PENDING'`; index(organization_id,customer_id,created_at). Portal rows require PORTAL_USER/CUSTOMER roles. Raw tokens are never persisted. Customer deletion remains restricted because invitation history is auditable.

### `organization_profiles`

- **Owner:** directory.
- **Fields:** organization_id PK/FK organizations ON DELETE CASCADE; display_name text; short_description text?; category text?; is_discoverable bool default false; updated_at.
- **Constraints and indexes:** one profile per organization. Public reads require both `is_discoverable=true` and active Organization status and explicitly project only organization ID, display name, short description and category. Internal Organization name/configuration is not a public fallback.

### `directory_join_requests`

- **Owner:** directory orchestration; catalog/identity services own the Customer/User/relationship records created by approval.
- **Fields:** organization_id FK; normalized email; company_name; message; status enum(PENDING,APPROVED,DECLINED); decided_by_id? FK users; decided_at?; decision_reason?; resulting_customer_id? U FK customers; created_at/updated_at.
- **Constraints and indexes:** unique(organization_id,email,status) prevents duplicate PENDING requests; unique resulting customer; index(organization_id,status,created_at) and (email,created_at). A lifecycle CHECK requires PENDING to have no decision/result, APPROVED to have actor/time/customer, and DECLINED to have actor/time/nonblank reason with no customer. Request history restricts deletion of decision/customer records.

### `customer_tiers`

- **Owner:** catalog.
- **Fields:** code text U; name text; active bool.
- **Constraints and indexes:** referenced policy ceilings, not hardcoded business caps.

### `customers`

- **Owner:** catalog.
- **Fields:** organization_id FK; name text; tier/currency/profile fields; primary_sales_team_id uuid? FK sales_teams ON DELETE SET NULL; assignment_version int default 1; active bool.
- **Constraints and indexes:** unique(organization_id,name); index(organization_id,primary_sales_team_id). A nullable team permits reviewed migration of unresolved legacy accounts; runtime quotation creation requires a resolved team and active primary Rep.

### `customer_representatives`

- **Owner:** catalog customer-relationship service; the seed and reviewed one-time migration are the only non-runtime writers.
- **Fields:** customer_id FK; user_id FK; role enum(PRIMARY,COLLABORATOR); assigned_by_id FK users; assigned_at; ended_at?; active bool.
- **Constraints and indexes:** index(user_id,active), index(customer_id,active). Reviewed raw SQL partial unique index on customer_id where role=PRIMARY and active=true guarantees one current primary while retaining ended assignment history. Service validation additionally requires active REP users in the customer's primary team and same organization; CUSTOMER portal users are never candidates.

### `portal_requests`

- **Owner:** portal intake; quotations may only link a result through the portal-intake transaction.
- **Fields:** organization_id FK; customer_id FK; submitted_by_user_id FK; requirements_text; preferred_delivery_date?; status enum(NEW,PROCESSED,DISMISSED); resulting_lead_id? U; resulting_quotation_id? U; processed_at?; processed_by_id?; created_at.
- **Constraints and indexes:** nonblank requirements with maximum 5000 characters; index(organization_id,customer_id,created_at) and (submitted_by_user_id,created_at); PROCESSED requires a quotation and processing metadata, DISMISSED requires processing metadata, NEW has neither. Raw customer text is retained independently of what it becomes.

### `portal_request_lines`

- **Owner:** portal intake.
- **Fields:** portal_request_id FK cascade; product_id? FK set null; free_text_description?; quantity numeric(14,3)?; degraded bool; degraded_reason?.
- **Constraints and indexes:** each row has product or text; positive quantity; degraded rows require a reason; indexes on request and product. A cross-tenant, inactive, malformed or deleted catalog reference is never retained as `product_id`; the safe fallback text remains auditable.

### `leads`

- **Owner:** small portal-intake Lead surface; it does not own pricing.
- **Fields:** organization_id FK; customer_id FK; portal_request_id U FK cascade; assigned_rep_id FK; status enum(NEW,CONVERTED,DISMISSED); requirements_summary; converted_quotation_id? U FK set null; dismiss_reason?; created_at/updated_at.
- **Constraints and indexes:** NEW has neither conversion nor dismissal result; CONVERTED requires exactly one quotation; DISMISSED requires a nonblank reason. Index(organization_id,assigned_rep_id,status,created_at), index(customer_id,status). Only the assigned Rep converts; managed-team Manager may inspect/dismiss.

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
- **Fields:** number text U; customer_id uuid FK customers; owner_id uuid FK users; created_by_id uuid FK users; team_id uuid FK teams; current_revision_id uuid? FK quotation_revisions; lock_version int; last_activity_at timestamptz; archived_at timestamptz?. Owner/team/customer name/tier/currency are creation-time commercial snapshots and are not rewritten by customer reassignment.
- **Constraints and indexes:** index(team_id,last_activity_at), (customer_id,created_at); current revision belongs to same quote, validated transactionally.

### `quotation_revisions`

- **Owner:** quotations.
- **Fields:** quotation_id uuid FK quotations; revision_number int; document_state enum(DRAFT,SUBMITTED,SENT,SUPERSEDED); currency char(3); tier_id uuid FK customer_tiers; policy_id uuid? FK discount_policies; order_discount numeric(7,4); valid_until timestamptz; promised_delivery_at timestamptz?; terms text; internal_note text?; totals_by_cadence jsonb; lock_version int; submitted_by uuid? FK users; submitted_at timestamptz?; sent_at timestamptz?.
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
- **Fields:** quote_id uuid FK quotations; revision_id uuid FK quotation_revisions; policy_id uuid? FK discount_policies; cycle int; version int; state enum(PENDING,APPROVED,REJECTED,RETURNED,SUPERSEDED); route enum(NONE,MANAGER,MANAGER_FINANCE); risk_snapshot jsonb; submitted_by uuid FK users; completed_at timestamptz?.
- **Constraints and indexes:** unique(quote_id,cycle); index(quote_id,state); index(revision_id); optimistic version is positive; the immutable risk snapshot includes explainable components and the published policy values/version.

### `approval_steps`

- **Owner:** governance.
- **Fields:** case_id uuid FK approval_cases; sequence int; reviewer_role text; assigned_user_id uuid? FK users; state enum(WAITING,PENDING,APPROVED,REJECTED,RETURNED,SUPERSEDED); decided_by uuid? FK users; decided_at timestamptz?; reason text?.
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

The implemented compatibility `Alert` table also supports portal-request notification rows with `kind=PORTAL_REQUEST`, `resource_type=LEAD|QUOTE`, optional `recipient_id`, unique evaluation key, and recipient/resolved/created index. These alerts are in-app only and workspace reads return recipient-null broadcast alerts or alerts for the authenticated user.

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
- Organization 0→1 OrganizationProfile and 1→N DirectoryJoinRequest; an approved request 0→1 resulting Customer. The resulting User remains linked through singular `customer_id` and one organization membership, so the directory adds no multi-business identity model.
- Customer N→1 primary SalesTeam and Customer 1→N CustomerRepresentative history. The partial active-primary index protects current cardinality; removal ends rows rather than deleting them. Portal User.customer_id remains customer-scoped and never references a representative.
- Customer/User 1→N PortalRequest; request 1→N subordinate lines and 0→1 Lead / 0→1 resulting Quote. Lead references exactly one source request and at most one converted Quote. Organization holds `rfq_handling_mode` with Proposed default LEAD_FIRST.
- Product 1→N variants; variant N↔N attribute values. Rules distinguish product category versus exact variant. Plan links supply explicit cadence price/cost.
- Quotation 1→N revisions 1→N lines. `current_revision_id` is created after initial revision inside a transaction to resolve the circular reference. A DB constraint trigger or composite FK must prevent referencing another quote's revision.
- Revision 1→N approval cases over history, at most one active. Approval case 1→N ordered steps. Revision 0→1 acceptance; eligible revision 0→1 order.
- Proposal lines/comments must reference lines from the same revision. Use composite `(id,revision_id)` unique references where possible rather than relying solely on client validation.
- Stock balance is the warehouse/variant join. Reservations link order lines to balances. Shipment lines preserve which reservation was consumed. `sum(active reservations)` must agree with reserved quantity; update both atomically and include reconciliation query.
- The current reservation phase persists one Backorder per hardware OrderLine with original and remaining quantities plus OPEN/FULFILLED state. The service updates that row in the same transaction as Reservation and StockBalance changes, and database checks require an OPEN row to have a positive remainder and a FULFILLED row to have zero remainder plus `fulfilledAt`. A future dispatch phase must extend this consistency rule with shipped/canceled quantities rather than reusing the current reservation remainder as shipment evidence.
- One recurring order line produces one subscription. Periods link to exactly one recurring charge; charge_key and period uniqueness prevent job duplicates.
- Payment N↔N invoice through allocations. Initial UI records payment against one invoice; relational model can support split allocation later without changing financial identity. Reversals subtract allocations through explicit reversal linkage; never edit the original payment.
- Credit notes reduce invoice receivable; cash-refund status does not imply the application transferred money. If actual refunds are later recorded, add immutable refund payment records with bank/provider reference and reconciliation contract first.

## Canonical, derived and historical data

Canonical: submitted quote snapshots, accepted order lines, physical movements, invoice postings, payment allocations, credit notes. Derived: pipeline stage, available stock, outstanding demand, invoice balance and aggregated reports. Cached totals/risk snapshots carry calculator/policy version and are recalculated on draft change. Historical records retain product name/SKU, resolved price, tax, cost, plan and policy even after catalog edits. Never join current product prices to recalculate old invoices.

## Critical transaction design

| Operation | Lock / isolation | Atomic writes | Failure invariant |
|---|---|---|---|
| Draft save | quote/revision optimistic lock_version | revision/lines + version + audit | Stale update cannot overwrite newer draft |
| Approve directory join request | lock tenant-scoped PENDING request; optimistic new Customer assignment version | Customer + customer portal User/membership + primary CustomerRepresentative + approved request + audit | Invalid/replayed/cross-tenant/team/Rep/email decision creates no partial customer/account; plaintext password is never persisted |
| Decline directory join request | lock tenant-scoped PENDING request | terminal reason/actor/time + audit | No Customer/User/representative row is created |
| Submit portal request | lock Customer, count customer/user rolling window | raw request/lines + Lead or Draft + recipient Alert + audit + idempotency | Stale assignment or any branch failure leaves no orphan request/result; retry creates one result |
| Convert Lead | lock Lead; recheck Rep/tenant and catalog | Draft/revision/valid lines + Lead/request status + resolved Alert + audit | A second conversion returns the same Quote; free text never becomes price |
| Dismiss Lead | lock Lead; Rep-own or managed-team scope | Lead/request terminal status + internal reason + resolved Alert + audit | Lead is retained; internal reason never enters customer DTO |
| Change RFQ mode | organization transaction; Admin service gate | organization mode + audit on real change | Non-Admin cannot mutate; no-op does not create misleading change audit |
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

The merged history contains twenty-six ordered migrations, including both additive `20260906080000_business_directory` and `20260906080000_razorpay_payments` migrations. Later increments implement quotation list/detail metadata, invoice/payment corrections, customer relationships, portal invitation lifecycle, versioned quotation governance, durable portal proposal responses, confirmation billing/change history, the order-based reservation/backorder boundary, customer-originated RFQ intake, public directory association approval and verified Razorpay payment metadata/webhook deduplication. The earlier platform-control migration runs after customer tenant-isolation repairs and adds organization status/slug, `OrganizationMembership`, `OrganizationInvitation`, `PlatformOwnerSession`, `PrivilegedAudit`, CSRF/View As session fields and organization-scoped uniqueness; it never persists the Platform Owner password.

The former feature-only `20260905130000`–`20260905150000` migration sequence was consolidated because it independently created tables later introduced on `main`. Retaining both sequences would make fresh and existing-main deployments fail. The consolidated migration was verified from an empty PostgreSQL database followed by the merged deterministic seed.

The merged migration chain and deterministic seed were executed against a disposable PostgreSQL database. The developer's primary database was not reset during conflict resolution. The larger table inventory remains a phased contract beyond the implemented Prisma models.

## Implemented identity delta — 2026-09-05

Migration `20260905120000_pending_accounts` adds PostgreSQL `AccountStatus` (PENDING, ACTIVE, DISABLED) and `User.status`. Latest-main onboarding creates a new organization and its first ACTIVE Admin through email/password or verified Google signup; generated organization users are also ACTIVE and module-scoped. Login and session middleware require ACTIVE.

## Implemented audit-hardening delta — 2026-09-05

Migration `20260905190000_audit_backend_hardening` adds Customer foreign keys, QuoteRevision snapshots, revision/cycle-bound approvals, proposal classification, CustomerAcceptance, Order/OrderLine, downstream order/customer/product provenance, IdempotencyRecord, request/revision audit context, and stock/invoice/payment CHECK constraints. Existing quote/customer text is backfilled without deleting business history. Payment references are unique per invoice. Quote current-revision circular integrity is established after revision backfill. The migration was validated from the initial migrations in a disposable PostgreSQL schema.

## Implemented quotation-list read model — 2026-09-05

Migration `20260905223000_quotation_list_read_model` adds initial-revision `currency`, optional `validUntil`, `promisedDeliveryAt`, and `terms`, plus organization/stage/activity and organization/owner/activity indexes for the scoped quotation list. The migration uses additive `IF NOT EXISTS` guards because an earlier local development database contained a drifted `QuoteRevision.currency` column; it performs no destructive rewrite. Board/Table display stages are projected by the backend from current lifecycle records while the existing `Quote.stage` remains a compatibility cache used by established workflow mutations.

## Implemented payment-reversal delta — 2026-09-05

Migration `20260906003000_payment_reversals` adds an optional unique self-reference and correction reason to `Payment`. A reversal is stored as a positive compensating entry linked to the original payment; ledger balance calculation subtracts linked reversal entries. The original payment remains immutable and each payment can be reversed at most once.

## Implemented customer relationship delta — 2026-09-05

Migration `20260906010000_customer_relationships` adds Customer.primarySalesTeamId, Customer.assignmentVersion, CustomerRepresentative history, Quote.createdById and the reviewed partial unique active-primary index. Its one-time SQL backfill takes the team only from the most recent non-terminal quotation and creates PRIMARY only when all customer quotations have exactly one active REP owner who belongs to that team. Multi-owner, missing-team and otherwise ambiguous customers remain unresolved for the Assignment required review filter. The migration writes no Quote ownerId/teamId values; createdById alone is backfilled from the historical owner. Production Rep customer filtering stays behind `CUSTOMER_ASSIGNMENT_SCOPING_ENABLED=true` until unresolved accounts have been reviewed.

## Implemented portal invitation lifecycle delta — 2026-09-05

Migration `20260906020000_portal_invitation_lifecycle` extends the existing `OrganizationInvitation` with accepted/revoked timestamps, backfills terminal timestamps, safely revokes older duplicate pending customer/email rows, and adds the partial unique pending-link boundary plus organization/customer history index. `createdAt` remains the canonical invited-at value and is projected as `invitedAt` in the API. This avoids duplicating the generic invitation infrastructure while providing the requested customer lifecycle.

## Implemented quotation governance delta — 2026-09-06

Migration `20260906030000_quotation_governance` adds versioned `ApprovalCase` records and ordered case-bound approval steps, plus published aggregate-discount and minimum-margin thresholds on `DiscountPolicy`. Existing revision/cycle approval rows are backfilled into cases without deleting history. Saved Draft and submitted revisions retain their own line, total, cadence, risk, and policy snapshots; returned cases preserve the submitted revision and start a new Draft.

## Implemented portal negotiation delta — 2026-09-06

Migration `20260906040000_portal_negotiation` extends the existing `Negotiation` record rather than introducing a parallel proposal/comment hierarchy. It stores message classification, requested delivery date, responding Rep, response reason/time and adopted revision ID, adds the active-proposal lookup index, and enforces counter discount bounds. Comments and proposals remain bound to the exact `QuoteRevision`. Decline preserves the SENT revision and closes only that proposal; adoption records the new Draft revision while the former SENT revision remains SUPERSEDED. Acceptance and Order retain their unique quote/revision/acceptance business keys, with `IdempotencyRecord` providing same-request replay.

Order confirmation reads `QuoteRevision.linesSnapshot`, never current catalog pricing. It atomically writes Acceptance, Order, immutable OrderLine snapshots, Quote confirmation, one full mixed Invoice, recurring-line Subscriptions, audit and idempotency result. Fulfillment remains an independent downstream transaction.

## Implemented confirmation billing and operations delta — 2026-09-06

Migration `20260906050000_billing_lifecycle` adds Invoice `billingKey`, frozen currency and optimistic version; Subscription version/cancellation/update timestamps; append-only `SubscriptionChange`; persisted customer `InvoiceNote`; and deduplicated Alert evaluation/acknowledgement/resolution timestamps. `billingKey=ORDER_CONFIRMATION:<orderId>` and the existing unique Order revision/acceptance keys protect confirmation retries. Payments keep the existing unique invoice/reference and one-reversal linkage. Amount/state updates lock the Invoice first; the original Payment is never edited or deleted. Subscription changes lock and version-check the row, write history and audit in the same transaction, and never update prior invoices.

## Implemented fulfillment reservation delta — 2026-09-06

Migration `20260906060000_fulfillment_reservations` keeps the existing one-per-Order Fulfillment row as the versioned accepted-allocation read model and adds its `version`, `overridden` and reason fields. Reservation is now the canonical warehouse commitment with unique `(orderLineId,stockBalanceId)`, positive integer quantity, source, and links to Fulfillment, Order, immutable OrderLine and StockBalance. Backorder is a retained, correctly quantified lifecycle record with unique `orderLineId`, original/remaining quantities, OPEN/FULFILLED state and completion time. StockMovement is append-only receipt evidence linked to organization, balance, optional target Order, Product and actor.

Reservation and consolidation lock the Order, discover relevant active balances, lock every balance by sorted ID, re-read availability, and update StockBalance plus Reservation/Backorder/Fulfillment/Order/audit/idempotency in one transaction. Receipt locks the target Order and warehouse/balance, increments on-hand, writes StockMovement and audit, then attempts the order's open backorders before commit. Database checks protect positive reservations/receipts, valid backorder quantities/state and the existing `0 <= reserved <= onHand` balance invariant. Existing JSON allocation rows were migrated into Reservation/Backorder records where an Order and matching balance existed; JSON remains a compatibility projection rather than the stock authority. No Shipment or on-hand consumption record is created by this migration.

## Implemented portal RFQ intake delta — 2026-09-06

Migration `20260906070000_portal_rfq_intake` adds the `RfqHandlingMode`, `PortalRequestStatus`, `LeadStatus` and `PORTAL_REQUEST` alert enums; Organization mode with Proposed `LEAD_FIRST` default; first-class PortalRequest/PortalRequestLine/Lead records; source links from request to Lead/Quote; optional QuoteRevision internal intake note; and recipient/resource classification on Alert. Unique result links and lifecycle CHECK constraints protect one-request/one-result and terminal-state consistency. The migration was deployed to local `public` with all 24 then-current migrations current; a disposable PostgreSQL schema exercised assignment, tenant, rate, idempotency, safe-projection and audit invariants before being dropped.

## Implemented public business directory delta — 2026-09-06

Migration `20260906080000_business_directory` adds `DirectoryJoinRequestStatus`, one-to-one OrganizationProfile, DirectoryJoinRequest, the per-organization/email/status uniqueness guard, resulting-customer uniqueness, review indexes, foreign keys and the terminal-state CHECK. No password/plain credential column exists. After merging the sibling Razorpay increment, local `public` reports all 26 migrations current. A disposable PostgreSQL schema passed the real approval/decline transaction, assignment, membership, password-hash and tenant-isolation checks before automatic cleanup. The repeatable deterministic seed publishes two allowlisted profiles and one request in each lifecycle state: actionable Atlas Field Operations, approved Lumen Offices with complete customer/portal/primary-assignment links, and declined Stonebridge Procurement without a customer. The known earlier empty-schema migration-order blocker at `20260905162000_customer_profile_fields` remains separate and was not hidden or rewritten by this additive migration.
