import crypto from 'node:crypto';
import { Prisma, type SubscriptionChangeKind, type SubscriptionState } from '@prisma/client';

// Proposed initial policy (PRD): replace with organization billing terms once confirmed.
export const DEFAULT_CONFIRMATION_INVOICE_DUE_DAYS = 14;

export class BillingError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

type JsonRecord = Record<string, unknown>;
const record = (value: unknown): JsonRecord => value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
const decimal = (value: unknown) => new Prisma.Decimal(String(value ?? 0));
const asJson = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const addDays = (value: Date, days: number) => new Date(value.getTime() + days * 86_400_000);

export function nextBillingDate(from: Date, cadence: string) {
  const months = cadence.toLowerCase() === 'quarterly' ? 3 : cadence.toLowerCase() === 'yearly' ? 12 : 1;
  const anchor = from.getUTCDate();
  const targetMonth = from.getUTCMonth() + months;
  const year = from.getUTCFullYear() + Math.floor(targetMonth / 12);
  const month = targetMonth % 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(anchor, lastDay), from.getUTCHours(), from.getUTCMinutes(), from.getUTCSeconds(), from.getUTCMilliseconds()));
}

function customerSafeInvoiceLine(snapshotValue: unknown, quantity: number, productId: string, cadence: string | null) {
  const snapshot = record(snapshotValue);
  const net = decimal(snapshot.net);
  const tax = decimal(snapshot.tax);
  return {
    description: String(snapshot.description ?? snapshot.name ?? 'Order charge'),
    productId,
    cadence: cadence ?? 'One-time',
    quantity,
    unitPrice: decimal(snapshot.unitPrice).toDecimalPlaces(2).toNumber(),
    discount: decimal(snapshot.discount).toNumber(),
    net: net.toDecimalPlaces(2).toNumber(),
    tax: tax.toDecimalPlaces(2).toNumber(),
    amount: net.add(tax).toDecimalPlaces(2).toNumber(),
  };
}

type ConfirmationBillingInput = {
  organizationId: string;
  actorId: string;
  requestId?: string;
  confirmedAt: Date;
  quote: { id: string; number: string; customer: string; customerId: string };
  revision: { id: string; total: unknown; currency: string };
  order: { id: string; number: string; lines: Array<{ id: string; productId: string; quantity: number; recurring: boolean; cadence: string | null; snapshot: unknown }> };
};

export async function createConfirmationBilling(tx: Prisma.TransactionClient, input: ConfirmationBillingInput) {
  const invoiceLines = input.order.lines.map((line) => customerSafeInvoiceLine(line.snapshot, line.quantity, line.productId, line.cadence));
  const invoice = await tx.invoice.create({
    data: {
      organizationId: input.organizationId,
      number: `INV-${input.order.number.replace(/^SO-/, '')}`,
      billingKey: `ORDER_CONFIRMATION:${input.order.id}`,
      quoteId: input.quote.id,
      customer: input.quote.customer,
      customerId: input.quote.customerId,
      orderId: input.order.id,
      currency: input.revision.currency,
      amount: decimal(input.revision.total),
      dueAt: addDays(input.confirmedAt, DEFAULT_CONFIRMATION_INVOICE_DUE_DAYS),
      lines: asJson(invoiceLines),
    },
  });

  const recurring = input.order.lines.filter((line) => line.recurring && line.cadence);
  const subscriptions = await Promise.all(recurring.map((line) => {
    const snapshot = record(line.snapshot);
    const amount = decimal(snapshot.net).add(decimal(snapshot.tax)).toDecimalPlaces(2);
    return tx.subscription.create({ data: {
      organizationId: input.organizationId,
      customer: input.quote.customer,
      customerId: input.quote.customerId,
      quoteId: input.quote.id,
      orderId: input.order.id,
      orderLineId: line.id,
      productId: line.productId,
      productName: String(snapshot.name ?? snapshot.description ?? 'Recurring plan'),
      cadence: line.cadence!,
      amount,
      nextBillAt: nextBillingDate(input.confirmedAt, line.cadence!),
    } });
  }));

  await tx.auditEvent.create({ data: { organizationId: input.organizationId, actorId: input.actorId, action: 'INVOICE_ISSUED_ON_CONFIRMATION', resource: 'Invoice', resourceId: invoice.id, revisionId: input.revision.id, requestId: input.requestId, reason: `Combined first invoice for ${input.order.number}; ${DEFAULT_CONFIRMATION_INVOICE_DUE_DAYS}-day proposed default.` } });
  for (const subscription of subscriptions) {
    await tx.auditEvent.create({ data: { organizationId: input.organizationId, actorId: input.actorId, action: 'SUBSCRIPTION_CREATED', resource: 'Subscription', resourceId: subscription.id, revisionId: input.revision.id, requestId: input.requestId, reason: `Created from recurring order line on ${input.order.number}.` } });
  }
  return { invoice, subscriptions };
}

