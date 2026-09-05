# DealOS full-cycle usability guide

This guide uses the deterministic local seed to exercise the product as five different people. The main scenario starts at a pending quotation and finishes with an accepted order, a warehouse reservation, a stock receipt, a paid invoice, and an active subscription.

## 1. Prepare a disposable local demo

The seed deletes and recreates DealOS application data in the configured database. Use a local demo database only. Do not run it against data you need to keep.

From the repository root:

```powershell
docker compose up -d postgres
cd backend
npm ci
npm run db:generate
npx prisma db push --skip-generate
npm run db:seed
```

`db:seed` should finish with this summary:

```text
DealOS full-cycle seed complete: 20 quotations, 6 orders, 6 invoices, and 4 portal requests.
Directory seed: 2 discoverable profiles; Atlas pending, Lumen approved, and Stonebridge declined.
Demo users share password: DealOS2026!
```

The output also prints a reusable Gamma Health customer invitation URL.

Start the backend:

```powershell
cd backend
npm run dev
```

In a second terminal, start the frontend:

```powershell
cd frontend
npm ci
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). Use a private/incognito window for the customer portal, or log out before changing roles, because each browser profile holds one active session.

> Clean-install note: the current historical migration chain tries to alter `Customer` before its creating migration. `prisma db push --skip-generate` is the reliable local-demo setup path until that migration-order defect is repaired. Existing migrated development databases do not need to be recreated.

## 2. Demo identities

Every active demo identity uses `DealOS2026!`.

| Persona | Sign-in | Organization | Main purpose |
| --- | --- | --- | --- |
| Sales rep | `rep@dealos.demo` | DealOS Demo | Leads, quotations, sending, negotiation |
| Collaborating rep | `collaborator@dealos.demo` | DealOS Demo | Relationship visibility check |
| Sales manager | `manager@dealos.demo` | DealOS Demo | Manager approval and team visibility |
| Finance | `finance@dealos.demo` | DealOS Demo | Finance approval, fulfillment, invoices, payments |
| Organization admin | `admin@dealos.demo` | DealOS Demo | Setup, access, subscriptions, all workspace modules |
| Acme customer | `customer@dealos.demo` | DealOS Demo | RFQ, negotiation, acceptance, invoices |
| Beta customer | `buyer@beta.demo` | DealOS Demo | Second-customer isolation check |
| Lumen customer | `customer@lumen.demo` | DealOS Demo | Completed directory-approval login and assignment check |
| Northstar rep | `rep@northstar.demo` | Northstar Distribution | Direct-draft RFQ check |
| Northstar manager | `manager@northstar.demo` | Northstar Distribution | Second-tenant approval check |
| Northstar admin | `orgadmin@northstar.demo` | Northstar Distribution | Second-tenant administration |
| Orion customer | `buyer@orion.demo` | Northstar Distribution | Direct-draft customer request |

`pending@dealos.demo` is intentionally in `PENDING` state and should not act like an active user.

## 3. Ten-minute orientation pass

Sign in at `/sign-in` as `admin@dealos.demo` and confirm:

1. **Overview** shows pipeline, approval, risk, and open-invoice totals.
2. **Products** contains hardware, services, and Monthly, Quarterly, and Yearly subscriptions. Product brands and tax settings should be visible.
3. **Rules** contains Bronze, Silver, and Gold policies with different line limits and Finance thresholds.
4. **Customers → Acme Corp** shows the Enterprise Sales team, Aarav as primary rep, Leena as collaborator, portal history, and commercial history.
5. **Fulfillment** shows Main Warehouse, East Depot, and South Hub with on-hand, reserved, and available quantities.
6. **User access** shows every active role plus the intentionally pending teammate.
7. The public **Business directory** shows DealOS Demo Commerce and Northstar Distribution without exposing catalog prices, costs, stock, customers, users, or policies.

Usability questions: Can you tell where you are, what the next useful action is, and why some actions are unavailable without reading source code?

## 4. Run the complete happy path with Q-0102

`Q-0102` is an Acme quote containing hardware, setup service, and a Monthly Care Plan. Its service discount deliberately exceeds policy, so it requires Manager followed by Finance approval.

### A. Manager approval

1. Sign out and sign in as `manager@dealos.demo`.
2. Open **Approvals** and select `Q-0102` from **Pending**.
3. Verify that the page explains the risky line, policy limit, risk score, and two-step route.
4. Enter a reason such as `Customer expansion is documented; approve commercial exception.`
5. Click **Approve**.
6. Confirm that Sales Manager becomes approved and Finance becomes the current pending step.

Pass condition: the decision persists after refresh, its reason is visible, and the Manager cannot perform the Finance decision.

### B. Finance approval

1. Sign out and sign in as `finance@dealos.demo`.
2. Open **Approvals → Pending → Q-0102**.
3. Verify that the Manager decision and reason remain visible.
4. Enter `Margin and billing mix checked against the frozen revision.` and click **Approve**.

Pass condition: `Q-0102` becomes **Approved**, with no remaining internal approval.

### C. Rep sends the governed revision

1. Sign out and sign in as `rep@dealos.demo`.
2. Open **Quotations**, locate `Q-0102` in the Approved lane, and open it.
3. Open **Customer preview** and confirm that cost, margin, internal notes, and reviewer-only details are absent.
4. Download the PDF if you want to compare it with the preview.
5. Click **Send to customer**.

Pass condition: the quote moves to **Pending customer acceptance**, the sent revision is no longer editable, and Acme—not Beta—can see it.

### D. Customer accepts exact terms

1. In a private window, open `/customer/sign-in` and sign in as `customer@dealos.demo`.
2. Open **Quotations** and select `Q-0102`.
3. Check line quantities, prices, discounts, tax, cadence, validity, and commercial terms.
4. Click **Accept quotation** once.
5. Refresh the page and verify that it stays accepted and shows an order number.

Pass condition: `SO-0102`, `INV-0102`, and a Monthly Care Plan subscription are created once. Repeated clicks or refreshes must not duplicate them.

### E. Finance reserves stock and clears the backorder

All seeded laptop stock is already reserved by an older order, so the new order intentionally begins with a visible shortage.

1. Return to the internal window and sign in as `finance@dealos.demo`.
2. Open **Fulfillment** and select `SO-0102`.
3. Check that the suggested split clearly shows no laptop availability and a backorder of 2.
4. Click **Accept Suggested Split**. This should persist the shortage rather than silently promising stock.
5. Return to **Fulfillment** and click **Record stock receipt**.
6. Select `SO-0102`, **Main Warehouse**, **Latitude Pro 14**, quantity `2`, reference `GRN-USABILITY-0102`, and reason `Received stock to clear the Q-0102 backorder.`
7. Submit the receipt and reopen the order.

Pass condition: the receipt is recorded once, the backorder reaches zero, reserved stock never exceeds on-hand stock, and the order becomes fulfilled/reserved according to the product's current operational terminology.

### F. Finance records and reverses a payment

1. Open **Invoices**, search for `INV-0102`, and open it.
2. Verify the invoice links back to `SO-0102` and `Q-0102`, and that one-time and recurring lines are understandable.
3. Record half the outstanding amount with reference `UTR-USABILITY-0102-A` and today's date.
4. Refresh and verify **Partially paid** and the remaining balance.
5. Record the exact remaining amount with reference `UTR-USABILITY-0102-B`.
6. Verify **Paid**, then reverse the first payment with reason `Usability test reversal of the first settlement.`

Pass condition: the append-only ledger shows both payments and the reversal, while the invoice returns to a partial state with the correct net balance.

### G. Admin manages the new subscription

1. Sign in as `admin@dealos.demo`.
2. Open **Subscriptions** and find the Care Plan linked to `SO-0102`.
3. Open it, adjust the amount, provide a reason, and save.
4. Pause it with a reason, refresh, then resume it with another reason.

Pass condition: amount, state, next billing date, version, and every change reason remain coherent; a Finance or Rep identity must not gain the Admin-only subscription controls.

### H. Check customer and reporting continuity

1. As Admin, open **Customers → Acme Corp** and verify that quotation, order/invoice, portal, and representative context still agree.
2. Open **Deal health** and confirm that the seeded stalled, discount, and delivery risks link to understandable records.
3. Open **Reports** and compare totals with the quotation and invoice modules.
4. Return to the customer portal and verify that the accepted quotation and invoice ledger remain customer-safe.

Pass condition: each module refers to the same commercial record, and no role sees another customer's or another organization's private data.

## 5. Exercise the alternate branches

Reseed before a branch if an earlier test changed its checkpoint.

| Record | Seeded state | What to test |
| --- | --- | --- |
| `Q-0101` | Draft, stalled | Edit lines, save, refresh, then submit; verify unsaved-change and reason requirements |
| `Q-0103` | Manager-only pending | Manager decision without a Finance step |
| `Q-0104` | Manager approved, Finance pending | Finance handoff and decision history |
| `Q-0105` | Approved, unsent | Customer preview and send boundary |
| `Q-0106` | Sent with question | Conversation visibility and delivery-date question |
| `Q-0107` | Open 12% customer counter | Rep adopts or declines; adoption must create a new Draft and fresh approval cycle |
| `Q-0108` | Returned, revision 2 Draft | Correct the quote, resubmit, and inspect revision history |
| `Q-0109` | Rejected | Read-only terminal state and retained reason |
| `Q-0110` | Declined counter | Customer and rep both see the decline outcome safely |
| `Q-0111` | Adopted counter | Superseded revision 1 and editable revision 2 remain distinct |
| `Q-0201` | Confirmed, unallocated, late | Suggested multi-warehouse tablet allocation and delivery-risk alert |
| `Q-0202` | Partial allocation/backorder | Existing reservations, receipt history, overdue partial invoice, due-date request |
| `Q-0203` | Fully reserved | Completed allocation and paid invoice history |
| `Q-0204` | Quarterly subscription | Paused subscription and unpaid invoice |
| `Q-0205` | Yearly subscription | Cancelled subscription and paid invoice |
| `Q-0206` | Reversed payment | Invoice balance derived from payment plus reversal |
| `Q-0301` | Converted portal Lead | RFQ-to-Lead-to-Draft provenance |
| `NS-Q-0001` | Northstar pending | Tenant-isolated Manager approval |
| `NS-Q-0002` | Northstar direct Draft | Direct-draft RFQ behavior without creating a Lead |

## 6. Test the public business directory and join-request lifecycle

Reseed before this section to restore the three named directory checkpoints.

| Request | Seeded state | Expected relationship |
| --- | --- | --- |
| Atlas Field Operations | Pending | No Customer, User, assignment, or login exists yet |
| Lumen Offices | Approved | Linked Lumen Customer, active portal identity, PORTAL_USER membership, Enterprise Sales team, and Aarav as primary Rep |
| Stonebridge Procurement | Declined | Retained decision reason and no resulting Customer |

1. While signed out, open `/directory`. Confirm that exactly **DealOS Demo Commerce** and **Northstar Distribution** are listed and that each card contains only public name, description, and category.
2. Submit a new request to Northstar with a unique email. Confirm that the page says no account or login exists until approval.
3. Sign in as `admin@dealos.demo`, open **Join requests → Pending**, and inspect **Atlas Field Operations**. Approve it with **Enterprise Sales**, **Aarav Mehta**, a tier, and INR. Copy the one-time credentials before dismissing the result.
4. Confirm Atlas moves out of Pending, one Customer exists, and the generated customer login works at `/customer/sign-in`. Reseed afterward if you need the untouched checkpoint again.
5. Open **Approved** and inspect **Lumen Offices**. Confirm the linked customer is present, then sign in as `customer@lumen.demo` with `DealOS2026!` to verify the seeded portal identity.
6. Open **Declined** and inspect **Stonebridge Procurement**. Confirm the reason is visible and no Stonebridge customer exists.
7. Sign in as `orgadmin@northstar.demo`. Confirm the DealOS Demo requests are absent. In **Rules**, verify that only an Admin can edit its own public directory profile.

Pass condition: public output remains allowlisted, submission creates only a pending request, approval produces one fully assigned customer/login, decline produces none, later list reads never reveal the temporary password, and each organization sees only its own inbox.

Automated equivalent: from `backend`, run `npm run test:directory:pg`. It creates a disposable PostgreSQL schema, runs the directory transaction cases, executes the full seed twice, validates all three seeded states and tenant isolation, then drops the schema.

## 7. Test RFQ intake in both organization modes

### Lead-first mode

1. As `customer@dealos.demo`, open **Request a quote**.
2. Request a catalog item and add one free-text requirement.
3. Submit once, refresh, and verify its status in request history.
4. As `rep@dealos.demo`, open **Portal leads**, inspect degradation/free-text warnings, and convert the Lead.
5. Verify that the new quotation is a private Draft and that free text was not silently converted into a priced product.

### Direct-draft mode

1. As `buyer@orion.demo`, submit an RFQ from the Northstar customer portal.
2. As `rep@northstar.demo`, verify that a Draft appears directly and no Lead qualification step is created.
3. As `admin@dealos.demo`, verify that no Northstar request, customer, quote, user, or product is visible.

Pass condition: the selected organization setting changes the workflow without crossing tenant or customer boundaries.

## 8. Test a customer invitation

1. Rerun the seed and copy the printed Gamma Health invitation URL.
2. Open it in a private window while signed out.
3. Verify the organization, customer, and email before accepting.
4. Create a password of at least 12 characters and accept once.
5. Try the same URL again.

Pass condition: the first acceptance activates exactly one Gamma customer identity; the second attempt reports that the one-time invitation is no longer usable.

## 9. Usability scorecard

For each major task, score 1 (poor) to 5 (excellent) and add one sentence of evidence.

| Dimension | Question |
| --- | --- |
| Findability | Could the persona find the next screen/action without being told its location? |
| Comprehension | Were status, risk, money, cadence, and ownership labels understandable? |
| Feedback | Did every action show immediate success, failure, or in-progress feedback? |
| Recovery | Did validation explain how to fix missing, stale, or invalid input? |
| Continuity | After refresh or role handoff, did the saved state remain clear? |
| Permission clarity | Were unavailable actions hidden or disabled for an understandable reason? |
| Data trust | Did totals, stock, balances, and history reconcile across modules? |
| Efficiency | Could a frequent user finish without unnecessary navigation or repeated entry? |
| Accessibility | Could keyboard users reach controls, see focus, dismiss dialogs, and understand labels? |
| Responsiveness | Did the workflow remain usable at narrow/mobile widths without hidden actions? |

Capture each issue as: persona, record, screen, action, expected result, actual result, severity, screenshot, and reproducibility. Treat data leakage, duplicate orders/invoices, incorrect balances, over-reservation, or unauthorized writes as release blockers.

## 10. Reset between runs

From `backend`:

```powershell
npm run db:seed
```

This returns every named checkpoint and demo password to the documented state. The dates are generated relative to seed time, so overdue and upcoming scenarios stay useful.
