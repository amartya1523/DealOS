# DealOS — REST API contracts

Status: living API contract. The inventory describes the target API; implemented compatibility endpoints and the Platform Owner control plane are identified at the end of this document.

## Shared HTTP contract

All paths below are relative to `/api/v1`. HTTPS in production. JSON UTF-8 except binary exports. Request IDs are accepted only in bounded safe form or generated; returned as `X-Request-ID`. Success `{success:true,data:<described DTO>,meta:{requestId,...pagination?}}`. Error `{success:false,error:{code,message,details?},meta:{requestId}}`. Dates are ISO-8601; money/quantity/rate values are decimal strings, not binary floating JSON numbers. Versions and counts are integers. IDs are UUIDs except catalog codes. `Page<T>` is `{items:T[],nextCursor:string|null}` with default 25/max 100. No stored password/hash, raw session token or internal stack trace appears in a response. Explicit credential-provisioning endpoints may return a newly generated plaintext password once and are identified below; it is never available from a later read.

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
| PortalRequest | id, requirementsText, preferredDeliveryDate?, safe status `RECEIVED|IN_PROGRESS|DECLINED`, createdAt and safe lines `{id,product?:{id,name,sku},description?,quantity?,catalogMatch}`; **no owner/team/result IDs, prices, internal/degradation/dismiss notes** |
| PublicBusiness | opaque organization id, displayName, shortDescription?, category? only; no internal Organization name, users, customers, products/pricing/cost/tax/stock, policies or metrics |
| DirectoryJoinRequest | internal id, email, companyName, message, status, decision actor/time/reason and resulting Customer summary when applicable; public submission receives only id/status/time |
| Lead | id/status/summary, customer/team/assigned Rep, internal source request with degradation flags, converted quotation summary?, timestamps and internal dismiss reason; internal Rep/Manager projection only |
| Order | id/number/version, source revision, customer, accepted lines, fulfillment summary, separate billing status |
| Warehouse / Fulfillment | warehouse costs/priorities, balances, reservations, shipment history, remaining demand, estimate and version; no silent write during GET |
| Subscription | id/version, order line, plan snapshot, quantity, cadence, timezone, current/next period, state, dated changes/credits |
| Invoice | id/number/version, immutable issued lines, currency/taxes/total, payments/credits, outstanding balance, issue/due date and derived status |
| PortalInvoice | invoice commercial lines, totals, due date, paid/outstanding status; no internal financial notes/provider secrets |
| Alert / Notification | id, kind/severity/state, safe reason, scoped resource link, evaluation time; notification recipient/action/read time |
| SalesReport | applied filters/asOf, separate currency/cadence groups, clearly defined counts/approval durations/upsell attribution; no unscoped raw records |

DTO additions must be documented before exposing them. Nested domain DTOs use Database.md fields converted to camelCase through explicit mapping, **not** automatic ORM serialization. `version` always maps to lock_version (optimistic counter), while configuration version is named policyVersion/planVersion where ambiguity exists.

## Endpoint inventory

### DIR-01 — List discoverable businesses

- **Method/path:** `GET /api/v1/directory/businesses`
- **Actor / authorization:** Public, no session.
- **Response:** 200 `{items:PublicBusinessDTO[]}` ordered by display name, max 200. Only profiles with `isDiscoverable=true` and active Organization status qualify.
- **Security:** Explicit projection only; catalog preview is not implemented.
- **Business rules:** R-051, BR-008, BR-021, BR-028.

### DIR-02 — Submit customer association request

- **Method/path:** `POST /api/v1/directory/businesses/:organizationId/join-requests`
- **Actor / authorization:** Public; allowed Origin required.
- **Request:** `{email,companyName,message}` with normalized valid email, company 2–160 and message 5–2000; unknown fields rejected.
- **Response:** 201 `{id,status:"PENDING",createdAt}`. No account/customer/Lead/RFQ/quotation is created.
- **Errors:** 404 hidden/inactive/unknown business; 409 `PENDING_REQUEST_EXISTS`; 429 `RATE_LIMITED` with Retry-After. Initial bounds are Proposed five per organization/email and twenty per organization/IP per rolling hour.
- **Business rules:** R-051, BR-028.

### DIR-03 — List scoped association requests

- **Method/path:** `GET /api/v1/directory/join-requests`
- **Actor / authorization:** Manager/Admin with customers module; tenant-scoped.
- **Request:** `query: status?:PENDING|APPROVED|DECLINED`; unknown query fields rejected.
- **Response:** 200 `{items:DirectoryJoinRequestDTO[]}`, newest first, max 200. No plaintext credential field exists.
- **Business rules:** BR-017, BR-021, BR-028.

### DIR-04 — Approve association and provision customer

- **Method/path:** `POST /api/v1/directory/join-requests/:id/approve`
- **Actor / authorization:** Manager/Admin with customers module; active session and CSRF. Manager may select only a team they manage.
- **Request:** `{primarySalesTeamId,primaryRepId,collaboratorIds?:[],customerTier,currency}`; relationship IDs use the exact CAT-03A eligibility rules.
- **Processing:** Lock organization-scoped PENDING request. In one transaction use the CAT-02 customer service, CAT-03A relationship service and existing customer-password provisioner; finalize request/audit only after all succeed.
- **Response:** 200 `{request:DirectoryJoinRequestDTO,credentials:{email,password,signInPath:"/customer/sign-in"}}`. The server-generated raw password is returned only in this response; later GETs omit it and PostgreSQL stores only bcrypt hash.
- **Errors:** 404 scoped miss; 409 already decided/name/email collision; 422/403 exact team/Rep/Manager validation. Any failure rolls back all Customer/User/Membership/Representative/request changes.
- **Business rules:** BR-017, BR-021, BR-024, BR-027, BR-028.

### DIR-05 — Decline association request

- **Method/path:** `POST /api/v1/directory/join-requests/:id/decline`
- **Actor / authorization:** Manager/Admin with customers module; active session and CSRF.
- **Request:** `{reason:string(5..1000)}`.
- **Response:** 200 DirectoryJoinRequestDTO with DECLINED status. No related customer/account record is created.
- **Errors:** 404 scoped miss; 409 already decided; 422 invalid reason.
- **Business rules:** BR-017, BR-021, BR-028.

### DIR-06 — Read organization directory settings

- **Method/path:** `GET /api/v1/settings/directory-profile`
- **Actor / authorization:** Organization Admin only.
- **Response:** 200 `{organizationId,displayName,shortDescription,category,isDiscoverable,updatedAt}`; before first save, defaults to internal organization name with `isDiscoverable:false` but nothing is publicly listed.
- **Business rules:** R-051, BR-028.

### DIR-07 — Publish or hide organization directory profile

