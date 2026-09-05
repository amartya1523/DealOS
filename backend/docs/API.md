# DealOS — REST API contracts

Status: living API contract. The inventory describes the target API; the functional subset explicitly identified under Implementation update is running locally. Endpoint IDs remain stable traceability references. Any implemented contract change must update this document in the same change.

## Shared HTTP contract

All paths below are relative to `/api/v1`. HTTPS in production. JSON UTF-8 except binary exports. Request IDs are accepted only in bounded safe form or generated; returned as `X-Request-ID`. Success `{success:true,data:<described DTO>,meta:{requestId,...pagination?}}`. Error `{success:false,error:{code,message,details?},meta:{requestId}}`. Dates are ISO-8601; money/quantity/rate values are decimal strings, not binary floating JSON numbers. Versions and counts are integers. IDs are UUIDs except catalog codes. `Page<T>` is `{items:T[],nextCursor:string|null}` with default 25/max 100. No passwords, raw session tokens or internal stack traces in any response.

Every authenticated mutation requires CSRF token header and allowed Origin. Sessions use HttpOnly cookies and server-stored token hashes. Public auth endpoints use Origin/rate checks; login rotates cookie. All `:id` and nested IDs are validated, existence scoped server-side. Actors are intersected with resource/team/customer permissions. Internal identities means active REP/MANAGER/FINANCE_OPS/ADMIN; CUSTOMER is never included. Admin is not implicitly a reviewer. Customer payloads use separate DTO projections.

`expectedVersion` is required on existing mutable aggregates; responses include `version`. Identity/configuration rows listed with this field need a `lock_version int default 1` in their owning migration. Mutation keys: `Idempotency-Key` required for approval decisions, acceptance, stock movements, allocations, shipments, invoice/payment posting, subscription changes/cancellation and nudge/escalation; recommended for create/submit/proposal to make client retries safe. Keys 16–128 chars; scope actor+operation+resource; payload mismatch returns 409. Pure previews do not mutate and do not need an idempotency key. Responses to a replay preserve original result and identify replay in meta.

## Common errors and validation

- 400 `INVALID_REQUEST`: malformed JSON/path/query; 422 `VALIDATION_ERROR`: field constraints with `{fields:{field:[message]}}`.
- 401 `AUTH_REQUIRED`; login 401 `INVALID_CREDENTIALS` does not reveal account existence/status.
- 403 `FORBIDDEN`; customer resource misses always 404 `NOT_FOUND` to avoid cross-account enumeration.
- 409 `STALE_VERSION`, `INVALID_STATE`, `IDEMPOTENCY_CONFLICT`, `DUPLICATE_RESOURCE`.
- 422 `CONFIGURATION_REQUIRED`, `AMOUNT_EXCEEDS_BALANCE`, `INVALID_BILLING_DATE`.
- 409 `STOCK_CHANGED`, `REVIEWER_UNAVAILABLE`, `SELF_APPROVAL_NOT_ALLOWED`, `APPROVAL_STEP_BLOCKED`.
- 429 `RATE_LIMITED` with Retry-After; 503 `SERVICE_UNAVAILABLE`; 500 `INTERNAL_ERROR` with request ID only.

Each endpoint inherits applicable errors above. Endpoint-specific validation below determines when they occur. Reject unknown privileged fields rather than mass-assigning request bodies. No frontend-controlled cost, role, computed total, stock availability, reviewer identity or order status is trusted. Header/body size limits are configured, not unbounded.

## DTO dictionary

| DTO family | Required projection |
|---|---|
| Identity/UserAdmin | id, displayName, email for permitted identity/admin views, status, roles, teamIds, linked customerId?, version; no hashes |
| Customer | id, name, tier, teamId, currency, authorized contact/address, active, version |
| Product | id, name, category, unit, taxRate, active, variants with SKU/price/cost/attributes/plan links, version; internal only |
| PriceList / Policy / Plan | id, version, explicit typed configuration, effective/state fields; old published configuration immutable |
| QuotationSummary | id, number, customer, owner, currentRevisionId, derived stage, totalsByCadence, updatedAt, version |
| Quotation | summary plus exact current revision, commercial lines, internal calculations, approvals/proposals/audit references; historical revision summaries |
| QuoteCalculation | authoritative lines, taxes and totalsByCadence; each bucket includes revenue/cost/margin; risk components and policy ID; warnings for missing configuration |
| ApprovalCase | id, version, revisionId, policyId, requiredLevel, riskComponents, state, ordered steps, auditable decisions |
| PortalQuotation | id/number, customer-facing status, revisionId/version/termsHash, expiry, line descriptions/quantities/prices/discounts/taxes/cadence, commercial totals, customer-visible comments and proposals; **no costs, margins, risk, internal comments or reviewer notes** |
| Order | id/number/version, source revision, customer, accepted lines, fulfillment summary, separate billing status |
| Warehouse / Fulfillment | warehouse costs/priorities, balances, reservations, shipment history, remaining demand, estimate and version; no silent write during GET |
| Subscription | id/version, order line, plan snapshot, quantity, cadence, timezone, current/next period, state, dated changes/credits |
| Invoice | id/number/version, immutable issued lines, currency/taxes/total, payments/credits, outstanding balance, issue/due date and derived status |
| PortalInvoice | invoice commercial lines, totals, due date, paid/outstanding status; no internal financial notes/provider secrets |
| Alert / Notification | id, kind/severity/state, safe reason, scoped resource link, evaluation time; notification recipient/action/read time |
| SalesReport | applied filters/asOf, separate currency/cadence groups, clearly defined counts/approval durations/upsell attribution; no unscoped raw records |

DTO additions must be documented before exposing them. Nested domain DTOs use Database.md fields converted to camelCase through explicit mapping, **not** automatic ORM serialization. `version` always maps to lock_version (optimistic counter), while configuration version is named policyVersion/planVersion where ambiguity exists.

## Endpoint inventory

### AUTH-01 — Create a pending internal account

- **Method/path:** `POST /api/v1/auth/signup`
- **Purpose:** Create a pending internal account.
- **Actor / authorization:** Public; resource scope and global restrictions above apply.
- **Authentication:** No session required; public endpoint protections apply.
- **Request:** `{email, password, displayName}`.
- **Validation:** normalized email; password 12–128 characters; name 1–120; no role/customer/team input.
- **Response:** 202 SignupResult {status: PENDING, message}; existing email gives same public response.
- **Errors:** common error contract above; validation, permission, lifecycle and concurrency conditions are enforced before commit.
- **Business rules:** R-003, R-030.

### AUTH-02 — Authenticate an active account

- **Method/path:** `POST /api/v1/auth/login`
- **Purpose:** Authenticate an active account.
- **Actor / authorization:** Public; resource scope and global restrictions above apply.
- **Authentication:** No session required; public endpoint protections apply.
- **Request:** `{email, password}`.
- **Validation:** generic credential errors; active account; bounded rate; rotate session.
- **Response:** 200 IdentityDTO plus session cookie; CSRF token in authenticated result.
- **Errors:** common error contract above; validation, permission, lifecycle and concurrency conditions are enforced before commit.
- **Business rules:** R-003, BR-008.

### AUTH-03 — Read current identity and session CSRF token

- **Method/path:** `GET /api/v1/auth/me`
- **Purpose:** Read current identity and session CSRF token.
- **Actor / authorization:** Any active identity; resource scope and global restrictions above apply.
- **Authentication:** Active database-backed session required.
- **Request:** `none`.
- **Validation:** valid unexpired session.
- **Response:** 200 IdentityDTO {id, displayName, roles, teamIds, customerId?, csrfToken}.
- **Errors:** common error contract above; validation, permission, lifecycle and concurrency conditions are enforced before commit.
- **Business rules:** BR-008.

### AUTH-04 — Revoke current session

- **Method/path:** `POST /api/v1/auth/logout`
- **Purpose:** Revoke current session.
- **Actor / authorization:** Any active identity; resource scope and global restrictions above apply.
- **Authentication:** Active database-backed session required.
- **Request:** `{}`.
- **Validation:** session/CSRF; repeated logout may return success without identity details.
- **Response:** 200 {loggedOut: true}; clear cookie.
- **Errors:** common error contract above; validation, permission, lifecycle and concurrency conditions are enforced before commit.
- **Business rules:** R-027.

### AUTH-05 — List pending and active identities

