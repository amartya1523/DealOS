# DealOS mobile

Flutter client for the existing DealOS Express/PostgreSQL platform. The app uses the same `/api/v1` API, opaque database-backed sessions, CSRF rules, tenant scope, role/module permissions, calculations, and workflow transitions as the website. It does not contain a second backend or hardcoded business records.

## Requirements

- Flutter 3.41.9 or newer compatible stable release
- Xcode with an installed iOS simulator for iOS builds
- Android SDK accepted by the installed Flutter release
- Running DealOS backend from the repository's `backend/` directory
- A backend `FRONTEND_ORIGIN` matching `DEALOS_ALLOWED_ORIGIN`

Start the local backend according to its README. The Android emulator reaches the host through `10.0.2.2`; iOS uses `localhost` by default.

```bash
flutter pub get
flutter run --flavor development \
  --dart-define=DEALOS_ENV=development \
  --dart-define=DEALOS_API_BASE_URL=http://10.0.2.2:4000/api/v1 \
  --dart-define=DEALOS_ALLOWED_ORIGIN=http://localhost:5173
```

For iOS, select the `Development` scheme and use `http://localhost:4000/api/v1`. Physical devices need an HTTPS address reachable from the device. Production configuration refuses a non-HTTPS API URL.

## Environments

No secrets or production URLs are committed. Supply configuration with compile-time defines:

| Define | Values / purpose |
|---|---|
| `DEALOS_ENV` | `development`, `staging`, or `production` |
| `DEALOS_API_BASE_URL` | Full API prefix ending in `/api/v1` |
| `DEALOS_ALLOWED_ORIGIN` | Exact backend `FRONTEND_ORIGIN`, required by CSRF protection |

Android has `development`, `staging`, and `production` product flavors (`com.dealos.mobile.dev`, `.staging`, and `com.dealos.mobile`). iOS has shared `Development`, `Staging`, and `Production` schemes; pass the matching Dart defines in the scheme or CI command. The release bundle identifier is `com.dealos.mobile`.

## Quality commands

```bash
dart format --output=none --set-exit-if-changed lib test integration_test
flutter analyze
flutter test
flutter test integration_test --dart-define=RUN_DEALOS_INTEGRATION=true
flutter build apk --debug --flavor development
flutter build appbundle --release --flavor production \
  --dart-define=DEALOS_ENV=production \
  --dart-define=DEALOS_API_BASE_URL=https://api.example.com/api/v1 \
  --dart-define=DEALOS_ALLOWED_ORIGIN=https://app.example.com
flutter build ios --simulator --debug --flavor Development \
  --dart-define=DEALOS_ENV=development \
  --dart-define=DEALOS_API_BASE_URL=http://localhost:4000/api/v1 \
  --dart-define=DEALOS_ALLOWED_ORIGIN=http://localhost:5173
flutter build ios --release --no-codesign --flavor Production \
  --dart-define=DEALOS_ENV=production \
  --dart-define=DEALOS_API_BASE_URL=https://api.example.com/api/v1 \
  --dart-define=DEALOS_ALLOWED_ORIGIN=https://app.example.com
```

The integration test is opt-in because it needs a device/simulator and a running seeded backend. It intentionally uses the real service; mock HTTP is limited to unit tests.

## Security and session behavior

- The backend issues no access/refresh-token pair. It issues a 12-hour organization session or four-hour Platform Owner session. The opaque cookie and CSRF token are kept in Keychain/Android encrypted storage.
- The app restores through `/auth/me` and revalidates on resume. A 401 clears session material and protected caches.
- Only the last backend-authorized `/workspace` projection is cached, encrypted. Offline data is read-only; approvals, confirmation, allocation, payments, role changes, suspension, and all other mutations are never queued.
- Changing Platform Owner View As context removes the former tenant cache before requesting the replacement projection. View As writes are blocked by both the client and backend.
- Deep-linked records must exist in the active backend-scoped workspace and pass module checks. A missing/out-of-scope ID renders a restricted state.
- Customer navigation never exposes product costs, margins, risk, approval notes, warehouse data, internal audit, or organization administration.
- Requests include bounded UUID request IDs. Consequential mutations include a fresh idempotency key and are never automatically retried.

## Release signing

Android local release verification uses the generated debug signing config. Before distribution, replace it with a CI-injected upload keystore; never commit keystore files or passwords. iOS distribution signing must be configured through the organization’s Apple Developer team/keychain or CI secrets; certificates and provisioning profiles are not stored here.

The backend capability and permission matrices, implementation status, and exact limitations are in [docs/BACKEND_COVERAGE.md](docs/BACKEND_COVERAGE.md). Architecture details are in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), and the reproducible check/build results are in [docs/VERIFICATION.md](docs/VERIFICATION.md).
