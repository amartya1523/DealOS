import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../../../core/api/api_client.dart';
import '../../../core/utils/formatters.dart';
import '../../../core/widgets/common.dart';
import '../../workspace/domain/models.dart';

class PlatformAdminScreen extends ConsumerStatefulWidget {
  const PlatformAdminScreen({
    super.key,
    required this.dashboard,
    required this.workspace,
  });
  final PlatformDashboard dashboard;
  final Workspace workspace;
  @override
  ConsumerState<PlatformAdminScreen> createState() =>
      _PlatformAdminScreenState();
}

class _PlatformAdminScreenState extends ConsumerState<PlatformAdminScreen> {
  bool members = false;
  late Future<List<JsonMap>> memberFuture;
  @override
  void initState() {
    super.initState();
    memberFuture = ref.read(workspaceRepositoryProvider).loadPlatformMembers();
  }

  @override
  Widget build(BuildContext context) {
    final session = ref.watch(sessionControllerProvider);
    return Scaffold(
      appBar: AppBar(
        title: const DealOsMark(),
        actions: [
          IconButton(
            onPressed: () =>
                ref.read(sessionControllerProvider.notifier).refresh(),
            icon: const Icon(Icons.refresh),
            tooltip: 'Refresh',
          ),
          IconButton(
            onPressed: () =>
                ref.read(sessionControllerProvider.notifier).logout(),
            icon: const Icon(Icons.logout),
            tooltip: 'Sign out',
          ),
        ],
      ),
      body: Column(
        children: [
          if (session.error != null)
            ErrorBanner(
              message: session.error!,
              offline: session.offline,
              onDismiss: () => ref
                  .read(sessionControllerProvider.notifier)
                  .dismissMessages(),
            ),
          if (session.busy) const LinearProgressIndicator(),
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 8, 20, 0),
            child: SegmentedButton<bool>(
              segments: const [
                ButtonSegment(
                  value: false,
                  label: Text('Organizations'),
                  icon: Icon(Icons.domain),
                ),
                ButtonSegment(
                  value: true,
                  label: Text('Global users'),
                  icon: Icon(Icons.group),
                ),
              ],
              selected: {members},
              onSelectionChanged: (value) =>
                  setState(() => members = value.first),
            ),
          ),
          Expanded(child: members ? _members() : _organizations()),
        ],
      ),
    );
  }

  Widget _organizations() {
    final dashboard = widget.dashboard;
    return ListView(
      padding: const EdgeInsets.all(20),
      children: [
        const SectionHeader(
          title: 'Platform overview',
          subtitle:
              'Independent global control plane. Privileged changes require a written reason.',
        ),
        GridView.count(
          crossAxisCount: MediaQuery.sizeOf(context).width > 800 ? 4 : 2,
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          childAspectRatio: 1.5,
          mainAxisSpacing: 10,
          crossAxisSpacing: 10,
          children: [
            MetricCard(
              label: 'Organizations',
              value: '${dashboard.metrics['totalOrganizations'] ?? 0}',
              icon: Icons.domain,
            ),
            MetricCard(
              label: 'Active tenants',
              value: '${dashboard.metrics['activeOrganizations'] ?? 0}',
              icon: Icons.check_circle_outline,
            ),
            MetricCard(
              label: 'Active users',
              value: '${dashboard.metrics['activeUsers'] ?? 0}',
              icon: Icons.group_outlined,
            ),
            MetricCard(
              label: 'Blocked deals',
              value: '${dashboard.metrics['blockedDeals'] ?? 0}',
              icon: Icons.warning_amber,
            ),
          ],
        ),
        const SizedBox(height: 20),
        Row(
          children: [
            Expanded(
              child: Text(
                'Organizations',
                style: Theme.of(
                  context,
                ).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w800),
              ),
            ),
            FilledButton.icon(
              onPressed: () => showDialog<void>(
                context: context,
                builder: (_) => const CreateOrganizationDialog(),
              ),
              icon: const Icon(Icons.add),
              label: const Text('Create'),
            ),
          ],
        ),
        const SizedBox(height: 10),
        ...dashboard.organizations.map(
          (org) => Card(
            child: ListTile(
              contentPadding: const EdgeInsets.all(16),
              leading: const Icon(Icons.apartment),
              title: Text(
                '${org['name'] ?? ''}',
                style: const TextStyle(fontWeight: FontWeight.w800),
              ),
              subtitle: Text(
                '${org['slug'] ?? ''} · ${org['_count'] is Map ? (org['_count'] as Map)['memberships'] ?? 0 : 0} members',
              ),
              trailing: StatusPill('${org['status'] ?? 'ACTIVE'}'),
              onTap: () => _openOrganization('${org['id']}'),
            ),
          ),
        ),
        const SizedBox(height: 20),
        Text(
          'Privileged audit',
          style: Theme.of(
            context,
          ).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w800),
        ),
        const SizedBox(height: 10),
        ...dashboard.recentActions.map(
          (event) => Card(
            child: ListTile(
              leading: const Icon(Icons.security),
              title: Text(label('${event['action'] ?? ''}')),
              subtitle: Text(
                '${event['reason'] ?? 'No reason'}\n${shortDate(event['createdAt'])}',
              ),
              isThreeLine: true,
            ),
          ),
        ),
      ],
    );
  }

  Widget _members() => FutureBuilder<List<JsonMap>>(
    future: memberFuture,
    builder: (context, snapshot) {
      if (snapshot.connectionState != ConnectionState.done) {
        return const Center(child: CircularProgressIndicator());
      }
      if (snapshot.hasError) {
        return EmptyState(
          icon: Icons.error_outline,
          title: 'Could not load users',
          message: '${snapshot.error}',
        );
      }
      final items = snapshot.data ?? const [];
      return ListView(
        padding: const EdgeInsets.all(20),
        children: [
          const SectionHeader(
            title: 'Global user directory',
            subtitle: 'Accounts and memberships across every organization.',
          ),
          ...items.map(
            (user) => Card(
              child: ListTile(
                contentPadding: const EdgeInsets.all(16),
                leading: CircleAvatar(
                  child: Text('${user['name'] ?? '?'}'.substring(0, 1)),
                ),
                title: Text('${user['name'] ?? ''}'),
                subtitle: Text(
                  '${user['email'] ?? ''}\n${(user['memberships'] as List? ?? const []).length} organization memberships',
                ),
                isThreeLine: true,
                trailing: StatusPill('${user['status'] ?? ''}'),
                onTap: () => showDialog<void>(
                  context: context,
                  builder: (_) => PlatformUserDialog(user: user),
                ),
              ),
            ),
          ),
          if (items.isEmpty)
            const EmptyState(
              icon: Icons.group_outlined,
              title: 'No users',
              message: 'No platform users match the current scope.',
            ),
        ],
      );
    },
  );

  Future<void> _openOrganization(String id) async {
    try {
      final detail = await ref
          .read(workspaceRepositoryProvider)
          .loadOrganization(id);
      if (!mounted) return;
      await showDialog<void>(
        context: context,
        builder: (_) => OrganizationDialog(organization: detail),
      );
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text('$error')));
    }
  }
}