- **Method/path:** `GET /api/v1/admin/users`
- **Purpose:** List pending and active identities.
- **Actor / authorization:** Admin; resource scope and global restrictions above apply.
- **Authentication:** Active database-backed session required.
- **Request:** `query: status?, cursor?, limit?`.
- **Validation:** bounded enum filters; never return password/session hashes.
- **Response:** 200 Page<UserAdminDTO>.
- **Errors:** common error contract above; validation, permission, lifecycle and concurrency conditions are enforced before commit.
- **Business rules:** R-004, R-030.

### AUTH-06 — Activate/deactivate and assign authorized roles/customer/team

- **Method/path:** `PATCH /api/v1/admin/users/:id`
- **Purpose:** Activate/deactivate and assign authorized roles/customer/team.
- **Actor / authorization:** Admin; resource scope and global restrictions above apply.
- **Authentication:** Active database-backed session required.
- **Request:** `{expectedVersion, status?, roles?, customerId?, teamIds?}`.
- **Validation:** known role codes; CUSTOMER cannot mix with internal roles; linked customer required; prevent disabling last active Admin.
- **Response:** 200 UserAdminDTO; revoke sessions on privilege/status changes.
- **Errors:** common error contract above; validation, permission, lifecycle and concurrency conditions are enforced before commit.
- **Business rules:** R-004, BR-008, BR-017.

### AUTH-07 — Provision a customer account without public privilege escalation

- **Method/path:** `POST /api/v1/admin/users`
- **Purpose:** Provision a customer account without public privilege escalation.
- **Actor / authorization:** Admin; resource scope and global restrictions above apply.
- **Authentication:** Active database-backed session required.
- **Request:** `{email, displayName, customerId, temporaryPassword}`.
- **Validation:** linked active customer; secret input hashed and never returned; account credential handoff is manual until delivery integration exists.
- **Response:** 201 UserAdminDTO.
- **Errors:** common error contract above; validation, permission, lifecycle and concurrency conditions are enforced before commit.
- **Business rules:** R-031, BR-008, BR-017.

### AUTH-08 — Read team configuration

- **Method/path:** `GET /api/v1/admin/teams`
- **Purpose:** Read team configuration.
- **Actor / authorization:** Admin, Manager; resource scope and global restrictions above apply.
- **Authentication:** Active database-backed session required.
- **Request:** `query: cursor?, limit?`.
- **Validation:** Manager sees assigned teams only.
- **Response:** 200 Page<TeamDTO>.
- **Errors:** common error contract above; validation, permission, lifecycle and concurrency conditions are enforced before commit.
- **Business rules:** R-004.

### AUTH-09 — Create a sales team

- **Method/path:** `POST /api/v1/admin/teams`
- **Purpose:** Create a sales team.
- **Actor / authorization:** Admin; resource scope and global restrictions above apply.
- **Authentication:** Active database-backed session required.
- **Request:** `{name, memberIds}`.
- **Validation:** unique name; members active internal identities.
- **Response:** 201 TeamDTO.
- **Errors:** common error contract above; validation, permission, lifecycle and concurrency conditions are enforced before commit.
- **Business rules:** R-004, BR-017.

### AUTH-10 — Update team membership

- **Method/path:** `PATCH /api/v1/admin/teams/:id`
- **Purpose:** Update team membership.
- **Actor / authorization:** Admin; resource scope and global restrictions above apply.
- **Authentication:** Active database-backed session required.
- **Request:** `{expectedVersion, name?, memberIds?, active?}`.
- **Validation:** valid internal identities; do not remove last access path to owned active deals without reassignment.
- **Response:** 200 TeamDTO.
- **Errors:** common error contract above; validation, permission, lifecycle and concurrency conditions are enforced before commit.
- **Business rules:** R-004, BR-017.

### CAT-01 — Find accessible buying businesses

- **Method/path:** `GET /api/v1/customers`
- **Purpose:** Find accessible buying businesses.
- **Actor / authorization:** Rep, Manager, Finance/Operations, Admin; resource scope and global restrictions above apply.
- **Authentication:** Active database-backed session required.
- **Request:** `query: search?, tierId?, cursor?, limit?`.
- **Validation:** scope by team for Rep/Manager; bounded search.
- **Response:** 200 Page<CustomerDTO>.
- **Errors:** common error contract above; validation, permission, lifecycle and concurrency conditions are enforced before commit.
- **Business rules:** R-005, BR-008.

### CAT-02 — Configure a buying business

- **Method/path:** `POST /api/v1/customers`
- **Purpose:** Configure a buying business.
- **Actor / authorization:** Admin, Rep; resource scope and global restrictions above apply.
- **Authentication:** Active database-backed session required.
- **Request:** `{name, tierId, teamId, currency, billingContactEmail?, billingAddress}`.
- **Validation:** Rep may create only in assigned team; known active tier/currency; no arbitrary owner escalation.
- **Response:** 201 CustomerDTO.
- **Errors:** common error contract above; validation, permission, lifecycle and concurrency conditions are enforced before commit.
- **Business rules:** R-005, BR-017.

### CAT-03 — Update customer commercial setup

- **Method/path:** `PATCH /api/v1/customers/:id`
- **Purpose:** Update customer commercial setup.
- **Actor / authorization:** Admin; resource scope and global restrictions above apply.
- **Authentication:** Active database-backed session required.
- **Request:** `{expectedVersion, name?, tierId?, teamId?, billingContactEmail?, billingAddress?, active?}`.
- **Validation:** historical revisions unchanged; team reassignment audited.
- **Response:** 200 CustomerDTO.
- **Errors:** common error contract above; validation, permission, lifecycle and concurrency conditions are enforced before commit.
- **Business rules:** BR-005, BR-017.

### CAT-04 — Browse product catalog

- **Method/path:** `GET /api/v1/catalog/products`
- **Purpose:** Browse product catalog.
- **Actor / authorization:** Internal identities; resource scope and global restrictions above apply.
- **Authentication:** Active database-backed session required.
- **Request:** `query: search?, categoryId?, active?, cursor?, limit?`.
- **Validation:** scope internal; never expose costs through a portal route.
- **Response:** 200 Page<ProductSummaryDTO>.
- **Errors:** common error contract above; validation, permission, lifecycle and concurrency conditions are enforced before commit.
- **Business rules:** R-005.

### CAT-05 — Read product, variants, attributes and plan links

- **Method/path:** `GET /api/v1/catalog/products/:id`
- **Purpose:** Read product, variants, attributes and plan links.
- **Actor / authorization:** Internal identities; resource scope and global restrictions above apply.
- **Authentication:** Active database-backed session required.
- **Request:** `none`.
- **Validation:** existing accessible catalog product.
- **Response:** 200 ProductDTO.
- **Errors:** common error contract above; validation, permission, lifecycle and concurrency conditions are enforced before commit.
- **Business rules:** R-005.

### CAT-06 — Create a product with variants

- **Method/path:** `POST /api/v1/catalog/products`
- **Purpose:** Create a product with variants.
- **Actor / authorization:** Admin; resource scope and global restrictions above apply.
- **Authentication:** Active database-backed session required.
- **Request:** `{name, description, categoryId, unit, taxRate, variants: [{sku, basePrice, cost, currency, stockTracked, attributes: [{attributeId,valueId,extraPrice}], planLinks: [{planId,recurringPrice,recurringCost}]}]}`.
- **Validation:** prices/cost decimal strings≥0; unique SKU/attribute combinations; known category/plans; max 100 variants per request.
- **Response:** 201 ProductDTO.
- **Errors:** common error contract above; validation, permission, lifecycle and concurrency conditions are enforced before commit.
- **Business rules:** BR-001, BR-012, BR-017.

### CAT-07 — Revise/archive current catalog values

- **Method/path:** `PATCH /api/v1/catalog/products/:id`
- **Purpose:** Revise/archive current catalog values.
- **Actor / authorization:** Admin; resource scope and global restrictions above apply.
- **Authentication:** Active database-backed session required.
- **Request:** `{expectedVersion, name?, description?, taxRate?, active?, variants?}`.
- **Validation:** no destructive deletion of referenced variants; same validation as creation; snapshots unaffected.
- **Response:** 200 ProductDTO.
- **Errors:** common error contract above; validation, permission, lifecycle and concurrency conditions are enforced before commit.
- **Business rules:** BR-001, BR-005, BR-017.

