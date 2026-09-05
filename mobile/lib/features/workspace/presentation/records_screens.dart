import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../../../core/utils/formatters.dart';
import '../../../core/widgets/common.dart';
import '../domain/models.dart';

class CustomersScreen extends StatefulWidget {
  const CustomersScreen({super.key, required this.workspace});
  final Workspace workspace;

  @override
  State<CustomersScreen> createState() => _CustomersScreenState();
}

class _CustomersScreenState extends State<CustomersScreen> {
  String query = '';
  @override
  Widget build(BuildContext context) {
    final items = widget.workspace.customers
        .where((item) => item.name.toLowerCase().contains(query.toLowerCase()))
        .toList();
    return ListView(
      padding: const EdgeInsets.all(20),
      children: [
        SectionHeader(
          title: 'Customers',
          subtitle: 'Authorized buying organizations and portal contacts.',
          action: widget.workspace.user.hasRole('MANAGER')
              ? FilledButton.icon(
                  onPressed: () => showDialog<void>(
                    context: context,
                    builder: (_) => const CreateCustomerDialog(),
                  ),
                  icon: const Icon(Icons.add),
                  label: const Text('Add'),
                )
              : null,
        ),
        TextField(
          decoration: const InputDecoration(
            prefixIcon: Icon(Icons.search),
            hintText: 'Search customers',
          ),
          onChanged: (value) => setState(() => query = value),
        ),
        const SizedBox(height: 14),
        if (items.isEmpty)
          const EmptyState(
            icon: Icons.groups_outlined,
            title: 'No customers found',
            message: 'Try a different search or add an authorized customer.',
          )
        else
          ...items.map(
            (customer) => Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: Card(
                child: ListTile(
                  contentPadding: const EdgeInsets.all(16),
                  leading: CircleAvatar(
                    child: Text(
                      customer.name.isEmpty
                          ? '?'
                          : customer.name[0].toUpperCase(),
                    ),
                  ),
                  title: Text(
                    customer.name,
                    style: const TextStyle(fontWeight: FontWeight.w700),
                  ),
                  subtitle: Text(
                    '${customer.tier} · ${customer.email ?? 'No portal email'}\n${customer.billingAddress ?? 'No billing address'}',
                  ),
                  isThreeLine: true,
                  trailing: StatusPill(customer.active ? 'ACTIVE' : 'DISABLED'),
                  onTap: widget.workspace.user.hasRole('MANAGER')
                      ? () => showDialog<void>(
                          context: context,
                          builder: (_) =>
                              CustomerActionsDialog(customer: customer),
                        )
                      : null,
                ),
              ),
            ),
          ),
      ],
    );
  }
}

class ProductsScreen extends StatefulWidget {
  const ProductsScreen({super.key, required this.workspace});
  final Workspace workspace;
  @override
  State<ProductsScreen> createState() => _ProductsScreenState();
}

class _ProductsScreenState extends State<ProductsScreen> {
  String query = '';
  @override
  Widget build(BuildContext context) {
    final products = widget.workspace.products
        .where(
          (item) => '${item.name} ${item.sku}'.toLowerCase().contains(
            query.toLowerCase(),
          ),
        )
        .toList();
    return ListView(
      padding: const EdgeInsets.all(20),
      children: [
        SectionHeader(
          title: 'Product catalogue',
          subtitle: 'Current server-authoritative prices, cost and stock.',
          action: widget.workspace.user.role == 'ADMIN'
              ? FilledButton.icon(
                  onPressed: () => showDialog<void>(
                    context: context,
                    builder: (_) => const CreateProductDialog(),
                  ),
                  icon: const Icon(Icons.add),
                  label: const Text('Product'),
                )
              : null,
        ),
        TextField(
          decoration: const InputDecoration(
            prefixIcon: Icon(Icons.search),
            hintText: 'Search name or SKU',
          ),
          onChanged: (value) => setState(() => query = value),
        ),
        const SizedBox(height: 14),
        ...products.map(
          (product) => Padding(
            padding: const EdgeInsets.only(bottom: 10),
            child: Card(
              child: ListTile(
                contentPadding: const EdgeInsets.all(16),
                leading: Icon(
                  product.recurring
                      ? Icons.autorenew
                      : Icons.inventory_2_outlined,
                ),
                title: Text(
                  product.name,
                  style: const TextStyle(fontWeight: FontWeight.w700),
                ),
                subtitle: Text(
                  '${product.sku} · ${product.category}\n${product.recurring ? '${product.cadence} recurring' : '${product.availableStock} available'}',
                ),
                isThreeLine: true,
                trailing: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    Text(
                      money(product.price),
                      style: const TextStyle(fontWeight: FontWeight.w800),
                    ),
                    Text(
                      'cost ${money(product.cost)}',
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                  ],
                ),
                onTap: widget.workspace.user.role == 'ADMIN'
                    ? () => showDialog<void>(
                        context: context,
                        builder: (_) => EditProductDialog(product: product),
                      )
                    : null,
              ),
            ),
          ),
        ),
        if (products.isEmpty)
          const EmptyState(
            icon: Icons.inventory_2_outlined,
            title: 'No products',
            message: 'No authorized catalogue items match your search.',
          ),
      ],
    );
  }
}