class OrganizationDialog extends ConsumerWidget {
  const OrganizationDialog({super.key, required this.organization});
  final JsonMap organization;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final status = '${organization['status'] ?? 'ACTIVE'}';
    final id = '${organization['id']}';
    return AlertDialog(
      title: Text('${organization['name']}'),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          StatusPill(status),
          const SizedBox(height: 12),
          Text('Slug: ${organization['slug'] ?? '—'}'),
          const SizedBox(height: 8),
          const Text(
            'View As is read-only and revalidates the simulated context on the backend.',
          ),
          const SizedBox(height: 12),
          Text(
            '${(organization['memberships'] as List? ?? const []).length} memberships · ${(organization['quotes'] as List? ?? const []).length} recent quotes',
          ),
          const SizedBox(height: 8),
          ...((organization['memberships'] as List? ?? const [])
              .whereType<Map>()
              .take(5)
              .map(
                (membership) => ListTile(
                  dense: true,
                  contentPadding: EdgeInsets.zero,
                  title: Text(
                    '${membership['user'] is Map ? (membership['user'] as Map)['name'] : 'Member'}',
                  ),
                  subtitle: Text(
                    '${membership['businessRole']} · ${membership['status']}',
                  ),
                  trailing: const Icon(Icons.edit_outlined),
                  onTap: () => showDialog<void>(
                    context: context,
                    builder: (_) => MembershipDialog(
                      membership: Map<String, dynamic>.from(membership),
                    ),
                  ),
                ),
              )),
        ],
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: const Text('Close'),
        ),
        TextButton(
          onPressed: () => showDialog<void>(
            context: context,
            builder: (_) => PlatformInviteDialog(organizationId: id),
          ),
          child: const Text('Invite'),
        ),
        TextButton(
          onPressed: () => showDialog<void>(
            context: context,
            builder: (_) => PlatformAssignDialog(organizationId: id),
          ),
          child: const Text('Assign user'),
        ),
        OutlinedButton(
          onPressed: () => _changeStatus(
            context,
            status == 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE',
          ),
          child: Text(status == 'ACTIVE' ? 'Suspend' : 'Activate'),
        ),
        FilledButton.icon(
          onPressed: () => _view(context, id),
          icon: const Icon(Icons.visibility),
          label: const Text('View as'),
        ),
      ],
    );
  }

  Future<void> _view(BuildContext context, String id) async {
    Navigator.pop(context);
    await ProviderScope.containerOf(
      context,
    ).read(sessionControllerProvider.notifier).enterViewAs(id);
  }

  Future<void> _changeStatus(BuildContext context, String next) async {
    final reason = await askForReason(
      context,
      title: '${label(next)} organization',
      action: label(next),
      confirmation: next == 'ACTIVE' ? null : next,
    );
    if (reason == null || !context.mounted) return;
    Navigator.pop(context);
    await ProviderScope.containerOf(context)
        .read(sessionControllerProvider.notifier)
        .mutate(
          '/platform/organizations/${organization['id']}',
          {
            'status': next,
            'reason': reason,
            if (next != 'ACTIVE') 'confirmation': next,
          },
          method: 'PATCH',
          notice: 'Organization status updated.',
        );
  }
}

