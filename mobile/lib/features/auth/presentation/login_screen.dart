import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../../../core/widgets/common.dart';

class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});

  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

enum _LoginMode { organization, customer, platformOwner }

class _LoginScreenState extends ConsumerState<LoginScreen> {
  final _formKey = GlobalKey<FormState>();
  final _identifier = TextEditingController();
  final _password = TextEditingController();
  _LoginMode _mode = _LoginMode.organization;
  bool _obscure = true;

  bool get _customer => _mode == _LoginMode.customer;
  bool get _platformOwner => _mode == _LoginMode.platformOwner;
  bool get _validCustomerEmail =>
      RegExp(r'^[^\s@]+@[^\s@]+\.[^\s@]+$').hasMatch(_identifier.text.trim());

  @override
  void dispose() {
    _identifier.dispose();
    _password.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final session = ref.watch(sessionControllerProvider);
    return Scaffold(
      body: DecoratedBox(
        decoration: BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
            colors: [
              Theme.of(context).colorScheme.primary.withValues(alpha: .09),
              Theme.of(context).scaffoldBackgroundColor,
              Theme.of(context).colorScheme.tertiary.withValues(alpha: .06),
            ],
          ),
        ),
        child: SafeArea(
          child: Center(
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(20),
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 460),
                child: Container(
                  padding: const EdgeInsets.all(28),
                  decoration: BoxDecoration(
                    color: Theme.of(context).colorScheme.surface,
                    borderRadius: BorderRadius.circular(28),
                    border: Border.all(
                      color: Theme.of(context).colorScheme.outlineVariant,
                    ),
                    boxShadow: [
                      BoxShadow(
                        color: Colors.black.withValues(alpha: .07),
                        blurRadius: 30,
                        offset: const Offset(0, 14),
                      ),
                    ],
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Row(
                        children: [
                          if (_customer) ...[
                            IconButton(
                              onPressed: session.busy
                                  ? null
                                  : () => _switchMode(_LoginMode.organization),
                              icon: const Icon(Icons.arrow_back_rounded),
                              tooltip: 'Back to login options',
                            ),
                            const SizedBox(width: 8),
                          ],
                          const DealOsMark(),
                        ],
                      ),
                      const SizedBox(height: 30),
                      if (_customer) ...[
                        Text(
                          'SECURE DEAL ROOM',
                          style: Theme.of(context).textTheme.labelMedium
                              ?.copyWith(
                                color: Theme.of(context).colorScheme.primary,
                                fontWeight: FontWeight.w900,
                                letterSpacing: 1.4,
                              ),
                        ),
                        const SizedBox(height: 10),
                      ],
                      Text(
                        _platformOwner
                            ? 'Platform control plane'
                            : _customer
                            ? 'Everything shared with you, in one place.'
                            : 'Your deals, moving forward.',
                        style: Theme.of(context).textTheme.displaySmall,
                      ),
                      const SizedBox(height: 10),
                      Text(
                        _platformOwner
                            ? 'Use the separately configured Platform Owner credentials.'
                            : _customer
                            ? 'Enter the email that received your portal invitation, then continue with the same Google account.'
                            : 'Sign in with the same organization account used on the DealOS website.',
                        style: TextStyle(
                          color: Theme.of(context).colorScheme.onSurfaceVariant,
                        ),
                      ),
                      const SizedBox(height: 28),
                      if (session.error != null) ...[
                        Container(
                          padding: const EdgeInsets.all(14),
                          decoration: BoxDecoration(
                            color: Theme.of(context).colorScheme.errorContainer,
                            borderRadius: BorderRadius.circular(12),
                          ),
                          child: Text(session.error!),
                        ),
                        const SizedBox(height: 16),
                      ],
                      if (_mode == _LoginMode.organization) ...[
                        OutlinedButton(
                          onPressed: session.busy
                              ? null
                              : () => ref
                                    .read(sessionControllerProvider.notifier)
                                    .loginWithGoogle(),
                          style: OutlinedButton.styleFrom(
                            minimumSize: const Size.fromHeight(52),
                          ),
                          child: session.busy
                              ? const SizedBox.square(
                                  dimension: 22,
                                  child: CircularProgressIndicator(
                                    strokeWidth: 2,
                                  ),
                                )
                              : const _GoogleButtonContent(
                                  label: 'Sign in with Google',
                                ),
                        ),
                        const SizedBox(height: 18),
                        const Row(
                          children: [
                            Expanded(child: Divider()),
                            Flexible(
                              child: Padding(
                                padding: EdgeInsets.symmetric(horizontal: 12),
                                child: Text(
                                  'or continue with email',
                                  textAlign: TextAlign.center,
                                ),
                              ),
                            ),
                            Expanded(child: Divider()),
                          ],
                        ),
                        const SizedBox(height: 18),
                      ],
                      Form(
                        key: _formKey,
                        child: Column(
                          children: [
                            TextFormField(
                              controller: _identifier,
                              keyboardType: TextInputType.emailAddress,
                              textInputAction: TextInputAction.next,
                              autofillHints: const [AutofillHints.username],
                              decoration: InputDecoration(
                                labelText: _customer
                                    ? 'Invited email address'
                                    : _platformOwner
                                    ? 'Platform login ID'
                                    : 'Email or login ID',
                              ),
                              onChanged: _customer
                                  ? (_) => setState(() {})
                                  : null,
                              validator: (value) {
                                if (_customer) {
                                  return _validCustomerEmail
                                      ? null
                                      : 'Enter the email used for your invitation.';
                                }
                                return (value?.trim().length ?? 0) < 3
                                    ? 'Enter your login ID.'
                                    : null;
                              },
                            ),
                            if (!_customer) ...[
                              const SizedBox(height: 14),
                              TextFormField(
                                controller: _password,
                                obscureText: _obscure,
                                textInputAction: TextInputAction.done,
                                autofillHints: const [AutofillHints.password],
                                decoration: InputDecoration(
                                  labelText: 'Password',
                                  suffixIcon: IconButton(
                                    onPressed: () =>
                                        setState(() => _obscure = !_obscure),
                                    icon: Icon(
                                      _obscure
                                          ? Icons.visibility_outlined
                                          : Icons.visibility_off_outlined,
                                    ),
                                    tooltip: _obscure
                                        ? 'Show password'
                                        : 'Hide password',
                                  ),
                                ),
                                validator: (value) => (value?.length ?? 0) < 8
                                    ? 'Enter a valid password.'
                                    : null,
                                onFieldSubmitted: (_) => _submit(),
                              ),
                            ],
                            const SizedBox(height: 18),
                            FilledButton(
                              onPressed:
                                  session.busy ||
                                      (_customer && !_validCustomerEmail)
                                  ? null
                                  : _submit,
                              style: FilledButton.styleFrom(
                                minimumSize: const Size.fromHeight(52),
                                backgroundColor: _customer
                                    ? Theme.of(context).colorScheme.surface
                                    : null,
                                foregroundColor: _customer
                                    ? Theme.of(context).colorScheme.onSurface
                                    : null,
                                side: _customer
                                    ? BorderSide(
                                        color: Theme.of(
                                          context,
                                        ).colorScheme.outlineVariant,
                                      )
                                    : null,
                              ),
                              child: session.busy
                                  ? const SizedBox.square(
                                      dimension: 22,
                                      child: CircularProgressIndicator(
                                        strokeWidth: 2,
                                      ),
                                    )
                                  : _customer
                                  ? const _GoogleButtonContent(
                                      label: 'Continue with Google',
                                    )
                                  : const Text('Sign in'),
                            ),
                          ],
                        ),
                      ),
                      if (_customer) ...[
                        const SizedBox(height: 18),
                        const _TrustNote(
                          icon: Icons.mark_email_read_outlined,
                          text: 'Email ID must match the invitation',
                        ),
                        const SizedBox(height: 10),
                        const _TrustNote(
                          icon: Icons.shield_outlined,
                          text: 'Customer-scoped access to your records only',
                        ),
                      ],
                      const SizedBox(height: 12),
                      TextButton(
                        onPressed: session.busy
                            ? null
                            : () => _switchMode(
                                _customer || _platformOwner
                                    ? _LoginMode.organization
                                    : _LoginMode.customer,
                              ),
                        child: Text(
                          _platformOwner
                              ? 'Return to organization sign in'
                              : _customer
                              ? 'Organization user sign in'
                              : 'Customer portal',
                        ),
                      ),
                      if (_mode == _LoginMode.organization) ...[
                        TextButton(
                          onPressed: session.busy
                              ? null
                              : () => _switchMode(_LoginMode.platformOwner),
                          child: const Text('Platform Owner sign in'),
                        ),
                        TextButton(
                          onPressed: session.busy
                              ? null
                              : () => showDialog<void>(
                                  context: context,
                                  builder: (_) => const SignUpDialog(),
                                ),
                          child: const Text('Create an organization'),
                        ),
                      ],
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  void _submit() {
    if (!(_formKey.currentState?.validate() ?? false)) return;
    final controller = ref.read(sessionControllerProvider.notifier);
    if (_customer) {
      controller.loginCustomer(_identifier.text);
    } else {
      controller.login(
        _identifier.text,
        _password.text,
        platformOwner: _platformOwner,
      );
    }
  }

  void _switchMode(_LoginMode mode) {
    ref.read(sessionControllerProvider.notifier).dismissMessages();
    setState(() {
      _mode = mode;
      _identifier.clear();
      _password.clear();
    });
  }
}

class _GoogleMark extends StatelessWidget {
  const _GoogleMark();

  @override
  Widget build(BuildContext context) => const Text(
    'G',
    style: TextStyle(
      color: Color(0xFF4285F4),
      fontSize: 20,
      fontWeight: FontWeight.w900,
    ),
  );
}

class _GoogleButtonContent extends StatelessWidget {
  const _GoogleButtonContent({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) => Row(
    children: [
      const _GoogleMark(),
      const SizedBox(width: 12),
      Expanded(
        child: Text(
          label,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          textAlign: TextAlign.center,
        ),
      ),
      const SizedBox(width: 32),
    ],
  );
}

class _TrustNote extends StatelessWidget {
  const _TrustNote({required this.icon, required this.text});

  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) => Row(
    children: [
      Icon(icon, size: 18, color: Theme.of(context).colorScheme.primary),
      const SizedBox(width: 10),
      Expanded(child: Text(text, style: Theme.of(context).textTheme.bodySmall)),
    ],
  );
}

class SignUpDialog extends ConsumerStatefulWidget {
  const SignUpDialog({super.key});

  @override
  ConsumerState<SignUpDialog> createState() => _SignUpDialogState();
}

class _SignUpDialogState extends ConsumerState<SignUpDialog> {
  final _organization = TextEditingController();
  final _name = TextEditingController();
  final _email = TextEditingController();
  final _password = TextEditingController();

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: const Text('Create your DealOS organization'),
    content: SingleChildScrollView(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          TextField(
            controller: _organization,
            decoration: const InputDecoration(labelText: 'Organization name'),
          ),
          const SizedBox(height: 10),
          TextField(
            controller: _name,
            decoration: const InputDecoration(labelText: 'Your name'),
          ),
          const SizedBox(height: 10),
          TextField(
            controller: _email,
            keyboardType: TextInputType.emailAddress,
            decoration: const InputDecoration(labelText: 'Work email'),
          ),
          const SizedBox(height: 10),
          TextField(
            controller: _password,
            obscureText: true,
            decoration: const InputDecoration(
              labelText: 'Password',
              helperText: '12–128 characters',
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
      FilledButton(
        onPressed: () {
          if (_organization.text.trim().length < 2 ||
              _name.text.trim().isEmpty ||
              !_email.text.contains('@') ||
              _password.text.length < 12) {
            return;
          }
          Navigator.pop(context);
          ref
              .read(sessionControllerProvider.notifier)
              .signUp(
                organization: _organization.text,
                name: _name.text,
                email: _email.text,
                password: _password.text,
              );
        },
        child: const Text('Create organization'),
      ),
    ],
  );
}