class SubscriptionsScreen extends ConsumerWidget {
  const SubscriptionsScreen({super.key, required this.workspace});
  final Workspace workspace;
  @override
  Widget build(BuildContext context, WidgetRef ref) => ListView(
    padding: const EdgeInsets.all(20),
    children: [
      const SectionHeader(
        title: 'Subscriptions',
        subtitle: 'Recurring obligations and upcoming billing dates.',
      ),
      ...workspace.subscriptions.map(
        (item) => Padding(
          padding: const EdgeInsets.only(bottom: 10),
          child: Card(
            child: ListTile(
              contentPadding: const EdgeInsets.all(16),
              leading: const Icon(Icons.autorenew),
              title: Text(
                '${item.customer} · ${item.productName}',
                style: const TextStyle(fontWeight: FontWeight.w700),
              ),
              subtitle: Text(
                '${item.cadence} · next bill ${shortDate(item.nextBillAt)}',
              ),
              trailing: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Text(
                    money(item.amount),
                    style: const TextStyle(fontWeight: FontWeight.w800),
                  ),
                  StatusPill(item.state),
                ],
              ),
              onTap: workspace.user.role == 'ADMIN'
                  ? () => showDialog<void>(
                      context: context,
                      builder: (_) =>
                          SubscriptionActionDialog(subscription: item),
                    )
                  : null,
            ),
          ),
        ),
      ),
      if (workspace.subscriptions.isEmpty)
        const EmptyState(
          icon: Icons.autorenew,
          title: 'No subscriptions',
          message:
              'Recurring obligations will appear here after an order is confirmed.',
        ),
    ],
  );
}

class HealthScreen extends ConsumerWidget {
  const HealthScreen({super.key, required this.workspace});
  final Workspace workspace;
  @override
  Widget build(BuildContext context, WidgetRef ref) => ListView(
    padding: const EdgeInsets.all(20),
    children: [
      const SectionHeader(
        title: 'Deal health',
        subtitle: 'Evidence-backed stalled, discount and delivery alerts.',
      ),
      ...workspace.alerts.map(
        (alert) => Padding(
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
                        child: Text(
                          alert.title,
                          style: const TextStyle(fontWeight: FontWeight.w800),
                        ),
                      ),
                      StatusPill(alert.resolved ? 'RESOLVED' : alert.severity),
                    ],
                  ),
                  const SizedBox(height: 8),
                  Text(alert.detail),
                  const SizedBox(height: 10),
                  Text(
                    shortDate(alert.createdAt),
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                  if (!alert.resolved)
                    Wrap(
                      spacing: 8,
                      children: [
                        OutlinedButton(
                          onPressed: () => ref
                              .read(sessionControllerProvider.notifier)
                              .mutate(
                                '/alerts/${alert.id}/nudge',
                                const {},
                                notice: 'Nudge recorded.',
                              ),
                          child: const Text('Nudge'),
                        ),
                        OutlinedButton(
                          onPressed: () => ref
                              .read(sessionControllerProvider.notifier)
                              .mutate(
                                '/alerts/${alert.id}/escalate',
                                const {},
                                notice: 'Alert escalated.',
                              ),
                          child: const Text('Escalate'),
                        ),
                        FilledButton(
                          onPressed: () => ref
                              .read(sessionControllerProvider.notifier)
                              .mutate(
                                '/alerts/${alert.id}/resolve',
                                const {},
                                notice: 'Alert resolved.',
                              ),
                          child: const Text('Resolve'),
                        ),
                      ],
                    ),
                ],
              ),
            ),
          ),
        ),
      ),
      if (workspace.alerts.isEmpty)
        const EmptyState(
          icon: Icons.monitor_heart_outlined,
          title: 'All clear',
          message: 'No deal-health alerts are visible in your scope.',
        ),
    ],
  );
}

