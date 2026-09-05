import '../../../core/api/api_client.dart';
import '../../workspace/domain/models.dart';

class GoogleAuthConfig {
  const GoogleAuthConfig({required this.enabled, this.clientId});

  final bool enabled;
  final String? clientId;

  factory GoogleAuthConfig.fromJson(Map<String, dynamic> json) =>
      GoogleAuthConfig(
        enabled: json['enabled'] == true,
        clientId: json['clientId']?.toString(),
      );
}

class AuthRepository {
  const AuthRepository(this._api);
  final ApiClient _api;

  Future<Actor> restore() => _api.get(
    '/auth/me',
    (data) => Actor.fromJson(Map<String, dynamic>.from(data as Map)),
  );

  Future<void> login({required String identifier, required String password}) =>
      _api.request(
        '/auth/login',
        method: 'POST',
        data: {'identifier': identifier.trim(), 'password': password},
      );

  Future<GoogleAuthConfig> googleAuthConfig() => _api.get(
    '/auth/google/config',
    (data) => GoogleAuthConfig.fromJson(
      Map<String, dynamic>.from(data as Map? ?? const {}),
    ),
  );

  Future<void> loginCustomerWithGoogle({
    required String email,
    required String credential,
  }) => _api.request(
    '/auth/google/customer',
    method: 'POST',
    data: {'email': email.trim().toLowerCase(), 'credential': credential},
  );

  Future<void> loginWithGoogle({required String credential}) => _api.request(
    '/auth/google/login',
    method: 'POST',
    data: {'credential': credential},
  );

  Future<void> signUp({
    required String organizationName,
    required String displayName,
    required String email,
    required String password,
  }) => _api.request(
    '/auth/signup',
    method: 'POST',
    data: {
      'organizationName': organizationName.trim(),
      'displayName': displayName.trim(),
      'email': email.trim().toLowerCase(),
      'password': password,
    },
  );

  Future<void> logout() async {
    try {
      await _api.request(
        '/auth/logout',
        method: 'POST',
        data: const {},
        idempotentMutation: true,
      );
    } finally {
      await _api.clearSession();
    }
  }
}
