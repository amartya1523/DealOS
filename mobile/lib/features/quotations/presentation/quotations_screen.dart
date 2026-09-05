import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../app/providers.dart';
import '../../../core/utils/formatters.dart';
import '../../../core/widgets/common.dart';
import '../../workspace/domain/models.dart';

class QuotationsScreen extends StatefulWidget {
  const QuotationsScreen({super.key, required this.workspace});
  final Workspace workspace;

  @override
  State<QuotationsScreen> createState() => _QuotationsScreenState();
}

class _QuotationsScreenState extends State<QuotationsScreen> {
  String query = '';
  String stage = 'ALL';

  @override
  Widget build(BuildContext context) {
    final quotes = widget.workspace.quotes.where((quote) {
      final matchesText = '${quote.number} ${quote.customer}'
          .toLowerCase()
          .contains(query.toLowerCase());
      return matchesText && (stage == 'ALL' || quote.stage == stage);
    }).toList();
    final canCreate =
        ['REP', 'ADMIN'].contains(widget.workspace.user.role) &&
        widget.workspace.user.hasModule('quotations');
    return ListView(
      padding: const EdgeInsets.all(20),
      children: [
        SectionHeader(
          title: widget.workspace.user.isCustomer
              ? 'My quotations'
              : 'Quotations',
          subtitle: widget.workspace.user.isCustomer
              ? 'Customer-visible commercial terms only.'
              : 'Drafts, approvals, negotiation and confirmed orders.',
          action: canCreate
              ? FilledButton.icon(
                  onPressed: () => showDialog<void>(
                    context: context,
                    builder: (_) =>
                        CreateQuoteDialog(workspace: widget.workspace),
                  ),
                  icon: const Icon(Icons.add),
                  label: const Text('Quote'),
                )
              : null,
        ),
        Row(
          children: [
            Expanded(
              child: TextField(
                decoration: const InputDecoration(
                  prefixIcon: Icon(Icons.search),
                  hintText: 'Search quotations',
                ),
                onChanged: (value) => setState(() => query = value),
              ),
            ),
            const SizedBox(width: 10),
            DropdownButton<String>(
              value: stage,
              items:
                  [
                        'ALL',
                        'DRAFT',
                        'PENDING_APPROVAL',
                        'APPROVED',
                        'NEGOTIATION',
                        'CONFIRMED',
                      ]
                      .map(
                        (value) => DropdownMenuItem(
                          value: value,
                          child: Text(label(value)),
                        ),
                      )
                      .toList(),
              onChanged: (value) => setState(() => stage = value ?? 'ALL'),
            ),
          ],
        ),
        const SizedBox(height: 14),
        if (quotes.isEmpty)
          const EmptyState(
            icon: Icons.description_outlined,
            title: 'No quotations',
            message: 'No authorized quotations match this view.',
          )
        else
          ...quotes.map(
            (quote) => Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: Card(
                child: InkWell(
                  borderRadius: BorderRadius.circular(16),
                  onTap: () => context.push('/quote/${quote.id}'),
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Row(
                      children: [
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Row(
                                children: [
                                  Text(
                                    quote.number,
                                    style: Theme.of(
                                      context,
                                    ).textTheme.labelMedium,
                                  ),
                                  const SizedBox(width: 8),
                                  StatusPill(quote.stage),
                                ],
                              ),
                              const SizedBox(height: 8),
                              Text(
                                quote.customer,
                                style: Theme.of(context).textTheme.titleMedium
                                    ?.copyWith(fontWeight: FontWeight.w800),
                              ),
                              const SizedBox(height: 4),
                              Text(
                                '${quote.customerTier} · ${quote.ownerName ?? 'Customer view'} · ${shortDate(quote.updatedAt)}',
                                style: Theme.of(context).textTheme.bodySmall,
                              ),
                            ],
                          ),
                        ),
                        const SizedBox(width: 12),
                        Column(
                          crossAxisAlignment: CrossAxisAlignment.end,
                          children: [
                            Text(
                              money(quote.total),
                              style: Theme.of(context).textTheme.titleMedium
                                  ?.copyWith(fontWeight: FontWeight.w900),
                            ),
                            if (!widget.workspace.user.isCustomer)
                              Text(
                                'Risk ${quote.riskScore.toStringAsFixed(0)}',
                                style: Theme.of(context).textTheme.bodySmall,
                              ),
                          ],
                        ),
                        const SizedBox(width: 6),
                        const Icon(Icons.chevron_right),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          ),
      ],
    );
  }
}

class CreateQuoteDialog extends ConsumerStatefulWidget {
  const CreateQuoteDialog({super.key, required this.workspace});
  final Workspace workspace;
  @override
  ConsumerState<CreateQuoteDialog> createState() => _CreateQuoteDialogState();
}

class _CreateQuoteDialogState extends ConsumerState<CreateQuoteDialog> {
  String? customerId;
  @override
  Widget build(BuildContext context) {
    final customers = widget.workspace.customers
        .where((customer) => customer.active)
        .toList();
    customerId ??= customers.firstOrNull?.id;
    final selected = customers
        .where((item) => item.id == customerId)
        .firstOrNull;
    return AlertDialog(
      title: const Text('New quotation'),
      content: DropdownButtonFormField<String>(
        initialValue: customerId,
        decoration: const InputDecoration(labelText: 'Customer'),
        items: customers
            .map(
              (customer) => DropdownMenuItem(
                value: customer.id,
                child: Text(customer.name),
              ),
            )
            .toList(),
        onChanged: (value) => setState(() => customerId = value),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: const Text('Cancel'),
        ),
        FilledButton(
          onPressed: selected == null
              ? null
              : () async {
                  final ok = await ref
                      .read(sessionControllerProvider.notifier)
                      .mutate('/quotations', {
                        'customer': selected.name,
                        'customerTier': selected.tier,
                      }, notice: 'Quotation draft created.');
                  if (ok && context.mounted) Navigator.pop(context);
                },
          child: const Text('Create draft'),
        ),
      ],
    );
  }
}

