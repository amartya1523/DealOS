# DealOS preserved-case regression results

**Run date:** 5 September 2026
**Environment:** synthetic records in a unique disposable PostgreSQL schema; the schema was dropped after the run. Existing demo records were not changed.
**Result:** 24/24 previously passing cases preserved. The separate repair checks are recorded in `api-results.json` and `REPAIR-REPORT.md`.

| Case ID | Scenario | Expected result | Actual result | HTTP status | Database evidence | Pass/Fail |
|---:|---|---|---|---:|---|---|
| 1 | Sales Rep login | Active Rep authenticates | Session created | 200 | Hashed session row linked to Rep | Pass |
| 2 | Sales Manager login | Active Manager authenticates | Session created | 200 | Hashed session row linked to Manager | Pass |
| 3 | Finance login | Active Finance user authenticates | Session created | 200 | Hashed session row linked to Finance | Pass |
| 4 | Admin login | Active Admin authenticates | Session created | 200 | Hashed session row linked to Admin | Pass |
| 5 | Customer login | Linked active Customer authenticates | Session created with customer FK | 200 | User.customerId references test Customer | Pass |
| 6 | Anonymous workspace | Request denied | `AUTH_REQUIRED` | 401 | No data read under an actor scope | Pass |
| 7 | High excess routing | Manager then Finance | Both ordered steps created | 200 submit | Cycle has sequences 1 and 2; Finance starts WAITING | Pass |
| 8 | Finance before Manager | Blocked | `APPROVAL_STEP_BLOCKED` | 409 | Finance step remains WAITING | Pass |
| 9 | Rep approval attempt | Forbidden | Request rejected | 403 | Approval row unchanged | Pass |
| 10 | Empty approval reason | Validation rejected | Request rejected | 422 | Approval row unchanged | Pass |
| 11 | Confirm pending quote | Lifecycle conflict | `INVALID_STATE` | 409 | Quote remains PENDING_APPROVAL; no order | Pass |
| 12 | Allocate before confirmation | Lifecycle conflict | `INVALID_STATE` | 409 | No fulfillment or reservation change | Pass |
| 13 | Manager approval with Finance required | Remains pending | PENDING_APPROVAL | 200 | Manager APPROVED; Finance becomes PENDING | Pass |
| 14 | Final required approval | Quote approved | APPROVED | 200 | Both current-cycle decisions APPROVED | Pass |
| 15 | Owner self-approval | Blocked | `SELF_APPROVAL_NOT_ALLOWED` | 409 | Approval remains actionable and undecided | Pass |
| 16 | Return for revision | Quote becomes Draft | DRAFT | 200 | Current cycle closed; new DRAFT revision created | Pass |
| 17 | Confirm approved customer quote | Confirmation succeeds | CONFIRMED | 200 | Acceptance, one Order, OrderLines, invoice created | Pass |
| 18 | Overpayment | Reject amount over balance | `AMOUNT_EXCEEDS_BALANCE` | 422 | No Payment row; invoice unchanged | Pass |
| 19 | Partial payment | Paid amount 100; PARTIAL | Exactly matched | 201 | One Payment; ledger sum and paidAmount are 100 | Pass |
| 20 | Public signup | Create pending account | PENDING result | 202 | User stored PENDING with bcrypt hash | Pass |
| 21 | Pending-account login | Deny workspace access | `ACCOUNT_INACTIVE` | 403 | No session created | Pass |
| 22 | Reject quotation | Quote becomes Rejected | REJECTED | 200 | Decision persisted; later step SUPERSEDED | Pass |
| 23 | Draft → approval → confirmation | End-to-end commercial flow succeeds | CONFIRMED | 200 final | Revision, approvals, send boundary, acceptance and order agree | Pass |
| 24 | Logout | Old cookie becomes invalid | `AUTH_REQUIRED` on reuse | 401 | Session row deleted | Pass |

The prerequisites for cases 1–24 were isolated active users for all five roles, one real Customer linked by foreign key, a published Gold policy, service/hardware/recurring products, a warehouse balance, and purpose-built quote/invoice fixtures. All mutations sent the session-bound CSRF token and an idempotency key where applicable.
