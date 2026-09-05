import '../../../core/api/api_client.dart';
import '../domain/models.dart';
import 'workspace_cache.dart';

class WorkspaceRepository {
  const WorkspaceRepository(this._api, this._cache);
  final ApiClient _api;
  final WorkspaceCache _cache;

  Future<Workspace> load() async {
    final raw = await _api.get(
      '/workspace',
      (data) => Map<String, dynamic>.from(data as Map),
    );
    await _cache.write(raw);
    return Workspace.fromJson(raw);
  }

  Future<Workspace?> loadCached() async {
    final raw = await _cache.read();
    return raw == null ? null : Workspace.fromJson(raw);
  }

  Future<PlatformDashboard> loadPlatformDashboard({
    String query = '',
    String? status,
    int page = 1,
  }) => _api.get(
    '/platform/dashboard',
    (data) =>
        PlatformDashboard.fromJson(Map<String, dynamic>.from(data as Map)),
    queryParameters: {
      'page': page,
      'limit': 25,
      'query': query,
      'status': ?status,
    },
  );

  Future<List<JsonMap>> loadPlatformMembers({String query = ''}) =>
      _api.get('/platform/members', (data) {
        final map = Map<String, dynamic>.from(data as Map);
        return (map['items'] as List? ?? const [])
            .whereType<Map>()
            .map((item) => Map<String, dynamic>.from(item))
            .toList(growable: false);
      }, queryParameters: {'limit': 100, 'query': query});

  Future<JsonMap> loadOrganization(String id) => _api.get(
    '/platform/organizations/$id',
    (data) => Map<String, dynamic>.from(data as Map),
  );

  Future<JsonMap> loadFulfillment(String quoteId, {bool preview = false}) =>
      _api.get(
        '/fulfillment/$quoteId${preview ? '/preview' : ''}',
        (data) => Map<String, dynamic>.from(data as Map),
      );

  Future<Object?> mutate(String path, JsonMap body, {String method = 'POST'}) =>
      _api.request(path, method: method, data: body, idempotentMutation: true);

  Future<List<int>> downloadInvoice(String id) =>
      _api.download('/invoices/$id/pdf');

  Future<void> clearCache() => _cache.clear();
}
