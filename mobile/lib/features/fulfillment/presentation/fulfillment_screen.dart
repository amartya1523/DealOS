import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../app/providers.dart';
import '../../../core/api/api_client.dart';
import '../../../core/utils/formatters.dart';
import '../../../core/widgets/common.dart';
import '../../workspace/domain/models.dart';

class FulfillmentScreen extends ConsumerWidget {
  const FulfillmentScreen({super.key, required this.workspace});
  final Workspace workspace;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final orders = workspace.quotes
        .where((quote) => quote.stage == 'CONFIRMED')
        .toList();
    return ListView(
      padding: const EdgeInsets.all(20),
      children: [
        const SectionHeader(
          title: 'Fulfillment',
          subtitle:
              'Confirmed orders, live stock, reservations and warehouse allocations.',
        ),
        Text(
          'Awaiting fulfillment',
          style: Theme.of(
            context,
          ).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w800),
        ),
        const SizedBox(height: 10),
        ...orders.map(
          (quote) => Card(
            child: ListTile(
              contentPadding: const EdgeInsets.all(16),
              leading: const Icon(Icons.local_shipping_outlined),
              title: Text(
                '${quote.order?['number'] ?? quote.number} · ${quote.customer}',
              ),
              subtitle: Text(
                '${quote.lines.where((line) => !line.product.recurring).fold<int>(0, (sum, line) => sum + line.quantity)} physical units',
              ),
              trailing: StatusPill(
                '${quote.fulfillment?['state'] ?? 'SPLIT_PENDING'}',
              ),
              onTap: () => context.push('/fulfillment/${quote.id}'),
            ),
          ),
        ),
        if (orders.isEmpty)
          const EmptyState(
            icon: Icons.local_shipping_outlined,
            title: 'No confirmed orders',
            message:
                'Fulfillment becomes available only after the approved revision is confirmed.',
          ),
        const SizedBox(height: 22),
        Text(
          'Warehouse stock',
          style: Theme.of(
            context,
          ).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w800),
        ),
        const SizedBox(height: 10),
        ...workspace.warehouses.map(
          (warehouse) => Card(
            child: ExpansionTile(
              leading: const Icon(Icons.warehouse_outlined),
              title: Text(warehouse.name),
              subtitle: Text(
                'Priority ${warehouse.priority} · shipping ${money(warehouse.shippingCost)}',
              ),
              trailing: StatusPill(warehouse.active ? 'ACTIVE' : 'DISABLED'),
              children: warehouse.stocks
                  .map<Widget>(
                    (stock) => ListTile(
                      title: Text(stock.product.name),
                      subtitle: Text(
                        'On hand ${stock.onHand} · reserved ${stock.reserved}',
                      ),
                      trailing: Text(
                        '${stock.available} available',
                        style: const TextStyle(fontWeight: FontWeight.w800),
                      ),
                    ),
                  )
                  .followedBy([
                    if (['FINANCE', 'ADMIN'].contains(workspace.user.role))
                      Padding(
                        padding: const EdgeInsets.all(12),
                        child: OutlinedButton.icon(
                          onPressed: () => showDialog<void>(
                            context: context,
                            builder: (_) => WarehouseActionsDialog(
                              workspace: workspace,
                              warehouse: warehouse,
                            ),
                          ),
                          icon: const Icon(Icons.settings_outlined),
                          label: Text(
                            workspace.user.role == 'ADMIN'
                                ? 'Settings & stock receipt'
                                : 'Receive stock',
                          ),
                        ),
                      ),
                  ])
                  .toList(),
            ),
          ),
        ),
      ],
    );
  }
}

class WarehouseActionsDialog extends ConsumerStatefulWidget {
  const WarehouseActionsDialog({
    super.key,
    required this.workspace,
    required this.warehouse,
  });
  final Workspace workspace;
  final Warehouse warehouse;
  @override
  ConsumerState<WarehouseActionsDialog> createState() =>
      _WarehouseActionsDialogState();
}