- **Method/path:** `PUT /api/v1/settings/directory-profile`
- **Actor / authorization:** Organization Admin only; active session and CSRF.
- **Request:** `{displayName:string(2..120),shortDescription?:string(0..500)|null,category?:string(0..80)|null,isDiscoverable:boolean}`.
- **Response:** 200 saved profile. A change is audited; hiding immediately removes it from DIR-01/DIR-02 eligibility.
- **Business rules:** BR-017, BR-021, BR-028.

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

- **Method/path:** `GET /api/v1/sales-teams`
- **Purpose:** Read organization sales-team choices and active Rep members for account assignment.
- **Actor / authorization:** Admin, Manager; resource scope and global restrictions above apply.
- **Authentication:** Active database-backed session required.
- **Request:** none.
- **Validation:** Manager sees assigned teams only.
- **Response:** 200 `{items:Array<{id,name,managerId,representatives:Array<{id,name}>}>}`. Managers receive only teams they manage; Admin receives all organization teams.
- **Errors:** common error contract above; validation, permission, lifecycle and concurrency conditions are enforced before commit.
- **Business rules:** R-004.

### AUTH-09 — Create a sales team

- **Method/path:** `POST /api/v1/sales-teams`
- **Purpose:** Create one named team and place multiple sales representatives on it in a single action.
- **Actor / authorization:** Admin; resource scope and global restrictions above apply.
- **Authentication:** Active database-backed session required.
- **Request:** `{name, managerId:null|string, memberIds:string[]}`. `memberIds` is the complete selected Rep list.
- **Validation:** organization-scoped, case-insensitively unique name; 1–200 distinct active Rep identities; optional manager must be an active Manager or Admin in the same organization.
- **Response:** 201 `{id,name,managerId,memberIds}`.
- **Errors:** common error contract above; validation, permission, lifecycle and concurrency conditions are enforced before commit.
- **Business rules:** R-004, BR-017.

### AUTH-10 — Update team membership

- **Method/path:** `PATCH /api/v1/sales-teams/:id`
- **Purpose:** Rename a team, change its manager, and replace its complete Rep membership from the simple team editor.
- **Actor / authorization:** Admin; resource scope and global restrictions above apply.
- **Authentication:** Active database-backed session required.
- **Request:** `{name, managerId:null|string, memberIds:string[]}`. All fields describe the desired final team state.
- **Validation:** same organization, name and identity rules as AUTH-09. A Rep cannot be removed while actively assigned to a customer on the team or while owning a non-confirmed/non-rejected quotation for it; reassign that work first.
- **Response:** 200 `{id,name,managerId,memberIds}`.
- **Errors:** common error contract above; validation, permission, lifecycle and concurrency conditions are enforced before commit.
- **Audit:** successful create/update writes `SALES_TEAM_CREATED` / `SALES_TEAM_UPDATED`; a rejected removal changes nothing.
- **Business rules:** R-004, BR-017.

### CAT-01 — Find accessible buying businesses

- **Method/path:** `GET /api/v1/customers`
- **Purpose:** Find accessible buying businesses.
- **Actor / authorization:** Rep, Manager, Finance/Operations, Admin; resource scope and global restrictions above apply.
- **Authentication:** Active database-backed session required.
- **Request:** `query: search?, assignment?:all|assigned|unassigned, limit?`; `tierId?` and cursor paging remain planned.
- **Validation:** organization scope and active customers first. REP sees only active representative assignments when the production rollout flag is enabled; Manager sees managed-team and unresolved customers; Finance/Admin see the organization. Customer portal actors are denied.
- **Response:** 200 `{items: Array<{id,name,tier,currency,primaryTeam,primaryRepresentative,collaborators,assignmentVersion,openQuotationCount,lastActivity,openQuotations}>}`. Open quotations expose only the fields required for explicit reassignment choice.
- **Errors:** common error contract above; validation, permission, lifecycle and concurrency conditions are enforced before commit.
- **Business rules:** R-005, BR-008.

### CAT-02 — Configure a buying business

- **Method/path:** `POST /api/v1/customers`
- **Purpose:** Configure a buying business.
- **Actor / authorization:** Manager, Admin; resource scope and global restrictions above apply. Customer profiles are never created by Reps or portal users. Only Admin may provision login credentials during this request.
- **Authentication:** Active database-backed session required.
- **Request:** `{name,tier,currency,customerType,region,contactPerson?,email?,phone?,countryCode,gstin?,billingAddress?,shippingAddress?,paymentTerms,active,temporaryPassword?}`. For Admin, `email` and `temporaryPassword` are required and the password is 12–128 characters. Manager must omit `temporaryPassword`.
- **Validation:** known tier/currency; normalized globally available portal email and unique customer email within the organization; payment terms 0–180 days; no assignment, owner, role, or invitation input. Admin creation atomically creates an active CUSTOMER/PORTAL_USER identity while storing only the password hash. Assignment remains a separate required step before portal RFQ submission, portal invitation, or quotation creation.
- **Response:** 201 CustomerDTO.
- **Errors:** common error contract above; validation, permission, lifecycle and concurrency conditions are enforced before commit.
- **Business rules:** R-005, R-050, BR-017, BR-027.

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

### CAT-03A — Replace active customer relationships

- **Method/path:** `PUT /api/v1/customers/:id/relationships`
- **Purpose:** Assign the customer's primary sales team, one primary Rep and optional collaborators without rewriting any quotation.
- **Actor / authorization:** Manager for a team they manage, or organization Admin.
- **Authentication:** Active database-backed session and CSRF required.
- **Request:** `{expectedVersion,primarySalesTeamId,primaryRepId,collaboratorIds,reason}`; strict unknown-field rejection.
- **Validation:** customer/team/users resolved inside authenticated organization; candidates must be active REP users and selected-team members; portal users rejected; stale assignmentVersion returns 409 STALE_VERSION.
- **Response:** 200 relationship projection plus current open quotations. Removed assignments are ended, the version increments and a reasoned before/after privileged audit is written in the same transaction.
- **Business rules:** BR-017, BR-021, BR-024.

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

#### Current workspace policy editor

- **Method/path:** `PATCH /api/v1/policies/:id`
- **Purpose:** Edit and publish the selected customer tier's overall ceiling, Hardware, Services and Subscriptions ceilings, and Finance escalation threshold in one audited operation.
- **Actor / authorization:** Organization Admin or Manager with the Rules module; organization scope is enforced server-side. Platform Owner view-as sessions remain read-only.
- **Authentication:** Active session, matching origin and CSRF token required.
- **Request:** `{maxDiscount, hardwareLimit, servicesLimit, subscriptionLimit, financeThreshold, reason}`. All numeric values are percentages/points from 0 through 100; `reason` is 5–240 characters.
- **Validation:** The request is complete and strict. Every category ceiling must be less than or equal to the overall tier ceiling. Invalid input returns 422 with field details.
- **Response:** 200 updated policy. A successful save increments `version`, refreshes `publishedAt`, and records `POLICY_UPDATED` with the supplied reason in the same transaction.
- **Business rules:** BR-003, BR-004, BR-017. This is the current compact editor endpoint; SET-02/SET-03 remain the target draft/publish model for immutable policy history.

