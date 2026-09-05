import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { paymentWebhookKey, readRazorpayConfiguration, rupeesToPaise, verifyCheckoutSignature, verifyWebhookSignature } from '../src/payments.js';

describe('Razorpay payment security helpers', () => {
  it('allows only a complete test-mode configuration', () => {
    expect(readRazorpayConfiguration({})).toMatchObject({ enabled: false, testMode: true });
    expect(() => readRazorpayConfiguration({ RAZORPAY_KEY_ID: 'rzp_live_key', RAZORPAY_KEY_SECRET: 'secret-value', RAZORPAY_WEBHOOK_SECRET: 'webhook-value' })).toThrow('RAZORPAY_TEST_KEY_REQUIRED');
    expect(() => readRazorpayConfiguration({ RAZORPAY_KEY_ID: 'rzp_test_key' })).toThrow('RAZORPAY_CONFIGURATION_INCOMPLETE');
    expect(readRazorpayConfiguration({ RAZORPAY_KEY_ID: 'rzp_test_key', RAZORPAY_KEY_SECRET: 'secret-value', RAZORPAY_WEBHOOK_SECRET: 'webhook-value' })).toMatchObject({ enabled: true, keyId: 'rzp_test_key' });
  });

  it('converts decimal rupees to integer paise without floating point arithmetic', () => {
    expect(rupeesToPaise('1121')).toBe(112100);
    expect(rupeesToPaise('1121.05')).toBe(112105);
    expect(() => rupeesToPaise('1.009')).toThrow('INVALID_MONEY');
    expect(() => rupeesToPaise('0')).toThrow('INVALID_MONEY');
  });

  it('accepts only the expected checkout signature', () => {
    const signature = crypto.createHmac('sha256', 'test-secret').update('order_1|pay_1').digest('hex');
    expect(verifyCheckoutSignature('order_1', 'pay_1', signature, 'test-secret')).toBe(true);
    expect(verifyCheckoutSignature('order_2', 'pay_1', signature, 'test-secret')).toBe(false);
    expect(verifyCheckoutSignature('order_1', 'pay_1', 'not-a-signature', 'test-secret')).toBe(false);
  });

  it('verifies the exact raw webhook bytes and derives stable idempotency keys', () => {
    const body = Buffer.from('{"event":"payment.captured"}');
    const signature = crypto.createHmac('sha256', 'webhook-secret').update(body).digest('hex');
    expect(verifyWebhookSignature(body, signature, 'webhook-secret')).toBe(true);
    expect(verifyWebhookSignature(Buffer.from(`${body} `), signature, 'webhook-secret')).toBe(false);
    expect(paymentWebhookKey(body, 'event-1')).toBe('razorpay:event-1');
    expect(paymentWebhookKey(body)).toBe(paymentWebhookKey(body));
  });
});
