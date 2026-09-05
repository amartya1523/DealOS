import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';

abstract interface class SessionStore {
  Future<Map<String, String>> readCookies();
  Future<void> writeCookies(Map<String, String> cookies);
  Future<String?> readCsrfToken();
  Future<void> writeCsrfToken(String? token);
  Future<void> clear();
}

class SecureSessionStore implements SessionStore {
  SecureSessionStore([FlutterSecureStorage? storage])
    : _storage = storage ?? const FlutterSecureStorage();

  static const _cookiesKey = 'dealos.secure.session.cookies.v1';
  static const _csrfKey = 'dealos.secure.session.csrf.v1';
  final FlutterSecureStorage _storage;

  @override
  Future<Map<String, String>> readCookies() async {
    final value = await _storage.read(key: _cookiesKey);
    if (value == null || value.isEmpty) return {};
    try {
      final decoded = jsonDecode(value);
      if (decoded is! Map) return {};
      return decoded.map((key, value) => MapEntry('$key', '$value'));
    } on FormatException {
      await clear();
      return {};
    }
  }

  @override
  Future<void> writeCookies(Map<String, String> cookies) => cookies.isEmpty
      ? _storage.delete(key: _cookiesKey)
      : _storage.write(key: _cookiesKey, value: jsonEncode(cookies));

  @override
  Future<String?> readCsrfToken() => _storage.read(key: _csrfKey);

  @override
  Future<void> writeCsrfToken(String? token) => token == null || token.isEmpty
      ? _storage.delete(key: _csrfKey)
      : _storage.write(key: _csrfKey, value: token);

  @override
  Future<void> clear() async {
    await Future.wait([
      _storage.delete(key: _cookiesKey),
      _storage.delete(key: _csrfKey),
    ]);
  }
}
