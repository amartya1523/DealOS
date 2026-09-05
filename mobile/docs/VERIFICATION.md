# Verification record

Verified on 2026-09-05 with Flutter 3.41.9, Dart 3.11.5, Xcode, and the locally configured Android SDK.

## Automated checks

| Check | Result |
|---|---|
| `flutter analyze` | Passed with no issues |
| `flutter test` | Passed, 9 tests |
| Backend `npm test` | Passed, 33 tests |
| Backend `npm run build` | Passed |
| `plutil -lint ios/Runner/Info.plist` | Passed |

The Flutter suite covers session cookie/CSRF handling, backend error mapping, decimal/date parsing, role authorization, customer-safe navigation and detail redaction, and an adaptive manager navigation surface. The opt-in integration harness compiles separately and requires a running seeded backend plus a simulator/device; it is not represented as an executed end-to-end test in this record.

## Build matrix

| Target | Configuration | Result |
|---|---|---|
| Android APK | `developmentDebug` | Passed |
| Android App Bundle | `productionRelease` | Passed |
| iOS simulator app | `Debug-Development` | Passed |
| iOS device app | `Release-Production`, signing disabled | Passed |

The production verification builds use `https://api.example.com/api/v1` and `https://app.example.com` placeholders because deploy-time URLs were not supplied. Rebuild with the real HTTPS API and backend origin before signing or distribution.

## Preserved artifacts

These artifacts were preserved in the original local build workspace and are intentionally excluded from this Git branch. Re-run the documented build commands to reproduce them.

| Artifact | SHA-256 |
|---|---|
| `release-artifacts/dealos-development-debug.apk` | `12bcd3ecee3622c279cbad8e63284b06b1373df2f3471895731905ecb7a88400` |
| `release-artifacts/dealos-production-release.aab` | `f198dbaea779550577ca4bb9cd87a3f12cd8fe02632a7290d48c0db7a697696b` |
| `release-artifacts/dealos-production-ios-unsigned.zip` | `e13411dd5a7a6b5bcbecb389759e749657db54607ddfdc95734431cac49c3201` |

The AAB uses the repository's explicit local debug-signing fallback and the iOS bundle is unsigned. They prove release compilation only; store submission still requires CI-injected Android upload signing and Apple distribution signing.

## Known validation boundary

The application is integrated against the inspected backend contract and its tests/build pass, but no disposable PostgreSQL environment with representative users was provided during this run. Real-device, accessibility-device-lab, performance-volume, notification, and full role-by-role end-to-end validation remain release-gate activities.
