import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../app/providers.dart';
import '../../../core/utils/formatters.dart';
import '../../../core/widgets/common.dart';
import '../../workspace/domain/models.dart';

class ApprovalsScreen extends StatelessWidget {
  const ApprovalsScreen({super.key, required this.workspace});
  final Workspace workspace;
  @override
  Widget build(BuildContext context) {
    final quotes = workspace.quotes
        .where((quote) => quote.approvals.isNotEmpty)
        .toList();
    return ListView(
      padding: const EdgeInsets.all(20),
      children: [
        const SectionHeader(
          title: 'Approval inbox',
          subtitle: 'Revision-bound Manager and Finance decisions.',
        ),
        ...quotes.map((quote) {
          final current = quote.pendingApproval;
          return Padding(
            padding: const EdgeInsets.only(bottom: 10),
            child: Card(
              child: ListTile(
                contentPadding: const EdgeInsets.all(16),
                leading: const CircleAvatar(
                  child: Icon(Icons.approval_outlined),
                ),
                title: Text(
                  '${quote.number} · ${quote.customer}',
                  style: const TextStyle(fontWeight: FontWeight.w800),
                ),
                subtitle: Text(
                  '${money(quote.total)} · risk ${quote.riskScore.toStringAsFixed(1)}\n${current == null ? 'Review complete' : 'Current: ${current.step}'}',
                ),
                isThreeLine: true,
                trailing: StatusPill(current?.state ?? quote.stage),
                onTap: () => context.push('/approval/${quote.id}'),
              ),
            ),
          );
        }),
        if (quotes.isEmpty)
          const EmptyState(
            icon: Icons.approval_outlined,
            title: 'Inbox clear',
            message: 'No approval cases are visible in your current scope.',
          ),
      ],
    );
  }
}

class ApprovalDetailScreen extends ConsumerStatefulWidget {
  const ApprovalDetailScreen({
    super.key,
    required this.workspace,
    required this.quote,
  });
  final Workspace workspace;
  final Quote quote;
  @override
  ConsumerState<ApprovalDetailScreen> createState() =>
      _ApprovalDetailScreenState();
}

class _ApprovalDetailScreenState extends ConsumerState<ApprovalDetailScreen> {
  final reason = TextEditingController();
  @override
  Widget build(BuildContext context) {
    final quote = widget.quote;
    final current = quote.pendingApproval;
    final role = widget.workspace.user.role;
    final allowed =
        current != null &&
        (role == 'ADMIN' ||
            (current.step == 'Sales Manager' && role == 'MANAGER') ||
            (current.step == 'Finance' && role == 'FINANCE'));
    return Scaffold(
      appBar: AppBar(
        leading: const ContextualBackButton(
          fallbackLocation: '/workspace/approvals',
        ),
        title: Text('Review ${quote.number}'),
      ),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    StatusPill(quote.stage),
                    const SizedBox(height: 8),
                    Text(
                      quote.customer,
                      style: Theme.of(context).textTheme.headlineSmall
                          ?.copyWith(fontWeight: FontWeight.w900),
                    ),
                    Text('${money(quote.total)} · revision ${quote.version}'),
                  ],
                ),
              ),
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Text(
                    '${quote.riskScore.toStringAsFixed(1)} pts',
                    style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                  const Text('risk excess'),
                ],
              ),
            ],
          ),
          const SizedBox(height: 18),
          Text(
            'Why this quote was flagged',
            style: Theme.of(
              context,
            ).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: 10),
          ...quote.lines.map((line) {
            final excess = line.discount - line.allowedDiscount;
            return Card(
              child: ListTile(
                title: Text(line.product.name),
                subtitle: Text(
                  '${line.discount}% discount · ${line.allowedDiscount}% policy ceiling',
                ),
                trailing: StatusPill(
                  excess > 0
                      ? '${excess.toStringAsFixed(1)}_PTS_OVER'
                      : 'APPROVED',
                ),
              ),
            );
          }),
          const SizedBox(height: 18),
          Text(
            'Approval chain',
            style: Theme.of(
              context,
            ).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: 10),
          ...quote.approvals.map(
            (approval) => Card(
              child: ListTile(
                leading: Icon(
                  approval.state == 'APPROVED'
                      ? Icons.check_circle
                      : Icons.radio_button_unchecked,
                ),
                title: Text('${approval.sequence}. ${approval.step} review'),
                subtitle: Text(
                  '${approval.decisionSummary}${approval.reason == null ? '' : '\n${approval.reason}'}',
                ),
                isThreeLine: approval.reason != null,
                trailing: StatusPill(approval.state),
              ),
            ),
          ),
          const SizedBox(height: 18),
          TextField(
            controller: reason,
            minLines: 3,
            maxLines: 5,
            decoration: const InputDecoration(
              labelText: 'Decision reason',
              helperText:
                  'Required for every decision; explain returns and rejections clearly.',
            ),
          ),
          const SizedBox(height: 12),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              FilledButton.icon(
                onPressed: allowed ? () => _decide('APPROVE') : null,
                icon: const Icon(Icons.check),
                label: const Text('Approve'),
              ),
              OutlinedButton.icon(
                onPressed: allowed ? () => _decide('RETURN') : null,
                icon: const Icon(Icons.undo),
                label: const Text('Return'),
              ),
              OutlinedButton.icon(
                onPressed: allowed ? () => _decide('REJECT') : null,
                icon: const Icon(Icons.close),
                label: const Text('Reject'),
              ),
            ],
          ),
          if (!allowed)
            const Padding(
              padding: EdgeInsets.only(top: 12),
              child: Text(
                'This approval step is not assigned to your role, or no decision is pending.',
              ),
            ),
        ],
      ),
    );
  }

  Future<void> _decide(String decision) async {
    if (reason.text.trim().length < 5) return;
    final approval = widget.quote.pendingApproval;
    if (approval == null) return;
    await ref.read(sessionControllerProvider.notifier).mutate(
      '/approvals/${approval.id}/decision',
      {'decision': decision, 'reason': reason.text.trim()},
      notice: 'Approval decision recorded.',
    );
    if (mounted) {
      returnToSource(context, fallbackLocation: '/workspace/approvals');
    }
  }
}
