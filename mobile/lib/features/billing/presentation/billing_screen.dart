import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:path_provider/path_provider.dart';

import '../../../app/providers.dart';
import '../../../core/errors/app_exception.dart';
import '../../../core/utils/formatters.dart';
import '../../../core/widgets/common.dart';
import '../application/razorpay_checkout.dart';
import '../data/payment_repository.dart';
import '../../workspace/domain/models.dart';

class InvoicesScreen extends StatelessWidget {
  const InvoicesScreen({super.key, required this.workspace});
  final Workspace workspace;
  @override
  Widget build(BuildContext context) => ListView(
    padding: const EdgeInsets.all(20),
    children: [
      SectionHeader(
        title: workspace.user.isCustomer ? 'My invoices' : 'Invoices',
        subtitle: 'One-time and recurring obligations with payment status.',
        action: workspace.user.hasRole('FINANCE') && !workspace.user.isCustomer
            ? FilledButton.icon(
                onPressed: () => showDialog<void>(
                  context: context,
                  builder: (_) => CreateInvoiceDialog(workspace: workspace),
                ),
                icon: const Icon(Icons.add),
                label: const Text('Invoice'),
              )
            : null,
      ),
      ...workspace.invoices.map(
        (invoice) => Padding(
          padding: const EdgeInsets.only(bottom: 10),
          child: Card(
            child: ListTile(
              contentPadding: const EdgeInsets.all(16),
              leading: const IconBadge(icon: Icons.receipt_long_outlined),
              title: Text(
                '${invoice.number} · ${invoice.customer}',
                style: const TextStyle(fontWeight: FontWeight.w800),
              ),
              subtitle: Text(
                'Due ${shortDate(invoice.dueAt)} · outstanding ${money(invoice.outstanding)}',
              ),
              trailing: StatusPill(invoice.state),
              onTap: () => context.push('/invoice/${invoice.id}'),
            ),
          ),
        ),
      ),
      if (workspace.invoices.isEmpty)
        const EmptyState(
          icon: Icons.receipt_long_outlined,
          title: 'No invoices',
          message: 'Authorized invoices will appear here when issued.',
        ),
    ],
  );
}

class InvoiceDetailScreen extends ConsumerStatefulWidget {
  const InvoiceDetailScreen({
    super.key,
    required this.workspace,
    required this.invoice,
  });
  final Workspace workspace;
  final Invoice invoice;
  @override
  ConsumerState<InvoiceDetailScreen> createState() =>
      _InvoiceDetailScreenState();
}

class _InvoiceDetailScreenState extends ConsumerState<InvoiceDetailScreen> {
  final amount = TextEditingController(), reference = TextEditingController();
  bool _paying = false;
  bool _paid = false;
  @override
  void initState() {
    super.initState();
    amount.text = '${widget.invoice.outstanding}';
  }

