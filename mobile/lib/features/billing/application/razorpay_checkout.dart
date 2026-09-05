import 'dart:async';

import 'package:razorpay_flutter/razorpay_flutter.dart';

import '../data/payment_repository.dart';

sealed class CheckoutOutcome {
  const CheckoutOutcome();
}

class CheckoutSuccess extends CheckoutOutcome {
  const CheckoutSuccess({
    required this.paymentId,
    required this.orderId,
    required this.signature,
  });
  final String paymentId;
  final String orderId;
  final String signature;
}

class CheckoutFailure extends CheckoutOutcome {
  const CheckoutFailure({required this.code, required this.message});
  final int? code;
  final String message;
  bool get cancelled => code == Razorpay.PAYMENT_CANCELLED;
}

abstract class PaymentCheckout {
  Future<CheckoutOutcome> open(RazorpayOrderDetails order);
}

class RazorpayPaymentCheckout implements PaymentCheckout {
  @override
  Future<CheckoutOutcome> open(RazorpayOrderDetails order) async {
    final completer = Completer<CheckoutOutcome>();
    final razorpay = Razorpay();
    void complete(CheckoutOutcome result) {
      if (!completer.isCompleted) completer.complete(result);
    }

    razorpay.on(Razorpay.EVENT_PAYMENT_SUCCESS, (PaymentSuccessResponse event) {
      final paymentId = event.paymentId ?? '';
      final orderId = event.orderId ?? '';
      final signature = event.signature ?? '';
      if (paymentId.isEmpty || orderId.isEmpty || signature.isEmpty) {
        complete(
          const CheckoutFailure(
            code: Razorpay.UNKNOWN_ERROR,
            message: 'Razorpay returned an incomplete payment response.',
          ),
        );
        return;
      }
      complete(
        CheckoutSuccess(
          paymentId: paymentId,
          orderId: orderId,
          signature: signature,
        ),
      );
    });
    razorpay.on(Razorpay.EVENT_PAYMENT_ERROR, (PaymentFailureResponse event) {
      complete(
        CheckoutFailure(
          code: event.code,
          message: event.message ?? 'The payment could not be completed.',
        ),
      );
    });
    razorpay.on(Razorpay.EVENT_EXTERNAL_WALLET, (ExternalWalletResponse event) {
      complete(
        CheckoutFailure(
          code: Razorpay.UNKNOWN_ERROR,
          message:
              'External wallet ${event.walletName ?? ''} requires confirmation before this invoice can be updated.',
        ),
      );
    });

    try {
      razorpay.open({
        'key': order.keyId,
        'amount': order.amount,
        'currency': order.currency,
        'order_id': order.orderId,
        'name': 'DealOS',
        'description': 'Invoice ${order.invoiceNumber} · TEST MODE',
        'prefill': order.prefill,
        'theme': {'color': '#3D5CDE'},
        'retry': {'enabled': true, 'max_count': 2},
      });
      return await completer.future;
    } catch (error) {
      return CheckoutFailure(
        code: Razorpay.UNKNOWN_ERROR,
        message: 'Razorpay checkout could not open: $error',
      );
    } finally {
      razorpay.clear();
    }
  }
}