const paymentFingerprint = (value: unknown) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const paymentTotal = (payments: Array<{ amount: unknown; reversalOfId: string | null }>) => payments.reduce((sum, payment) => payment.reversalOfId ? sum.sub(decimal(payment.amount)) : sum.add(decimal(payment.amount)), decimal(0));
const invoiceState = (paid: Prisma.Decimal, total: Prisma.Decimal) => paid.isZero() ? 'UNPAID' as const : paid.greaterThanOrEqualTo(total) ? 'PAID' as const : 'PARTIAL' as const;

type RecordPaymentInput = { organizationId: string; actorId: string; invoiceId: string; amount: number; currency: string; reference: string; paidAt: Date; idempotencyKey: string; requestId?: string };

export async function recordPayment(tx: Prisma.TransactionClient, input: RecordPaymentInput) {
  await tx.$queryRaw`SELECT "id" FROM "Invoice" WHERE "id" = ${input.invoiceId} FOR UPDATE`;
  const invoice = await tx.invoice.findFirst({ where: { id: input.invoiceId, organizationId: input.organizationId } });
  if (!invoice) throw new BillingError(404, 'NOT_FOUND', 'Invoice not found.');
  if (input.currency !== invoice.currency) throw new BillingError(422, 'CURRENCY_MISMATCH', `Record this payment in ${invoice.currency}.`);
  const fingerprint = paymentFingerprint({ amount: input.amount, currency: input.currency, reference: input.reference, paidAt: input.paidAt.toISOString() });
  const replay = await tx.idempotencyRecord.findUnique({ where: { actorId_operation_resourceKey_key: { actorId: input.actorId, operation: 'BILLING_RECORD_PAYMENT', resourceKey: invoice.id, key: input.idempotencyKey } } });
  if (replay && replay.payloadHash !== fingerprint) throw new BillingError(409, 'IDEMPOTENCY_CONFLICT', 'This idempotency key was already used for different payment evidence.');
  if (replay) return tx.invoice.findUniqueOrThrow({ where: { id: invoice.id }, include: { payments: true } });
  const duplicate = await tx.payment.findUnique({ where: { invoiceId_reference: { invoiceId: invoice.id, reference: input.reference } } });
  if (duplicate) {
    if (decimal(duplicate.amount).equals(decimal(input.amount)) && duplicate.paidAt.getTime() === input.paidAt.getTime()) return tx.invoice.findUniqueOrThrow({ where: { id: invoice.id }, include: { payments: true } });
    throw new BillingError(409, 'PAYMENT_REFERENCE_EXISTS', 'This settlement reference is already recorded with different evidence.');
  }
  const ledger = await tx.payment.findMany({ where: { invoiceId: invoice.id }, select: { amount: true, reversalOfId: true } });
  const paid = paymentTotal(ledger);
  const amount = decimal(input.amount).toDecimalPlaces(2);
  const total = decimal(invoice.amount);
  if (amount.lessThanOrEqualTo(0)) throw new BillingError(422, 'VALIDATION_ERROR', 'Payment amount must be positive.');
  if (paid.add(amount).greaterThan(total)) throw new BillingError(422, 'AMOUNT_EXCEEDS_BALANCE', 'Payment exceeds the outstanding balance.');
  const payment = await tx.payment.create({ data: { invoiceId: invoice.id, amount, reference: input.reference, paidAt: input.paidAt } });
  const newPaid = paid.add(amount);
  const result = await tx.invoice.update({ where: { id: invoice.id }, data: { paidAmount: newPaid, state: invoiceState(newPaid, total), version: { increment: 1 } }, include: { payments: true } });
  await tx.idempotencyRecord.create({ data: { actorId: input.actorId, operation: 'BILLING_RECORD_PAYMENT', resourceKey: invoice.id, key: input.idempotencyKey, payloadHash: fingerprint, responseStatus: 201, responseBody: asJson({ invoiceId: invoice.id, paymentId: payment.id }) } });
  await tx.auditEvent.create({ data: { organizationId: input.organizationId, actorId: input.actorId, action: 'PAYMENT_RECORDED', resource: 'Invoice', resourceId: invoice.id, requestId: input.requestId, reason: `${input.currency} ${amount.toFixed(2)} · ${input.reference}` } });
  return result;
}