### SET-04 — Read recurring-plan configurations

- **Method/path:** `GET /api/v1/settings/subscription-plans`
- **Purpose:** Read recurring-plan configurations.
- **Actor / authorization:** Admin only; resource scope and global restrictions above apply.
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
- **Request:** `query: stage?, customerId?, ownerId?, search?, activityPeriod?:7d|30d|90d|all, sort?:activity_desc|activity_asc|amount_desc|amount_asc|quotation_asc|quotation_desc, cursor?, limit?`.
- **Validation:** organization/module/role scope first; Reps see quotations they own plus read-only quotations for teams where they are members; owner-only mutation capabilities remain separate. Stage is projected from the current revision, active approval/proposal and order records.
- **Response:** 200 `{items: QuotationSummaryDTO[], pagination:{total,nextCursor}, stageCounts, owners, primaryStages}`. Money is a decimal string and the DTO includes customer, owner, currency, risk indicator, active approval step, exact current revision ID/version, and last activity.
- **Errors:** common error contract above; validation, permission, lifecycle and concurrency conditions are enforced before commit.
- **Business rules:** R-014, BR-005.

### QUO-02 — Create customer quotation draft

- **Method/path:** `POST /api/v1/quotations`
- **Purpose:** Create customer quotation draft.
- **Actor / authorization:** Rep with an active customer assignment; Manager for a managed-team customer; Admin organization-wide. Manager/Admin must explicitly submit an assigned owner.
- **Authentication:** Active database-backed session required.
- **Request:** Rep `{customerId,validUntil?,promisedDeliveryAt?,terms?}`; Manager/Admin `{customerId,ownerId,validUntil?,promisedDeliveryAt?,terms?}`. `teamId`, `tier` and `currency` are always rejected; Rep-supplied ownerId is rejected.
- **Validation:** selected customer must be active and assigned in the actor's organization. Rep must have an active relationship and becomes owner. Manager/Admin owner must be one of the customer's active assigned Reps. Team, customer name, tier and currency are derived and snapshotted server-side; creator is recorded separately.
- **Response:** 201 QuotationSummaryDTO for the new exact Draft revision.
- **Errors:** common error contract above; validation, permission, lifecycle and concurrency conditions are enforced before commit.
- **Business rules:** BR-001, BR-017.

### QUO-03 — Read current quotation and revision history

- **Method/path:** `GET /api/v1/quotations/:id`
- **Purpose:** Read current quotation and revision history.
- **Actor / authorization:** Rep, Manager, Finance/Operations, Admin; resource scope and global restrictions above apply.
- **Authentication:** Active database-backed session required.
- **Request:** `none`.
- **Validation:** internal role/team scope; owner mutation capability is independent from team visibility; include current revision version.
- **Response:** 200 QuotationDTO including account team, deal owner, account role, creator and `viewerAccess.readOnlyTeamView`. A non-owner teammate receives no edit/submit/send capabilities.
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
- **Validation:** same calculation schema as preview; exact current Draft and optimistic version; server re-resolves all price, cost, tax, cadence, and policy inputs.
- **Response:** 200 `{quote, revisionId, version, calculation}`. The prior Draft becomes superseded and the returned `revisionId` identifies the new immutable saved Draft snapshot.
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
- **Validation:** nonempty valid saved Draft; complete pricing/cost/policy; enforce exact current revision/version. Submission creates a separate frozen submitted revision and never rewrites the saved Draft snapshot.
- **Response:** 200 {quotation, approvalCase}.
- **Errors:** common error contract above; validation, permission, lifecycle and concurrency conditions are enforced before commit.
- **Business rules:** BR-003–006, BR-017.

### QUO-08 — Expose exact quotation revision in customer portal

- **Method/path:** `POST /api/v1/quotations/:id/send`
- **Purpose:** Expose exact quotation revision in customer portal.
- **Actor / authorization:** Rep; resource scope and global restrictions above apply.
- **Authentication:** Active database-backed session required.
- **Request:** `{revisionId, expectedVersion}`.
- **Validation:** exact current version; owner Rep only; revision is SUBMITTED and its bound ApprovalCase is APPROVED. Sending never implies external email delivery.
- **Response:** 200 `{quoteId,revisionId,state:SENT,version,sentAt}`.
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

### SET-08 — Read customer RFQ handling mode

- **Method/path:** `GET /api/v1/settings/rfq-handling`
- **Purpose:** Read the organization's explicit portal-request processing branch.
- **Actor / authorization:** Organization Admin only.
- **Authentication:** Active session required.
- **Response:** 200 `{mode:LEAD_FIRST|DIRECT_DRAFT,defaultClassification:"PROPOSED"}`.
- **Business rules:** R-047–R-049, BR-026.

### SET-09 — Change customer RFQ handling mode

- **Method/path:** `PUT /api/v1/settings/rfq-handling`
- **Purpose:** Select Lead-first review or immediate private Draft creation.
- **Actor / authorization:** Organization Admin only; service repeats the role gate.
- **Authentication:** Active session and CSRF required.
- **Request:** `{mode:LEAD_FIRST|DIRECT_DRAFT,reason?:string(5..500)}`; unknown fields rejected.
- **Response:** 200 `{mode,changed,defaultClassification:"PROPOSED"}`. A real change appends `RFQ_HANDLING_MODE_CHANGED`; a no-op returns `changed:false` without a misleading change audit.
- **Errors:** 403 `FORBIDDEN`; 404 scoped organization miss; 422 validation.
- **Business rules:** R-047–R-049, BR-017, BR-021, BR-026.

### QUO-11 — Adopt or decline customer change request

- **Method/path:** `POST /api/v1/quotations/:id/proposals/:proposalId/respond`
- **Purpose:** Adopt or decline customer change request.
- **Actor / authorization:** Rep; resource scope and global restrictions above apply.
- **Authentication:** Active database-backed session required.
- **Request:** `{expectedVersion, decision:ADOPT|DECLINE, reason}`.
- **Validation:** owner Rep, exact quotation version, proposal open/current and bound to the current SENT revision. Adoption creates a backend-recalculated Draft, supersedes old authorization and requires explicit resubmission. Decline closes the proposal, returns the quotation to APPROVED and restores the unchanged SENT revision as acceptable.
- **Response:** 200 {proposal, quotation}.
- **Errors:** common error contract above; validation, permission, lifecycle and concurrency conditions are enforced before commit.
- **Business rules:** BR-005, BR-017.