class QuoteDetailScreen extends ConsumerStatefulWidget {
  const QuoteDetailScreen({
    super.key,
    required this.workspace,
    required this.quote,
  });
  final Workspace workspace;
  final Quote quote;
  @override
  ConsumerState<QuoteDetailScreen> createState() => _QuoteDetailScreenState();
}

class _EditableLine {
  _EditableLine({
    required this.productId,
    required this.quantity,
    required this.discount,
  });
  String productId;
  int quantity;
  double discount;
}

class _QuoteDetailScreenState extends ConsumerState<QuoteDetailScreen> {
  late List<_EditableLine> lines;

  @override
  void initState() {
    super.initState();
    lines = widget.quote.lines
        .map(
          (line) => _EditableLine(
            productId: line.productId,
            quantity: line.quantity,
            discount: line.discount,
          ),
        )
        .toList();
  }

  @override
  Widget build(BuildContext context) {
    final quote = widget.quote;
    final actor = widget.workspace.user;
    final editable =
        quote.stage == 'DRAFT' &&
        ['REP', 'ADMIN'].contains(actor.role) &&
        !actor.readOnlyView;
    return Scaffold(
      appBar: AppBar(
        leading: const ContextualBackButton(
          fallbackLocation: '/workspace/quotations',
        ),
        title: Text(quote.number),
        actions: [
          IconButton(
            onPressed: () =>
                ref.read(sessionControllerProvider.notifier).refresh(),
            icon: const Icon(Icons.refresh),
            tooltip: 'Refresh',
          ),
        ],
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
                    Text('${quote.customerTier} · revision ${quote.version}'),
                  ],
                ),
              ),
              Text(
                money(quote.total),
                style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                  fontWeight: FontWeight.w900,
                ),
              ),
            ],
          ),
          if (!actor.isCustomer) ...[
            const SizedBox(height: 16),
            Card(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Row(
                  children: [
                    Expanded(
                      child: _Fact(label: 'Margin', value: money(quote.margin)),
                    ),
                    Expanded(
                      child: _Fact(
                        label: 'Risk excess',
                        value: '${quote.riskScore.toStringAsFixed(1)} pts',
                      ),
                    ),
                    Expanded(
                      child: _Fact(
                        label: 'Owner',
                        value: quote.ownerName ?? '—',
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ],
          const SizedBox(height: 18),
          Text(
            'Commercial lines',
            style: Theme.of(
              context,
            ).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: 10),
          ...lines.asMap().entries.map((entry) {
            final index = entry.key;
            final line = entry.value;
            final product =
                widget.workspace.products
                    .where((item) => item.id == line.productId)
                    .firstOrNull ??
                widget.quote.lines
                    .where((item) => item.productId == line.productId)
                    .firstOrNull
                    ?.product;
            if (product == null) return const SizedBox.shrink();
            final persisted = quote.lines
                .where((item) => item.productId == line.productId)
                .firstOrNull;
            return Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: Card(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  product.name,
                                  style: const TextStyle(
                                    fontWeight: FontWeight.w800,
                                  ),
                                ),
                                Text(
                                  '${product.sku} · ${product.category}',
                                  style: Theme.of(context).textTheme.bodySmall,
                                ),
                              ],
                            ),
                          ),
                          Text(money(product.price)),
                        ],
                      ),
                      const SizedBox(height: 12),
                      if (editable)
                        Row(
                          children: [
                            Expanded(
                              child: TextFormField(
                                initialValue: '${line.quantity}',
                                keyboardType: TextInputType.number,
                                decoration: const InputDecoration(
                                  labelText: 'Quantity',
                                ),
                                onChanged: (value) =>
                                    line.quantity = int.tryParse(value) ?? 1,
                              ),
                            ),
                            const SizedBox(width: 10),
                            Expanded(
                              child: TextFormField(
                                initialValue: '${line.discount}',
                                keyboardType: TextInputType.number,
                                decoration: const InputDecoration(
                                  labelText: 'Discount %',
                                ),
                                onChanged: (value) =>
                                    line.discount = double.tryParse(value) ?? 0,
                              ),
                            ),
                            IconButton(
                              onPressed: () =>
                                  setState(() => lines.removeAt(index)),
                              icon: const Icon(Icons.delete_outline),
                              tooltip: 'Remove line',
                            ),
                          ],
                        )
                      else
                        Row(
                          children: [
                            Expanded(
                              child: _Fact(
                                label: 'Quantity',
                                value: '${line.quantity}',
                              ),
                            ),
                            Expanded(
                              child: _Fact(
                                label: 'Discount',
                                value: '${line.discount}%',
                              ),
                            ),
                            if (!actor.isCustomer)
                              Expanded(
                                child: _Fact(
                                  label: 'Policy limit',
                                  value: '${persisted?.allowedDiscount ?? 0}%',
                                ),
                              ),
                          ],
                        ),
                      const SizedBox(height: 10),
                      Align(
                        alignment: Alignment.centerRight,
                        child: Text(
                          money(
                            product.price *
                                line.quantity *
                                (1 - line.discount / 100),
                          ),
                          style: const TextStyle(fontWeight: FontWeight.w900),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            );
          }),
          if (editable) ...[
            OutlinedButton.icon(
              onPressed: _addLine,
              icon: const Icon(Icons.add),
              label: const Text('Add product'),
            ),
            const SizedBox(height: 12),
            FilledButton.icon(
              onPressed: lines.isEmpty ? null : _saveDraft,
              icon: const Icon(Icons.save_outlined),
              label: const Text('Save draft'),
            ),
            const SizedBox(height: 8),
            FilledButton.tonalIcon(
              onPressed: lines.isEmpty ? null : _submit,
              icon: const Icon(Icons.send_outlined),
              label: const Text('Submit for approval'),
            ),
          ],
          if (quote.stage == 'APPROVED' &&
              ['REP', 'ADMIN'].contains(actor.role)) ...[
            const SizedBox(height: 12),
            FilledButton.icon(
              onPressed: () => ref
                  .read(sessionControllerProvider.notifier)
                  .mutate(
                    '/quotations/${quote.id}/send',
                    const {},
                    notice: 'Approved revision sent to the customer portal.',
                  ),
              icon: const Icon(Icons.send),
              label: const Text('Send to customer'),
            ),
          ],
          if (actor.isCustomer) ...[
            const SizedBox(height: 18),
            _CustomerNegotiation(workspace: widget.workspace, quote: quote),
          ],
          const SizedBox(height: 22),
          Text(
            'Activity & approvals',
            style: Theme.of(
              context,
            ).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: 10),
          ...quote.approvals.map(
            (approval) => Card(
              child: ListTile(
                leading: const Icon(Icons.approval_outlined),
                title: Text('${approval.step} review'),
                subtitle: Text(
                  '${approval.decisionSummary}${approval.reason == null ? '' : '\n${approval.reason}'}\n${shortDate(approval.decidedAt ?? approval.createdAt)}',
                ),
                isThreeLine: true,
                trailing: StatusPill(approval.state),
              ),
            ),
          ),
          ...quote.negotiation.map(
            (message) => Card(
              child: ListTile(
                leading: const Icon(Icons.forum_outlined),
                title: Text(message.author),
                subtitle: Text(
                  '${message.message}\n${shortDate(message.createdAt)}${message.counterDiscount == null ? '' : ' · ${message.counterDiscount}% proposed'}',
                ),
                isThreeLine: true,
                trailing:
                    !actor.isCustomer &&
                        message.kind == 'PROPOSAL' &&
                        (message.state == null || message.state == 'OPEN') &&
                        ['REP', 'ADMIN'].contains(actor.role)
                    ? IconButton(
                        onPressed: () => showDialog<void>(
                          context: context,
                          builder: (_) => ProposalResponseDialog(
                            quote: quote,
                            proposal: message,
                          ),
                        ),
                        icon: const Icon(Icons.rule),
                        tooltip: 'Respond to proposal',
                      )
                    : null,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Future<void> _addLine() async {
    final selected = await showDialog<Product>(
      context: context,
      builder: (context) => SimpleDialog(
        title: const Text('Add product'),
        children: widget.workspace.products
            .where(
              (product) =>
                  product.active &&
                  !lines.any((line) => line.productId == product.id),
            )
            .map(
              (product) => SimpleDialogOption(
                onPressed: () => Navigator.pop(context, product),
                child: ListTile(
                  title: Text(product.name),
                  subtitle: Text('${product.sku} · ${money(product.price)}'),
                ),
              ),
            )
            .toList(),
      ),
    );
    if (selected != null) {
      setState(
        () => lines.add(
          _EditableLine(productId: selected.id, quantity: 1, discount: 0),
        ),
      );
    }
  }

  Future<void> _saveDraft() => ref
      .read(sessionControllerProvider.notifier)
      .mutate(
        '/quotations/${widget.quote.id}/draft',
        {
          'version': widget.quote.version,
          'orderDiscount': widget.quote.orderDiscount,
          'lines': lines
              .map(
                (line) => {
                  'productId': line.productId,
                  'quantity': line.quantity,
                  'discount': line.discount,
                },
              )
              .toList(),
        },
        method: 'PUT',
        notice: 'Draft saved with server-calculated totals.',
      );

  Future<void> _submit() async {
    await _saveDraft();
    if (!mounted) return;
    await ref
        .read(sessionControllerProvider.notifier)
        .mutate(
          '/quotations/${widget.quote.id}/submit',
          const {},
          notice: 'Quotation submitted for approval.',
        );
  }
}

class _Fact extends StatelessWidget {
  const _Fact({required this.label, required this.value});
  final String label, value;
  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Text(label, style: Theme.of(context).textTheme.labelSmall),
      const SizedBox(height: 3),
      Text(
        value,
        style: const TextStyle(fontWeight: FontWeight.w800),
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
      ),
    ],
  );
}

class ProposalResponseDialog extends ConsumerStatefulWidget {
  const ProposalResponseDialog({
    super.key,
    required this.quote,
    required this.proposal,
  });
  final Quote quote;
  final NegotiationMessage proposal;
  @override
  ConsumerState<ProposalResponseDialog> createState() =>
      _ProposalResponseDialogState();
}

class _ProposalResponseDialogState
    extends ConsumerState<ProposalResponseDialog> {
  final reason = TextEditingController();
  @override
  Widget build(BuildContext context) => AlertDialog(
    title: const Text('Customer counteroffer'),
    content: Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(widget.proposal.message),
        if (widget.proposal.counterDiscount != null)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Text(
              '${widget.proposal.counterDiscount}% proposed',
              style: const TextStyle(fontWeight: FontWeight.w800),
            ),
          ),
        const SizedBox(height: 12),
        TextField(
          controller: reason,
          minLines: 2,
          maxLines: 4,
          decoration: const InputDecoration(labelText: 'Decision reason'),
        ),
      ],
    ),
    actions: [
      TextButton(
        onPressed: () => Navigator.pop(context),
        child: const Text('Close'),
      ),
      OutlinedButton(
        onPressed: () => _respond('DECLINE'),
        child: const Text('Decline'),
      ),
      FilledButton(
        onPressed: () => _respond('ADOPT'),
        child: const Text('Adopt as new revision'),
      ),
    ],
  );
  Future<void> _respond(String decision) async {
    if (reason.text.trim().length < 2) return;
    final ok = await ref.read(sessionControllerProvider.notifier).mutate(
      '/quotations/${widget.quote.id}/proposals/${widget.proposal.id}/respond',
      {'decision': decision, 'reason': reason.text.trim()},
      notice: decision == 'ADOPT'
          ? 'Counteroffer adopted as a new draft revision.'
          : 'Counteroffer declined.',
    );
    if (ok && mounted) Navigator.pop(context);
  }
}