class _WarehouseActionsDialogState
    extends ConsumerState<WarehouseActionsDialog> {
  late final name = TextEditingController(text: widget.warehouse.name),
      priority = TextEditingController(text: '${widget.warehouse.priority}'),
      shipping = TextEditingController(
        text: '${widget.warehouse.shippingCost}',
      ),
      quantity = TextEditingController(),
      reason = TextEditingController();
  late bool active = widget.warehouse.active;
  String? productId;
  @override
  Widget build(BuildContext context) {
    final products = widget.workspace.products
        .where((product) => product.category == 'Hardware' && product.active)
        .toList();
    productId ??= products.firstOrNull?.id;
    return AlertDialog(
      title: Text(widget.warehouse.name),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (widget.workspace.user.role == 'ADMIN') ...[
              TextField(
                controller: name,
                decoration: const InputDecoration(labelText: 'Warehouse name'),
              ),
              const SizedBox(height: 10),
              TextField(
                controller: priority,
                keyboardType: TextInputType.number,
                decoration: const InputDecoration(labelText: 'Priority'),
              ),
              const SizedBox(height: 10),
              TextField(
                controller: shipping,
                keyboardType: TextInputType.number,
                decoration: const InputDecoration(labelText: 'Shipping cost'),
              ),
              SwitchListTile(
                title: const Text('Active'),
                value: active,
                onChanged: (value) => setState(() => active = value),
              ),
            ],
            DropdownButtonFormField<String>(
              initialValue: productId,
              decoration: const InputDecoration(labelText: 'Hardware product'),
              items: products
                  .map(
                    (product) => DropdownMenuItem(
                      value: product.id,
                      child: Text(product.name),
                    ),
                  )
                  .toList(),
              onChanged: (value) => setState(() => productId = value),
            ),
            const SizedBox(height: 10),
            TextField(
              controller: quantity,
              keyboardType: TextInputType.number,
              decoration: const InputDecoration(labelText: 'Received quantity'),
            ),
            const SizedBox(height: 10),
            TextField(
              controller: reason,
              minLines: 2,
              maxLines: 3,
              decoration: const InputDecoration(labelText: 'Reason'),
            ),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: const Text('Close'),
        ),
        if (widget.workspace.user.role == 'ADMIN')
          OutlinedButton(
            onPressed: _saveSettings,
            child: const Text('Save settings'),
          ),
        FilledButton(onPressed: _receive, child: const Text('Receive stock')),
      ],
    );
  }

  Future<void> _saveSettings() async {
    if (reason.text.trim().length < 5) return;
    final ok = await ref
        .read(sessionControllerProvider.notifier)
        .mutate(
          '/warehouses/${widget.warehouse.id}',
          {
            'name': name.text.trim(),
            'priority':
                int.tryParse(priority.text) ?? widget.warehouse.priority,
            'shippingCost':
                double.tryParse(shipping.text) ?? widget.warehouse.shippingCost,
            'active': active,
            'reason': reason.text.trim(),
          },
          method: 'PATCH',
          notice: 'Warehouse settings updated.',
        );
    if (ok && mounted) Navigator.pop(context);
  }

  Future<void> _receive() async {
    final count = int.tryParse(quantity.text) ?? 0;
    if (productId == null || count <= 0 || reason.text.trim().length < 5) {
      return;
    }
    final ok = await ref.read(sessionControllerProvider.notifier).mutate(
      '/warehouses/${widget.warehouse.id}/restock',
      {'productId': productId, 'quantity': count, 'reason': reason.text.trim()},
      notice: 'Stock receipt recorded.',
    );
    if (ok && mounted) Navigator.pop(context);
  }
}

class FulfillmentDetailScreen extends ConsumerStatefulWidget {
  const FulfillmentDetailScreen({
    super.key,
    required this.workspace,
    required this.quote,
  });
  final Workspace workspace;
  final Quote quote;

  @override
  ConsumerState<FulfillmentDetailScreen> createState() =>
      _FulfillmentDetailScreenState();
}