### CAT-08 — Read category/tier/attribute options

- **Method/path:** `GET /api/v1/catalog/reference-data`
- **Purpose:** Read category/tier/attribute options.
- **Actor / authorization:** Internal identities; resource scope and global restrictions above apply.
- **Authentication:** Active database-backed session required.
- **Request:** `none`.
- **Validation:** identity required.
- **Response:** 200 {categories, tiers, attributesWithValues}.
- **Errors:** common error contract above; validation, permission, lifecycle and concurrency conditions are enforced before commit.
- **Business rules:** R-005, R-006.

### CAT-09 — Create catalog categories, tiers or attribute definitions

- **Method/path:** `POST /api/v1/catalog/reference-data`
- **Purpose:** Create catalog categories, tiers or attribute definitions.
- **Actor / authorization:** Admin; resource scope and global restrictions above apply.
- **Authentication:** Active database-backed session required.
- **Request:** `{kind: CATEGORY|TIER|ATTRIBUTE, name, code?, categoryKind?, values?}`.
- **Validation:** discriminated schema; unique names/codes; category kind HARDWARE/SERVICE/SUBSCRIPTION.
- **Response:** 201 CatalogReferenceDTO.
- **Errors:** common error contract above; validation, permission, lifecycle and concurrency conditions are enforced before commit.
- **Business rules:** R-005, BR-017.

### CAT-10 — Inspect active and scheduled pricing

- **Method/path:** `GET /api/v1/catalog/price-lists`
- **Purpose:** Inspect active and scheduled pricing.
- **Actor / authorization:** Internal identities; resource scope and global restrictions above apply.
- **Authentication:** Active database-backed session required.
- **Request:** `query: tierId?, currency?, cursor?, limit?`.
- **Validation:** known currency/tier; no cross-currency arithmetic.
- **Response:** 200 Page<PriceListDTO>.
- **Errors:** common error contract above; validation, permission, lifecycle and concurrency conditions are enforced before commit.
- **Business rules:** R-005, BR-001.

### CAT-11 — Create a versioned price list

- **Method/path:** `POST /api/v1/catalog/price-lists`
- **Purpose:** Create a versioned price list.
- **Actor / authorization:** Admin; resource scope and global restrictions above apply.
- **Authentication:** Active database-backed session required.
- **Request:** `{name, tierId?, currency, validFrom, validTo?, rules: [{variantId?|categoryId?, adjustmentKind, value, minQuantity}]}`.
- **Validation:** exactly one rule target; valid interval; reject ambiguous overlapping specificity; decimals strings.
- **Response:** 201 PriceListDTO.
- **Errors:** common error contract above; validation, permission, lifecycle and concurrency conditions are enforced before commit.
- **Business rules:** BR-001, BR-017.

### CAT-12 — Retire or amend unused scheduled pricing

- **Method/path:** `PATCH /api/v1/catalog/price-lists/:id`
- **Purpose:** Retire or amend unused scheduled pricing.
- **Actor / authorization:** Admin; resource scope and global restrictions above apply.
- **Authentication:** Active database-backed session required.
- **Request:** `{expectedVersion, active?, validTo?}`.
- **Validation:** do not rewrite price snapshots; complete revisions created with POST.
- **Response:** 200 PriceListDTO.
- **Errors:** common error contract above; validation, permission, lifecycle and concurrency conditions are enforced before commit.
- **Business rules:** BR-005, BR-017.

### SET-01 — Inspect current and historical governance configuration

- **Method/path:** `GET /api/v1/settings/discount-policies`
- **Purpose:** Inspect current and historical governance configuration.
- **Actor / authorization:** Admin, Manager, Finance/Operations; resource scope and global restrictions above apply.
- **Authentication:** Active database-backed session required.
- **Request:** `query: state?, cursor?, limit?`.
- **Validation:** known states; no arbitrary policy override from quote input.
- **Response:** 200 Page<DiscountPolicyDTO>.
- **Errors:** common error contract above; validation, permission, lifecycle and concurrency conditions are enforced before commit.
- **Business rules:** BR-003, BR-004.

### SET-02 — Create draft policy version

- **Method/path:** `POST /api/v1/settings/discount-policies`
- **Purpose:** Create draft policy version.
- **Actor / authorization:** Admin, Manager; resource scope and global restrictions above apply.
- **Authentication:** Active database-backed session required.
- **Request:** `{name, ceilings:[{tierId?|categoryId?, ceilingPercent}], bands:[{metric,threshold,comparator,requiredLevel}], aggregateCaps, minimumMargins}`.
- **Validation:** exactly one cap target; 0..100 percentages; comparator/metric compatibility; explicit currency/cadence buckets.
- **Response:** 201 DiscountPolicyDTO {state:DRAFT}.
- **Errors:** common error contract above; validation, permission, lifecycle and concurrency conditions are enforced before commit.
- **Business rules:** BR-003, BR-004, BR-017.

### SET-03 — Publish validated discount and review policy

- **Method/path:** `POST /api/v1/settings/discount-policies/:id/publish`
- **Purpose:** Publish validated discount and review policy.
- **Actor / authorization:** Admin, Manager; resource scope and global restrictions above apply.
- **Authentication:** Active database-backed session required.
- **Request:** `{expectedVersion, effectiveAt, reason}`.
- **Validation:** complete required tier/category caps; reviewers available; no overlapping current policy; immutable after publish.
- **Response:** 200 DiscountPolicyDTO {state:PUBLISHED}.
- **Errors:** common error contract above; validation, permission, lifecycle and concurrency conditions are enforced before commit.
- **Business rules:** BR-003–006, BR-017.

### SET-04 — Read recurring-plan configurations

- **Method/path:** `GET /api/v1/settings/subscription-plans`
- **Purpose:** Read recurring-plan configurations.
- **Actor / authorization:** Internal identities; resource scope and global restrictions above apply.
- **Authentication:** Active database-backed session required.
- **Request:** `query: active?, cursor?, limit?`.
- **Validation:** known filters.
- **Response:** 200 Page<SubscriptionPlanDTO>.
- **Errors:** common error contract above; validation, permission, lifecycle and concurrency conditions are enforced before commit.
- **Business rules:** R-009, BR-013.

### SET-05 — Create new immutable recurring plan version

- **Method/path:** `POST /api/v1/settings/subscription-plans`
- **Purpose:** Create new immutable recurring plan version.
- **Actor / authorization:** Admin; resource scope and global restrictions above apply.
- **Authentication:** Active database-backed session required.
- **Request:** `{name, intervalMonths, billingTimezone, prorationMethod, cancellationPolicy}`.
- **Validation:** intervalMonths 1/3/12; valid IANA timezone; typed unused-period-credit policy.
- **Response:** 201 SubscriptionPlanDTO.
- **Errors:** common error contract above; validation, permission, lifecycle and concurrency conditions are enforced before commit.
- **Business rules:** BR-012–014, BR-017.

### SET-06 — Read optional product pairings and promotions

- **Method/path:** `GET /api/v1/settings/recommendations`
- **Purpose:** Read optional product pairings and promotions.
- **Actor / authorization:** Admin; resource scope and global restrictions above apply.
- **Authentication:** Active database-backed session required.
- **Request:** `query: cursor?, limit?`.
- **Validation:** only implemented in optional configuration slice.
- **Response:** 200 Page<RecommendationRuleDTO>.
- **Errors:** common error contract above; validation, permission, lifecycle and concurrency conditions are enforced before commit.
- **Business rules:** R-011, BR-019.

### SET-07 — Configure pairing/promotion and margin floor

- **Method/path:** `POST /api/v1/settings/recommendations`
- **Purpose:** Configure pairing/promotion and margin floor.
- **Actor / authorization:** Admin; resource scope and global restrictions above apply.
- **Authentication:** Active database-backed session required.
- **Request:** `{sourceVariantId, suggestedVariantId, promotionStart?, promotionEnd?, promotionWeight, minimumMargin, active}`.
- **Validation:** distinct active products; ordered dates; nonnegative weights; decimal percentages.
- **Response:** 201 RecommendationRuleDTO.
- **Errors:** common error contract above; validation, permission, lifecycle and concurrency conditions are enforced before commit.
- **Business rules:** R-011, BR-019, BR-017.

### QUO-01 — List pipeline or table quotation summaries

