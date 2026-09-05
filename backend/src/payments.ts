import crypto from 'node:crypto';
import Razorpay from 'razorpay';

export type RazorpayConfiguration = {
  enabled: boolean;
  keyId: string;
  keySecret: string;
  webhookSecret: string;
  testMode: true;
};

export function readRazorpayConfiguration(env: NodeJS.ProcessEnv = process.env): RazorpayConfiguration {
  const keyId = env.RAZORPAY_KEY_ID?.trim() ?? '';
  const keySecret = env.RAZORPAY_KEY_SECRET?.trim() ?? '';
  const webhookSecret = env.RAZORPAY_WEBHOOK_SECRET?.trim() ?? '';
  const configured = [keyId, keySecret, webhookSecret].filter(Boolean).length;
  if (configured === 0) return { enabled: false, keyId: '', keySecret: '', webhookSecret: '', testMode: true };
  if (configured !== 3) throw new Error('RAZORPAY_CONFIGURATION_INCOMPLETE');
  if (!keyId.startsWith('rzp_test_')) throw new Error('RAZORPAY_TEST_KEY_REQUIRED');
  if (keySecret.length < 8 || webhookSecret.length < 8) throw new Error('RAZORPAY_SECRET_INVALID');
  return { enabled: true, keyId, keySecret, webhookSecret, testMode: true };
}

export function rupeesToPaise(value: string): number {
  const normalized = value.trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) throw new Error('INVALID_MONEY');
  const parts = normalized.split('.');
  const whole = parts[0]!;
  const fraction = parts[1] ?? '';
  const paise = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  if (paise <= 0n || paise > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('INVALID_MONEY');
  return Number(paise);
}

function safeHexEqual(left: string, right: string) {
  if (!/^[a-f0-9]{64}$/i.test(left) || !/^[a-f0-9]{64}$/i.test(right)) return false;
  return crypto.timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}

export function verifyCheckoutSignature(orderId: string, paymentId: string, signature: string, secret: string) {
  const expected = crypto.createHmac('sha256', secret).update(`${orderId}|${paymentId}`).digest('hex');
  return safeHexEqual(expected, signature);
}

export function verifyWebhookSignature(rawBody: Buffer, signature: string, secret: string) {
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  return safeHexEqual(expected, signature);
}

export function paymentWebhookKey(rawBody: Buffer, eventId?: string) {
  const cleanEventId = eventId?.trim();
  return cleanEventId && cleanEventId.length <= 200
    ? `razorpay:${cleanEventId}`
    : `body:${crypto.createHash('sha256').update(rawBody).digest('hex')}`;
}

export function createRazorpayClient(config: RazorpayConfiguration) {
  if (!config.enabled) throw new Error('RAZORPAY_NOT_CONFIGURED');
  return new Razorpay({ key_id: config.keyId, key_secret: config.keySecret });
}
