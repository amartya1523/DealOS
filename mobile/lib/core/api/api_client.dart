import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:uuid/uuid.dart';

import '../config/app_config.dart';
import '../errors/app_exception.dart';
import '../security/session_store.dart';

typedef JsonMap = Map<String, dynamic>;

class ApiClient {
  ApiClient({
    required AppConfig config,
    required SessionStore sessionStore,
    Dio? dio,
  }) : _config = config,
       _sessionStore = sessionStore,
       _dio =
           dio ??
           Dio(
             BaseOptions(
               baseUrl: config.apiBaseUrl,
               connectTimeout: const Duration(seconds: 15),
               receiveTimeout: const Duration(seconds: 25),
               sendTimeout: const Duration(seconds: 25),
               responseType: ResponseType.json,
             ),
           );

  final AppConfig _config;
  final SessionStore _sessionStore;
  final Dio _dio;
  final Uuid _uuid = const Uuid();

  static const _safeMethods = {'GET', 'HEAD', 'OPTIONS'};

  Future<T> get<T>(
    String path,
    T Function(Object? data) decode, {
    Map<String, dynamic>? queryParameters,
    CancelToken? cancelToken,
  }) async {
    final data = await request(
      path,
      method: 'GET',
      queryParameters: queryParameters,
      cancelToken: cancelToken,
    );
    return decode(data);
  }

  Future<Object?> request(
    String path, {
    String method = 'GET',
    Object? data,
    Map<String, dynamic>? queryParameters,
    CancelToken? cancelToken,
    bool idempotentMutation = false,
  }) async {
    final normalizedMethod = method.toUpperCase();
    final cookies = await _sessionStore.readCookies();
    final csrf = await _sessionStore.readCsrfToken();
    final headers = <String, dynamic>{
      'Accept': 'application/json',
      'Origin': _config.allowedOrigin,
      'X-Request-ID': _uuid.v4(),
      if (cookies.isNotEmpty)
        'Cookie': cookies.entries
            .map((entry) => '${entry.key}=${entry.value}')
            .join('; '),
      if (!_safeMethods.contains(normalizedMethod) && csrf != null)
        'X-CSRF-Token': csrf,
      if (idempotentMutation) 'Idempotency-Key': _uuid.v4(),
    };

    try {
      final response = await _dio.request<Object?>(
        path,
        data: data,
        queryParameters: queryParameters,
        cancelToken: cancelToken,
        options: Options(method: normalizedMethod, headers: headers),
      );
      await _captureCookies(response.headers);
      final envelope = _asMap(response.data);
      if (envelope['success'] != true) {
        throw _fromEnvelope(envelope, response.statusCode);
      }
      final payload = envelope['data'];
      await _captureCsrf(payload);
      if (path == '/auth/logout') await _sessionStore.clear();
      return payload;
    } on DioException catch (error) {
      if (error.response != null) {
        await _captureCookies(error.response!.headers);
        final envelope = _asMap(error.response!.data);
        throw _fromEnvelope(envelope, error.response!.statusCode);
      }
      throw AppException(
        code: error.type == DioExceptionType.connectionError
            ? 'OFFLINE'
            : 'NETWORK_ERROR',
        message: error.type == DioExceptionType.connectionError
            ? 'DealOS cannot reach the server. Check your connection and try again.'
            : 'The request could not be completed. Please try again.',
      );
    }
  }

  Future<List<int>> download(String path, {CancelToken? cancelToken}) async {
    final cookies = await _sessionStore.readCookies();
    try {
      final response = await _dio.get<List<int>>(
        path,
        cancelToken: cancelToken,
        options: Options(
          responseType: ResponseType.bytes,
          headers: {
            'Origin': _config.allowedOrigin,
            'X-Request-ID': _uuid.v4(),
            if (cookies.isNotEmpty)
              'Cookie': cookies.entries
                  .map((entry) => '${entry.key}=${entry.value}')
                  .join('; '),
          },
        ),
      );
      return response.data ?? const [];
    } on DioException catch (error) {
      throw AppException(
        code: 'DOWNLOAD_FAILED',
        statusCode: error.response?.statusCode,
        message: 'The document could not be downloaded.',
      );
    }
  }

  Future<void> clearSession() => _sessionStore.clear();

  Future<void> _captureCookies(Headers headers) async {
    final setCookies = headers.map['set-cookie'];
    if (setCookies == null || setCookies.isEmpty) return;
    final current = await _sessionStore.readCookies();
    for (final raw in setCookies) {
      final segments = raw.split(';');
      if (segments.isEmpty || !segments.first.contains('=')) continue;
      final separator = segments.first.indexOf('=');
      final name = segments.first.substring(0, separator).trim();
      final value = segments.first.substring(separator + 1).trim();
      final expired = segments.any(
        (part) => part.trim().toLowerCase() == 'max-age=0',
      );
      if (expired || value.isEmpty) {
        current.remove(name);
        if (name == 'dealos_csrf') await _sessionStore.writeCsrfToken(null);
      } else {
        current[name] = value;
        if (name == 'dealos_csrf') await _sessionStore.writeCsrfToken(value);
      }
    }
    await _sessionStore.writeCookies(current);
  }

  Future<void> _captureCsrf(Object? payload) async {
    if (payload is! Map) return;
    final direct = payload['csrfToken'];
    final nested = payload['user'] is Map
        ? (payload['user'] as Map)['csrfToken']
        : null;
    final token = direct is String
        ? direct
        : nested is String
        ? nested
        : null;
    if (token != null && token.isNotEmpty) {
      await _sessionStore.writeCsrfToken(token);
    }
  }

  static JsonMap _asMap(Object? value) {
    if (value is Map<String, dynamic>) return value;
    if (value is String) {
      try {
        final decoded = jsonDecode(value);
        if (decoded is Map<String, dynamic>) return decoded;
      } on FormatException {
        // Converted to a safe generic error below.
      }
    }
    return const {};
  }

  static AppException _fromEnvelope(JsonMap envelope, int? statusCode) {
    final error = envelope['error'] is Map
        ? Map<String, dynamic>.from(envelope['error'] as Map)
        : const <String, dynamic>{};
    final meta = envelope['meta'] is Map
        ? Map<String, dynamic>.from(envelope['meta'] as Map)
        : const <String, dynamic>{};
    return AppException(
      code: error['code'] as String? ?? 'REQUEST_FAILED',
      message:
          error['message'] as String? ??
          'The server could not complete this request.',
      statusCode: statusCode,
      requestId: meta['requestId'] as String?,
      details: error['details'],
    );
  }
}