  @override
  Widget build(BuildContext context) {
    final invoice = widget.invoice;
    final customer = widget.workspace.user.isCustomer;
    final outstanding = _paid ? 0.0 : invoice.outstanding;
    return Scaffold(
      appBar: AppBar(
        leading: const ContextualBackButton(
          fallbackLocation: '/workspace/invoices',
        ),
        title: Text(invoice.number),
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
                    StatusPill(_paid ? 'PAID' : invoice.state),
                    const SizedBox(height: 8),
                    Text(
                      invoice.customer,
                      style: Theme.of(context).textTheme.headlineSmall
                          ?.copyWith(fontWeight: FontWeight.w900),
                    ),
                    Text('Due ${shortDate(invoice.dueAt)}'),
                  ],
                ),
              ),
              Text(
                money(invoice.amount),
                style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                  fontWeight: FontWeight.w900,
                ),
              ),
            ],
          ),
          const SizedBox(height: 18),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Row(
                children: [
                  Expanded(child: _BillingFact('Total', money(invoice.amount))),
                  Expanded(
                    child: _BillingFact(
                      'Paid',
                      money(_paid ? invoice.amount : invoice.paidAmount),
                    ),
                  ),
                  Expanded(
                    child: _BillingFact('Outstanding', money(outstanding)),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 18),
          Text(
            'Invoice lines',
            style: Theme.of(
              context,
            ).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: 10),
          ...invoice.lines.map(
            (line) => Card(
              margin: const EdgeInsets.only(bottom: 10),
              child: ListTile(
                title: Text(line.description),
                subtitle: Text(
                  '${line.quantity ?? 1} × ${money(line.unitPrice ?? line.amount)} · ${line.cadence ?? 'One-time'}',
                ),
                trailing: Text(
                  money(line.amount),
                  style: const TextStyle(fontWeight: FontWeight.w800),
                ),
              ),
            ),
          ),
          const SizedBox(height: 12),
          OutlinedButton.icon(
            onPressed: _download,
            icon: const Icon(Icons.download),
            label: const Text('Download PDF'),
          ),
          if (customer && invoice.state != 'PAID') ...[
            const SizedBox(height: 12),
            Card(
              color: const Color(0xFFFFF4D8),
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Icon(
                      Icons.science_outlined,
                      color: Color(0xFF875B00),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            _paid ? 'PAYMENT VERIFIED' : 'RAZORPAY TEST MODE',
                            style: const TextStyle(
                              color: Color(0xFF875B00),
                              fontWeight: FontWeight.w900,
                              letterSpacing: .8,
                            ),
                          ),
                          const SizedBox(height: 4),
                          Text(
                            _paid
                                ? 'Razorpay verified the payment. The refreshed invoice will show the final ledger status.'
                                : 'No real money is charged. Complete the secure Razorpay test checkout to pay this invoice.',
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 8),
            FilledButton.icon(
              onPressed: _paying || _paid ? null : _pay,
              icon: _paying
                  ? const SizedBox.square(
                      dimension: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : Icon(_paid ? Icons.verified_outlined : Icons.lock_outline),
              label: Text(
                _paid ? 'Payment verified' : 'Pay now · ${money(outstanding)}',
              ),
            ),
            const SizedBox(height: 8),
            FilledButton.icon(
              onPressed: _requestDate,
              icon: const Icon(Icons.calendar_month_outlined),
              label: const Text('Request due-date change'),
            ),
          ],
          if (!customer &&
              widget.workspace.user.hasRole('FINANCE') &&
              invoice.state != 'PAID') ...[
            const SizedBox(height: 18),
            Text(
              'Record verified payment',
              style: Theme.of(
                context,
              ).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w800),
            ),
            const SizedBox(height: 10),
            TextField(
              controller: amount,
              keyboardType: TextInputType.number,
              decoration: const InputDecoration(labelText: 'Amount'),
            ),
            const SizedBox(height: 10),
            TextField(
              controller: reference,
              decoration: const InputDecoration(labelText: 'Bank reference'),
            ),
            const SizedBox(height: 10),
            FilledButton(
              onPressed: _recordPayment,
              child: const Text('Record payment'),
            ),
          ],
          if (invoice.payments.isNotEmpty) ...[
            const SizedBox(height: 20),
            Text(
              'Payment history',
              style: Theme.of(
                context,
              ).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w800),
            ),
            ...invoice.payments.map(
              (payment) => ListTile(
                leading: Icon(
                  payment.successful
                      ? Icons.check_circle_outline
                      : payment.status == 'FAILED'
                      ? Icons.error_outline
                      : Icons.schedule_outlined,
                ),
                title: Text(money(payment.amount)),
                subtitle: Text(
                  '${payment.provider == 'RAZORPAY' ? 'Razorpay' : payment.reference} · ${label(payment.status)} · ${shortDate(payment.paidAt)}'
                  '${payment.razorpayPaymentId == null ? '' : '\nID ${payment.razorpayPaymentId}'}',
                ),
                trailing: StatusPill(payment.status),
              ),
            ),
          ],
        ],
      ),
    );
  }

  Future<void> _download() async {
    try {
      final bytes = await ref
          .read(workspaceRepositoryProvider)
          .downloadInvoice(widget.invoice.id);
      final directory = await getApplicationDocumentsDirectory();
      final file = File('${directory.path}/${widget.invoice.number}.pdf');
      await file.writeAsBytes(bytes, flush: true);
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text('Saved to ${file.path}')));
      }
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text('$error')));
      }
    }
  }

  Future<void> _recordPayment() async {
    final value = double.tryParse(amount.text) ?? 0;
    if (value <= 0 || reference.text.trim().isEmpty) return;
    await ref.read(sessionControllerProvider.notifier).mutate(
      '/invoices/${widget.invoice.id}/payments',
      {'amount': value, 'reference': reference.text.trim()},
      notice: 'Verified payment recorded.',
    );
  }

  Future<void> _pay() async {
    setState(() => _paying = true);
    RazorpayOrderDetails? order;
    try {
      order = await ref
          .read(paymentRepositoryProvider)
          .createOrder(widget.invoice.id);
      if (!order.testMode || !order.keyId.startsWith('rzp_test_')) {
        throw const AppException(
          code: 'RAZORPAY_TEST_MODE_REQUIRED',
          message:
              'Checkout was blocked because Razorpay Test Mode is not active.',
        );
      }
      final outcome = await ref.read(paymentCheckoutProvider).open(order);
      if (outcome is CheckoutFailure) {
        try {
          await ref
              .read(paymentRepositoryProvider)
              .reportFailure(
                order: order,
                code: outcome.code,
                message: outcome.message,
              );
        } catch (_) {
          // The verified webhook remains the recovery path if failure reporting
          // cannot reach the API.
        }
        if (!mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              outcome.cancelled
                  ? 'Payment cancelled. Your invoice was not changed.'
                  : outcome.message,
            ),
          ),
        );
        return;
      }
      final success = outcome as CheckoutSuccess;
      await ref
          .read(paymentRepositoryProvider)
          .verify(
            order: order,
            razorpayPaymentId: success.paymentId,
            razorpayOrderId: success.orderId,
            razorpaySignature: success.signature,
          );
      if (!mounted) return;
      setState(() => _paid = true);
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Payment verified successfully.')),
      );
      await ref.read(sessionControllerProvider.notifier).refresh();
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(error is AppException ? error.message : '$error'),
        ),
      );
    } finally {
      if (mounted) setState(() => _paying = false);
    }
  }

  Future<void> _requestDate() async {
    final date = await showDatePicker(
      context: context,
      firstDate: DateTime.now(),
      lastDate: DateTime.now().add(const Duration(days: 365)),
      initialDate: DateTime.now().add(const Duration(days: 30)),
    );
    if (date == null || !mounted) return;
    final reason = await askForReason(
      context,
      title: 'Request due-date change',
      action: 'Submit',
    );
    if (reason == null) return;
    await ref.read(sessionControllerProvider.notifier).mutate(
      '/portal/invoices/${widget.invoice.id}/request-change',
      {
        'requestedDate': date.toIso8601String().split('T').first,
        'message': reason,
      },
      notice: 'Due-date request submitted.',
    );
  }
}