class ReportsScreen extends StatelessWidget {
  const ReportsScreen({super.key, required this.workspace});
  final Workspace workspace;
  @override
  Widget build(BuildContext context) {
    final approved = workspace.quotes
        .where((quote) => ['APPROVED', 'CONFIRMED'].contains(quote.stage))
        .length;
    final revenue = workspace.quotes
        .where((quote) => quote.stage == 'CONFIRMED')
        .fold<double>(0, (sum, quote) => sum + quote.total);
    final margin = workspace.quotes.fold<double>(
      0,
      (sum, quote) => sum + quote.margin,
    );
    return ListView(
      padding: const EdgeInsets.all(20),
      children: [
        const SectionHeader(
          title: 'Reports',
          subtitle:
              'Authorized live workspace aggregates. Currencies are not combined by the mobile client.',
        ),
        GridView.count(
          crossAxisCount: MediaQuery.sizeOf(context).width > 700 ? 3 : 1,
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          childAspectRatio: 2,
          mainAxisSpacing: 10,
          crossAxisSpacing: 10,
          children: [
            MetricCard(
              label: 'Approved / confirmed',
              value: '$approved',
              icon: Icons.verified_outlined,
            ),
            MetricCard(
              label: 'Confirmed revenue (INR)',
              value: money(revenue),
              icon: Icons.trending_up,
            ),
            MetricCard(
              label: 'Quoted margin (INR)',
              value: money(margin),
              icon: Icons.stacked_line_chart,
            ),
          ],
        ),
        const SizedBox(height: 18),
        const Card(
          child: Padding(
            padding: EdgeInsets.all(18),
            child: Text(
              'The backend currently exposes reporting source records through /workspace, but not the documented filtered report/export endpoints. Mobile export controls remain intentionally absent until those contracts are implemented.',
            ),
          ),
        ),
      ],
    );
  }
}

class AuditScreen extends StatelessWidget {
  const AuditScreen({super.key, required this.workspace});
  final Workspace workspace;
  @override
  Widget build(BuildContext context) => ListView(
    padding: const EdgeInsets.all(20),
    children: [
      const SectionHeader(
        title: 'Audit history',
        subtitle: 'Recent organization-scoped activity from the backend.',
      ),
      ...workspace.audits.map(
        (item) => Card(
          child: ListTile(
            leading: const Icon(Icons.history),
            title: Text(label(item.action)),
            subtitle: Text(
              '${item.resource} · ${item.reason ?? 'No reason recorded'}\n${shortDate(item.createdAt)}',
            ),
            isThreeLine: true,
          ),
        ),
      ),
      if (workspace.audits.isEmpty)
        const EmptyState(
          icon: Icons.history,
          title: 'No audit entries',
          message: 'No authorized audit activity is available.',
        ),
    ],
  );
}