- **Method/path:** `GET /api/v1/quotations`
- **Purpose:** List pipeline or table quotation summaries.
- **Actor / authorization:** Rep, Manager, Finance/Operations, Admin; resource scope and global restrictions above apply.
- **Authentication:** Active database-backed session required.
- **Request:** `query: stage?, customerId?, ownerId?, search?, cursor?, limit?`.
- **Validation:** role/team scope first; stage derived from current revision/approval/acceptance.
- **Response:** 200 Page<QuotationSummaryDTO>.
- **Errors:** common error contract above; validation, permission, lifecycle and concurrency conditions are enforced before commit.
- **Business rules:** R-014, BR-005.

### QUO-02 — Create customer quotation draft

- **Method/path:** `POST /api/v1/quotations`
- **Purpose:** Create customer quotation draft.
- **Actor / authorization:** Rep; resource scope and global restrictions above apply.
- **Authentication:** Active database-backed session required.
- **Request:** `{customerId, validUntil, promisedDeliveryAt?, terms?}`.
- **Validation:** customer in rep scope; future expiry; owner is authenticated rep.
- **Response:** 201 QuotationDTO.
- **Errors:** common error contract above; validation, permission, lifecycle and concurrency conditions are enforced before commit.
- **Business rules:** BR-001, BR-017.

### QUO-03 — Read current quotation and revision history

- **Method/path:** `GET /api/v1/quotations/:id`
- **Purpose:** Read current quotation and revision history.
- **Actor / authorization:** Rep, Manager, Finance/Operations, Admin; resource scope and global restrictions above apply.
- **Authentication:** Active database-backed session required.
- **Request:** `none`.
- **Validation:** internal role/team scope; include current revision version.
- **Response:** 200 QuotationDTO.
- **Errors:** common error contract above; validation, permission, lifecycle and concurrency conditions are enforced before commit.
- **Business rules:** BR-005, BR-008.

### QUO-04 — Calculate unsaved lines, margin and risk

- **Method/path:** `POST /api/v1/quotations/:id/preview`
- **Purpose:** Calculate unsaved lines, margin and risk.
- **Actor / authorization:** Rep; resource scope and global restrictions above apply.
- **Authentication:** Active database-backed session required.
- **Request:** `{revisionId, expectedVersion, lines:[{variantId,quantity,lineDiscount,planId?}], orderDiscount, promisedDeliveryAt?}`.
- **Validation:** max 200 lines; quantity>0; discount 0..100; ignore/reject client price/cost/risk fields; no persistence.
- **Response:** 200 QuoteCalculationDTO.
- **Errors:** common error contract above; validation, permission, lifecycle and concurrency conditions are enforced before commit.
- **Business rules:** BR-001–004, BR-012.

### QUO-05 — Save complete draft commercial terms

- **Method/path:** `PUT /api/v1/quotations/:id/draft`
- **Purpose:** Save complete draft commercial terms.
- **Actor / authorization:** Rep; resource scope and global restrictions above apply.
- **Authentication:** Active database-backed session required.
- **Request:** `{revisionId, expectedVersion, lines, orderDiscount, validUntil, promisedDeliveryAt?, terms}`.
- **Validation:** same calculation schema as preview; draft only; atomic line replacement.
- **Response:** 200 QuotationDTO with incremented version.
- **Errors:** common error contract above; validation, permission, lifecycle and concurrency conditions are enforced before commit.
- **Business rules:** BR-001–005, BR-017.

### QUO-06 — Start revision from current submitted/sent terms

- **Method/path:** `POST /api/v1/quotations/:id/revisions`
- **Purpose:** Start revision from current submitted/sent terms.
- **Actor / authorization:** Rep; resource scope and global restrictions above apply.
- **Authentication:** Active database-backed session required.
- **Request:** `{expectedVersion, reason, proposalId?}`.
- **Validation:** no revision of already executed order; proposal must match quote/customer; existing draft conflict.
- **Response:** 201 QuotationDTO with new draft.
- **Errors:** common error contract above; validation, permission, lifecycle and concurrency conditions are enforced before commit.
- **Business rules:** BR-005, BR-017.

### QUO-07 — Freeze current draft and route approval

- **Method/path:** `POST /api/v1/quotations/:id/submit`
- **Purpose:** Freeze current draft and route approval.
- **Actor / authorization:** Rep; resource scope and global restrictions above apply.
- **Authentication:** Active database-backed session required.
- **Request:** `{revisionId, expectedVersion, reason}`.
- **Validation:** nonempty valid lines; complete pricing/cost/policy; enforce expected current revision.
- **Response:** 200 {quotation, approvalCase}.
- **Errors:** common error contract above; validation, permission, lifecycle and concurrency conditions are enforced before commit.
- **Business rules:** BR-003–006, BR-017.

### QUO-08 — Expose exact quotation revision in customer portal

- **Method/path:** `POST /api/v1/quotations/:id/send`
- **Purpose:** Expose exact quotation revision in customer portal.
- **Actor / authorization:** Rep; resource scope and global restrictions above apply.
- **Authentication:** Active database-backed session required.
- **Request:** `{revisionId, expectedVersion}`.
- **Validation:** submitted evaluated revision; never implies email sent; known linked customer account.
- **Response:** 200 {revisionId, portalPath, customerReviewState:SENT}.
- **Errors:** common error contract above; validation, permission, lifecycle and concurrency conditions are enforced before commit.
- **Business rules:** BR-005, BR-008.

### QUO-09 — Rank valid upsell/cross-sell additions

- **Method/path:** `GET /api/v1/quotations/:id/suggestions`
- **Purpose:** Rank valid upsell/cross-sell additions.
- **Actor / authorization:** Rep; resource scope and global restrictions above apply.
- **Authentication:** Active database-backed session required.
- **Request:** `query: revisionId`.
- **Validation:** current quote scope; currency/plan-compatible candidates; cost required for margin delta.
- **Response:** 200 {suggestions:[{variantId,reason,promotion?,availability,marginDeltaByCadence}]}.
- **Errors:** common error contract above; validation, permission, lifecycle and concurrency conditions are enforced before commit.
- **Business rules:** BR-012, BR-019.

### QUO-10 — Dismiss recommendation for current revision

- **Method/path:** `POST /api/v1/quotations/:id/suggestions/:variantId/dismiss`
- **Purpose:** Dismiss recommendation for current revision.
- **Actor / authorization:** Rep; resource scope and global restrictions above apply.
- **Authentication:** Active database-backed session required.
- **Request:** `{revisionId}`.
- **Validation:** quote and variant exist; unique dismissal.
- **Response:** 200 {dismissed:true}.
- **Errors:** common error contract above; validation, permission, lifecycle and concurrency conditions are enforced before commit.
- **Business rules:** BR-019.

### QUO-11 — Adopt or decline customer change request

- **Method/path:** `POST /api/v1/quotations/:id/proposals/:proposalId/respond`
- **Purpose:** Adopt or decline customer change request.
- **Actor / authorization:** Rep; resource scope and global restrictions above apply.
- **Authentication:** Active database-backed session required.
- **Request:** `{expectedVersion, decision:ADOPT|DECLINE, reason}`.
- **Validation:** proposal open/current; adoption creates revised draft and supersedes old authorizations; resubmission re-evaluates risk.
- **Response:** 200 {proposal, quotation}.
- **Errors:** common error contract above; validation, permission, lifecycle and concurrency conditions are enforced before commit.
- **Business rules:** BR-005, BR-017.

### APR-01 — List review queue

- **Method/path:** `GET /api/v1/approvals`
- **Purpose:** List review queue.
- **Actor / authorization:** Manager, Finance/Operations; resource scope and global restrictions above apply.
- **Authentication:** Active database-backed session required.
- **Request:** `query: state?, assignedToMe?, cursor?, limit?`.
- **Validation:** Manager team scope; Finance scope; ordered active steps.
- **Response:** 200 Page<ApprovalSummaryDTO>.
- **Errors:** common error contract above; validation, permission, lifecycle and concurrency conditions are enforced before commit.
- **Business rules:** BR-004, BR-006.

### APR-02 — Read risk reasons, steps and audit