type ReversePaymentInput = { organizationId: string; actorId: string; invoiceId: string; paymentId: string; reason: string; requestId?: string };

export async function reversePayment(tx: Prisma.TransactionClient, input: ReversePaymentInput) {
  await tx.$queryRaw`SELECT "id" FROM "Invoice" WHERE "id" = ${input.invoiceId} FOR UPDATE`;
  const invoice = await tx.invoice.findFirst({ where: { id: input.invoiceId, organizationId: input.organizationId } });
  if (!invoice) throw new BillingError(404, 'NOT_FOUND', 'Invoice not found.');
  const original = await tx.payment.findFirst({ where: { id: input.paymentId, invoiceId: invoice.id }, include: { reversal: true } });
  if (!original) throw new BillingError(404, 'NOT_FOUND', 'Payment not found.');
  if (original.reversalOfId) throw new BillingError(409, 'INVALID_STATE', 'A compensating entry cannot itself be reversed.');
  if (original.reversal) return tx.invoice.findUniqueOrThrow({ where: { id: invoice.id }, include: { payments: true } });
  const ledger = await tx.payment.findMany({ where: { invoiceId: invoice.id }, select: { amount: true, reversalOfId: true } });
  const nextPaid = paymentTotal(ledger).sub(decimal(original.amount));
  if (nextPaid.lessThan(0)) throw new BillingError(409, 'LEDGER_MISMATCH', 'This reversal would make the recorded balance negative.');
  await tx.payment.create({ data: { invoiceId: invoice.id, amount: original.amount, reference: `REV-${original.id}`, paidAt: new Date(), reversalOfId: original.id, reason: input.reason } });
  const result = await tx.invoice.update({ where: { id: invoice.id }, data: { paidAmount: nextPaid, state: invoiceState(nextPaid, decimal(invoice.amount)), version: { increment: 1 } }, include: { payments: true } });
  await tx.auditEvent.create({ data: { organizationId: input.organizationId, actorId: input.actorId, action: 'PAYMENT_REVERSED', resource: 'Invoice', resourceId: invoice.id, requestId: input.requestId, reason: input.reason } });
  return result;
}

type ChangeSubscriptionInput = { organizationId: string; actorId: string; subscriptionId: string; expectedVersion: number; amount?: number; action?: 'PAUSE'|'RESUME'|'CANCEL'; reason: string; effectiveAt: Date; requestId?: string };