class PoliciesScreen extends ConsumerWidget {
  const PoliciesScreen({super.key, required this.workspace});
  final Workspace workspace;
  @override
  Widget build(BuildContext context, WidgetRef ref) => ListView(
    padding: const EdgeInsets.all(20),
    children: [
      const SectionHeader(
        title: 'Approval policies',
        subtitle: 'Versioned discount ceilings and finance routing thresholds.',
      ),
      ...workspace.policies.map(
        (policy) => Card(
          child: ListTile(
            contentPadding: const EdgeInsets.all(16),
            leading: const Icon(Icons.policy_outlined),
            title: Text(
              '${policy.tier} · v${policy.version}',
              style: const TextStyle(fontWeight: FontWeight.w800),
            ),
            subtitle: Text(
              'Max discount ${policy.maxDiscount}% · Finance after ${policy.financeThreshold} pts',
            ),
            trailing: const Icon(Icons.edit_outlined),
            onTap: () => showDialog<void>(
              context: context,
              builder: (_) => PolicyDialog(policy: policy),
            ),
          ),
        ),
      ),
    ],
  );
}

class MembersScreen extends StatelessWidget {
  const MembersScreen({super.key, required this.workspace});
  final Workspace workspace;
  @override
  Widget build(BuildContext context) => ListView(
    padding: const EdgeInsets.all(20),
    children: [
      SectionHeader(
        title: 'Members & roles',
        subtitle:
            'Organization membership and backend-authorized module access.',
        action: FilledButton.icon(
          onPressed: () => showDialog<void>(
            context: context,
            builder: (_) => const CreateMemberDialog(),
          ),
          icon: const Icon(Icons.person_add_alt_1),
          label: const Text('Member'),
        ),
      ),
      ...workspace.users.map(
        (user) => Card(
          child: ListTile(
            leading: CircleAvatar(
              child: Text(user.name.isEmpty ? '?' : user.name[0]),
            ),
            title: Text(user.name),
            subtitle: Text('${user.email}\n${user.moduleAccess.join(' · ')}'),
            isThreeLine: true,
            trailing: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                StatusPill(user.status),
                Text(user.role, style: Theme.of(context).textTheme.labelSmall),
              ],
            ),
            onTap: () => showDialog<void>(
              context: context,
              builder: (_) => EditMemberDialog(user: user),
            ),
          ),
        ),
      ),
    ],
  );
}

const _assignableModules = [
  'dashboard',
  'quotations',
  'approvals',
  'fulfillment',
  'invoices',
  'health',
  'reports',
  'products',
  'customers',
  'policies',
];

class CreateMemberDialog extends ConsumerStatefulWidget {
  const CreateMemberDialog({super.key});
  @override
  ConsumerState<CreateMemberDialog> createState() => _CreateMemberDialogState();
}

class _CreateMemberDialogState extends ConsumerState<CreateMemberDialog> {
  final name = TextEditingController();
  final email = TextEditingController();
  final password = TextEditingController();
  String role = 'REP';
  final selected = <String>{'dashboard', 'quotations'};

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: const Text('Provision organization member'),
    content: SingleChildScrollView(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          TextField(
            controller: name,
            decoration: const InputDecoration(labelText: 'Name'),
          ),
          const SizedBox(height: 10),
          TextField(
            controller: email,
            keyboardType: TextInputType.emailAddress,
            decoration: const InputDecoration(labelText: 'Email'),
          ),
          const SizedBox(height: 10),
          TextField(
            controller: password,
            obscureText: true,
            decoration: const InputDecoration(
              labelText: 'Temporary password',
              helperText: '12–128 characters; share outside DealOS',
            ),
          ),
          const SizedBox(height: 10),
          DropdownButtonFormField<String>(
            initialValue: role,
            decoration: const InputDecoration(labelText: 'Role'),
            items: const ['REP', 'MANAGER', 'FINANCE']
                .map(
                  (value) =>
                      DropdownMenuItem(value: value, child: Text(label(value))),
                )
                .toList(),
            onChanged: (value) => setState(() => role = value ?? role),
          ),
          const SizedBox(height: 10),
          ..._assignableModules.map(
            (module) => CheckboxListTile(
              dense: true,
              title: Text(label(module)),
              value: selected.contains(module),
              onChanged: (value) => setState(
                () => value == true
                    ? selected.add(module)
                    : selected.remove(module),
              ),
            ),
          ),
        ],
      ),
    ),
    actions: [
      TextButton(
        onPressed: () => Navigator.pop(context),
        child: const Text('Cancel'),
      ),
      FilledButton(onPressed: _create, child: const Text('Create access')),
    ],
  );

  Future<void> _create() async {
    if (name.text.trim().isEmpty ||
        !email.text.contains('@') ||
        password.text.length < 12 ||
        selected.isEmpty) {
      return;
    }
    final ok = await ref.read(sessionControllerProvider.notifier).mutate(
      '/admin/users',
      {
        'name': name.text.trim(),
        'email': email.text.trim().toLowerCase(),
        'password': password.text,
        'role': role,
        'moduleAccess': selected.toList(),
      },
      notice: 'Member access created. Share the temporary password securely.',
    );
    password.clear();
    if (ok && mounted) Navigator.pop(context);
  }
}

