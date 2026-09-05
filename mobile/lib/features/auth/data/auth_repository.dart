import '../../../core/api/api_client.dart';
import '../../workspace/domain/models.dart';

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

  Future<void> loginPlatformOwner({
    required String loginId,
    required String password,
  }) => _api.request(
    '/auth/super-admin/login',
    method: 'POST',
    data: {'loginId': loginId.trim(), 'password': password},
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