### APR-01 — List review queue

- **Method/path:** `GET /api/v1/approvals`
- **Purpose:** List review queue.
- **Actor / authorization:** Manager, Finance/Operations; resource scope and global restrictions above apply.
- **Authentication:** Active database-backed session required.
- **Request:** `query: state=PENDING|RETURNED|APPROVED` (defaults to PENDING).
- **Validation:** Manager team scope; Finance receives only Manager+Finance routes; ordered case steps.
- **Response:** 200 `{items: ApprovalSummaryDTO[]}` (bounded to 100 in the compatibility API).
- **Errors:** common error contract above; validation, permission, lifecycle and concurrency conditions are enforced before commit.
- **Business rules:** BR-004, BR-006.

### APR-02 — Read risk reasons, steps and audit

- **Method/path:** `GET /api/v1/approvals/:id`
- **Purpose:** Read risk reasons, steps and audit.
- **Actor / authorization:** Manager, Finance/Operations; resource scope and global restrictions above apply.
- **Authentication:** Active database-backed session required.
- **Request:** `none`.
- **Validation:** case belongs to accessible quote.
- **Response:** 200 ApprovalCaseDTO.
- **Errors:** common error contract above; validation, permission, lifecycle and concurrency conditions are enforced before commit.
- **Business rules:** BR-004–006, BR-017.

### APR-03 — Approve, reject or return active review step

- **Method/path:** `POST /api/v1/approvals/:id/decision`
- **Purpose:** Approve, reject or return active review step.
- **Actor / authorization:** Manager, Finance/Operations; resource scope and global restrictions above apply.
- **Authentication:** Active database-backed session required.
- **Request:** `{expectedVersion, decision:APPROVE|REJECT|RETURN, reason}`.
- **Validation:** required role and active ordered step; no author/submitter self-approval; reason 2–2000; lock case. Finance cannot act until Manager approves. Return supersedes unfinished steps and creates a new Draft revision.
- **Response:** 200 ApprovalCaseDTO.
- **Errors:** common error contract above; validation, permission, lifecycle and concurrency conditions are enforced before commit.
- **Business rules:** BR-005, BR-006, BR-015, BR-017.

### POR-00A — Issue customer portal invitation

- **Method/path:** `POST /api/v1/customers/:id/portal-invitations`.
- **Purpose:** Create a seven-day, single-use manual-share invitation link. Compatibility alias `/api/v1/customers/:id/portal-invite` uses the same implementation.
- **Actor / authorization:** Manager for the customer's managed team, or organization Admin; customers and Reps denied.
- **Authentication:** Active database-backed session and CSRF required.
- **Request:** `{}`; recipient, role, organization, customer, and expiry overrides are rejected.
- **Validation:** scoped active customer with email, primary team, and exactly one active primary Rep; no active portal user; at most five created links per customer in the preceding hour. A replacement revokes the prior pending link.
- **Response:** 201 `{id,email,status,invitedAt,expiresAt,acceptedAt,revokedAt,invitationLink}`. `invitationLink` contains the raw token and is returned only by this issuance response for manual copying; no email is sent or claimed.
- **Errors:** 404 scoped miss; 422 `CONFIGURATION_REQUIRED`/`CUSTOMER_EMAIL_REQUIRED`; 409 `PORTAL_ACCOUNT_ACTIVE`; 429 `RATE_LIMITED` with Retry-After.
- **Business rules:** R-040, BR-017, BR-021, BR-025.

### POR-00B — Inspect portal invitation

- **Method/path:** `GET /api/v1/portal/invitations/:token`.
- **Purpose:** Validate a raw invitation token for the public confirmation screen.
- **Actor / authorization:** Public bearer of the raw link.
- **Authentication:** No prior session required.
- **Request:** token path parameter.
- **Validation:** SHA-256 hash lookup plus constant-time comparison; customer active; invitation PENDING and not expired.
- **Response:** 200 `{customerName,email,expiresAt}` only.
- **Errors:** 410 `INVITATION_UNAVAILABLE` with the same message for malformed, unknown, expired, accepted, or revoked tokens.
- **Business rules:** R-040, BR-008, BR-025.

### POR-00C — Accept portal invitation

- **Method/path:** `POST /api/v1/portal/invitations/:token/accept`.
- **Purpose:** Activate a password-backed portal account through the existing User/session identity model.
- **Actor / authorization:** Public bearer of a usable raw link; allowed Origin required.
- **Authentication:** No prior session; successful acceptance starts the normal HttpOnly session.
- **Request:** `{displayName,password}` with password 12–128 characters.
- **Validation:** atomically claim one PENDING unexpired invitation. Existing email may be activated only when it is the same non-active CUSTOMER identity for the same organization/customer. No Rep relationship is written.
- **Response:** 201 customer identity with `customerId`, destination `/customer`, CSRF token, and session cookie.
- **Errors:** 410 `INVITATION_UNAVAILABLE` for every unusable token/account collision; repeated use fails cleanly.
- **Business rules:** R-003, R-040, BR-008, BR-025.

### POR-00D — Revoke portal invitation

- **Method/path:** `POST /api/v1/customers/:id/portal-invitations/:invitationId/revoke`.
- **Purpose:** Revoke a pending invitation without deleting its audit history.
- **Actor / authorization:** Manager for the customer's managed team, or organization Admin.
- **Authentication:** Active session and CSRF required.
- **Request:** `{}`.
- **Validation:** customer and invitation must match the authenticated organization and each other; PENDING only.
- **Response:** 200 invitation status/timestamps.
- **Errors:** 404 scoped miss; 409 `INVALID_STATE`.
- **Business rules:** R-040, BR-017, BR-021, BR-025.

### POR-00E — Read portal request catalog

- **Method/path:** `GET /api/v1/portal/requests/catalog`
- **Purpose:** Provide an optional customer-safe catalog picker without exposing price, cost, tax, stock or internal configuration.
- **Actor / authorization:** Linked CUSTOMER portal identity only.
- **Authentication:** Active session required.
- **Response:** 200 `{items:[{id,name,sku,category,description,unit}]}` for active, store-visible products in the session organization, max 200.
- **Errors:** 403 if no linked Customer identity.
- **Business rules:** BR-008, BR-021, BR-026.

### POR-00F — List own quotation requests