class EditMemberDialog extends ConsumerStatefulWidget {
  const EditMemberDialog({super.key, required this.user});
  final UserSummary user;
  @override
  ConsumerState<EditMemberDialog> createState() => _EditMemberDialogState();
}

class _EditMemberDialogState extends ConsumerState<EditMemberDialog> {
  late String role = widget.user.role;
  late String status = widget.user.status == 'ACTIVE' ? 'ACTIVE' : 'DISABLED';
  late final selected = widget.user.moduleAccess
      .where(_assignableModules.contains)
      .toSet();

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: Text(widget.user.name),
    content: SingleChildScrollView(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          DropdownButtonFormField<String>(
            initialValue: role,
            decoration: const InputDecoration(labelText: 'Role'),
            items: const ['REP', 'MANAGER', 'FINANCE', 'ADMIN']
                .map(
                  (value) =>
                      DropdownMenuItem(value: value, child: Text(label(value))),
                )
                .toList(),
            onChanged: (value) => setState(() => role = value ?? role),
          ),
          const SizedBox(height: 10),
          DropdownButtonFormField<String>(
            initialValue: status,
            decoration: const InputDecoration(labelText: 'Account status'),
            items: const ['ACTIVE', 'DISABLED']
                .map(
                  (value) =>
                      DropdownMenuItem(value: value, child: Text(label(value))),
                )
                .toList(),
            onChanged: (value) => setState(() => status = value ?? status),
          ),
          const SizedBox(height: 10),
          ..._assignableModules.map(
            (module) => CheckboxListTile(
              dense: true,
              title: Text(label(module)),
              value: selected.contains(module),
              onChanged: role == 'ADMIN'
                  ? null
                  : (value) => setState(
                      () => value == true
                          ? selected.add(module)
                          : selected.remove(module),
                    ),
            ),
          ),
        ],
      ),
    ),
    actions: [
      TextButton(
        onPressed: () => Navigator.pop(context),
        child: const Text('Cancel'),
      ),
      FilledButton(onPressed: _save, child: const Text('Save')),
    ],
  );

  Future<void> _save() async {
    final ok = await ref
        .read(sessionControllerProvider.notifier)
        .mutate(
          '/admin/users/${widget.user.id}',
          {
            'status': status,
            'role': role,
            'moduleAccess': role == 'ADMIN'
                ? _assignableModules
                : selected.toList(),
          },
          method: 'PATCH',
          notice:
              'Member role and access updated. Existing sessions were revoked.',
        );
    if (ok && mounted) Navigator.pop(context);
  }
}

class CustomerActionsDialog extends ConsumerStatefulWidget {
  const CustomerActionsDialog({super.key, required this.customer});
  final Customer customer;
  @override
  ConsumerState<CustomerActionsDialog> createState() =>
      _CustomerActionsDialogState();
}