class _BillingFact extends StatelessWidget {
  const _BillingFact(this.label, this.value);
  final String label, value;
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

class CreateInvoiceDialog extends ConsumerStatefulWidget {
  const CreateInvoiceDialog({super.key, required this.workspace});
  final Workspace workspace;
  @override
  ConsumerState<CreateInvoiceDialog> createState() =>
      _CreateInvoiceDialogState();
}

class _CreateInvoiceDialogState extends ConsumerState<CreateInvoiceDialog> {
  String? customerId, productId;
  final quantity = TextEditingController(text: '1'),
      discount = TextEditingController(text: '0');
  DateTime due = DateTime.now().add(const Duration(days: 30));
  @override
  Widget build(BuildContext context) {
    customerId ??= widget.workspace.customers
        .where((c) => c.active)
        .firstOrNull
        ?.id;
    productId ??= widget.workspace.products
        .where((p) => p.active)
        .firstOrNull
        ?.id;
    return AlertDialog(
      title: const Text('Create invoice'),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            DropdownButtonFormField<String>(
              initialValue: customerId,
              decoration: const InputDecoration(labelText: 'Customer'),
              items: widget.workspace.customers
                  .where((c) => c.active)
                  .map(
                    (c) => DropdownMenuItem(value: c.id, child: Text(c.name)),
                  )
                  .toList(),
              onChanged: (v) => setState(() => customerId = v),
            ),
            const SizedBox(height: 10),
            DropdownButtonFormField<String>(
              initialValue: productId,
              decoration: const InputDecoration(labelText: 'Product'),
              items: widget.workspace.products
                  .where((p) => p.active)
                  .map(
                    (p) => DropdownMenuItem(value: p.id, child: Text(p.name)),
                  )
                  .toList(),
              onChanged: (v) => setState(() => productId = v),
            ),
            const SizedBox(height: 10),
            TextField(
              controller: quantity,
              keyboardType: TextInputType.number,
              decoration: const InputDecoration(labelText: 'Quantity'),
            ),
            const SizedBox(height: 10),
            TextField(
              controller: discount,
              keyboardType: TextInputType.number,
              decoration: const InputDecoration(labelText: 'Discount %'),
            ),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: const Text('Cancel'),
        ),
        FilledButton(onPressed: _create, child: const Text('Create')),
      ],
    );
  }

  Future<void> _create() async {
    if (customerId == null || productId == null) return;
    final ok = await ref.read(sessionControllerProvider.notifier).mutate(
      '/invoices',
      {
        'customerId': customerId,
        'dueAt': due.toIso8601String().split('T').first,
        'lines': [
          {
            'productId': productId,
            'quantity': int.tryParse(quantity.text) ?? 1,
            'discount': double.tryParse(discount.text) ?? 0,
          },
        ],
        'sendReceipt': false,
      },
      notice: 'Invoice created.',
    );
    if (ok && mounted) Navigator.pop(context);
  }
}