export async function changeSubscription(tx: Prisma.TransactionClient, input: ChangeSubscriptionInput) {
  if ((input.amount === undefined) === (input.action === undefined)) throw new BillingError(422, 'VALIDATION_ERROR', 'Choose exactly one amount or lifecycle change.');
  await tx.$queryRaw`SELECT "id" FROM "Subscription" WHERE "id" = ${input.subscriptionId} FOR UPDATE`;
  const subscription = await tx.subscription.findFirst({ where: { id: input.subscriptionId, organizationId: input.organizationId } });
  if (!subscription) throw new BillingError(404, 'NOT_FOUND', 'Subscription not found.');
  if (subscription.version !== input.expectedVersion) throw new BillingError(409, 'STALE_VERSION', 'Refresh the subscription before changing it.');
  if (subscription.state === 'CANCELLED') throw new BillingError(409, 'INVALID_STATE', 'A cancelled subscription cannot be changed.');
  if (input.action === 'PAUSE' && subscription.state !== 'ACTIVE') throw new BillingError(409, 'INVALID_STATE', 'Only an active subscription can be paused.');
  if (input.action === 'RESUME' && subscription.state !== 'PAUSED') throw new BillingError(409, 'INVALID_STATE', 'Only a paused subscription can be resumed.');
  const nextState: SubscriptionState = input.action === 'PAUSE' ? 'PAUSED' : input.action === 'RESUME' ? 'ACTIVE' : input.action === 'CANCEL' ? 'CANCELLED' : subscription.state;
  const kind: SubscriptionChangeKind = input.action === 'PAUSE' ? 'PAUSED' : input.action === 'RESUME' ? 'RESUMED' : input.action === 'CANCEL' ? 'CANCELLED' : 'AMOUNT_CHANGED';
  const nextAmount = input.amount === undefined ? decimal(subscription.amount) : decimal(input.amount).toDecimalPlaces(2);
  if (nextAmount.lessThanOrEqualTo(0)) throw new BillingError(422, 'VALIDATION_ERROR', 'Subscription amount must be positive.');
  const updated = await tx.subscription.update({ where: { id: subscription.id }, data: { amount: nextAmount, state: nextState, cancelledAt: input.action === 'CANCEL' ? input.effectiveAt : subscription.cancelledAt, version: { increment: 1 } } });
  await tx.subscriptionChange.create({ data: { subscriptionId: subscription.id, actorId: input.actorId, kind, previousAmount: subscription.amount, newAmount: nextAmount, previousState: subscription.state, newState: nextState, effectiveAt: input.effectiveAt, reason: input.reason } });
  await tx.auditEvent.create({ data: { organizationId: input.organizationId, actorId: input.actorId, action: `SUBSCRIPTION_${kind}`, resource: 'Subscription', resourceId: subscription.id, requestId: input.requestId, reason: input.reason } });
  return updated;
}

type DueDateRequestInput = { organizationId: string; customerId: string; actorId: string; invoiceId: string; requestedDueAt: Date; message: string; requestId?: string };

export async function requestInvoiceDueDateChange(tx: Prisma.TransactionClient, input: DueDateRequestInput) {
  const invoice = await tx.invoice.findFirst({ where: { id: input.invoiceId, organizationId: input.organizationId, customerId: input.customerId } });
  if (!invoice) throw new BillingError(404, 'NOT_FOUND', 'Invoice not found.');
  const note = await tx.invoiceNote.create({ data: { invoiceId: invoice.id, customerId: input.customerId, authorId: input.actorId, kind: 'DUE_DATE_CHANGE_REQUEST', requestedDueAt: input.requestedDueAt, message: input.message } });
  await tx.auditEvent.create({ data: { organizationId: input.organizationId, actorId: input.actorId, action: 'CUSTOMER_REQUESTED_DUE_DATE_CHANGE', resource: 'Invoice', resourceId: invoice.id, requestId: input.requestId, reason: `${input.requestedDueAt.toISOString().slice(0, 10)}: ${input.message}` } });
  return note;
}