- **Method/path:** `GET /api/v1/approvals/:id`
- **Purpose:** Read risk reasons, steps and audit.
- **Actor / authorization:** Manager, Finance/Operations, owning Rep; resource scope and global restrictions above apply.
- **Authentication:** Active database-backed session required.
- **Request:** `none`.
- **Validation:** case belongs to accessible quote.
- **Response:** 200 ApprovalCaseDTO.
- **Errors:** common error contract above; validation, permission, lifecycle and concurrency conditions are enforced before commit.
- **Business rules:** BR-004–006, BR-017.

### APR-03 — Approve, reject or return active review step

- **Method/path:** `POST /api/v1/approvals/:id/decisions`
- **Purpose:** Approve, reject or return active review step.
- **Actor / authorization:** Manager, Finance/Operations; resource scope and global restrictions above apply.
- **Authentication:** Active database-backed session required.
- **Request:** `{expectedVersion, stepId, decision:APPROVE|REJECT|RETURN, reason}`.
- **Validation:** required role and current step; no author/submitter self-approval; reason 1–2000; lock case.
- **Response:** 200 ApprovalCaseDTO.
- **Errors:** common error contract above; validation, permission, lifecycle and concurrency conditions are enforced before commit.
- **Business rules:** BR-005, BR-006, BR-015, BR-017.

### POR-01 — List customer sent quotations

- **Method/path:** `GET /api/v1/portal/quotations`
- **Purpose:** List customer sent quotations.
- **Actor / authorization:** Customer; resource scope and global restrictions above apply.
- **Authentication:** Active database-backed session required.
- **Request:** `query: cursor?, limit?`.
- **Validation:** customer from session; exclude drafts/internal fields.
- **Response:** 200 Page<PortalQuotationSummaryDTO>.
- **Errors:** common error contract above; validation, permission, lifecycle and concurrency conditions are enforced before commit.
- **Business rules:** BR-008.

### POR-02 — View customer-safe exact commercial terms

- **Method/path:** `GET /api/v1/portal/quotations/:id`
- **Purpose:** View customer-safe exact commercial terms.
- **Actor / authorization:** Customer; resource scope and global restrictions above apply.
- **Authentication:** Active database-backed session required.
- **Request:** `query: revisionId?`.
- **Validation:** same customer and sent revision; superseded version visibly labeled and nonaccepting.
- **Response:** 200 PortalQuotationDTO.
- **Errors:** common error contract above; validation, permission, lifecycle and concurrency conditions are enforced before commit.
- **Business rules:** BR-005, BR-008.

### POR-03 — Ask line-level or quote-level question

- **Method/path:** `POST /api/v1/portal/quotations/:id/comments`
- **Purpose:** Ask line-level or quote-level question.
- **Actor / authorization:** Customer; resource scope and global restrictions above apply.
- **Authentication:** Active database-backed session required.
- **Request:** `{revisionId, quotationLineId?, body}`.
- **Validation:** line belongs to revision and customer; body 1–4000; customer visibility forced.
- **Response:** 201 PortalCommentDTO.
- **Errors:** common error contract above; validation, permission, lifecycle and concurrency conditions are enforced before commit.
- **Business rules:** BR-008, BR-017.

### POR-04 — Request commercial changes

- **Method/path:** `POST /api/v1/portal/quotations/:id/proposals`
- **Purpose:** Request commercial changes.
- **Actor / authorization:** Customer; resource scope and global restrictions above apply.
- **Authentication:** Active database-backed session required.
- **Request:** `{revisionId, expectedVersion, proposedOrderDiscount?, requestedDeliveryAt?, message, lines?:[{quotationLineId,proposedQuantity?,proposedDiscount?,message?}]}`.
- **Validation:** current sent revision; at least one change; line ownership/positive quantity/discount bounds.
- **Response:** 201 PortalProposalDTO.
- **Errors:** common error contract above; validation, permission, lifecycle and concurrency conditions are enforced before commit.
- **Business rules:** BR-005, BR-008, BR-017.

### POR-05 — Accept exact terms, conditionally pending approval if necessary

- **Method/path:** `POST /api/v1/portal/quotations/:id/accept`
- **Purpose:** Accept exact terms, conditionally pending approval if necessary.
- **Actor / authorization:** Customer; resource scope and global restrictions above apply.
- **Authentication:** Active database-backed session required.
- **Request:** `{revisionId, expectedVersion, termsHash}`.
- **Validation:** current sent unexpired terms; scoped customer; approval recheck; unique confirmation.
- **Response:** 200 {acceptanceId, state:CONFIRMED|PENDING_APPROVAL, orderId?}.
- **Errors:** common error contract above; validation, permission, lifecycle and concurrency conditions are enforced before commit.
- **Business rules:** BR-005, BR-007, BR-008, BR-015.

### POR-06 — Read customer receivables

- **Method/path:** `GET /api/v1/portal/invoices`
- **Purpose:** Read customer receivables.
- **Actor / authorization:** Customer; resource scope and global restrictions above apply.
- **Authentication:** Active database-backed session required.
- **Request:** `query: cursor?, limit?`.
- **Validation:** customer-scoped; issued invoices only.
- **Response:** 200 Page<PortalInvoiceDTO>.
- **Errors:** common error contract above; validation, permission, lifecycle and concurrency conditions are enforced before commit.
- **Business rules:** BR-008, BR-016.

### POR-07 — Read customer invoice and recorded payment status

- **Method/path:** `GET /api/v1/portal/invoices/:id`
- **Purpose:** Read customer invoice and recorded payment status.
- **Actor / authorization:** Customer; resource scope and global restrictions above apply.
- **Authentication:** Active database-backed session required.
- **Request:** `none`.
- **Validation:** invoice customer scoped; no bank secrets/internal notes.
- **Response:** 200 PortalInvoiceDTO.
- **Errors:** common error contract above; validation, permission, lifecycle and concurrency conditions are enforced before commit.
- **Business rules:** BR-008, BR-016.

### ORD-01 — List confirmed orders

- **Method/path:** `GET /api/v1/orders`
- **Purpose:** List confirmed orders.
- **Actor / authorization:** Internal identities; resource scope and global restrictions above apply.
- **Authentication:** Active database-backed session required.
- **Request:** `query: state?, customerId?, cursor?, limit?`.
- **Validation:** team scope for Rep/Manager; bounded pagination.
- **Response:** 200 Page<OrderSummaryDTO>.
- **Errors:** common error contract above; validation, permission, lifecycle and concurrency conditions are enforced before commit.
- **Business rules:** BR-007.

### ORD-02 — Read accepted commercial and operational state

- **Method/path:** `GET /api/v1/orders/:id`
- **Purpose:** Read accepted commercial and operational state.
- **Actor / authorization:** Internal identities; resource scope and global restrictions above apply.
- **Authentication:** Active database-backed session required.
- **Request:** `none`.
- **Validation:** team/customer scope; snapshots are immutable.
- **Response:** 200 OrderDTO.
- **Errors:** common error contract above; validation, permission, lifecycle and concurrency conditions are enforced before commit.
- **Business rules:** BR-007, BR-012.

### FUL-01 — Read warehouse balances and replenishment rules

- **Method/path:** `GET /api/v1/warehouses`
- **Purpose:** Read warehouse balances and replenishment rules.
- **Actor / authorization:** Internal identities; resource scope and global restrictions above apply.
- **Authentication:** Active database-backed session required.
- **Request:** `query: variantId?, cursor?, limit?`.
- **Validation:** internal only; available is onHand−reserved.
- **Response:** 200 Page<WarehouseDTO>.
- **Errors:** common error contract above; validation, permission, lifecycle and concurrency conditions are enforced before commit.
- **Business rules:** BR-009.

### FUL-02 — Configure warehouse and shipping weights

- **Method/path:** `POST /api/v1/warehouses`
- **Purpose:** Configure warehouse and shipping weights.
- **Actor / authorization:** Admin; resource scope and global restrictions above apply.
- **Authentication:** Active database-backed session required.
- **Request:** `{name, priority, baseShippingCost, perUnitShippingCost, shippingWeight}`.
- **Validation:** nonnegative decimals; configured currency; unique name.
- **Response:** 201 WarehouseDTO.
- **Errors:** common error contract above; validation, permission, lifecycle and concurrency conditions are enforced before commit.
- **Business rules:** BR-010, BR-017.

### FUL-03 — Update warehouse/replenishment configuration

