import 'package:flutter/material.dart';

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

class CustomerProfileScreen extends StatelessWidget {
  const CustomerProfileScreen({super.key, required this.workspace});

  final Workspace workspace;

  @override
  Widget build(BuildContext context) {
    final actor = workspace.user;
    return ListView(
      padding: const EdgeInsets.all(20),
      children: [
        const SectionHeader(
          title: 'Your portal profile',
          subtitle:
              'This verified identity controls which documents you can access.',
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
                          const StatusPill('Verified customer'),
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
              ],
            ),
          ),
        ),
        const SizedBox(height: 14),
        Card(
          child: const Padding(
            padding: EdgeInsets.all(18),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Icon(Icons.shield_outlined),
                SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Your data is isolated',
                        style: TextStyle(fontWeight: FontWeight.w800),
                      ),
                      SizedBox(height: 4),
                      Text(
                        'Only records assigned to this customer identity and organization are returned by the server.',
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ],
    );
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