class _CustomerActionsDialogState extends ConsumerState<CustomerActionsDialog> {
  late final name = TextEditingController(text: widget.customer.name);
  late final email = TextEditingController(text: widget.customer.email ?? '');
  late bool active = widget.customer.active;

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: Text(widget.customer.name),
    content: Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        TextField(
          controller: name,
          decoration: const InputDecoration(labelText: 'Company name'),
        ),
        const SizedBox(height: 10),
        TextField(
          controller: email,
          keyboardType: TextInputType.emailAddress,
          decoration: const InputDecoration(labelText: 'Portal email'),
        ),
        SwitchListTile(
          title: const Text('Active customer'),
          value: active,
          onChanged: (value) => setState(() => active = value),
        ),
      ],
    ),
    actions: [
      TextButton(
        onPressed: () => Navigator.pop(context),
        child: const Text('Close'),
      ),
      OutlinedButton(
        onPressed: widget.customer.email == null ? null : _invite,
        child: const Text('Send portal invite'),
      ),
      FilledButton(onPressed: _save, child: const Text('Save')),
    ],
  );

  Future<void> _invite() async {
    final ok = await ref
        .read(sessionControllerProvider.notifier)
        .mutate(
          '/customers/${widget.customer.id}/portal-invite',
          const {},
          notice: 'Customer portal invitation refreshed.',
        );
    if (ok && mounted) Navigator.pop(context);
  }

  Future<void> _save() async {
    if (name.text.trim().length < 2) return;
    final ok = await ref
        .read(sessionControllerProvider.notifier)
        .mutate(
          '/customers/${widget.customer.id}',
          {
            'name': name.text.trim(),
            'email': email.text.trim().isEmpty
                ? null
                : email.text.trim().toLowerCase(),
            'active': active,
          },
          method: 'PATCH',
          notice: 'Customer updated. Portal access was revalidated.',
        );
    if (ok && mounted) Navigator.pop(context);
  }
}

class CreateCustomerDialog extends ConsumerStatefulWidget {
  const CreateCustomerDialog({super.key});
  @override
  ConsumerState<CreateCustomerDialog> createState() =>
      _CreateCustomerDialogState();
}

class _CreateCustomerDialogState extends ConsumerState<CreateCustomerDialog> {
  final name = TextEditingController();
  final email = TextEditingController();
  final phone = TextEditingController();
  @override
  Widget build(BuildContext context) => AlertDialog(
    title: const Text('Add customer'),
    content: SingleChildScrollView(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          TextField(
            controller: name,
            decoration: const InputDecoration(labelText: 'Company name'),
          ),
          const SizedBox(height: 10),
          TextField(
            controller: email,
            keyboardType: TextInputType.emailAddress,
            decoration: const InputDecoration(labelText: 'Portal email'),
          ),
          const SizedBox(height: 10),
          TextField(
            controller: phone,
            keyboardType: TextInputType.phone,
            decoration: const InputDecoration(labelText: 'Phone'),
          ),
        ],
      ),
    ),
    actions: [
      TextButton(
        onPressed: () => Navigator.pop(context),
        child: const Text('Cancel'),
      ),
      FilledButton(
        onPressed: () async {
          if (name.text.trim().length < 2) return;
          final ok = await ref
              .read(sessionControllerProvider.notifier)
              .mutate('/customers', {
                'customerType': 'Business / Company',
                'region': 'India',
                'name': name.text.trim(),
                'contactPerson': null,
                'email': email.text.trim().isEmpty ? null : email.text.trim(),
                'countryCode': '+91',
                'phone': phone.text.trim().isEmpty ? null : phone.text.trim(),
                'gstin': null,
                'billingAddress': null,
                'shippingAddress': null,
                'paymentTerms': 30,
                'tier': 'Gold',
                'currency': 'INR',
                'active': true,
              }, notice: 'Customer created.');
          if (ok && context.mounted) Navigator.pop(context);
        },
        child: const Text('Create'),
      ),
    ],
  );
}

class EditProductDialog extends ConsumerStatefulWidget {
  const EditProductDialog({super.key, required this.product});
  final Product product;
  @override
  ConsumerState<EditProductDialog> createState() => _EditProductDialogState();
}

