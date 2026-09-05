import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../../core/theme/app_theme.dart';
import '../../../core/utils/formatters.dart';
import '../../../core/widgets/common.dart';
import '../domain/models.dart';

class DashboardScreen extends StatelessWidget {
  const DashboardScreen({super.key, required this.workspace});
  final Workspace workspace;

  @override
  Widget build(BuildContext context) {
    final openQuotes = workspace.quotes
        .where((quote) => quote.stage != 'CONFIRMED')
        .length;
    final pending = workspace.quotes
        .where((quote) => quote.pendingApproval != null)
        .length;
    final atRisk = workspace.alerts.where((alert) => !alert.resolved).length;
    final outstanding = workspace.invoices.fold<double>(
      0,
      (sum, invoice) => sum + invoice.outstanding,
    );
    final recent = workspace.quotes.take(5).toList();
    return ListView(
      padding: const EdgeInsets.all(20),
      children: [
        SectionHeader(
          title: _title(workspace.user),
          subtitle:
              'Live from ${workspace.organization?.name ?? 'your organization'} · synced ${shortDate(workspace.syncedAt)}',
          action:
              workspace.user.hasRole('REP') &&
                  workspace.user.hasModule('quotations')
              ? FilledButton.icon(
                  onPressed: () => context.push('/workspace/quotations'),
                  icon: const Icon(Icons.add),
                  label: const Text('New quote'),
                )
              : null,
        ),
        LayoutBuilder(
          builder: (context, constraints) => GridView.count(
            crossAxisCount: constraints.maxWidth >= 760 ? 4 : 2,
            mainAxisSpacing: 12,
            crossAxisSpacing: 12,
            mainAxisExtent: 132,
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            children: [
              MetricCard(
                label: 'Open quotations',
                value: '$openQuotes',
                icon: Icons.description_outlined,
              ),
              MetricCard(
                label: 'Pending approvals',
                value: '$pending',
                icon: Icons.approval_outlined,
                accent: DealOsColors.amber,
              ),
              MetricCard(
                label: 'Deal-health alerts',
                value: '$atRisk',
                icon: Icons.monitor_heart_outlined,
                accent: DealOsColors.coral,
              ),
              MetricCard(
                label: 'Outstanding',
                value: money(outstanding),
                icon: Icons.account_balance_wallet_outlined,
                accent: DealOsColors.green,
              ),
            ],
          ),
        ),
        const SizedBox(height: 28),
        SectionTitle(
          'Recent activity',
          action: recent.isEmpty
              ? null
              : TextButton(
                  onPressed: () => context.go('/workspace/quotations'),
                  child: const Text('View all'),
                ),
        ),
        if (recent.isEmpty)
          const Card(
            child: EmptyState(
              icon: Icons.auto_awesome_outlined,
              title: 'No deals yet',
              message: 'Your authorized quotations will appear here.',
            ),
          )
        else
          Card(
            child: Column(
              children: [
                for (var index = 0; index < recent.length; index++) ...[
                  ListTile(
                    leading: const IconBadge(
                      icon: Icons.description_outlined,
                      color: DealOsColors.coral,
                    ),
                    title: Text(recent[index].number),
                    subtitle: Text(
                      '${recent[index].customer} · ${money(recent[index].total)}\nUpdated ${shortDate(recent[index].updatedAt)}',
                    ),
                    isThreeLine: true,
                    trailing: StatusPill(recent[index].stage),
                    onTap: () => context.push('/quote/${recent[index].id}'),
                  ),
                  if (index != recent.length - 1)
                    const Divider(indent: 76, endIndent: 18),
                ],
              ],
            ),
          ),
        const SizedBox(height: 12),
      ],
    );
  }

  String _title(Actor actor) => switch (actor.role) {
    'REP' => 'Your sales workspace',
    'MANAGER' => 'Team performance',
    'FINANCE' => 'Finance & operations',
    'CUSTOMER' => 'Welcome back',
    _ => 'Organization overview',
  };
}
