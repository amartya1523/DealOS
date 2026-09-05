import 'package:dealos_mobile/app/providers.dart';
import 'package:dealos_mobile/features/auth/application/session_controller.dart';
import 'package:dealos_mobile/features/quotations/presentation/quotations_screen.dart';
import 'package:dealos_mobile/features/workspace/domain/models.dart';
import 'package:dealos_mobile/features/workspace/presentation/app_shell.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import '../fixtures.dart';

class StubSessionController extends SessionController {
  StubSessionController(this.initial);
  final SessionState initial;
  @override
  SessionState build() => initial;
}

Widget appFor(Workspace workspace, Widget child) => ProviderScope(
  overrides: [
    sessionControllerProvider.overrideWith(
      () => StubSessionController(
        SessionState(status: SessionStatus.authenticated, workspace: workspace),
      ),
    ),
  ],
  child: MaterialApp(home: child),
);

void main() {
  testWidgets('customer navigation exposes only customer-safe destinations', (
    tester,
  ) async {
    final workspace = fixtureWorkspace(role: 'CUSTOMER', modules: const []);
    await tester.pumpWidget(
      appFor(
        workspace,
        DealOsShell(workspace: workspace, section: 'quotations'),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Quotes'), findsWidgets);
    expect(find.text('Invoices'), findsWidgets);
    expect(find.text('Plans'), findsWidgets);
    expect(find.text('Approvals'), findsNothing);
    expect(find.text('Products'), findsNothing);
  });

  testWidgets('customer quote detail hides margin, costs and approval policy', (
    tester,
  ) async {
    final workspace = fixtureWorkspace(role: 'CUSTOMER', modules: const []);
    await tester.pumpWidget(
      appFor(
        workspace,
        QuoteDetailScreen(workspace: workspace, quote: workspace.quotes.single),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Margin'), findsNothing);
    expect(find.text('Policy limit'), findsNothing);
    expect(find.textContaining('82000'), findsNothing);
    expect(find.text('Confirm approved revision'), findsOneWidget);
  });

  testWidgets('manager navigation contains the approval inbox', (tester) async {
    final workspace = fixtureWorkspace();
    await tester.binding.setSurfaceSize(const Size(1000, 900));
    await tester.pumpWidget(
      appFor(
        workspace,
        DealOsShell(workspace: workspace, section: 'approvals'),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Approvals'), findsWidgets);
    expect(find.text('Approval inbox'), findsOneWidget);
    addTearDown(() => tester.binding.setSurfaceSize(null));
  });
}