- **Method/path:** `PATCH /api/v1/warehouses/:id`
- **Purpose:** Update warehouse/replenishment configuration.
- **Actor / authorization:** Admin; resource scope and global restrictions above apply.
- **Authentication:** Active database-backed session required.
- **Request:** `{expectedVersion, priority?, shippingWeight?, baseShippingCost?, perUnitShippingCost?, active?, replenishmentRules?:[{variantId,reorderPoint,targetQuantity}]}`.
- **Validation:** target≥reorderPoint≥0; cannot archive with active reservations; no direct onHand input.
- **Response:** 200 WarehouseDTO.
- **Errors:** common error contract above; validation, permission, lifecycle and concurrency conditions are enforced before commit.
- **Business rules:** R-008, BR-009, BR-017.

### FUL-04 — Record receipt or justified stock adjustment

- **Method/path:** `POST /api/v1/warehouses/:id/stock-movements`
- **Purpose:** Record receipt or justified stock adjustment.
- **Actor / authorization:** Finance/Operations; resource scope and global restrictions above apply.
- **Authentication:** Active database-backed session required.
- **Request:** `{variantId, expectedVersion, kind:RECEIPT|ADJUSTMENT, quantityDelta, reference, reason}`.
- **Validation:** receipt positive; adjustment cannot violate reserved/onHand invariant; active tracked variant.
- **Response:** 201 {movement, balance, consolidationCandidates}.
- **Errors:** common error contract above; validation, permission, lifecycle and concurrency conditions are enforced before commit.
- **Business rules:** BR-009, BR-011, BR-015, BR-017.

### FUL-05 — List orders needing fulfillment

- **Method/path:** `GET /api/v1/fulfillment`
- **Purpose:** List orders needing fulfillment.
- **Actor / authorization:** Internal identities; resource scope and global restrictions above apply.
- **Authentication:** Active database-backed session required.
- **Request:** `query: state?, warehouseId?, cursor?, limit?`.
- **Validation:** authorized order scope; shortage derived from demand/reservations/shipments.
- **Response:** 200 Page<FulfillmentSummaryDTO>.
- **Errors:** common error contract above; validation, permission, lifecycle and concurrency conditions are enforced before commit.
- **Business rules:** BR-009, BR-011.

### FUL-06 — Read current split, shipments and backorder

- **Method/path:** `GET /api/v1/fulfillment/:orderId`
- **Purpose:** Read current split, shipments and backorder.
- **Actor / authorization:** Internal identities; resource scope and global restrictions above apply.
- **Authentication:** Active database-backed session required.
- **Request:** `none`.
- **Validation:** authorized order scope.
- **Response:** 200 FulfillmentDTO.
- **Errors:** common error contract above; validation, permission, lifecycle and concurrency conditions are enforced before commit.
- **Business rules:** BR-009–011.

### FUL-07 — Calculate suggested warehouse allocation

- **Method/path:** `POST /api/v1/fulfillment/:orderId/preview`
- **Purpose:** Calculate suggested warehouse allocation.
- **Actor / authorization:** Finance/Operations; resource scope and global restrictions above apply.
- **Authentication:** Active database-backed session required.
- **Request:** `{expectedVersion}`.
- **Validation:** confirmed order; actual balances; no reservation writes.
- **Response:** 200 AllocationPreviewDTO {lines,shortages,shipmentCount,estimatedCost,orderVersion}.
- **Errors:** common error contract above; validation, permission, lifecycle and concurrency conditions are enforced before commit.
- **Business rules:** BR-009, BR-010.

### FUL-08 — Accept split, override or consolidate remaining demand

- **Method/path:** `POST /api/v1/fulfillment/:orderId/allocations`
- **Purpose:** Accept split, override or consolidate remaining demand.
- **Actor / authorization:** Finance/Operations; resource scope and global restrictions above apply.
- **Authentication:** Active database-backed session required.
- **Request:** `{expectedVersion, mode:SUGGESTED|OVERRIDE|CONSOLIDATE, lines:[{orderLineId,warehouseId,quantity}], reason?}`.
- **Validation:** revalidate under locks; exact demand bounds; override/consolidate requires reason; shipped quantities immutable.
- **Response:** 201 FulfillmentDTO.
- **Errors:** common error contract above; validation, permission, lifecycle and concurrency conditions are enforced before commit.
- **Business rules:** BR-009–011, BR-015, BR-017.

### FUL-09 — Dispatch reserved quantities

- **Method/path:** `POST /api/v1/fulfillment/:orderId/shipments`
- **Purpose:** Dispatch reserved quantities.
- **Actor / authorization:** Finance/Operations; resource scope and global restrictions above apply.
- **Authentication:** Active database-backed session required.
- **Request:** `{expectedVersion, warehouseId, lines:[{reservationId,quantity}], reference}`.
- **Validation:** positive quantities≤open reservations; correct warehouse/order; no service stock.
- **Response:** 201 ShipmentDTO.
- **Errors:** common error contract above; validation, permission, lifecycle and concurrency conditions are enforced before commit.
- **Business rules:** BR-009, BR-015, BR-017.

### BIL-01 — List recurring obligations

- **Method/path:** `GET /api/v1/subscriptions`
- **Purpose:** List recurring obligations.
- **Actor / authorization:** Internal identities; resource scope and global restrictions above apply.
- **Authentication:** Active database-backed session required.
- **Request:** `query: state?, customerId?, cursor?, limit?`.
- **Validation:** scope through order/customer; no fabricated paused state.
- **Response:** 200 Page<SubscriptionSummaryDTO>.
- **Errors:** common error contract above; validation, permission, lifecycle and concurrency conditions are enforced before commit.
- **Business rules:** BR-012.

### BIL-02 — Read recurring terms, history and next periods

- **Method/path:** `GET /api/v1/subscriptions/:id`
- **Purpose:** Read recurring terms, history and next periods.
- **Actor / authorization:** Internal identities; resource scope and global restrictions above apply.
- **Authentication:** Active database-backed session required.
- **Request:** `none`.
- **Validation:** authorized linked order; history immutable.
- **Response:** 200 SubscriptionDTO.
- **Errors:** common error contract above; validation, permission, lifecycle and concurrency conditions are enforced before commit.
- **Business rules:** BR-012–014.

### BIL-03 — Preview mid-period quantity or plan change

- **Method/path:** `POST /api/v1/subscriptions/:id/change-preview`
- **Purpose:** Preview mid-period quantity or plan change.
- **Actor / authorization:** Finance/Operations; resource scope and global restrictions above apply.
- **Authentication:** Active database-backed session required.
- **Request:** `{expectedVersion, quantity?, planId?, effectiveAt}`.
- **Validation:** positive quantity; valid plan; effectiveAt within allowed future/current period; no settled backdating.
- **Response:** 200 SubscriptionChangePreviewDTO.
- **Errors:** common error contract above; validation, permission, lifecycle and concurrency conditions are enforced before commit.
- **Business rules:** BR-013, BR-014.

### BIL-04 — Commit subscription change and adjustment

- **Method/path:** `POST /api/v1/subscriptions/:id/changes`
- **Purpose:** Commit subscription change and adjustment.
- **Actor / authorization:** Finance/Operations; resource scope and global restrictions above apply.
- **Authentication:** Active database-backed session required.
- **Request:** `{expectedVersion, quantity?, planId?, effectiveAt, reason}`.
- **Validation:** same as preview; recompute in transaction; no trust in preview totals.
- **Response:** 201 {subscription,adjustmentInvoice?,creditNote?}.
- **Errors:** common error contract above; validation, permission, lifecycle and concurrency conditions are enforced before commit.
- **Business rules:** BR-013–015, BR-017.

### BIL-05 — Preview cancellation and eligible unused-period credit

- **Method/path:** `POST /api/v1/subscriptions/:id/cancel-preview`
- **Purpose:** Preview cancellation and eligible unused-period credit.
- **Actor / authorization:** Finance/Operations; resource scope and global restrictions above apply.
- **Authentication:** Active database-backed session required.
- **Request:** `{expectedVersion, effectiveAt}`.
- **Validation:** valid snapshotted cancellation policy; active subscription.
- **Response:** 200 CancellationPreviewDTO.
- **Errors:** common error contract above; validation, permission, lifecycle and concurrency conditions are enforced before commit.
- **Business rules:** BR-014.

### BIL-06 — Stop future obligation and create eligible credit

