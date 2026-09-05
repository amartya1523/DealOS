import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../core/theme/app_theme.dart';
import '../core/widgets/common.dart';
import '../features/administration/presentation/platform_admin_screen.dart';
import '../features/approvals/presentation/approvals_screen.dart';
import '../features/auth/application/session_controller.dart';
import '../features/auth/presentation/login_screen.dart';
import '../features/billing/presentation/billing_screen.dart';
import '../features/fulfillment/presentation/fulfillment_screen.dart';
import '../features/quotations/presentation/quotations_screen.dart';
import '../features/workspace/domain/models.dart';
import '../features/workspace/presentation/app_shell.dart';
import 'providers.dart';

class DealOsApp extends ConsumerStatefulWidget {
  const DealOsApp({super.key});
  @override
  ConsumerState<DealOsApp> createState() => _DealOsAppState();
}

class _DealOsAppState extends ConsumerState<DealOsApp>
    with WidgetsBindingObserver {
  late final GoRouter _router;
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _router = GoRouter(
      routes: [
        GoRoute(path: '/', builder: (context, state) => const _SessionGate()),
        GoRoute(
          path: '/workspace/:section',
          builder: (context, state) =>
              _SessionGate(section: state.pathParameters['section']),
        ),
        GoRoute(
          path: '/quote/:id',
          builder: (context, state) => _SessionGate(
            detail: _Detail.quote,
            id: state.pathParameters['id'],
          ),
        ),
        GoRoute(
          path: '/approval/:id',
          builder: (context, state) => _SessionGate(
            detail: _Detail.approval,
            id: state.pathParameters['id'],
          ),
        ),
        GoRoute(
          path: '/fulfillment/:id',
          builder: (context, state) => _SessionGate(
            detail: _Detail.fulfillment,
            id: state.pathParameters['id'],
          ),
        ),
        GoRoute(
          path: '/invoice/:id',
          builder: (context, state) => _SessionGate(
            detail: _Detail.invoice,
            id: state.pathParameters['id'],
          ),
        ),
      ],
      errorBuilder: (context, state) => const _SessionGate(),
    );
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _router.dispose();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed &&
        ref.read(sessionControllerProvider).status ==
            SessionStatus.authenticated) {
      ref.read(sessionControllerProvider.notifier).refresh();
    }
  }

  @override
  Widget build(BuildContext context) => MaterialApp.router(
    title: 'DealOS',
    debugShowCheckedModeBanner: false,
    theme: buildDealOsTheme(Brightness.light),
    darkTheme: buildDealOsTheme(Brightness.dark),
    themeMode: ThemeMode.system,
    routerConfig: _router,
  );
}

enum _Detail { quote, approval, fulfillment, invoice }

class _SessionGate extends ConsumerWidget {
  const _SessionGate({this.section, this.detail, this.id});
  final String? section, id;
  final _Detail? detail;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(sessionControllerProvider);
    if (state.status == SessionStatus.booting) {
      return const Scaffold(
        body: Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              DealOsMark(),
              SizedBox(height: 24),
              CircularProgressIndicator(),
              SizedBox(height: 12),
              Text('Restoring secure session…'),
            ],
          ),
        ),
      );
    }
    if (state.status == SessionStatus.unauthenticated ||
        state.workspace == null) {
      return const LoginScreen();
    }
    final workspace = state.workspace!;
    if (workspace.user.isPlatformOwner && workspace.organization == null) {
      final dashboard = state.platformDashboard;
      if (dashboard == null) {
        return Scaffold(
          body: EmptyState(
            icon: Icons.cloud_off,
            title: 'Platform data unavailable',
            message: state.error ?? 'Refresh when the server is available.',
            action: FilledButton(
              onPressed: () =>
                  ref.read(sessionControllerProvider.notifier).refresh(),
              child: const Text('Retry'),
            ),
          ),
        );
      }
      return PlatformAdminScreen(dashboard: dashboard, workspace: workspace);
    }
    if (detail != null) {
      return switch (detail!) {
        _Detail.quote =>
          _findQuote(workspace, id) == null
              ? _denied(context)
              : QuoteDetailScreen(
                  workspace: workspace,
                  quote: _findQuote(workspace, id)!,
                ),
        _Detail.approval =>
          _findQuote(workspace, id) == null ||
                  !workspace.user.hasModule('approvals')
              ? _denied(context)
              : ApprovalDetailScreen(
                  workspace: workspace,
                  quote: _findQuote(workspace, id)!,
                ),
        _Detail.fulfillment =>
          _findQuote(workspace, id) == null ||
                  !workspace.user.hasModule('fulfillment')
              ? _denied(context)
              : FulfillmentDetailScreen(
                  workspace: workspace,
                  quote: _findQuote(workspace, id)!,
                ),
        _Detail.invoice =>
          _findInvoice(workspace, id) == null
              ? _denied(context)
              : InvoiceDetailScreen(
                  workspace: workspace,
                  invoice: _findInvoice(workspace, id)!,
                ),
      };
    }
    final fallback = workspace.user.isCustomer ? 'quotations' : 'dashboard';
    return DealOsShell(workspace: workspace, section: section ?? fallback);
  }

  Quote? _findQuote(Workspace workspace, String? id) {
    if (id == null) return null;
    for (final quote in workspace.quotes) {
      if (quote.id == id) return quote;
    }
    return null;
  }

  Invoice? _findInvoice(Workspace workspace, String? id) {
    if (id == null) return null;
    for (final invoice in workspace.invoices) {
      if (invoice.id == id) return invoice;
    }
    return null;
  }

  Widget _denied(BuildContext context) => Scaffold(
    appBar: AppBar(leading: const ContextualBackButton(fallbackLocation: '/')),
    body: EmptyState(
      icon: Icons.lock_outline,
      title: 'Record unavailable',
      message: 'This record is outside your active organization or role scope.',
      action: FilledButton(
        onPressed: () => context.go('/'),
        child: const Text('Return to workspace'),
      ),
    ),
  );
}