- **Method/path:** `GET /api/v1/portal/requests`
- **Purpose:** Show only the authenticated portal user's/customer's safe request history.
- **Actor / authorization:** Linked CUSTOMER portal identity only.
- **Authentication:** Active session required.
- **Validation:** query is fixed; organization, customer and submittedBy user are all server scoped.
- **Response:** 200 `{items:PortalRequestDTO[],rateLimit:{maximum:5,windowMinutes:60}}`. Internal NEW/PROCESSED/DISMISSED projects to Received/In progress/Declined.
- **Errors:** 403 if no linked Customer identity.
- **Business rules:** BR-008, BR-021, BR-026.

### POR-00G — Submit quotation request

- **Method/path:** `POST /api/v1/portal/requests`
- **Purpose:** Persist the customer's original requirements and synchronously create the configured assigned Lead or private Draft.
- **Actor / authorization:** Linked CUSTOMER portal identity only; current active primary team/Rep is locked and revalidated at submission time.
- **Authentication:** Active session, CSRF and `Idempotency-Key` required.
- **Request:** `{requirementsText:string(5..5000),preferredDeliveryDate?:YYYY-MM-DD|null,lines?:[{productId?:string,freeTextDescription?:string(1..1000),quantity?:number>0}]}`; max 50 lines; every line supplies product or text. Owner/team/price/cost/tax/margin/risk fields are rejected.
- **Processing:** Product IDs resolve only against active products in the session organization. Unknown, malformed, inactive and cross-tenant IDs are removed from structured data; customer text (or a generic unmatched-selection fallback) and an internal degradation flag remain. Only resolved whole-quantity lines can enter a Draft. Raw request, result, recipient Alert, audit and idempotency record commit together. No email is sent.
- **Response:** 201 `{id,status:RECEIVED|IN_PROGRESS,handlingMode,replayed:false}`; an identical retry returns 200 with `replayed:true`. No Lead/Quote/result ID or price is returned.
- **Errors:** 422 `CONFIGURATION_REQUIRED` for missing current assignment; 429 `RATE_LIMITED` with `Retry-After` after five customer/user submissions in the rolling hour; 409 `IDEMPOTENCY_CONFLICT`; validation errors.
- **Business rules:** R-047–R-049, BR-008, BR-015, BR-021, BR-024, BR-026.

### LEA-01 — List scoped portal Leads

- **Method/path:** `GET /api/v1/leads`
- **Purpose:** List Lead-first portal intake for qualification.
- **Actor / authorization:** REP sees only `assignedRepId=self`; MANAGER sees only customers whose primary team they manage. Requires quotations module.
- **Request:** `query: status?:NEW|CONVERTED|DISMISSED`; unknown query fields rejected.
- **Response:** 200 `{items:LeadDTO[]}` ordered newest first, max 100.
- **Business rules:** BR-021, BR-024, BR-026.

### LEA-02 — Read scoped portal Lead

- **Method/path:** `GET /api/v1/leads/:id`
- **Purpose:** Show original requirements, preferred date, catalog context and explicit degradation warnings.
- **Actor / authorization:** Same REP-own / MANAGER-managed-team scope as LEA-01.
- **Response:** 200 LeadDTO; cross-tenant/out-of-scope lookup is 404.
- **Business rules:** BR-021, BR-024, BR-026.

### LEA-03 — Convert Lead to quotation Draft

- **Method/path:** `POST /api/v1/leads/:id/convert`
- **Purpose:** Use the shared server-authoritative quotation `createDraft` service exactly once.
- **Actor / authorization:** Assigned REP only; Managers/Admins cannot convert. Requires quotations module, active session and CSRF.
- **Request:** `{}`; ownership/pricing fields are rejected.
- **Processing:** Lock Lead; re-resolve active tenant products; price resolved whole-quantity lines only; copy other requirements into the internal revision note; mark Lead CONVERTED and request PROCESSED; resolve the request alert; audit.
- **Response:** 201 `{lead,quotation:{id,revisionId},replayed:false}`; a repeated conversion returns 200 with the existing quotation and `replayed:true`.
- **Errors:** 404 scoped miss; 409 `INVALID_STATE`; 422 pricing/customer configuration.
- **Business rules:** BR-001, BR-015, BR-017, BR-024, BR-026.

### LEA-04 — Dismiss Lead with retained reason

- **Method/path:** `POST /api/v1/leads/:id/dismiss`
- **Purpose:** Close an unqualified request without deletion.
- **Actor / authorization:** Assigned REP or Manager of the customer's current primary team. Requires quotations module, active session and CSRF.
- **Request:** `{reason:string(5..1000)}`; blank/missing/unknown fields rejected.
- **Response:** 200 `{id,status:"DISMISSED"}`; Lead and internal reason remain for audit, while the customer projection becomes Declined without the reason.
- **Errors:** 404 scoped miss; 409 `INVALID_STATE`; 422 validation.
- **Business rules:** BR-008, BR-017, BR-021, BR-026.

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

### POR-03 — Add a customer comment, question or decline note

- **Method/path:** `POST /api/v1/portal/quotations/:id/comment`
- **Purpose:** Ask line-level or quote-level question.
- **Actor / authorization:** Customer; resource scope and global restrictions above apply.
- **Authentication:** Active database-backed session required.
- **Request:** `{revisionId,message,type:COMMENT|QUESTION|DECLINE_NOTE,requestedDeliveryAt?}`.
- **Validation:** exact current SENT revision and session customer; message 2–2000. The write is append-only and does not alter quotation/revision state.
- **Response:** 201 PortalCommentDTO.
- **Errors:** common error contract above; validation, permission, lifecycle and concurrency conditions are enforced before commit.
- **Business rules:** BR-008, BR-017.

### POR-04 — Request commercial changes

- **Method/path:** `POST /api/v1/portal/quotations/:id/proposals`
- **Purpose:** Request commercial changes.
- **Actor / authorization:** Customer; resource scope and global restrictions above apply.
- **Authentication:** Active database-backed session required.
- **Request:** `{revisionId,expectedVersion,counterDiscount,requestedDeliveryAt?,message}`.
- **Validation:** exact current approved SENT revision, no confirmed order, no other OPEN proposal, discount 0–100 and customer scope.
- **Response:** 201 PortalProposalDTO.
- **Errors:** common error contract above; validation, permission, lifecycle and concurrency conditions are enforced before commit.
- **Business rules:** BR-005, BR-008, BR-017.

### POR-05 — Accept exact approved SENT terms