- **Method/path:** `POST /api/v1/subscriptions/:id/cancellations`
- **Purpose:** Stop future obligation and create eligible credit.
- **Actor / authorization:** Finance/Operations; resource scope and global restrictions above apply.
- **Authentication:** Active database-backed session required.
- **Request:** `{expectedVersion, effectiveAt, reason}`.
- **Validation:** active subscription; no duplicate interval credit; re-evaluate preview.
- **Response:** 201 {subscription,creditNote?,cashRefundRequired}.
- **Errors:** common error contract above; validation, permission, lifecycle and concurrency conditions are enforced before commit.
- **Business rules:** BR-014, BR-015, BR-017.

### BIL-07 — List invoices and outstanding amounts

- **Method/path:** `GET /api/v1/invoices`
- **Purpose:** List invoices and outstanding amounts.
- **Actor / authorization:** Internal identities; resource scope and global restrictions above apply.
- **Authentication:** Active database-backed session required.
- **Request:** `query: state?, customerId?, cursor?, limit?`.
- **Validation:** authorized order scope; balance derived from postings.
- **Response:** 200 Page<InvoiceSummaryDTO>.
- **Errors:** common error contract above; validation, permission, lifecycle and concurrency conditions are enforced before commit.
- **Business rules:** BR-012, BR-016.

### BIL-08 — Read full invoice, lines, payments and credits

- **Method/path:** `GET /api/v1/invoices/:id`
- **Purpose:** Read full invoice, lines, payments and credits.
- **Actor / authorization:** Internal identities; resource scope and global restrictions above apply.
- **Authentication:** Active database-backed session required.
- **Request:** `none`.
- **Validation:** scope through order; financial audit accessible to Finance.
- **Response:** 200 InvoiceDTO.
- **Errors:** common error contract above; validation, permission, lifecycle and concurrency conditions are enforced before commit.
- **Business rules:** BR-012, BR-016.

### BIL-09 — Issue eligible one-time or currently due recurring charges

- **Method/path:** `POST /api/v1/orders/:id/invoices`
- **Purpose:** Issue eligible one-time or currently due recurring charges.
- **Actor / authorization:** Finance/Operations; resource scope and global restrictions above apply.
- **Authentication:** Active database-backed session required.
- **Request:** `{expectedVersion, kind:ONE_TIME|DUE_RECURRING}`.
- **Validation:** confirmed order; configured issue trigger; unique charge/period; no arbitrary future duplicate charges.
- **Response:** 201 InvoiceDTO or 200 existing InvoiceDTO on retry.
- **Errors:** common error contract above; validation, permission, lifecycle and concurrency conditions are enforced before commit.
- **Business rules:** BR-012, BR-015, BR-017.

### BIL-10 — Record verified payment against receivable

- **Method/path:** `POST /api/v1/invoices/:id/payments`
- **Purpose:** Record verified payment against receivable.
- **Actor / authorization:** Finance/Operations; resource scope and global restrictions above apply.
- **Authentication:** Active database-backed session required.
- **Request:** `{expectedVersion, amount, currency, paidAt, reference}`.
- **Validation:** positive decimal≤locked balance; currency/customer match; no future payment date beyond allowed clock skew.
- **Response:** 201 {payment,invoice}.
- **Errors:** common error contract above; validation, permission, lifecycle and concurrency conditions are enforced before commit.
- **Business rules:** BR-015–017.

### BIL-11 — Correct erroneous recorded payment with compensating entry

- **Method/path:** `POST /api/v1/invoices/:id/payments/:paymentId/reversals`
- **Purpose:** Correct erroneous recorded payment with compensating entry.
- **Actor / authorization:** Finance/Operations; resource scope and global restrictions above apply.
- **Authentication:** Active database-backed session required.
- **Request:** `{expectedVersion, reason}`.
- **Validation:** payment allocated to invoice; not already reversed; whole-payment reversal only initially; no destructive delete.
- **Response:** 201 {reversal,invoice}.
- **Errors:** common error contract above; validation, permission, lifecycle and concurrency conditions are enforced before commit.
- **Business rules:** BR-015–017.

### HEA-01 — Read actionable deal-health overview

- **Method/path:** `GET /api/v1/deal-health`
- **Purpose:** Read actionable deal-health overview.
- **Actor / authorization:** Rep, Manager, Admin; resource scope and global restrictions above apply.
- **Authentication:** Active database-backed session required.
- **Request:** `query: kind?, state?, cursor?, limit?`.
- **Validation:** team scope first; include evidence and evaluation timestamp.
- **Response:** 200 {summary,alerts:Page<DealAlertDTO>}.
- **Errors:** common error contract above; validation, permission, lifecycle and concurrency conditions are enforced before commit.
- **Business rules:** BR-018.

### HEA-02 — Acknowledge, nudge or escalate alert

- **Method/path:** `POST /api/v1/deal-health/:id/actions`
- **Purpose:** Acknowledge, nudge or escalate alert.
- **Actor / authorization:** Rep, Manager, Admin; resource scope and global restrictions above apply.
- **Authentication:** Active database-backed session required.
- **Request:** `{action:ACKNOWLEDGE|NUDGE|ESCALATE, reason?}`.
- **Validation:** Rep only own accessible alerts; Manager scope for escalation; validate recipient server-side.
- **Response:** 200 {alert,notification?}.
- **Errors:** common error contract above; validation, permission, lifecycle and concurrency conditions are enforced before commit.
- **Business rules:** BR-015, BR-018, BR-017.

### HEA-03 — Read configured alert thresholds

- **Method/path:** `GET /api/v1/settings/health-rules`
- **Purpose:** Read configured alert thresholds.
- **Actor / authorization:** Admin, Manager; resource scope and global restrictions above apply.
- **Authentication:** Active database-backed session required.
- **Request:** `none`.
- **Validation:** internal privileged configuration.
- **Response:** 200 HealthRuleDTO[].
- **Errors:** common error contract above; validation, permission, lifecycle and concurrency conditions are enforced before commit.
- **Business rules:** BR-018.

### HEA-04 — Change inactivity/anomaly/slippage policy

- **Method/path:** `PUT /api/v1/settings/health-rules/:id`
- **Purpose:** Change inactivity/anomaly/slippage policy.
- **Actor / authorization:** Admin, Manager; resource scope and global restrictions above apply.
- **Authentication:** Active database-backed session required.
- **Request:** `{expectedVersion, active, config}`.
- **Validation:** typed per-kind schema; minimum sample positive; bounded threshold/range.
- **Response:** 200 HealthRuleDTO.
- **Errors:** common error contract above; validation, permission, lifecycle and concurrency conditions are enforced before commit.
- **Business rules:** BR-018, BR-017.

### HEA-05 — Read in-app nudges and operational prompts

- **Method/path:** `GET /api/v1/notifications`
- **Purpose:** Read in-app nudges and operational prompts.
- **Actor / authorization:** Internal identities; resource scope and global restrictions above apply.
- **Authentication:** Active database-backed session required.
- **Request:** `query: unread?, cursor?, limit?`.
- **Validation:** recipient=self; no arbitrary recipient query.
- **Response:** 200 Page<NotificationDTO>.
- **Errors:** common error contract above; validation, permission, lifecycle and concurrency conditions are enforced before commit.
- **Business rules:** BR-008, BR-018.

### HEA-06 — Mark own notification read

- **Method/path:** `POST /api/v1/notifications/:id/read`
- **Purpose:** Mark own notification read.
- **Actor / authorization:** Internal identities; resource scope and global restrictions above apply.
- **Authentication:** Active database-backed session required.
- **Request:** `{}`.
- **Validation:** recipient=self; idempotent read marker.
- **Response:** 200 NotificationDTO.
- **Errors:** common error contract above; validation, permission, lifecycle and concurrency conditions are enforced before commit.
- **Business rules:** BR-008.

### REP-01 — Read filtered sales/approval/upsell metrics

- **Method/path:** `GET /api/v1/reports/sales`
- **Purpose:** Read filtered sales/approval/upsell metrics.
- **Actor / authorization:** Rep, Manager, Finance/Operations, Admin; resource scope and global restrictions above apply.
- **Authentication:** Active database-backed session required.
- **Request:** `query: from, to, teamId?, repId?, approvalStatus?, productId?, categoryId?`.
- **Validation:** bounded date range proposed max 366 days; role scope before aggregation; explicit currency/cadence groups.
- **Response:** 200 SalesReportDTO {filters,asOf,groups,quoteCount,approvalDuration,upsellAttribution}.
- **Errors:** common error contract above; validation, permission, lifecycle and concurrency conditions are enforced before commit.
- **Business rules:** BR-020.

