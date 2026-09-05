import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../app/providers.dart';
import '../../../core/utils/formatters.dart';
import '../../../core/widgets/common.dart';
import '../../approvals/presentation/approvals_screen.dart';
import '../../billing/presentation/billing_screen.dart';
import '../../fulfillment/presentation/fulfillment_screen.dart';
import '../../quotations/presentation/quotations_screen.dart';
import '../domain/models.dart';
import 'dashboard_screen.dart';
import 'records_screens.dart';

class AppSection {
  const AppSection(this.id, this.label, this.icon);
  final String id;
  final String label;
  final IconData icon;
}

class DealOsShell extends ConsumerWidget {
  const DealOsShell({
    super.key,
    required this.workspace,
    required this.section,
  });
  final Workspace workspace;
  final String section;

  List<AppSection> get sections {
    final actor = workspace.user;
    if (actor.isCustomer) {
      return const [
        AppSection('quotations', 'Quotes', Icons.description_outlined),
        AppSection('invoices', 'Invoices', Icons.receipt_long_outlined),
        AppSection('subscriptions', 'Plans', Icons.autorenew),
      ];
    }
    final items = <AppSection>[];
    if (actor.hasModule('dashboard')) {
      items.add(
        const AppSection(
          'dashboard',
          'Overview',
          Icons.space_dashboard_outlined,
        ),
      );
    }
    if (actor.hasModule('quotations')) {
      items.add(
        const AppSection('quotations', 'Quotes', Icons.description_outlined),
      );
    }
    if (actor.hasModule('approvals')) {
      items.add(
        const AppSection('approvals', 'Approvals', Icons.approval_outlined),
      );
    }
    if (actor.hasModule('customers')) {
      items.add(
        const AppSection('customers', 'Customers', Icons.groups_outlined),
      );
    }
    if (actor.hasModule('products')) {
      items.add(
        const AppSection('products', 'Products', Icons.inventory_2_outlined),
      );
    }
    if (actor.hasModule('fulfillment')) {
      items.add(
        const AppSection(
          'fulfillment',
          'Fulfillment',
          Icons.local_shipping_outlined,
        ),
      );
    }
    if (actor.role == 'ADMIN') {
      items.add(
        const AppSection('subscriptions', 'Subscriptions', Icons.autorenew),
      );
    }
    if (actor.hasModule('invoices')) {
      items.add(
        const AppSection('invoices', 'Invoices', Icons.receipt_long_outlined),
      );
    }
    if (actor.hasModule('health')) {
      items.add(
        const AppSection('health', 'Deal health', Icons.monitor_heart_outlined),
      );
    }
    if (actor.hasModule('reports')) {
      items.add(
        const AppSection('reports', 'Reports', Icons.bar_chart_outlined),
      );
    }
    if (actor.hasModule('policies')) {
      items.add(
        const AppSection('policies', 'Policies', Icons.policy_outlined),
      );
    }
    if (actor.role == 'ADMIN') {
      items.add(
        const AppSection(
          'members',
          'Members',
          Icons.admin_panel_settings_outlined,
        ),
      );
    }
    if (actor.hasModule('reports') || actor.hasModule('health')) {
      items.add(const AppSection('audit', 'Audit', Icons.history));
    }
    return items;
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(sessionControllerProvider);
    final allSections = sections;
    final current = allSections.any((item) => item.id == section)
        ? section
        : allSections.firstOrNull?.id ?? 'dashboard';
    final large = MediaQuery.sizeOf(context).width >= 860;
    final primary = allSections.take(5).toList();
    final selectedPrimary = primary.indexWhere((item) => item.id == current);
    return Scaffold(
      appBar: AppBar(
        title: large
            ? const DealOsMark()
            : Text(
                allSections
                        .where((item) => item.id == current)
                        .firstOrNull
                        ?.label ??
                    'DealOS',
              ),
        actions: [
          if (workspace.organization != null)
            Center(
              child: Padding(
                padding: const EdgeInsets.only(right: 4),
                child: Chip(
                  avatar: const Icon(Icons.apartment, size: 16),
                  label: Text(workspace.organization!.name),
                ),
              ),
            ),
          IconButton(
            onPressed: state.busy
                ? null
                : () => ref.read(sessionControllerProvider.notifier).refresh(),
            icon: const Icon(Icons.refresh),
            tooltip: 'Refresh',
          ),
          PopupMenuButton<String>(
            tooltip: 'Account',
            onSelected: (value) {
              if (value == 'logout') {
                ref.read(sessionControllerProvider.notifier).logout();
              }
              if (value == 'exit-view') {
                ref.read(sessionControllerProvider.notifier).exitViewAs();
              }
            },
            itemBuilder: (_) => [
              PopupMenuItem(
                enabled: false,
                child: Text(
                  '${workspace.user.name}\n${label(workspace.user.role)}',
                  style: const TextStyle(fontWeight: FontWeight.w700),
                ),
              ),
              if (workspace.user.readOnlyView)
                const PopupMenuItem(
                  value: 'exit-view',
                  child: ListTile(
                    leading: Icon(Icons.exit_to_app),
                    title: Text('Exit View As'),
                  ),
                ),
              const PopupMenuItem(
                value: 'logout',
                child: ListTile(
                  leading: Icon(Icons.logout),
                  title: Text('Sign out'),
                ),
              ),
            ],
          ),
        ],
      ),
      drawer: large
          ? null
          : NavigationDrawer(
              selectedIndex: allSections.indexWhere(
                (item) => item.id == current,
              ),
              onDestinationSelected: (index) {
                Navigator.pop(context);
                context.go('/workspace/${allSections[index].id}');
              },
              children: [
                const Padding(
                  padding: EdgeInsets.fromLTRB(28, 20, 16, 16),
                  child: DealOsMark(),
                ),
                ...allSections.map(
                  (item) => NavigationDrawerDestination(
                    icon: Icon(item.icon),
                    label: Text(item.label),
                  ),
                ),
              ],
            ),
      body: Row(
        children: [
          if (large)
            NavigationRail(
              extended: MediaQuery.sizeOf(context).width >= 1180,
              selectedIndex: allSections.indexWhere(
                (item) => item.id == current,
              ),
              onDestinationSelected: (index) =>
                  context.go('/workspace/${allSections[index].id}'),
              destinations: allSections
                  .map(
                    (item) => NavigationRailDestination(
                      icon: Icon(item.icon),
                      label: Text(item.label),
                    ),
                  )
                  .toList(),
            ),
          Expanded(
            child: Column(
              children: [
                if (workspace.user.readOnlyView)
                  MaterialBanner(
                    leading: const Icon(Icons.visibility_outlined),
                    content: Text(
                      'Viewing ${workspace.user.viewContext?.organizationName ?? workspace.organization?.name} as read-only. Every write is blocked server-side.',
                    ),
                    actions: [
                      TextButton(
                        onPressed: () => ref
                            .read(sessionControllerProvider.notifier)
                            .exitViewAs(),
                        child: const Text('Exit'),
                      ),
                    ],
                  ),
                if (state.error != null)
                  ErrorBanner(
                    message: state.error!,
                    offline: state.offline,
                    onDismiss: () => ref
                        .read(sessionControllerProvider.notifier)
                        .dismissMessages(),
                  ),
                if (state.notice != null)
                  MaterialBanner(
                    leading: const Icon(Icons.check_circle_outline),
                    content: Text(state.notice!),
                    actions: [
                      TextButton(
                        onPressed: () => ref
                            .read(sessionControllerProvider.notifier)
                            .dismissMessages(),
                        child: const Text('Dismiss'),
                      ),
                    ],
                  ),
                if (state.busy) const LinearProgressIndicator(minHeight: 2),
                Expanded(child: _screen(current)),
              ],
            ),
          ),
        ],
      ),
      bottomNavigationBar: !large && primary.isNotEmpty
          ? NavigationBar(
              selectedIndex: selectedPrimary < 0 ? 0 : selectedPrimary,
              onDestinationSelected: (index) =>
                  context.go('/workspace/${primary[index].id}'),
              destinations: primary
                  .map(
                    (item) => NavigationDestination(
                      icon: Icon(item.icon),
                      label: item.label,
                    ),
                  )
                  .toList(),
            )
          : null,
    );
  }

  Widget _screen(String current) => switch (current) {
    'dashboard' => DashboardScreen(workspace: workspace),
    'quotations' => QuotationsScreen(workspace: workspace),
    'approvals' => ApprovalsScreen(workspace: workspace),
    'customers' => CustomersScreen(workspace: workspace),
    'products' => ProductsScreen(workspace: workspace),
    'fulfillment' => FulfillmentScreen(workspace: workspace),
    'subscriptions' => SubscriptionsScreen(workspace: workspace),
    'invoices' => InvoicesScreen(workspace: workspace),
    'health' => HealthScreen(workspace: workspace),
    'reports' => ReportsScreen(workspace: workspace),
    'policies' => PoliciesScreen(workspace: workspace),
    'members' => MembersScreen(workspace: workspace),
    'audit' => AuditScreen(workspace: workspace),
    _ => const EmptyState(
      icon: Icons.lock_outline,
      title: 'Not available',
      message: 'This destination is not authorized for your current role.',
    ),
  };
}