- **Method/path:** `POST /api/v1/portal/quotations/:id/accept`
- **Purpose:** Accept exact approved SENT terms and invoke `orders.confirmEligibleRevision`.
- **Actor / authorization:** Customer; resource scope and global restrictions above apply.
- **Authentication:** Active database-backed session required.
- **Request:** `{revisionId, expectedVersion, termsHash}`.
- **Validation:** current sent unexpired terms; scoped customer; approval recheck; unique confirmation.
- **Response:** 201 `{acceptanceId,state:CONFIRMED,orderId,orderNumber,revisionId,invoiceId,subscriptionIds,replayed:false}`; same-key or existing-business-result replay returns 200 with `replayed:true`.
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
- **Implemented route:** `GET /api/v1/warehouses` returns active organization warehouses and product balances with backend-derived `available = onHand - reserved`. `/warehouses/stock` remains a read-only compatibility alias.

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
- **Implemented compatibility route:** `PATCH /api/v1/warehouses/:id` is Admin-only and accepts `{name?,priority?,shippingCost?,active?,reason}`.

### FUL-04 — Record an order-scoped stock receipt and recheck its backorder

- **Method/path:** `POST /api/v1/fulfillment/:orderId/receive`
- **Purpose:** Persist a receipt into one active warehouse balance and automatically attempt consolidation of that Order's open Backorder.
- **Actor / authorization:** Finance or Admin; organization and Order scope apply.
- **Authentication:** Active database-backed session required.
- **Request:** `{warehouseId, productId, quantity, reference?, reason}` plus `Idempotency-Key`.
- **Validation:** positive integer receipt; active organization warehouse; organization Hardware product; non-empty audit reason.
- **Response:** 201 `{movement,balance,consolidated,fulfillment,replayed}`; same-key retry returns 200 and the stored result.
- **Errors:** common error contract above; validation, permission, lifecycle and concurrency conditions are enforced before commit.
- **Business rules:** BR-009, BR-011, BR-015, BR-017.
- **Implemented behavior:** the receipt, on-hand increment, any new reservation/backorder reduction, lifecycle updates, audit and idempotency result commit atomically. The former `/warehouses/:id/restock` write returns `410 ORDER_ID_REQUIRED` so a receipt cannot bypass the target-order consolidation boundary.

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
- **Implemented compatibility route:** `GET /api/v1/fulfillment` returns confirmed, non-complete hardware orders scoped by organization and Sales Rep ownership.

### FUL-06 — Read current split, shipments and backorder

- **Method/path:** `GET /api/v1/fulfillment/:orderId`
- **Purpose:** Read current split, shipments and backorder.
- **Actor / authorization:** Internal identities; resource scope and global restrictions above apply.
- **Authentication:** Active database-backed session required.
- **Request:** `none`.
- **Validation:** authorized order scope.
- **Response:** 200 FulfillmentDTO with Reservation IDs, ordered/reserved/backordered quantities, current consolidation availability and `physicalDispatchImplemented:false`.
- **Errors:** common error contract above; validation, permission, lifecycle and concurrency conditions are enforced before commit.
- **Business rules:** BR-009–011.
- **Implemented route:** `GET /api/v1/fulfillment/:orderId` returns either the read-only preview or the accepted reservation read model. `statusMeaning` explicitly states that FULFILLED is reservation completion only.

### FUL-07 — Calculate suggested warehouse allocation

- **Method/path:** `GET /api/v1/fulfillment/:orderId/preview`
- **Purpose:** Calculate suggested warehouse allocation.
- **Actor / authorization:** Finance/Operations; resource scope and global restrictions above apply.
- **Authentication:** Active database-backed session required.
- **Request:** `none`.
- **Validation:** confirmed order; actual balances; no reservation writes.
- **Response:** 200 AllocationPreviewDTO `{orderId,state,split:{split,backorders},items,availability,shipmentCount,estimatedCost,stockFingerprint,preview:true,physicalDispatchImplemented:false}`.
- **Errors:** common error contract above; validation, permission, lifecycle and concurrency conditions are enforced before commit.
- **Business rules:** BR-009, BR-010.
- **Implemented behavior:** demand comes only from immutable, non-recurring Hardware OrderLines. Availability is read live as onHand-reserved. The deterministic greedy suggestion prefers an already selected warehouse, then full coverage, configured shipping cost, priority and ID; it is an explainable practical heuristic, not a claimed global optimizer. Preview never writes stock.

### FUL-08 — Accept split, override or consolidate remaining demand

- **Method/path:** `POST /api/v1/fulfillment/:orderId/reserve`
- **Purpose:** Accept split, override or consolidate remaining demand.
- **Actor / authorization:** Finance/Operations; resource scope and global restrictions above apply.
- **Authentication:** Active database-backed session required.
- **Request:** `{mode:SUGGESTED|MANUAL, stockFingerprint?, split:[{orderLineId,warehouseId,quantity}], reason?}` plus `Idempotency-Key`.
- **Validation:** revalidate under sorted row locks; exact immutable OrderLine demand bounds; SUGGESTED requires the preview fingerprint and must match the current server suggestion; MANUAL requires at least one row and a reason at Zod validation.
- **Response:** 201 FulfillmentDTO; same-key or already committed business-result replay returns 200 without incrementing reserved again.
- **Errors:** common error contract above; validation, permission, lifecycle and concurrency conditions are enforced before commit.
- **Business rules:** BR-009–011, BR-015, BR-017.
- **Implemented behavior:** one transaction locks Order then all relevant StockBalances, re-reads availability, creates first-class Reservations and correctly quantified Backorders, updates the Fulfillment projection and Order state, writes audit/idempotency, and rolls everything back on failure. `409 STOCK_CHANGED` includes fresh `details.availability`. Former quote-ID allocation writes return `410 ORDER_ID_REQUIRED`.

### FUL-08A — Consolidate an outstanding backorder

- **Method/path:** `POST /api/v1/fulfillment/:orderId/consolidate`
- **Actor / authorization:** Finance or Admin with Fulfillment module and CSRF protection.
- **Request:** `{reason}` plus `Idempotency-Key`.
- **Response:** 200 FulfillmentDTO.
- **Behavior:** locks Order and relevant balances, reserves only the remaining Backorder quantities, retains completed Backorder history, updates PARTIALLY_FULFILLED/FULFILLED and audits the reason. A same-key retry cannot double-reserve.

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
- **Current status:** GAP/TARGET only. There is no implemented dispatch route, Shipment/ShipmentLine persistence, tracking, delivery confirmation, or physical on-hand consumption. `FULFILLED` in current responses is therefore explicitly reservation-complete, not shipped.

### BIL-01 — List recurring obligations

- **Method/path:** `GET /api/v1/subscriptions`
- **Purpose:** List recurring obligations.
- **Actor / authorization:** Admin only; the subscription module cannot be delegated through module access.
- **Authentication:** Active database-backed session required.
- **Request:** `query: state?, customerId?, cursor?, limit?`.
- **Validation:** scope through order/customer; no fabricated paused state.
- **Response:** 200 Page<SubscriptionSummaryDTO>.
- **Errors:** common error contract above; validation, permission, lifecycle and concurrency conditions are enforced before commit.
- **Business rules:** BR-012.

