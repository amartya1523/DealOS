import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import '../../../core/api/api_client.dart';

abstract interface class WorkspaceCache {
  Future<void> write(JsonMap workspace);
  Future<JsonMap?> read();
  Future<void> clear();
}

/// Stores only the last successfully authorized workspace projection.
///
/// It is encrypted by the OS keystore/keychain and deleted on logout or tenant
/// context changes. Cached data is exposed in read-only offline mode.
class SecureWorkspaceCache implements WorkspaceCache {
  SecureWorkspaceCache([FlutterSecureStorage? storage])
    : _storage = storage ?? const FlutterSecureStorage();

  static const _key = 'dealos.secure.workspace.cache.v1';
  final FlutterSecureStorage _storage;

  @override
  Future<void> write(JsonMap workspace) => _storage.write(
    key: _key,
    value: jsonEncode({
      'cachedAt': DateTime.now().toUtc().toIso8601String(),
      'workspace': workspace,
    }),
  );

  @override
  Future<JsonMap?> read() async {
    final raw = await _storage.read(key: _key);
    if (raw == null) return null;
    try {
      final envelope = jsonDecode(raw);
      if (envelope is! Map || envelope['workspace'] is! Map) return null;
      return Map<String, dynamic>.from(envelope['workspace'] as Map);
    } on FormatException {
      await clear();
      return null;
    }
  }

  @override
  Future<void> clear() => _storage.delete(key: _key);
}
