import 'package:dealos_mobile/main.dart' as app;
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets(
    'launches and restores or requests a DealOS session',
    (tester) async {
      app.main();
      await tester.pumpAndSettle(const Duration(seconds: 3));
      expect(find.text('DealOS'), findsWidgets);
    },
    skip: !const bool.fromEnvironment('RUN_DEALOS_INTEGRATION'),
  );
}
