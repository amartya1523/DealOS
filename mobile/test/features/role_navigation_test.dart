import 'package:dealos_mobile/app/app.dart';
import 'package:dealos_mobile/app/providers.dart';
import 'package:dealos_mobile/features/auth/application/session_controller.dart';
import 'package:dealos_mobile/features/auth/presentation/login_screen.dart';
import 'package:dealos_mobile/features/approvals/presentation/approvals_screen.dart';
import 'package:dealos_mobile/features/billing/presentation/billing_screen.dart';
import 'package:dealos_mobile/features/customer_portal/presentation/customer_portal_screens.dart';
import 'package:dealos_mobile/features/quotations/presentation/quotations_screen.dart';
import 'package:dealos_mobile/features/workspace/domain/models.dart';
import 'package:dealos_mobile/features/workspace/presentation/app_shell.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';

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

    expect(find.text('My quotations'), findsWidgets);
    expect(find.text('Invoices'), findsWidgets);
    expect(find.text('Messages'), findsWidgets);
    expect(find.text('Profile'), findsWidgets);
    expect(find.text('Plans'), findsNothing);
    expect(find.text('Approvals'), findsNothing);
    expect(find.text('Products'), findsNothing);
  });

  testWidgets('login exposes the website customer invitation doorway', (
    tester,
  ) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          sessionControllerProvider.overrideWith(
            () => StubSessionController(
              const SessionState(status: SessionStatus.unauthenticated),
            ),
          ),
        ],
        child: const MaterialApp(home: LoginScreen()),
      ),
    );

    await tester.tap(find.text('Customer portal'));
    await tester.pump();

    expect(find.text('SECURE DEAL ROOM'), findsOneWidget);
    expect(find.text('Invited email address'), findsOneWidget);
    expect(find.text('Password'), findsNothing);
    expect(find.text('Continue with Google'), findsOneWidget);
    expect(find.text('Email ID must match the invitation'), findsOneWidget);
    expect(find.byTooltip('Back to login options'), findsOneWidget);

    await tester.enterText(find.byType(TextFormField), 'buyer@vertex.test');
    await tester.pump();
    final button = tester.widget<FilledButton>(
      find.ancestor(
        of: find.text('Continue with Google'),
        matching: find.byType(FilledButton),
      ),
    );
    expect(button.onPressed, isNotNull);

    await tester.tap(find.byTooltip('Back to login options'));
    await tester.pump();
    expect(find.text('SECURE DEAL ROOM'), findsNothing);
    expect(find.text('Your deals, moving forward.'), findsOneWidget);
    expect(find.text('Password'), findsOneWidget);
    expect(find.text('Customer portal'), findsOneWidget);
  });

  testWidgets('customer messages and profile mirror website portal modules', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(430, 1000));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    final workspace = fixtureWorkspace(role: 'CUSTOMER', modules: const []);
    await tester.pumpWidget(
      appFor(workspace, CustomerMessagesScreen(workspace: workspace)),
    );
    await tester.pumpAndSettle();

    expect(find.text('Ravi Rep'), findsOneWidget);
    expect(
      find.text('The revised commercial terms are ready to review.'),
      findsOneWidget,
    );

    await tester.pumpWidget(
      appFor(workspace, ProfileScreen(workspace: workspace)),
    );
    await tester.pumpAndSettle();
    expect(find.text('Verified customer'), findsOneWidget);
    expect(find.text('Google verified'), findsOneWidget);
    expect(find.text('buyer@vertex.test'), findsOneWidget);
    expect(find.text('Sign out'), findsOneWidget);

    await tester.tap(find.text('Sign out'));
    await tester.pumpAndSettle();
    expect(find.text('Sign out?'), findsOneWidget);
    expect(find.text('Cancel'), findsOneWidget);
    await tester.tap(find.text('Cancel'));
    await tester.pumpAndSettle();
    expect(find.text('Sign out?'), findsNothing);
  });

  testWidgets('customer invoice follows website actions', (tester) async {
    final workspace = fixtureWorkspace(role: 'CUSTOMER', modules: const []);
    await tester.pumpWidget(
      appFor(
        workspace,
        InvoiceDetailScreen(
          workspace: workspace,
          invoice: workspace.invoices.single,
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Download PDF'), findsOneWidget);
    expect(find.text('Request due-date change'), findsOneWidget);
    expect(find.text('Pay now'), findsNothing);
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
    expect(find.byType(PopupMenuButton<String>), findsNothing);
    addTearDown(() => tester.binding.setSurfaceSize(null));
  });

  testWidgets('organization roles get profile and sign out as the final tab', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(430, 1000));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    final workspace = fixtureWorkspace();
    await tester.pumpWidget(
      appFor(workspace, DealOsShell(workspace: workspace, section: 'profile')),
    );
    await tester.pumpAndSettle();

    expect(find.text('Your profile'), findsOneWidget);
    expect(find.text('Manager'), findsOneWidget);
    expect(find.text('Sign out'), findsOneWidget);
    final navigationBar = tester.widget<NavigationBar>(
      find.byType(NavigationBar),
    );
    expect(
      (navigationBar.destinations.last as NavigationDestination).label,
      'Profile',
    );
  });

  testWidgets(
    'approval detail distinguishes the step from the deciding admin',
    (tester) async {
      final workspace = fixtureWorkspace(role: 'ADMIN');
      final quote = Quote.fromJson(const {
        'id': 'quote-1',
        'number': 'Q-1001',
        'customer': 'Vertex Systems',
        'customerTier': 'Gold',
        'stage': 'REJECTED',
        'version': 2,
        'total': '147500',
        'riskScore': '4',
        'lines': [],
        'approvals': [
          {
            'id': 'approval-1',
            'step': 'Sales Manager',
            'sequence': 1,
            'state': 'REJECTED',
            'reason': 'Pricing exception',
            'reviewerId': 'admin-1',
            'reviewer': {
              'id': 'admin-1',
              'name': 'Asha Admin',
              'role': 'ADMIN',
            },
          },
        ],
        'negotiation': [],
      });
      await tester.pumpWidget(
        appFor(
          workspace,
          ApprovalDetailScreen(workspace: workspace, quote: quote),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('1. Sales Manager review'), findsOneWidget);
      expect(
        find.textContaining('Rejected by Asha Admin (Admin)'),
        findsOneWidget,
      );
      expect(find.text('Rejected'), findsWidgets);
      expect(find.text('Pending Approval'), findsNothing);
    },
  );

  testWidgets('quote back button returns to the page that opened it', (
    tester,
  ) async {
    final workspace = fixtureWorkspace();
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          sessionControllerProvider.overrideWith(
            () => StubSessionController(
              SessionState(
                status: SessionStatus.authenticated,
                workspace: workspace,
              ),
            ),
          ),
        ],
        child: const DealOsApp(),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Team performance'), findsOneWidget);
    final shellContext = tester.element(find.byType(DealOsShell));
    GoRouter.of(shellContext).push('/workspace/quotations');
    await tester.pumpAndSettle();
    await tester.tap(find.text('Q-1001'));
    await tester.pumpAndSettle();

    expect(find.text('Q-1001'), findsWidgets);
    expect(find.text('Record unavailable'), findsNothing);

    await tester.tap(find.byType(BackButton));
    await tester.pumpAndSettle();

    expect(find.text('Quotations'), findsOneWidget);
    expect(find.byType(QuoteDetailScreen), findsNothing);
  });

  testWidgets('direct quote link back button falls back to quotations', (
    tester,
  ) async {
    final workspace = fixtureWorkspace();
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          sessionControllerProvider.overrideWith(
            () => StubSessionController(
              SessionState(
                status: SessionStatus.authenticated,
                workspace: workspace,
              ),
            ),
          ),
        ],
        child: const DealOsApp(),
      ),
    );
    await tester.pumpAndSettle();

    final shellContext = tester.element(find.byType(DealOsShell));
    GoRouter.of(shellContext).go('/quote/quote-1');
    await tester.pumpAndSettle();
    await tester.tap(find.byType(BackButton));
    await tester.pumpAndSettle();

    expect(find.text('Quotations'), findsOneWidget);
    expect(find.byType(QuoteDetailScreen), findsNothing);
  });
}