class _EditProductDialogState extends ConsumerState<EditProductDialog> {
  late final name = TextEditingController(text: widget.product.name);
  late final price = TextEditingController(text: '${widget.product.price}');
  late final cost = TextEditingController(text: '${widget.product.cost}');
  late bool active = widget.product.active;
  @override
  Widget build(BuildContext context) => AlertDialog(
    title: Text(widget.product.name),
    content: Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        TextField(
          controller: name,
          decoration: const InputDecoration(labelText: 'Name'),
        ),
        const SizedBox(height: 10),
        TextField(
          controller: price,
          keyboardType: TextInputType.number,
          decoration: const InputDecoration(labelText: 'Selling price'),
        ),
        const SizedBox(height: 10),
        TextField(
          controller: cost,
          keyboardType: TextInputType.number,
          decoration: const InputDecoration(labelText: 'Cost'),
        ),
        SwitchListTile(
          title: const Text('Active'),
          value: active,
          onChanged: (value) => setState(() => active = value),
        ),
      ],
    ),
    actions: [
      TextButton(
        onPressed: () => Navigator.pop(context),
        child: const Text('Cancel'),
      ),
      FilledButton(onPressed: _save, child: const Text('Save')),
    ],
  );
  Future<void> _save() async {
    final ok = await ref
        .read(sessionControllerProvider.notifier)
        .mutate(
          '/products/${widget.product.id}',
          {
            'name': name.text.trim(),
            'price': double.tryParse(price.text) ?? widget.product.price,
            'cost': double.tryParse(cost.text) ?? widget.product.cost,
            'active': active,
          },
          method: 'PATCH',
          notice:
              'Product updated; historical document snapshots were preserved.',
        );
    if (ok && mounted) Navigator.pop(context);
  }
}

class CreateProductDialog extends ConsumerStatefulWidget {
  const CreateProductDialog({super.key});
  @override
  ConsumerState<CreateProductDialog> createState() =>
      _CreateProductDialogState();
}

class _CreateProductDialogState extends ConsumerState<CreateProductDialog> {
  final name = TextEditingController(),
      sku = TextEditingController(),
      price = TextEditingController(),
      cost = TextEditingController();
  @override
  Widget build(BuildContext context) => AlertDialog(
    title: const Text('Create product'),
    content: SingleChildScrollView(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          TextField(
            controller: name,
            decoration: const InputDecoration(labelText: 'Name'),
          ),
          const SizedBox(height: 10),
          TextField(
            controller: sku,
            decoration: const InputDecoration(labelText: 'SKU'),
          ),
          const SizedBox(height: 10),
          TextField(
            controller: price,
            keyboardType: TextInputType.number,
            decoration: const InputDecoration(labelText: 'Selling price'),
          ),
          const SizedBox(height: 10),
          TextField(
            controller: cost,
            keyboardType: TextInputType.number,
            decoration: const InputDecoration(labelText: 'Cost'),
          ),
        ],
      ),
    ),
    actions: [
      TextButton(
        onPressed: () => Navigator.pop(context),
        child: const Text('Cancel'),
      ),
      FilledButton(
        onPressed: () async {
          if (name.text.trim().isEmpty || sku.text.trim().isEmpty) return;
          final ok = await ref
              .read(sessionControllerProvider.notifier)
              .mutate('/products', {
                'name': name.text.trim(),
                'sku': sku.text.trim().toUpperCase(),
                'category': 'Hardware',
                'description': 'Sellable catalogue item.',
                'unit': 'Piece',
                'price': double.tryParse(price.text) ?? 0,
                'cost': double.tryParse(cost.text) ?? 0,
                'taxRate': 18,
                'recurring': false,
                'cadence': null,
                'active': true,
                'storeVisible': true,
                'featured': false,
                'openingStock': 0,
                'minAlertLevel': 0,
                'maxCapacity': 1000,
              }, notice: 'Product created.');
          if (ok && context.mounted) Navigator.pop(context);
        },
        child: const Text('Create'),
      ),
    ],
  );
}

class SubscriptionActionDialog extends ConsumerStatefulWidget {
  const SubscriptionActionDialog({super.key, required this.subscription});
  final Subscription subscription;
  @override
  ConsumerState<SubscriptionActionDialog> createState() =>
      _SubscriptionActionDialogState();
}

