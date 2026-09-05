import { request } from './api';

export type RazorpayOrderDetails = {
  paymentRecordId: string;
  orderId: string;
  amount: number;
  amountRupees: number | string;
  currency: string;
  keyId: string;
  testMode: boolean;
  invoice: { id: string; number: string; customer: string };
  prefill: { name?: string; email?: string; contact?: string };
};

type RazorpaySuccess = {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
};

type RazorpayFailure = {
  error?: { code?: string | number; description?: string };
};

type CheckoutOptions = {
  key: string;
  amount: number;
  currency: string;
  order_id: string;
  name: string;
  description: string;
  prefill: RazorpayOrderDetails['prefill'];
  theme: { color: string };
  retry: { enabled: boolean; max_count: number };
  modal: { confirm_close: boolean; ondismiss: () => void };
  handler: (response: RazorpaySuccess) => void;
};

type RazorpayCheckout = {
  open: () => void;
  on: (event: 'payment.failed', callback: (response: RazorpayFailure) => void) => void;
};

declare global {
  interface Window {
    Razorpay?: new (options: CheckoutOptions) => RazorpayCheckout;
  }
}

let scriptPromise: Promise<void> | null = null;

function loadCheckoutScript() {
  if (window.Razorpay) return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-dealos-razorpay]');
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('Razorpay checkout could not be loaded.')), { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.async = true;
    script.dataset.dealosRazorpay = 'true';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Razorpay checkout could not be loaded. Check your connection and try again.'));
    document.head.appendChild(script);
  }).catch((error) => {
    scriptPromise = null;
    throw error;
  });
  return scriptPromise;
}

async function reportFailure(order: RazorpayOrderDetails, code: string | number, message: string) {
  try {
    await request('/payments/failure', {
      method: 'POST',
      body: JSON.stringify({ paymentRecordId: order.paymentRecordId, razorpayOrderId: order.orderId, code, message }),
    });
  } catch {
    // A signed Razorpay webhook remains the reconciliation fallback.
  }
}

export async function payInvoiceWithRazorpay(invoiceId: string) {
  const order = await request<RazorpayOrderDetails>('/payments/orders', {
    method: 'POST',
    body: JSON.stringify({ invoiceId }),
  });
  if (!order.testMode || !order.keyId.startsWith('rzp_test_')) throw new Error('Checkout was blocked because Razorpay Test Mode is not active.');
  await loadCheckoutScript();
  if (!window.Razorpay) throw new Error('Razorpay checkout is unavailable. Please try again.');

  return new Promise<RazorpayOrderDetails>((resolve, reject) => {
    let settled = false;
    const fail = (code: string | number, message: string) => {
      if (settled) return;
      settled = true;
      void reportFailure(order, code, message);
      reject(new Error(message));
    };
    const checkout = new window.Razorpay!({
      key: order.keyId,
      amount: order.amount,
      currency: order.currency,
      order_id: order.orderId,
      name: 'DealOS',
      description: `Invoice ${order.invoice.number} · TEST MODE`,
      prefill: order.prefill,
      theme: { color: '#ff4f2e' },
      retry: { enabled: true, max_count: 2 },
      modal: {
        confirm_close: true,
        ondismiss: () => fail('CHECKOUT_CANCELLED', 'Payment cancelled. Your invoice was not changed.'),
      },
      handler: (response) => {
        if (settled) return;
        settled = true;
        void request('/payments/verify', {
          method: 'POST',
          body: JSON.stringify({
            paymentRecordId: order.paymentRecordId,
            razorpayOrderId: response.razorpay_order_id,
            razorpayPaymentId: response.razorpay_payment_id,
            razorpaySignature: response.razorpay_signature,
          }),
        }).then(() => resolve(order), reject);
      },
    });
    checkout.on('payment.failed', (response) => fail(
      response.error?.code ?? 'PAYMENT_FAILED',
      response.error?.description ?? 'Razorpay could not complete the payment.',
    ));
    try {
      checkout.open();
    } catch {
      fail('CHECKOUT_OPEN_FAILED', 'Razorpay checkout could not be opened. Please try again.');
    }
  });
}
