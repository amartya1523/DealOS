import 'package:dealos_mobile/core/config/app_config.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('development defaults match the runnable backend port', () {
    final config = AppConfig.fromEnvironment();

    expect(config.environment, 'development');
    expect(config.apiBaseUrl, 'http://localhost:4000/api/v1');
    expect(config.allowedOrigin, 'http://localhost:5173');
  });
}
