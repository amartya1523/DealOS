import 'package:flutter/material.dart';

import '../theme/app_theme.dart';
import '../utils/formatters.dart';

class DealOsMark extends StatelessWidget {
  const DealOsMark({super.key, this.compact = false, this.light = false});
  final bool compact;
  final bool light;

  @override
  Widget build(BuildContext context) => Semantics(
    label: 'DealOS',
    header: true,
    child: Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          width: 34,
          height: 34,
          decoration: BoxDecoration(
            color: DealOsColors.coral,
            borderRadius: BorderRadius.circular(9),
          ),
          alignment: Alignment.center,
          child: const Text(
            'D',
            style: TextStyle(
              color: DealOsColors.ink,
              fontWeight: FontWeight.w900,
              fontSize: 18,
            ),
          ),
        ),
        if (!compact) ...[
          const SizedBox(width: 10),
          Text(
            'DealOS',
            style: TextStyle(
              color: light
                  ? Colors.white
                  : Theme.of(context).colorScheme.onSurface,
              fontSize: 22,
              letterSpacing: -1,
              fontWeight: FontWeight.w800,
            ),
          ),
        ],
      ],
    ),
  );
}

class SectionHeader extends StatelessWidget {
  const SectionHeader({
    super.key,
    required this.title,
    required this.subtitle,
    this.action,
  });
  final String title;
  final String subtitle;
  final Widget? action;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 20),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.end,
      children: [
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                title,
                style: Theme.of(context).textTheme.headlineMedium?.copyWith(
                  fontWeight: FontWeight.w800,
                  letterSpacing: -1,
                ),
              ),
              const SizedBox(height: 6),
              Text(
                subtitle,
                style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                  color: Theme.of(context).colorScheme.onSurfaceVariant,
                ),
              ),
            ],
          ),
        ),
        ?action,
      ],
    ),
  );
}

class StatusPill extends StatelessWidget {
  const StatusPill(this.value, {super.key});
  final String value;

  @override
  Widget build(BuildContext context) {
    final color = switch (value) {
      'APPROVED' ||
      'ACTIVE' ||
      'PAID' ||
      'CONFIRMED' ||
      'RESOLVED' => DealOsColors.green,
      'REJECTED' ||
      'SUSPENDED' ||
      'CANCELLED' ||
      'DISABLED' => Theme.of(context).colorScheme.error,
      'PENDING' ||
      'PENDING_APPROVAL' ||
      'PARTIAL' ||
      'UNPAID' => const Color(0xFF9A6D00),
      _ => DealOsColors.violet,
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 5),
      decoration: BoxDecoration(
        color: color.withValues(alpha: .13),
        borderRadius: BorderRadius.circular(20),
      ),
      child: Text(
        label(value),
        style: TextStyle(
          color: color,
          fontSize: 11,
          fontWeight: FontWeight.w800,
        ),
      ),
    );
  }
}

class MetricCard extends StatelessWidget {
  const MetricCard({
    super.key,
    required this.label,
    required this.value,
    required this.icon,
    this.accent,
  });
  final String label;
  final String value;
  final IconData icon;
  final Color? accent;

  @override
  Widget build(BuildContext context) => Card(
    child: Padding(
      padding: const EdgeInsets.all(18),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, color: accent ?? Theme.of(context).colorScheme.secondary),
          const Spacer(),
          Text(
            value,
            style: Theme.of(
              context,
            ).textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w900),
          ),
          const SizedBox(height: 3),
          Text(
            label,
            style: Theme.of(context).textTheme.labelMedium?.copyWith(
              color: Theme.of(context).colorScheme.onSurfaceVariant,
            ),
          ),
        ],
      ),
    ),
  );
}

class EmptyState extends StatelessWidget {
  const EmptyState({
    super.key,
    required this.icon,
    required this.title,
    required this.message,
    this.action,
  });
  final IconData icon;
  final String title;
  final String message;
  final Widget? action;

  @override
  Widget build(BuildContext context) => Center(
    child: Padding(
      padding: const EdgeInsets.all(40),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 46, color: Theme.of(context).colorScheme.secondary),
          const SizedBox(height: 14),
          Text(
            title,
            style: Theme.of(
              context,
            ).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w800),
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 6),
          Text(
            message,
            textAlign: TextAlign.center,
            style: TextStyle(
              color: Theme.of(context).colorScheme.onSurfaceVariant,
            ),
          ),
          if (action != null) ...[const SizedBox(height: 18), action!],
        ],
      ),
    ),
  );
}

class ErrorBanner extends StatelessWidget {
  const ErrorBanner({
    super.key,
    required this.message,
    this.onDismiss,
    this.offline = false,
  });
  final String message;
  final VoidCallback? onDismiss;
  final bool offline;

  @override
  Widget build(BuildContext context) => MaterialBanner(
    leading: Icon(offline ? Icons.cloud_off_outlined : Icons.error_outline),
    content: Text(message),
    actions: [TextButton(onPressed: onDismiss, child: const Text('Dismiss'))],
  );
}

Future<String?> askForReason(
  BuildContext context, {
  required String title,
  required String action,
  String? confirmation,
}) async {
  final reason = TextEditingController();
  final confirmationController = TextEditingController();
  return showDialog<String>(
    context: context,
    builder: (context) => AlertDialog(
      title: Text(title),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          TextField(
            controller: reason,
            minLines: 3,
            maxLines: 5,
            decoration: const InputDecoration(
              labelText: 'Reason',
              hintText: 'Explain why this action is required',
            ),
          ),
          if (confirmation != null) ...[
            const SizedBox(height: 12),
            TextField(
              controller: confirmationController,
              decoration: InputDecoration(
                labelText: 'Type $confirmation to confirm',
              ),
            ),
          ],
        ],
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: const Text('Cancel'),
        ),
        FilledButton(
          onPressed: () {
            if (reason.text.trim().length < 5) return;
            if (confirmation != null &&
                confirmationController.text.trim() != confirmation) {
              return;
            }
            Navigator.pop(context, reason.text.trim());
          },
          child: Text(action),
        ),
      ],
    ),
  );
}
