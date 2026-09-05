# Customer portal parity

## Authentication contract

1. An organization user sends a portal invitation to a customer email.
2. The customer opens **Customer portal** on the mobile login screen and enters that exact email.
3. Native Google Sign-In returns an ID token for the selected account.
4. Mobile sends only `{ email, credential }` to `POST /api/v1/auth/google/customer`.
5. The backend verifies the token signature, audience and expiry, compares the Google email with the entered email, accepts a pending invitation, and starts the normal opaque-cookie session.
6. Mobile loads `/auth/me` and `/workspace`; customer authorization is derived from the returned `CUSTOMER` actor.

Internal email/password credentials are never routed through this flow. Mobile performs an early account-email comparison for a clearer error, but backend verification is authoritative.

## Portal modules

The mobile customer shell intentionally exposes the same four modules as `CustomerPortalV2` on the website:

- **My quotations** — shared quote list/details, customer-safe commercial lines, negotiation messages and confirmation of an approved revision.
- **Invoices** — shared invoices, line/summary details, PDF download and due-date change requests.
- **Messages** — quotation conversations aggregated and ordered newest-first.
- **Profile** — verified identity, organization, shared record counts and the server-isolation notice.

Subscriptions, approvals, products, costs, margin, internal risk notes, policy data, stock, users and audit data are not customer destinations.

## Native Google configuration

The backend `GOOGLE_CLIENT_ID` is the web OAuth client ID used as the ID-token audience and is returned by `/auth/google/config` as the mobile `serverClientId`.

For Android, register these package names as needed and add the signing certificate SHA fingerprints in the same Google project:

- `com.dealos.mobile.dev`
- `com.dealos.mobile.staging`
- `com.dealos.mobile`

For iOS, create OAuth clients for the corresponding bundle identifiers and add each client's reversed ID as a URL scheme. The Development client for `com.dealos.mobile.dev` is configured in `ios/Runner/Info.plist`. A Dart define is only needed to override the client in CI or another flavor:

```bash
flutter run --flavor Development \
  --dart-define=DEALOS_GOOGLE_IOS_CLIENT_ID=YOUR_IOS_CLIENT_ID \
  --dart-define=DEALOS_API_BASE_URL=http://localhost:4000/api/v1 \
  --dart-define=DEALOS_ALLOWED_ORIGIN=http://localhost:5173
```

Do not substitute the web client ID for the iOS client ID. Without the native client and callback scheme, the UI remains available but reports a precise OAuth configuration error.