class PlatformInviteDialog extends ConsumerStatefulWidget {
  const PlatformInviteDialog({super.key, required this.organizationId});
  final String organizationId;
  @override
  ConsumerState<PlatformInviteDialog> createState() =>
      _PlatformInviteDialogState();
}

class _PlatformInviteDialogState extends ConsumerState<PlatformInviteDialog> {
  final email = TextEditingController(), reason = TextEditingController();
  String role = 'REP';
  @override
  Widget build(BuildContext context) => AlertDialog(
    title: const Text('Invite organization user'),
    content: Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        TextField(
          controller: email,
          keyboardType: TextInputType.emailAddress,
          decoration: const InputDecoration(labelText: 'Email'),
        ),
        const SizedBox(height: 10),
        DropdownButtonFormField<String>(
          initialValue: role,
          decoration: const InputDecoration(labelText: 'Business role'),
          items: const ['REP', 'MANAGER', 'FINANCE', 'ADMIN', 'CUSTOMER']
              .map(
                (value) =>
                    DropdownMenuItem(value: value, child: Text(label(value))),
              )
              .toList(),
          onChanged: (value) => setState(() => role = value ?? role),
        ),
        const SizedBox(height: 10),
        TextField(
          controller: reason,
          minLines: 2,
          maxLines: 4,
          decoration: const InputDecoration(
            labelText: 'Privileged action reason',
          ),
        ),
      ],
    ),
    actions: [
      TextButton(
        onPressed: () => Navigator.pop(context),
        child: const Text('Cancel'),
      ),
      FilledButton(onPressed: _submit, child: const Text('Invite')),
    ],
  );
  Future<void> _submit() async {
    if (!email.text.contains('@') || reason.text.trim().length < 10) return;
    final access = role == 'ADMIN'
        ? 'ORGANIZATION_ADMIN'
        : role == 'CUSTOMER'
        ? 'PORTAL_USER'
        : 'ORGANIZATION_MEMBER';
    final ok = await ref
        .read(sessionControllerProvider.notifier)
        .mutate('/platform/invitations', {
          'organizationId': widget.organizationId,
          'email': email.text.trim().toLowerCase(),
          'accessRole': access,
          'businessRole': role,
          'reason': reason.text.trim(),
        }, notice: 'Organization invitation created.');
    if (ok && mounted) {
      Navigator.pop(context);
      Navigator.pop(context);
    }
  }
}

class PlatformAssignDialog extends ConsumerStatefulWidget {
  const PlatformAssignDialog({super.key, required this.organizationId});
  final String organizationId;
  @override
  ConsumerState<PlatformAssignDialog> createState() =>
      _PlatformAssignDialogState();
}

