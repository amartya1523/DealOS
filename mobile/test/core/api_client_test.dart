import 'dart:convert';
import 'dart:typed_data';

import 'package:dealos_mobile/core/api/api_client.dart';
import 'package:dealos_mobile/core/config/app_config.dart';
import 'package:dealos_mobile/core/errors/app_exception.dart';
import 'package:dealos_mobile/core/security/session_store.dart';
import 'package:dealos_mobile/features/auth/data/auth_repository.dart';
import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';

class MemorySessionStore implements SessionStore {
  Map<String, String> cookies = {};
  String? csrf;
  @override
  Future<void> clear() async {
    cookies.clear();
    csrf = null;
  }

  @override
  Future<Map<String, String>> readCookies() async => Map.of(cookies);
  @override
  Future<String?> readCsrfToken() async => csrf;
  @override
  Future<void> writeCookies(Map<String, String> value) async =>
      cookies = Map.of(value);
  @override
  Future<void> writeCsrfToken(String? token) async => csrf = token;
}

class StubAdapter implements HttpClientAdapter {
  StubAdapter(this.handler);
  final ResponseBody Function(RequestOptions options) handler;
  @override
  void close({bool force = false}) {}
  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async => handler(options);
}

ResponseBody jsonBody(
  Object value,
  int status, {
  Map<String, List<String>> headers = const {},
}) => ResponseBody.fromString(
  jsonEncode(value),
  status,
  headers: {
    'content-type': ['application/json'],
    ...headers,
  },
);

void main() {
  const config = AppConfig(
    environment: 'test',
    apiBaseUrl: 'https://api.test/api/v1',
    allowedOrigin: 'https://app.test',
  );

  test(
    'captures opaque cookie and CSRF, then authorizes an idempotent mutation',
    () async {
      final store = MemorySessionStore();
      RequestOptions? mutation;
      var calls = 0;
      final dio = Dio()
        ..httpClientAdapter = StubAdapter((options) {
          calls++;
          if (calls == 1) {
            return jsonBody(
              {
                'success': true,
                'data': {'csrfToken': 'csrf-123'},
                'meta': {'requestId': 'request-1'},
              },
              200,
              headers: {
                'set-cookie': [
                  'dealos_session=opaque; HttpOnly; Path=/',
                  'dealos_platform_session=; Max-Age=0',
                ],
              },
            );
          }
          mutation = options;
          return jsonBody({
            'success': true,
            'data': {'saved': true},
            'meta': {'requestId': 'request-2'},
          }, 200);
        });
      final client = ApiClient(config: config, sessionStore: store, dio: dio);

      await client.request(
        '/auth/login',
        method: 'POST',
        data: {'identifier': 'user@test', 'password': 'password'},
      );
      await client.request(
        '/approvals/a1/decision',
        method: 'POST',
        data: {'decision': 'APPROVE', 'reason': 'Reviewed'},
        idempotentMutation: true,
      );

      expect(store.cookies, {'dealos_session': 'opaque'});
      expect(store.csrf, 'csrf-123');
      expect(mutation?.headers['Cookie'], 'dealos_session=opaque');
      expect(mutation?.headers['X-CSRF-Token'], 'csrf-123');
      expect(mutation?.headers['Origin'], 'https://app.test');
      expect(mutation?.headers['Idempotency-Key'], isNotEmpty);
    },
  );

  test(
    'maps backend validation envelopes without exposing internals',
    () async {
      final dio = Dio()
        ..httpClientAdapter = StubAdapter(
          (_) => jsonBody({
            'success': false,
            'error': {
              'code': 'VALIDATION_ERROR',
              'message': 'Check the form.',
              'details': {
                'fields': {
                  'name': ['Required'],
                },
              },
            },
            'meta': {'requestId': 'req-safe'},
          }, 422),
        );
      final client = ApiClient(
        config: config,
        sessionStore: MemorySessionStore(),
        dio: dio,
      );

      expect(
        () => client.request('/customers', method: 'POST', data: const {}),
        throwsA(
          isA<AppException>()
              .having((error) => error.code, 'code', 'VALIDATION_ERROR')
              .having((error) => error.requestId, 'request ID', 'req-safe'),
        ),
      );
    },
  );

  test('Google auth uses the website contracts and stores session', () async {
    final store = MemorySessionStore();
    RequestOptions? customerLogin;
    RequestOptions? organizationLogin;
    final dio = Dio()
      ..httpClientAdapter = StubAdapter((options) {
        if (options.path.endsWith('/auth/google/config')) {
          return jsonBody({
            'success': true,
            'data': {
              'enabled': true,
              'clientId': 'web-client.apps.googleusercontent.com',
            },
          }, 200);
        }
        if (options.path.endsWith('/auth/google/customer')) {
          customerLogin = options;
        }
        if (options.path.endsWith('/auth/google/login')) {
          organizationLogin = options;
        }
        return jsonBody(
          {
            'success': true,
            'data': {'role': 'CUSTOMER', 'csrfToken': 'customer-csrf'},
          },
          200,
          headers: {
            'set-cookie': ['dealos_session=customer-session; HttpOnly'],
          },
        );
      });
    final repository = AuthRepository(
      ApiClient(config: config, sessionStore: store, dio: dio),
    );

    final google = await repository.googleAuthConfig();
    expect(google.enabled, isTrue);
    expect(google.clientId, 'web-client.apps.googleusercontent.com');
    await repository.loginCustomerWithGoogle(
      email: ' Buyer@Vertex.Test ',
      credential: 'signed-google-id-token',
    );

    expect(customerLogin?.path, endsWith('/auth/google/customer'));
    expect(customerLogin?.method, 'POST');
    expect(customerLogin?.data, {
      'email': 'buyer@vertex.test',
      'credential': 'signed-google-id-token',
    });
    await repository.loginWithGoogle(
      credential: 'organization-google-id-token',
    );
    expect(organizationLogin?.path, endsWith('/auth/google/login'));
    expect(organizationLogin?.method, 'POST');
    expect(organizationLogin?.data, {
      'credential': 'organization-google-id-token',
    });
    expect(store.cookies['dealos_session'], 'customer-session');
    expect(store.csrf, 'customer-csrf');
  });
}