### BIL-02 — Read recurring terms, history and next periods

- **Method/path:** `GET /api/v1/subscriptions/:id`
- **Purpose:** Read recurring terms, history and next periods.
- **Actor / authorization:** Admin only; resource scope and global restrictions above apply.
- **Authentication:** Active database-backed session required.
- **Request:** `none`.
- **Validation:** authorized linked order; history immutable.
- **Response:** 200 SubscriptionDTO.
- **Errors:** common error contract above; validation, permission, lifecycle and concurrency conditions are enforced before commit.
- **Business rules:** BR-012–014.

### BIL-03 — Preview mid-period quantity or plan change

- **Method/path:** `POST /api/v1/subscriptions/:id/change-preview`
- **Purpose:** Preview mid-period quantity or plan change.
- **Actor / authorization:** Admin only; resource scope and global restrictions above apply.
- **Authentication:** Active database-backed session required.
- **Request:** `{expectedVersion, quantity?, planId?, effectiveAt}`.
- **Validation:** positive quantity; valid plan; effectiveAt within allowed future/current period; no settled backdating.
- **Response:** 200 SubscriptionChangePreviewDTO.
- **Errors:** common error contract above; validation, permission, lifecycle and concurrency conditions are enforced before commit.
- **Business rules:** BR-013, BR-014.

### BIL-04 — Commit subscription change and adjustment

- **Method/path:** `POST /api/v1/subscriptions/:id/changes`
- **Purpose:** Commit subscription change and adjustment.
- **Actor / authorization:** Admin only; resource scope and global restrictions above apply.
- **Authentication:** Active database-backed session required.
- **Request:** `{expectedVersion, quantity?, planId?, effectiveAt, reason}`.
- **Validation:** same as preview; recompute in transaction; no trust in preview totals.
- **Response:** 201 {subscription,adjustmentInvoice?,creditNote?}.
- **Errors:** common error contract above; validation, permission, lifecycle and concurrency conditions are enforced before commit.
- **Business rules:** BR-013–015, BR-017.

### BIL-05 — Preview cancellation and eligible unused-period credit

- **Method/path:** `POST /api/v1/subscriptions/:id/cancel-preview`
- **Purpose:** Preview cancellation and eligible unused-period credit.
- **Actor / authorization:** Admin only; resource scope and global restrictions above apply.
- **Authentication:** Active database-backed session required.
- **Request:** `{expectedVersion, effectiveAt}`.
- **Validation:** valid snapshotted cancellation policy; active subscription.
- **Response:** 200 CancellationPreviewDTO.
- **Errors:** common error contract above; validation, permission, lifecycle and concurrency conditions are enforced before commit.
- **Business rules:** BR-014.

### BIL-06 — Stop future obligation and create eligible credit

- **Method/path:** `POST /api/v1/subscriptions/:id/cancellations`
- **Purpose:** Stop future obligation and create eligible credit.
- **Actor / authorization:** Admin only; resource scope and global restrictions above apply.
- **Authentication:** Active database-backed session required.
- **Request:** `{expectedVersion, effectiveAt, reason}`.
- **Validation:** active subscription; no duplicate interval credit; re-evaluate preview.
- **Response:** 201 {subscription,creditNote?,cashRefundRequired}.
- **Errors:** common error contract above; validation, permission, lifecycle and concurrency conditions are enforced before commit.
- **Business rules:** BR-014, BR-015, BR-017.

#### Implemented compact subscription change endpoint

- **Method/path:** `POST /api/v1/subscriptions/:id/change`
- **Actor / authorization:** Organization Admin only. Non-admin users receive no subscription data from the workspace endpoint, cannot be assigned the subscription module, and cannot call this mutation.
- **Current request:** `{expectedVersion, amount?, action?: "PAUSE"|"RESUME"|"CANCEL", effectiveAt?, reason}` with a positive amount or lifecycle action and a 5–240 character reason. Invalid lifecycle transitions or stale versions return 409.
- **Current behavior:** The locked mutation increments version, retains a dedicated dated `SubscriptionChange`, records audit, and changes future amount/state/cancellation date without touching historical invoices.
- **Current limitation:** It does not calculate proration or create a credit note. BIL-03 through BIL-06 remain the future scheduler/proration completion path after policy confirmation.

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
- **Request:** `{amount, currency, paidAt, reference}` plus `Idempotency-Key` (the settlement reference is the compatibility fallback key).
- **Validation:** positive decimal≤locked balance; currency/customer match; no future payment date beyond allowed clock skew.
- **Response:** 201 {payment,invoice}.
- **Errors:** common error contract above; validation, permission, lifecycle and concurrency conditions are enforced before commit.
- **Business rules:** BR-015–017.

### BIL-11 — Correct erroneous recorded payment with compensating entry

- **Method/path:** `POST /api/v1/invoices/:id/payments/:paymentId/reversals`
- **Purpose:** Correct erroneous recorded payment with compensating entry.
- **Actor / authorization:** Finance/Operations; resource scope and global restrictions above apply.
- **Authentication:** Active database-backed session required.
- **Request:** `{reason}`.
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

### HEA-02 — Acknowledge, nudge or resolve alert

- **Method/path:** `POST /api/v1/deal-health/:id/actions`
- **Purpose:** Acknowledge, nudge or resolve alert.
- **Actor / authorization:** Rep, Manager, Admin; resource scope and global restrictions above apply.
- **Authentication:** Active database-backed session required.
- **Request:** `{action:ACKNOWLEDGE|NUDGE|RESOLVE, reason}`.
- **Validation:** Rep only own/team-accessible alerts; every action requires a 5–240 character reason.
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

This inventory is approved as architecture scope, not as deployed functionality. Implement only the phase's endpoints; record implemented IDs and test evidence in Memory.md. Generate OpenAPI 3.1 from runtime validators or maintain it alongside code in P1 onward; do not ship two diverging contracts. Until then this document is the canonical design contract. Breaking production changes require a documented compatibility plan and, when necessary, a new API version.

## Implementation update — 2026-09-05

AUTH-01 is implemented as organization onboarding: `POST /api/v1/auth/signup` accepts only `{organizationName,displayName,email,password}`, validates and normalizes the values, creates an isolated organization with its first ACTIVE administrator, starts a server-managed session, and returns HTTP 201. Duplicate email, validation, and role/access injection are rejected. AUTH-01A and AUTH-01B expose runtime Google configuration and verified Google organization signup; the exact OAuth audience and verified email are checked server-side. Google and email/password login both issue the same CSRF-bound session. AUTH-02 accepts either an email address or generated `DL-…` user ID and requires an ACTIVE account. Administrators can create audited module-scoped user access with generated credentials; every user and workspace query remains organization-scoped.

