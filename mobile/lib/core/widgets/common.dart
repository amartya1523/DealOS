import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../theme/app_theme.dart';
import '../utils/formatters.dart';

void returnToSource(BuildContext context, {required String fallbackLocation}) {
  final router = GoRouter.of(context);
  if (router.canPop()) {
    router.pop();
  } else {
    router.go(fallbackLocation);
  }
}

class ContextualBackButton extends StatelessWidget {
  const ContextualBackButton({super.key, required this.fallbackLocation});

  final String fallbackLocation;

  @override
  Widget build(BuildContext context) => BackButton(
    onPressed: () =>
        returnToSource(context, fallbackLocation: fallbackLocation),
  );
}

class DealOsMark extends StatelessWidget {
  const DealOsMark({super.key, this.compact = false, this.light = false});
  final bool compact;
  final bool light;

  @override
  Widget build(BuildContext context) {
    final useLight = light || Theme.of(context).brightness == Brightness.dark;
    return Semantics(
      label: 'DealOS',
      header: true,
      child: SizedBox(
        width: compact ? 92 : 132,
        height: compact ? 40 : 56,
        child: Image.asset(
          'assets/branding/dealos_logo.png',
          fit: BoxFit.contain,
          filterQuality: FilterQuality.high,
          color: useLight ? const Color(0xFFF7F4EC) : null,
          colorBlendMode: useLight ? BlendMode.srcIn : null,
          excludeFromSemantics: true,
        ),
      ),
    );
  }
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
    padding: const EdgeInsets.only(bottom: 18),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.center,
      children: [
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(title, style: Theme.of(context).textTheme.headlineMedium),
              const SizedBox(height: 5),
              Text(
                subtitle,
                style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                  color: Theme.of(context).colorScheme.onSurfaceVariant,
                ),
              ),
            ],
          ),
        ),
        if (action != null) ...[const SizedBox(width: 12), action!],
      ],
    ),
  );
}

class SectionTitle extends StatelessWidget {
  const SectionTitle(this.title, {super.key, this.action});
  final String title;
  final Widget? action;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 12),
    child: Row(
      children: [
        Expanded(
          child: Text(title, style: Theme.of(context).textTheme.titleLarge),
        ),
        ?action,
      ],
    ),
  );
}

class IconBadge extends StatelessWidget {
  const IconBadge({
    super.key,
    required this.icon,
    this.color = DealOsColors.blue,
    this.size = 42,
  });
  final IconData icon;
  final Color color;
  final double size;

  @override
  Widget build(BuildContext context) => Container(
    width: size,
    height: size,
    alignment: Alignment.center,
    decoration: BoxDecoration(
      color: color.withValues(alpha: .11),
      borderRadius: BorderRadius.circular(size * .32),
    ),
    child: Icon(icon, color: color, size: size * .5),
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
        color: color.withValues(alpha: .1),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: color.withValues(alpha: .12)),
      ),
      child: Text(
        label(value),
        style: TextStyle(
          color: color,
          fontSize: 10.5,
          letterSpacing: .15,
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
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          IconBadge(
            icon: icon,
            color: accent ?? Theme.of(context).colorScheme.primary,
            size: 38,
          ),
          const SizedBox(height: 14),
          Text(
            value,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: Theme.of(context).textTheme.headlineSmall?.copyWith(
              fontSize: 24,
              fontWeight: FontWeight.w800,
            ),
          ),
          const SizedBox(height: 2),
          Text(
            label,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: Theme.of(context).textTheme.labelMedium?.copyWith(
              color: Theme.of(context).colorScheme.onSurfaceVariant,
              fontWeight: FontWeight.w600,
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
