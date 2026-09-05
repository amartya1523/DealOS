import 'dart:io';

/// Compile-time environment configuration.
///
/// Production builds must pass HTTPS values with `--dart-define`; no production
/// hosts or credentials are embedded in the application.
class AppConfig {
  const AppConfig({
    required this.environment,
    required this.apiBaseUrl,
    required this.allowedOrigin,
  });

  final String environment;
  final String apiBaseUrl;
  final String allowedOrigin;

  bool get isProduction => environment == 'production';

  factory AppConfig.fromEnvironment() {
    const environment = String.fromEnvironment(
      'DEALOS_ENV',
      defaultValue: 'development',
    );
    final defaultHost = Platform.isAndroid ? '10.0.2.2' : 'localhost';
    final config = AppConfig(
      environment: environment,
      apiBaseUrl: const String.fromEnvironment('DEALOS_API_BASE_URL').isEmpty
          ? 'http://$defaultHost:4000/api/v1'
          : const String.fromEnvironment('DEALOS_API_BASE_URL'),
      allowedOrigin: const String.fromEnvironment(
        'DEALOS_ALLOWED_ORIGIN',
        defaultValue: 'http://localhost:5173',
      ),
    );
    if (config.isProduction &&
        !Uri.parse(config.apiBaseUrl).isScheme('https')) {
      throw StateError('Production DEALOS_API_BASE_URL must use HTTPS.');
    }
    return config;
  }
}