CAT-01, QUO-01, QUO-02, QUO-03, and QUO-04 now back the quotation-list and draft-pricing vertical slices. The list endpoint provides one scoped read model for Board and Table views with search, stage/customer/owner/activity filters, sorting, counts and bounded cursor pagination. Creation no longer accepts a caller-supplied customer name/tier or silently creates a customer; it selects an active configured customer and snapshots that customer's tier/currency into the initial revision. Quotation-detail navigation carries the exact current revision ID and version. QUO-04 calculates unsaved draft lines through the same authoritative product, tier-policy, tax, margin and risk engine used by Save Draft without persisting changes or exposing direct line costs. Customer actors are rejected from the internal endpoints, and Platform Owner View As remains read-only.

## Audit repair implementation update — 2026-09-05

Implemented in the compatibility API: session-derived CSRF tokens and Origin checks for mutations; request IDs; bounded login throttling; Admin user listing/activation; owner/customer-scoped workspace projections; immutable revision/cycle approval behavior; and the P5 portal/order boundary. P5 adds exact-version Send, frozen snapshot-only portal DTOs, append-only comments, versioned counter proposals, backend-recalculated adoption, decline-to-SENT restoration, and idempotent exact-revision Acceptance/Order/OrderLine creation. P7 now adds the combined first Invoice and recurring-line Subscriptions inside that same transaction. `/portal/quotations/:id/confirm` remains only as a strict alias of Accept and requires the same body/idempotency contract; the insecure combined `/message` action was replaced by distinct `/comment` and `/proposals` actions.

## Platform Owner implementation update — 2026-09-05

`POST /api/v1/auth/super-admin/login` is the only Platform Owner login endpoint. It accepts strict `{loginId,password}` from server environment configuration, requires a password of at least 16 characters, applies constant-time comparison and a five-failure/15-minute process-local throttle, and issues a separate four-hour `dealos_platform_session`. `GET /api/v1/auth/super-admin/me` accepts only that session. Organization users cannot be promoted to Platform Owner through the database or an API.

All `/api/v1/platform/*` routes require the independent owner session and CSRF/Origin validation. Implemented operations include global dashboard/search, organization detail/create/status changes, member and invitation management, session reset, privileged audit, and read-only View As Organization/User. Business writes return `VIEW_AS_READ_ONLY` until the owner explicitly exits the simulated context. Normal business routes remain constrained by `organizationId`.

## Invoice workspace implementation update — 2026-09-05

The internal invoice workspace now derives overdue and aging presentation from due date plus outstanding balance while retaining the stored `UNPAID` / `PARTIAL` / `PAID` financial lifecycle. It provides working status, aging, search and sort controls; receivables metrics; keyboard-accessible row navigation; order, quotation and fulfillment provenance; financial-line detail; and an append-only payment/reversal ledger. Payment recording accepts a settlement date and validates the invoice currency. `POST /api/v1/orders/:id/invoices` issues an eligible one-time receivable from a confirmed order snapshot and returns the existing order invoice on retry. `POST /api/v1/invoices/:id/payments/:paymentId/reversals` retains the original payment and creates one positive compensating entry linked through `reversalOfId`.

## Confirmation billing and operations implementation update — 2026-09-06

Acceptance automatically issues one combined mixed invoice with the Proposed +14-day due default and creates one linked subscription for every recurring frozen OrderLine. `billing.recordPayment` and `billing.reversePayment` lock the invoice, enforce organization/currency/balance/idempotency rules, update `UNPAID`/`PARTIAL`/`PAID`, and append audit without moving money. Portal invoice PDFs use the customer scope. `POST /api/v1/portal/invoices/:id/request-change` creates a note and audit only; it never changes `dueAt`. No `POST /api/v1/portal/invoices/:id/pay` route exists and no portal UI claims payment processing.

`GET /api/v1/deal-health` evaluates and returns scoped persisted alerts from real quote/order state. `POST /api/v1/deal-health/:id/actions` performs reasoned `NUDGE`, `ACKNOWLEDGE`, or `RESOLVE`. `GET /api/v1/reports/sales` and `/api/v1/reports/sales/export?format=pdf|xls` apply period/Rep/Order-status/product filters after role/team scope, aggregate frozen confirmed-order values with actual receivables, preserve currency groups, constrain periods to 366 days, and neutralize formula-leading spreadsheet text.

## Customer relationship implementation update — 2026-09-05

CAT-01, CAT-03A, AUTH-08's implemented team read and QUO-02/03 now enforce the customer-account ownership model. Runtime assignment writes flow only through `customer-relationships.ts`; quotation creation snapshots a valid assigned Rep/team, and customer reassignment never mutates Quote rows. Team members receive read-only quotation visibility, Managers receive managed-team scope, and Finance/Admin retain organization reads. The customer UI exposes Assignment required filtering and reasoned version-aware reassignment; eligible open quotations require separate per-record opt-in through the existing audited quotation assignment endpoint.

## Customer portal invitation implementation update — 2026-09-05

POR-00A–POR-00D implement the assignment-gated invitation lifecycle on the existing `OrganizationInvitation` model. Customer email edits, quotation sending, and invoice creation do not create invitations implicitly. The customer detail UI shows the complete invitation status history, explains the assignment gate, and surfaces the raw manual-share link only immediately after issuance. `/customer/invitations/:token` provides password setup through the existing identity/session system, and `/customer/sign-in` supports that password plus Google linking for an already-active customer identity. No outbound email exists.

CAT-02 additionally implements the confirmed Admin-created credential path. An Admin request requires customer email plus `temporaryPassword`; profile, customer-scoped active User, PORTAL_USER membership and audit rows commit atomically. The response remains CustomerDTO and never echoes the password. The React form generates and holds the plaintext locally, then shows it once after success for manual sharing. Managers cannot submit this field and continue to use assignment-gated invitation onboarding.

POR-00E–POR-00G, LEA-01–LEA-04 and SET-08/09 now implement the formerly deferred customer RFQ branch. Submission always retains the raw request, revalidates assignment and creates a recipient-scoped in-app Alert. `LEAD_FIRST` creates a qualification record; `DIRECT_DRAFT` and Lead conversion both call the same quotation draft service. Quotation list/detail DTOs identify portal origin for internal users. Customer request DTOs remain separate and never serialize Draft price/link, owner/team, degradation reason, internal note or Lead dismiss reason.

DIR-01–DIR-07 implement public business discovery, request submission, tenant review and Admin directory settings. Public responses are allowlisted and request submission creates no access. Approval reuses CAT-02/CAT-03A/password services under one transaction and returns the generated raw credential once; request history never returns it. The current singular User.customerId/organization membership remains unchanged, so this does not implement a multi-business customer identity.
