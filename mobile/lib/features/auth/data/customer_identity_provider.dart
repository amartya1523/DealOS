import 'package:flutter/foundation.dart';
import 'package:google_sign_in/google_sign_in.dart';

import '../../../core/errors/app_exception.dart';

class CustomerGoogleCredential {
  const CustomerGoogleCredential({required this.idToken, required this.email});

  final String idToken;
  final String email;
}

abstract interface class CustomerIdentityProvider {
  Future<CustomerGoogleCredential> authenticate({
    required String serverClientId,
    String? expectedEmail,
  });
}

class GoogleCustomerIdentityProvider implements CustomerIdentityProvider {
  GoogleCustomerIdentityProvider({GoogleSignIn? googleSignIn})
    : _googleSignIn = googleSignIn ?? GoogleSignIn.instance;

  static const _appleClientId = String.fromEnvironment(
    'DEALOS_GOOGLE_IOS_CLIENT_ID',
  );

  final GoogleSignIn _googleSignIn;
  Future<void>? _initialization;
  String? _configuredServerClientId;

  @override
  Future<CustomerGoogleCredential> authenticate({
    required String serverClientId,
    String? expectedEmail,
  }) async {
    if (kIsWeb) {
      throw const AppException(
        code: 'GOOGLE_MOBILE_ONLY',
        message: 'Google sign-in is available in the DealOS mobile app.',
      );
    }

    final normalizedServerClientId = serverClientId.trim();
    if (normalizedServerClientId.isEmpty) {
      throw const AppException(
        code: 'GOOGLE_NOT_CONFIGURED',
        message: 'Google sign-in is not configured on the server.',
      );
    }

    final applePlatform =
        defaultTargetPlatform == TargetPlatform.iOS ||
        defaultTargetPlatform == TargetPlatform.macOS;
    if (_configuredServerClientId != null &&
        _configuredServerClientId != normalizedServerClientId) {
      throw const AppException(
        code: 'GOOGLE_CONFIGURATION_CHANGED',
        message: 'Google sign-in configuration changed. Restart the app.',
      );
    }

    _configuredServerClientId = normalizedServerClientId;
    _initialization ??= _googleSignIn.initialize(
      // iOS reads GIDClientID from Info.plist by default. The Dart define is
      // retained as an override for CI/flavor-specific native clients.
      clientId: applePlatform && _appleClientId.isNotEmpty
          ? _appleClientId
          : null,
      serverClientId: normalizedServerClientId,
    );

    try {
      await _initialization;
      // The native SDKs generally support one active account. Signing out here
      // lets the customer explicitly choose the account matching the invite.
      await _googleSignIn.signOut();
      final account = await _googleSignIn.authenticate();
      final normalizedActual = account.email.trim().toLowerCase();
      final normalizedExpected = expectedEmail?.trim().toLowerCase();
      if (normalizedExpected != null &&
          normalizedExpected.isNotEmpty &&
          normalizedActual != normalizedExpected) {
        await _googleSignIn.signOut();
        throw AppException(
          code: 'GOOGLE_EMAIL_MISMATCH',
          message:
              'Choose the Google account for $normalizedExpected. You selected ${account.email}.',
        );
      }

      final idToken = account.authentication.idToken;
      if (idToken == null || idToken.isEmpty) {
        await _googleSignIn.signOut();
        throw const AppException(
          code: 'GOOGLE_ID_TOKEN_MISSING',
          message: 'Google did not return a verifiable identity token.',
        );
      }
      return CustomerGoogleCredential(idToken: idToken, email: account.email);
    } on AppException {
      rethrow;
    } on GoogleSignInException catch (error) {
      throw _friendlyException(error);
    } catch (_) {
      throw const AppException(
        code: 'GOOGLE_SIGN_IN_FAILED',
        message: 'Google sign-in could not be completed. Please try again.',
      );
    }
  }

  AppException _friendlyException(GoogleSignInException error) {
    switch (error.code) {
      case GoogleSignInExceptionCode.canceled:
        return const AppException(
          code: 'GOOGLE_SIGN_IN_CANCELLED',
          message: 'Google sign-in was cancelled.',
        );
      case GoogleSignInExceptionCode.clientConfigurationError:
      case GoogleSignInExceptionCode.providerConfigurationError:
        return const AppException(
          code: 'GOOGLE_NOT_CONFIGURED',
          message:
              'Google sign-in needs the native OAuth configuration for this app.',
        );
      case GoogleSignInExceptionCode.uiUnavailable:
        return const AppException(
          code: 'GOOGLE_UI_UNAVAILABLE',
          message: 'Google sign-in cannot open right now. Please try again.',
        );
      default:
        return const AppException(
          code: 'GOOGLE_SIGN_IN_FAILED',
          message: 'Google sign-in could not be completed. Please try again.',
        );
    }
  }
}
