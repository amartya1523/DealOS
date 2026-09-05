import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../../../core/utils/formatters.dart';
import '../../../core/widgets/common.dart';
import '../../workspace/domain/models.dart';

class CustomerMessagesScreen extends StatelessWidget {
  const CustomerMessagesScreen({super.key, required this.workspace});

  final Workspace workspace;

  @override
  Widget build(BuildContext context) {
    final messages =
        <({NegotiationMessage message, String quoteNumber})>[
          for (final quote in workspace.quotes)
            for (final message in quote.negotiation)
              (message: message, quoteNumber: quote.number),
        ]..sort(
          (a, b) => (b.message.createdAt ?? DateTime(1970)).compareTo(
            a.message.createdAt ?? DateTime(1970),
          ),
        );

    return ListView(
      padding: const EdgeInsets.all(20),
      children: [
        const SectionHeader(
          title: 'Messages',
          subtitle:
              'All quotation comments and negotiation updates stay synchronized here.',
        ),
        if (messages.isEmpty)
          const EmptyState(
            icon: Icons.forum_outlined,
            title: 'No messages yet',
            message: 'Your quotation conversations will be collected here.',
          ),
        ...messages.map(
          (item) => Card(
            margin: const EdgeInsets.only(bottom: 12),
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  CircleAvatar(
                    child: Text(
                      item.message.author.isEmpty
                          ? '?'
                          : item.message.author[0].toUpperCase(),
                    ),
                  ),
                  const SizedBox(width: 14),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          '${item.quoteNumber} · ${shortDate(item.message.createdAt)}',
                          style: Theme.of(context).textTheme.labelMedium
                              ?.copyWith(
                                color: Theme.of(
                                  context,
                                ).colorScheme.onSurfaceVariant,
                              ),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          item.message.author,
                          style: Theme.of(context).textTheme.titleMedium
                              ?.copyWith(fontWeight: FontWeight.w800),
                        ),
                        const SizedBox(height: 6),
                        Text(item.message.message),
                        if (item.message.counterDiscount != null) ...[
                          const SizedBox(height: 10),
                          StatusPill(
                            'Counter proposal: ${item.message.counterDiscount}% ',
                          ),
                        ],
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ],
    );
  }
}

class ProfileScreen extends ConsumerWidget {
  const ProfileScreen({super.key, required this.workspace});

  final Workspace workspace;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final actor = workspace.user;
    final isCustomer = actor.isCustomer;
    final session = ref.watch(sessionControllerProvider);
    return ListView(
      padding: const EdgeInsets.fromLTRB(20, 20, 20, 32),
      children: [
        SectionHeader(
          title: isCustomer ? 'Your portal profile' : 'Your profile',
          subtitle: isCustomer
              ? 'This verified identity controls which documents you can access.'
              : 'Your account, role and current workspace access.',
        ),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(20),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    CircleAvatar(
                      radius: 30,
                      child: Text(
                        actor.name.isEmpty ? '?' : actor.name[0].toUpperCase(),
                        style: Theme.of(context).textTheme.headlineSmall,
                      ),
                    ),
                    const SizedBox(width: 16),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          StatusPill(
                            isCustomer ? 'Verified customer' : 'Active account',
                          ),
                          const SizedBox(height: 8),
                          Text(
                            actor.name,
                            style: Theme.of(context).textTheme.headlineSmall
                                ?.copyWith(fontWeight: FontWeight.w900),
                          ),
                          Text(actor.email),
                        ],
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 24),
                _ProfileFact(
                  label: 'Organization',
                  value: workspace.organization?.name ?? 'DealOS',
                ),
                const Divider(height: 28),
                _ProfileFact(label: 'Role', value: label(actor.role)),
                if (isCustomer) ...[
                  const Divider(height: 28),
                  const _ProfileFact(
                    label: 'Portal access',
                    value: 'Google verified',
                  ),
                  const Divider(height: 28),
                  _ProfileFact(
                    label: 'Quotations shared',
                    value: '${workspace.quotes.length}',
                  ),
                  const Divider(height: 28),
                  _ProfileFact(
                    label: 'Invoices shared',
                    value: '${workspace.invoices.length}',
                  ),
                ] else ...[
                  const Divider(height: 28),
                  _ProfileFact(
                    label: 'Enabled modules',
                    value: actor.role == 'ADMIN'
                        ? 'All modules'
                        : '${actor.moduleAccess.length}',
                  ),
                ],
              ],
            ),
          ),
        ),
        const SizedBox(height: 14),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(18),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Icon(Icons.shield_outlined),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        isCustomer
                            ? 'Your data is isolated'
                            : 'Your access is role-based',
                        style: const TextStyle(fontWeight: FontWeight.w800),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        isCustomer
                            ? 'Only records assigned to this customer identity and organization are returned by the server.'
                            : 'DealOS limits modules and actions using your organization role and server-side permissions.',
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 28),
        OutlinedButton.icon(
          onPressed: session.busy ? null : () => _confirmSignOut(context, ref),
          icon: const Icon(Icons.logout_rounded),
          label: const Text('Sign out'),
          style: OutlinedButton.styleFrom(
            minimumSize: const Size.fromHeight(54),
            foregroundColor: Theme.of(context).colorScheme.error,
            side: BorderSide(
              color: Theme.of(context).colorScheme.error.withValues(alpha: .5),
            ),
          ),
        ),
      ],
    );
  }

  Future<void> _confirmSignOut(BuildContext context, WidgetRef ref) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Sign out?'),
        content: const Text(
          'You will need to sign in again to access your DealOS workspace.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(dialogContext, true),
            child: const Text('Sign out'),
          ),
        ],
      ),
    );
    if (confirmed == true) {
      await ref.read(sessionControllerProvider.notifier).logout();
    }
  }
}

class _ProfileFact extends StatelessWidget {
  const _ProfileFact({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) => Row(
    children: [
      Expanded(child: Text(label)),
      Text(value, style: const TextStyle(fontWeight: FontWeight.w800)),
    ],
  );
}