class _SubscriptionActionDialogState
    extends ConsumerState<SubscriptionActionDialog> {
  final reason = TextEditingController();
  @override
  Widget build(BuildContext context) => AlertDialog(
    title: Text(widget.subscription.productName),
    content: TextField(
      controller: reason,
      minLines: 3,
      maxLines: 4,
      decoration: const InputDecoration(
        labelText: 'Reason for lifecycle change',
      ),
    ),
    actions: [
      TextButton(
        onPressed: () => Navigator.pop(context),
        child: const Text('Cancel'),
      ),
      if (widget.subscription.state == 'ACTIVE')
        FilledButton(
          onPressed: () => _run('PAUSE'),
          child: const Text('Pause'),
        ),
      if (widget.subscription.state == 'PAUSED')
        FilledButton(
          onPressed: () => _run('RESUME'),
          child: const Text('Resume'),
        ),
      OutlinedButton(
        onPressed: widget.subscription.state == 'CANCELLED'
            ? null
            : () => _run('CANCEL'),
        child: const Text('Cancel plan'),
      ),
    ],
  );
  Future<void> _run(String action) async {
    if (reason.text.trim().length < 5) return;
    final ok = await ref.read(sessionControllerProvider.notifier).mutate(
      '/subscriptions/${widget.subscription.id}/change',
      {'action': action, 'reason': reason.text.trim()},
      notice: 'Subscription ${label(action).toLowerCase()}.',
    );
    if (ok && mounted) Navigator.pop(context);
  }
}

class PolicyDialog extends ConsumerStatefulWidget {
  const PolicyDialog({super.key, required this.policy});
  final Policy policy;
  @override
  ConsumerState<PolicyDialog> createState() => _PolicyDialogState();
}

class _PolicyDialogState extends ConsumerState<PolicyDialog> {
  late final max = TextEditingController(text: '${widget.policy.maxDiscount}'),
      hardware = TextEditingController(text: '${widget.policy.hardwareLimit}'),
      services = TextEditingController(text: '${widget.policy.servicesLimit}'),
      subscriptions = TextEditingController(
        text: '${widget.policy.subscriptionLimit}',
      ),
      finance = TextEditingController(
        text: '${widget.policy.financeThreshold}',
      ),
      reason = TextEditingController();
  @override
  Widget build(BuildContext context) => AlertDialog(
    title: Text('${widget.policy.tier} policy'),
    content: Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        TextField(
          controller: max,
          keyboardType: TextInputType.number,
          decoration: const InputDecoration(labelText: 'Maximum discount %'),
        ),
        const SizedBox(height: 10),
        TextField(
          controller: hardware,
          keyboardType: TextInputType.number,
          decoration: const InputDecoration(labelText: 'Hardware ceiling %'),
        ),
        const SizedBox(height: 10),
        TextField(
          controller: services,
          keyboardType: TextInputType.number,
          decoration: const InputDecoration(labelText: 'Services ceiling %'),
        ),
        const SizedBox(height: 10),
        TextField(
          controller: subscriptions,
          keyboardType: TextInputType.number,
          decoration: const InputDecoration(
            labelText: 'Subscription ceiling %',
          ),
        ),
        const SizedBox(height: 10),
        TextField(
          controller: finance,
          keyboardType: TextInputType.number,
          decoration: const InputDecoration(labelText: 'Finance threshold'),
        ),
        const SizedBox(height: 10),
        TextField(
          controller: reason,
          minLines: 2,
          maxLines: 3,
          decoration: const InputDecoration(labelText: 'Change reason'),
        ),
      ],
    ),
    actions: [
      TextButton(
        onPressed: () => Navigator.pop(context),
        child: const Text('Cancel'),
      ),
      FilledButton(
        onPressed: () async {
          final ok = await ref
              .read(sessionControllerProvider.notifier)
              .mutate(
                '/policies/${widget.policy.id}',
                {
                  'maxDiscount': double.tryParse(max.text) ?? 0,
                  'hardwareLimit': double.tryParse(hardware.text) ?? 0,
                  'servicesLimit': double.tryParse(services.text) ?? 0,
                  'subscriptionLimit': double.tryParse(subscriptions.text) ?? 0,
                  'financeThreshold': double.tryParse(finance.text) ?? 0,
                  'reason': reason.text.trim(),
                },
                method: 'PATCH',
                notice: 'Policy updated.',
              );
          if (ok && context.mounted) Navigator.pop(context);
        },
        child: const Text('Save'),
      ),
    ],
  );
}