class _PlatformAssignDialogState extends ConsumerState<PlatformAssignDialog> {
  String? userId;
  String role = 'REP';
  final reason = TextEditingController();
  late final Future<List<JsonMap>> users = ref
      .read(workspaceRepositoryProvider)
      .loadPlatformMembers();
  @override
  Widget build(BuildContext context) => AlertDialog(
    title: const Text('Assign existing user'),
    content: FutureBuilder<List<JsonMap>>(
      future: users,
      builder: (context, snapshot) {
        if (!snapshot.hasData) {
          return const SizedBox(
            height: 80,
            child: Center(child: CircularProgressIndicator()),
          );
        }
        final items = snapshot.data!;
        userId ??= items.firstOrNull?['id']?.toString();
        return Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            DropdownButtonFormField<String>(
              initialValue: userId,
              decoration: const InputDecoration(labelText: 'User'),
              items: items
                  .map(
                    (user) => DropdownMenuItem(
                      value: '${user['id']}',
                      child: Text('${user['name']}'),
                    ),
                  )
                  .toList(),
              onChanged: (value) => setState(() => userId = value),
            ),
            const SizedBox(height: 10),
            DropdownButtonFormField<String>(
              initialValue: role,
              decoration: const InputDecoration(labelText: 'Business role'),
              items: const ['REP', 'MANAGER', 'FINANCE', 'ADMIN', 'CUSTOMER']
                  .map(
                    (value) => DropdownMenuItem(
                      value: value,
                      child: Text(label(value)),
                    ),
                  )
                  .toList(),
              onChanged: (value) => setState(() => role = value ?? role),
            ),
            const SizedBox(height: 10),
            TextField(
              controller: reason,
              minLines: 2,
              maxLines: 4,
              decoration: const InputDecoration(
                labelText: 'Privileged action reason',
              ),
            ),
          ],
        );
      },
    ),
    actions: [
      TextButton(
        onPressed: () => Navigator.pop(context),
        child: const Text('Cancel'),
      ),
      FilledButton(onPressed: _submit, child: const Text('Assign')),
    ],
  );
  Future<void> _submit() async {
    if (userId == null || reason.text.trim().length < 10) return;
    final access = role == 'ADMIN'
        ? 'ORGANIZATION_ADMIN'
        : role == 'CUSTOMER'
        ? 'PORTAL_USER'
        : 'ORGANIZATION_MEMBER';
    final ok = await ref.read(sessionControllerProvider.notifier).mutate(
      '/platform/organizations/${widget.organizationId}/members',
      {
        'userId': userId,
        'accessRole': access,
        'businessRole': role,
        'reason': reason.text.trim(),
      },
      notice: 'User assigned to organization.',
    );
    if (ok && mounted) {
      Navigator.pop(context);
      Navigator.pop(context);
    }
  }
}

class MembershipDialog extends ConsumerStatefulWidget {
  const MembershipDialog({super.key, required this.membership});
  final JsonMap membership;
  @override
  ConsumerState<MembershipDialog> createState() => _MembershipDialogState();
}

class _MembershipDialogState extends ConsumerState<MembershipDialog> {
  late String role = '${widget.membership['businessRole']}',
      status = '${widget.membership['status']}';
  final reason = TextEditingController(),
      confirmation = TextEditingController();
  @override
  Widget build(BuildContext context) => AlertDialog(
    title: const Text('Update membership'),
    content: Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        DropdownButtonFormField<String>(
          initialValue: role,
          decoration: const InputDecoration(labelText: 'Role'),
          items: const ['REP', 'MANAGER', 'FINANCE', 'ADMIN', 'CUSTOMER']
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
          decoration: const InputDecoration(labelText: 'Status'),
          items: const ['ACTIVE', 'SUSPENDED', 'REVOKED']
              .map(
                (value) =>
                    DropdownMenuItem(value: value, child: Text(label(value))),
              )
              .toList(),
          onChanged: (value) => setState(() => status = value ?? status),
        ),
        const SizedBox(height: 10),
        TextField(
          controller: reason,
          minLines: 2,
          maxLines: 4,
          decoration: const InputDecoration(labelText: 'Reason'),
        ),
        if (status != 'ACTIVE') ...[
          const SizedBox(height: 10),
          TextField(
            controller: confirmation,
            decoration: InputDecoration(labelText: 'Type $status to confirm'),
          ),
        ],
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
    if (reason.text.trim().length < 10 ||
        (status != 'ACTIVE' && confirmation.text != status)) {
      return;
    }
    final access = role == 'ADMIN'
        ? 'ORGANIZATION_ADMIN'
        : role == 'CUSTOMER'
        ? 'PORTAL_USER'
        : 'ORGANIZATION_MEMBER';
    final ok = await ref
        .read(sessionControllerProvider.notifier)
        .mutate(
          '/platform/memberships/${widget.membership['id']}',
          {
            'accessRole': access,
            'businessRole': role,
            'status': status,
            'reason': reason.text.trim(),
            if (status != 'ACTIVE') 'confirmation': status,
          },
          method: 'PATCH',
          notice: 'Membership updated.',
        );
    if (ok && mounted) {
      Navigator.pop(context);
      Navigator.pop(context);
    }
  }
}

