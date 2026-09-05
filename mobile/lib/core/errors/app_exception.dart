class AppException implements Exception {
  const AppException({
    required this.code,
    required this.message,
    this.statusCode,
    this.requestId,
    this.details,
  });

  final String code;
  final String message;
  final int? statusCode;
  final String? requestId;
  final Object? details;

  bool get isAuthenticationFailure =>
      statusCode == 401 ||
      code == 'AUTH_REQUIRED' ||
      code == 'PLATFORM_AUTH_REQUIRED';

  bool get isConflict => statusCode == 409;

  @override
  String toString() => message;
}