class _CustomerNegotiation extends ConsumerStatefulWidget {
  const _CustomerNegotiation({required this.workspace, required this.quote});
  final Workspace workspace;
  final Quote quote;
  @override
  ConsumerState<_CustomerNegotiation> createState() =>
      _CustomerNegotiationState();
}

class _CustomerNegotiationState extends ConsumerState<_CustomerNegotiation> {
  final message = TextEditingController();
  final counter = TextEditingController();
  @override
  Widget build(BuildContext context) => Card(
    child: Padding(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            'Respond to this quotation',
            style: Theme.of(
              context,
            ).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: message,
            minLines: 2,
            maxLines: 4,
            decoration: const InputDecoration(
              labelText: 'Comment or change request',
            ),
          ),
          const SizedBox(height: 10),
          TextField(
            controller: counter,
            keyboardType: TextInputType.number,
            decoration: const InputDecoration(
              labelText: 'Counter discount % (optional)',
            ),
          ),
          const SizedBox(height: 12),
          OutlinedButton.icon(
            onPressed: () => _send(),
            icon: const Icon(Icons.forum_outlined),
            label: const Text('Submit request'),
          ),
          const SizedBox(height: 8),
          FilledButton.icon(
            onPressed: widget.quote.stage == 'APPROVED'
                ? () => ref
                      .read(sessionControllerProvider.notifier)
                      .mutate(
                        '/portal/quotations/${widget.quote.id}/confirm',
                        const {},
                        notice: 'Approved revision confirmed.',
                      )
                : null,
            icon: const Icon(Icons.check),
            label: const Text('Confirm approved revision'),
          ),
        ],
      ),
    ),
  );
  Future<void> _send() async {
    if (message.text.trim().isEmpty) return;
    final value = double.tryParse(counter.text);
    await ref.read(sessionControllerProvider.notifier).mutate(
      '/portal/quotations/${widget.quote.id}/message',
      {
        'message': message.text.trim(),
        if (value != null && value > 0) 'counterDiscount': value,
      },
      notice: value == null ? 'Comment posted.' : 'Counteroffer submitted.',
    );
  }
}