class CreateOrganizationDialog extends ConsumerStatefulWidget {
  const CreateOrganizationDialog({super.key});
  @override
  ConsumerState<CreateOrganizationDialog> createState() =>
      _CreateOrganizationDialogState();
}

class _CreateOrganizationDialogState
    extends ConsumerState<CreateOrganizationDialog> {
  final name = TextEditingController(),
      slug = TextEditingController(),
      reason = TextEditingController();
  @override
  Widget build(BuildContext context) => AlertDialog(
    title: const Text('Create organization'),
    content: Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        TextField(
          controller: name,
          decoration: const InputDecoration(labelText: 'Name'),
          onChanged: (value) => slug.text = value
              .toLowerCase()
              .replaceAll(RegExp(r'[^a-z0-9]+'), '-')
              .replaceAll(RegExp(r'^-|-$'), ''),
        ),
        const SizedBox(height: 10),
        TextField(
          controller: slug,
          decoration: const InputDecoration(labelText: 'Slug'),
        ),
        const SizedBox(height: 10),
        TextField(
          controller: reason,
          minLines: 2,
          maxLines: 4,
          decoration: const InputDecoration(labelText: 'Reason'),
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
          if (name.text.trim().length < 2 ||
              slug.text.trim().isEmpty ||
              reason.text.trim().length < 5) {
            return;
          }
          final ok = await ref
              .read(sessionControllerProvider.notifier)
              .mutate('/platform/organizations', {
                'name': name.text.trim(),
                'slug': slug.text.trim(),
                'reason': reason.text.trim(),
              }, notice: 'Organization created.');
          if (ok && context.mounted) Navigator.pop(context);
        },
        child: const Text('Create'),
      ),
    ],
  );
}

class PlatformUserDialog extends ConsumerWidget {
  const PlatformUserDialog({super.key, required this.user});
  final JsonMap user;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final active = user['status'] == 'ACTIVE';
    return AlertDialog(
      title: Text('${user['name']}'),
      content: Text(
        '${user['email']}\n\nThis action revokes active sessions when disabling an account.',
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: const Text('Close'),
        ),
        OutlinedButton(
          onPressed: () => _reset(context),
          child: const Text('Reset access'),
        ),
        FilledButton(
          onPressed: () => _status(context, active ? 'DISABLED' : 'ACTIVE'),
          child: Text(active ? 'Disable' : 'Activate'),
        ),
      ],
    );
  }

  Future<void> _status(BuildContext context, String status) async {
    final reason = await askForReason(
      context,
      title: '${label(status)} user',
      action: label(status),
      confirmation: status,
    );
    if (reason == null || !context.mounted) return;
    Navigator.pop(context);
    await ProviderScope.containerOf(context)
        .read(sessionControllerProvider.notifier)
        .mutate(
          '/platform/users/${user['id']}/status',
          {'status': status, 'reason': reason, 'confirmation': status},
          method: 'PATCH',
          notice: 'User status updated.',
        );
  }

  Future<void> _reset(BuildContext context) async {
    final reason = await askForReason(
      context,
      title: 'Reset user access',
      action: 'Reset access',
      confirmation: 'RESET ACCESS',
    );
    if (reason == null || !context.mounted) return;
    Navigator.pop(context);
    await ProviderScope.containerOf(
      context,
    ).read(sessionControllerProvider.notifier).mutate(
      '/platform/users/${user['id']}/reset-access',
      {'reason': reason, 'confirmation': 'RESET ACCESS'},
      notice: 'Existing user sessions revoked.',
    );
  }
}
