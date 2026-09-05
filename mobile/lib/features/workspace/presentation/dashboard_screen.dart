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
                  onPressed: () => context.go('/workspace/quotations'),
                  icon: const Icon(Icons.add),
                  label: const Text('New quote'),
                )
              : null,
        ),
        GridView.count(
          crossAxisCount: MediaQuery.sizeOf(context).width > 850 ? 4 : 2,
          childAspectRatio: MediaQuery.sizeOf(context).width > 500 ? 1.55 : 1.1,
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          mainAxisSpacing: 12,
          crossAxisSpacing: 12,
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
        const SizedBox(height: 24),
        Text(
          'Recent activity',
          style: Theme.of(
            context,
          ).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w800),
        ),
        const SizedBox(height: 12),
        if (recent.isEmpty)
          const Card(
            child: EmptyState(
              icon: Icons.auto_awesome_outlined,
              title: 'No deals yet',
              message: 'Your authorized quotations will appear here.',
            ),
          )
        else
          ...recent.map(
            (quote) => Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: Card(
                child: ListTile(
                  contentPadding: const EdgeInsets.symmetric(
                    horizontal: 18,
                    vertical: 8,
                  ),
                  leading: const CircleAvatar(
                    child: Icon(Icons.description_outlined),
                  ),
                  title: Text(
                    '${quote.number} · ${quote.customer}',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                  subtitle: Text(
                    '${money(quote.total)} · updated ${shortDate(quote.updatedAt)}',
                  ),
                  trailing: StatusPill(quote.stage),
                  onTap: () => context.go('/quote/${quote.id}'),
                ),
              ),
            ),
          ),
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