### REP-02 — Export same scoped report as PDF or XLS

- **Method/path:** `GET /api/v1/reports/sales/export`
- **Purpose:** Export same scoped report as PDF or XLS.
- **Actor / authorization:** Rep, Manager, Finance/Operations, Admin; resource scope and global restrictions above apply.
- **Authentication:** Active database-backed session required.
- **Request:** `same query as REP-01 plus format:pdf|xls`.
- **Validation:** same report limits/scope; safe spreadsheet cells; actual requested format, never renamed CSV.
- **Response:** 200 binary file with Content-Type and Content-Disposition; JSON error envelope on failure.
- **Errors:** common error contract above; validation, permission, lifecycle and concurrency conditions are enforced before commit.
- **Business rules:** R-012, BR-020.

### REP-03 — Read role-scoped sales home totals and activity

- **Method/path:** `GET /api/v1/dashboard`
- **Purpose:** Read role-scoped sales home totals and activity.
- **Actor / authorization:** Internal identities; resource scope and global restrictions above apply.
- **Authentication:** Active database-backed session required.
- **Request:** `query: teamId?`.
- **Validation:** same scope rules as quotations/reports; no made-up chart series.
- **Response:** 200 DashboardDTO {pendingApprovals,openQuotations,atRiskDeals,recentActivity}.
- **Errors:** common error contract above; validation, permission, lifecycle and concurrency conditions are enforced before commit.
- **Business rules:** R-013, BR-018, BR-020.

### OPS-01 — Expose process liveness

- **Method/path:** `GET /api/v1/health/live`
- **Purpose:** Expose process liveness.
- **Actor / authorization:** Public; resource scope and global restrictions above apply.
- **Authentication:** No session required; public endpoint protections apply.
- **Request:** `none`.
- **Validation:** no sensitive configuration details.
- **Response:** 200 {status:alive}.
- **Errors:** common error contract above; validation, permission, lifecycle and concurrency conditions are enforced before commit.
- **Business rules:** Architecture observability.

### OPS-02 — Check database and migration readiness

- **Method/path:** `GET /api/v1/health/ready`
- **Purpose:** Check database and migration readiness.
- **Actor / authorization:** Public; resource scope and global restrictions above apply.
- **Authentication:** No session required; public endpoint protections apply.
- **Request:** `none`.
- **Validation:** bounded DB check; no version strings/credentials; rate limit.
- **Response:** 200 {status:ready} or 503 {code:NOT_READY}.
- **Errors:** common error contract above; validation, permission, lifecycle and concurrency conditions are enforced before commit.
- **Business rules:** Architecture observability.

## Internal system operations (not public APIs)

The scheduler invokes billing.generateDuePeriods(), dealHealth.evaluateRules() and fulfillment.findConsolidationCandidates() through application services under a system actor. Do not expose an unauthenticated `/run-jobs` or seed/reset endpoint. Job leases, retries and uniqueness are in [Database.md](Database.md). Runtime health is not an authorization bypass.

## State transition and UI coordination

Creating or revising a quote returns a revision ID/version. The client submits that exact pair; save/submit/send/accept never act on an implied latest revision without comparison. Adopted proposals re-enter draft/submission; the UI clearly labels approval required. A customer may agree conditionally while review is pending; approval completion invokes the same idempotent confirmation service. Actual allocation/shipping is restricted to confirmed orders.

No endpoint edits an issued invoice, deletes audit history or directly patches order approval/stock counters. UI Add to Quote modifies draft form and uses preview/save contracts; it does not need a separate unsafe add-suggestion bypass. Close Workspace is client navigation after dirty-state handling, not an invented backend endpoint. Reload Data invalidates query caches. The board's Profile/Messages tabs can remain customer-safe account identity and quote-comment views; no unrelated direct-message API is introduced.

## Contract lifecycle

This inventory is the approved target scope, not a claim that every listed endpoint exists. Implemented exceptions are recorded below and test evidence belongs in `memory.me`. Generate OpenAPI 3.1 from runtime validators or maintain it alongside code; do not ship two diverging contracts. Breaking production changes require a documented compatibility plan and, when necessary, a new API version.

## Implementation update — 2026-09-05

AUTH-01 is implemented: `POST /api/v1/auth/signup` accepts only `{displayName,email,password}`, trims and normalizes email/name, validates name 1–120 and password 12–128, hashes with bcrypt, persists PENDING, and returns HTTP 202 `{success:true,data:{status:"PENDING",message}}`. Existing emails receive the same public result without account changes. Extra fields (including role) are rejected with 422. AUTH-02 and session authentication require ACTIVE; valid credentials for a pending/disabled account return 403 ACCOUNT_INACTIVE and no cookie. Existing active demo accounts remain available.

Browser authentication now uses an opaque HttpOnly `dealos_session` cookie plus a SameSite=Strict `dealos_csrf` cookie whose hash is stored on the session. Authenticated mutations require both an exact configured `Origin` and matching `X-CSRF-Token`. `GET /api/v1/auth/me` returns platform status, organization context and a distinct real actor/simulated identity when View As is active.

`POST /api/v1/auth/super-admin/login` is the only Platform Owner login endpoint. It accepts strict `{loginId,password}`. Server configuration requires a non-empty `PLATFORM_OWNER_LOGIN_ID` and `PLATFORM_OWNER_PASSWORD` of at least 16 characters; incomplete or weak configuration returns 503 `PLATFORM_OWNER_NOT_CONFIGURED`. Valid input is compared in constant time, a five-failure/15-minute process-local throttle applies, and success returns a separate four-hour HttpOnly `dealos_platform_session`. It clears an organization session in the same browser. `GET /api/v1/auth/super-admin/me` accepts only that session. Organization users, including Admins, receive `PLATFORM_OWNER_REQUIRED` from every platform endpoint. No endpoint can grant owner status to a user.

### Implemented Platform Super Admin API

All routes below require the independent environment-authenticated Platform Owner session. Every mutation requires CSRF validation. Except for View As exit, mutations are denied while a read-only simulated context is active.

| Method and path | Purpose | High-risk controls |
|---|---|---|
| `GET /api/v1/platform/dashboard` | Live global metrics, filtered/paged organizations and recent privileged actions | Independent Platform Owner session only |
| `GET /api/v1/platform/organizations/:id` | Organization members, quotes/approvals, inventory, subscriptions, invoices/payments and audit history | Independent Platform Owner session; safe selected fields |
| `POST /api/v1/platform/organizations` | Create organization | Written reason; privileged audit |
| `PATCH /api/v1/platform/organizations/:id` | Rename, activate, suspend or archive organization | Written reason; exact status confirmation for suspend/archive |
| `GET /api/v1/platform/members` | Search/paginate users, memberships and role/status assignments | Password/session/token fields omitted |
| `POST /api/v1/platform/invitations` | Create seven-day organization invitation | Role-pair validation; token hash never returned |
| `POST /api/v1/platform/organizations/:id/members` | Add/reactivate existing user membership | Organization/user existence and role-pair validation |
| `PATCH /api/v1/platform/memberships/:id` | Change organization role or suspend/revoke membership | Written reason; status confirmation |
| `PATCH /api/v1/platform/users/:id/status` | Activate/disable organization user and revoke disabled user's sessions | Written reason; status confirmation |
| `POST /api/v1/platform/users/:id/reset-access` | Revoke active sessions | `RESET ACCESS` confirmation; does not pretend to send a password |
| `POST /api/v1/platform/view-as` | Enter read-only organization or user context | Active target validation; written reason; real actor retained |
| `POST /api/v1/platform/view-as/exit` | Explicitly return to global platform context | Audited exit; allowed while simulation blocks other mutations |

Normal `/api/v1/workspace` and business resource routes resolve organization membership centrally and constrain database reads/mutations by `organizationId`. A manipulated `X-Organization-Id` returns `ORGANIZATION_ACCESS_DENIED`; suspended organizations return `ORGANIZATION_SUSPENDED`. The Platform Owner receives no global business data from `/workspace` unless it explicitly enters read-only View As.
