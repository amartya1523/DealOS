import '../../../core/api/api_client.dart';

class RazorpayOrderDetails {
  const RazorpayOrderDetails({
    required this.paymentRecordId,
    required this.orderId,
    required this.amount,
    required this.amountRupees,
    required this.currency,
    required this.keyId,
    required this.invoiceNumber,
    required this.testMode,
    required this.prefill,
  });

  final String paymentRecordId;
  final String orderId;
  final int amount;
  final double amountRupees;
  final String currency;
  final String keyId;
  final String invoiceNumber;
  final bool testMode;
  final Map<String, String> prefill;

  factory RazorpayOrderDetails.fromJson(Map<String, dynamic> json) {
    final invoice = json['invoice'] is Map
        ? Map<String, dynamic>.from(json['invoice'] as Map)
        : const <String, dynamic>{};
    final rawPrefill = json['prefill'] is Map
        ? Map<String, dynamic>.from(json['prefill'] as Map)
        : const <String, dynamic>{};
    return RazorpayOrderDetails(
      paymentRecordId: '${json['paymentRecordId'] ?? ''}',
      orderId: '${json['orderId'] ?? ''}',
      amount: switch (json['amount']) {
        int value => value,
        num value => value.toInt(),
        _ => int.tryParse('${json['amount']}') ?? 0,
      },
      amountRupees: switch (json['amountRupees']) {
        num value => value.toDouble(),
        _ => double.tryParse('${json['amountRupees']}') ?? 0,
      },
      currency: '${json['currency'] ?? 'INR'}',
      keyId: '${json['keyId'] ?? ''}',
      invoiceNumber: '${invoice['number'] ?? ''}',
      testMode: json['testMode'] == true,
      prefill: rawPrefill.map(
        (key, value) => MapEntry(key, value?.toString() ?? ''),
      ),
    );
  }
}

class PaymentRepository {
  const PaymentRepository(this._api);
  final ApiClient _api;

  Future<RazorpayOrderDetails> createOrder(String invoiceId) async {
    final raw = await _api.request(
      '/payments/orders',
      method: 'POST',
      data: {'invoiceId': invoiceId},
      idempotentMutation: true,
    );
    return RazorpayOrderDetails.fromJson(Map<String, dynamic>.from(raw as Map));
  }

  Future<void> verify({
    required RazorpayOrderDetails order,
    required String razorpayPaymentId,
    required String razorpayOrderId,
    required String razorpaySignature,
  }) => _api.request(
    '/payments/verify',
    method: 'POST',
    data: {
      'paymentRecordId': order.paymentRecordId,
      'razorpayPaymentId': razorpayPaymentId,
      'razorpayOrderId': razorpayOrderId,
      'razorpaySignature': razorpaySignature,
    },
    idempotentMutation: true,
  );

  Future<void> reportFailure({
    required RazorpayOrderDetails order,
    Object? code,
    String? message,
  }) => _api.request(
    '/payments/failure',
    method: 'POST',
    data: {
      'paymentRecordId': order.paymentRecordId,
      'razorpayOrderId': order.orderId,
      'code': ?code,
      'message': ?message,
    },
    idempotentMutation: true,
  );
}