class _FulfillmentDetailScreenState
    extends ConsumerState<FulfillmentDetailScreen> {
  late Future<JsonMap> future;

  @override
  void initState() {
    super.initState();
    future = _load();
  }

  Future<JsonMap> _load() => ref
      .read(workspaceRepositoryProvider)
      .loadFulfillment(
        widget.quote.id,
        preview: widget.quote.fulfillment == null,
      );

  @override
  Widget build(BuildContext context) {
    final canManage =
        ['FINANCE', 'ADMIN'].contains(widget.workspace.user.role) &&
        !widget.workspace.user.readOnlyView;
    return Scaffold(
      appBar: AppBar(
        leading: const ContextualBackButton(
          fallbackLocation: '/workspace/fulfillment',
        ),
        title: Text('Fulfillment ${widget.quote.number}'),
      ),
      body: FutureBuilder<JsonMap>(
        future: future,
        builder: (context, snapshot) {
          if (snapshot.connectionState != ConnectionState.done) {
            return const Center(child: CircularProgressIndicator());
          }
          if (snapshot.hasError) {
            return EmptyState(
              icon: Icons.error_outline,
              title: 'Could not load fulfillment',
              message: '${snapshot.error}',
              action: FilledButton(
                onPressed: () => setState(() => future = _load()),
                child: const Text('Retry'),
              ),
            );
          }
          final data = snapshot.data ?? const {};
          final split = data['split'] is Map
              ? Map<String, dynamic>.from(data['split'] as Map)
              : const <String, dynamic>{};
          final rows = (split['split'] as List? ?? const [])
              .whereType<Map>()
              .map((item) => Map<String, dynamic>.from(item))
              .toList();
          final backorders = (split['backorders'] as List? ?? const [])
              .whereType<Map>()
              .map((item) => Map<String, dynamic>.from(item))
              .toList();
          return ListView(
            padding: const EdgeInsets.all(20),
            children: [
              SectionHeader(
                title: widget.quote.customer,
                subtitle:
                    '${widget.quote.order?['number'] ?? widget.quote.number} · server-calculated warehouse plan',
              ),
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Row(
                    children: [
                      Expanded(
                        child: _FulfillmentFact(
                          'State',
                          '${data['state'] ?? 'SPLIT_PENDING'}',
                        ),
                      ),
                      Expanded(
                        child: _FulfillmentFact(
                          'Shipments',
                          '${data['shipmentCount'] ?? rows.length}',
                        ),
                      ),
                      Expanded(
                        child: _FulfillmentFact(
                          'Estimated cost',
                          money(data['estimatedCost']),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 18),
              Text(
                'Warehouse allocation',
                style: Theme.of(
                  context,
                ).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w800),
              ),
              const SizedBox(height: 10),
              ...rows.map(
                (row) => Card(
                  child: ListTile(
                    leading: const Icon(Icons.warehouse_outlined),
                    title: Text('${row['warehouseName'] ?? 'Warehouse'}'),
                    subtitle: Text('Product ${row['productId'] ?? ''}'),
                    trailing: Text(
                      '${row['quantity'] ?? 0} units',
                      style: const TextStyle(fontWeight: FontWeight.w800),
                    ),
                  ),
                ),
              ),
              if (rows.isEmpty)
                const EmptyState(
                  icon: Icons.inventory_2_outlined,
                  title: 'No stock allocation',
                  message:
                      'No physical stock is available for this confirmed order.',
                ),
              if (backorders.isNotEmpty) ...[
                const SizedBox(height: 18),
                Text(
                  'Backorders',
                  style: Theme.of(
                    context,
                  ).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w800),
                ),
                ...backorders.map(
                  (row) => Card(
                    child: ListTile(
                      leading: const Icon(Icons.schedule),
                      title: Text('Product ${row['productId']}'),
                      trailing: Text('${row['quantity']} units'),
                    ),
                  ),
                ),
              ],
              const SizedBox(height: 18),
              if (widget.quote.fulfillment == null)
                Wrap(
                  spacing: 10,
                  runSpacing: 10,
                  children: [
                    FilledButton.icon(
                      onPressed: canManage ? () => _accept(data) : null,
                      icon: const Icon(Icons.check),
                      label: const Text('Accept suggested split'),
                    ),
                    OutlinedButton.icon(
                      onPressed: canManage ? _manual : null,
                      icon: const Icon(Icons.tune),
                      label: const Text('Manual override'),
                    ),
                  ],
                )
              else if (backorders.isNotEmpty)
                FilledButton.tonal(
                  onPressed: canManage ? _consolidate : null,
                  child: const Text('Consolidate remaining backorder'),
                ),
            ],
          );
        },
      ),
    );
  }

  Future<void> _accept(JsonMap data) async {
    final ok = await ref.read(sessionControllerProvider.notifier).mutate(
      '/fulfillment/${widget.quote.id}/allocate',
      {'stockFingerprint': data['stockFingerprint']},
      notice: 'Suggested warehouse split accepted.',
    );
    if (ok && mounted) {
      returnToSource(context, fallbackLocation: '/workspace/fulfillment');
    }
  }

  Future<void> _manual() async {
    final reason = await askForReason(
      context,
      title: 'Manual allocation override',
      action: 'Continue',
    );
    if (reason == null || !mounted) return;
    final allocations = <JsonMap>[];
    for (final line in widget.quote.lines.where(
      (line) => !line.product.recurring && line.product.category == 'Hardware',
    )) {
      for (final warehouse in widget.workspace.warehouses) {
        final stock = warehouse.stocks
            .where((item) => item.product.id == line.productId)
            .firstOrNull;
        if (stock != null && stock.available > 0) {
          allocations.add({
            'productId': line.productId,
            'warehouseId': warehouse.id,
            'quantity': line.quantity.clamp(1, stock.available),
          });
          break;
        }
      }
    }
    if (allocations.isEmpty) return;
    final ok = await ref.read(sessionControllerProvider.notifier).mutate(
      '/fulfillment/${widget.quote.id}/allocate-manual',
      {'allocations': allocations, 'reason': reason},
      notice: 'Manual allocation committed.',
    );
    if (ok && mounted) {
      returnToSource(context, fallbackLocation: '/workspace/fulfillment');
    }
  }

  Future<void> _consolidate() async {
    final reason = await askForReason(
      context,
      title: 'Consolidate backorder',
      action: 'Consolidate',
    );
    if (reason == null) return;
    final ok = await ref.read(sessionControllerProvider.notifier).mutate(
      '/fulfillment/${widget.quote.id}/consolidate-backorder',
      {'reason': reason},
      notice: 'Backorder consolidation committed.',
    );
    if (ok && mounted) {
      returnToSource(context, fallbackLocation: '/workspace/fulfillment');
    }
  }
}

class _FulfillmentFact extends StatelessWidget {
  const _FulfillmentFact(this.label, this.value);
  final String label;
  final String value;
  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Text(label, style: Theme.of(context).textTheme.labelSmall),
      Text(
        value,
        style: const TextStyle(fontWeight: FontWeight.w900),
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
      ),
    ],
  );
}
