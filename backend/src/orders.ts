import crypto from 'node:crypto';
import { Prisma } from '@prisma/client';
import { createConfirmationBilling } from './billing.js';

export class OrderConfirmationError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

type ConfirmationQuote = {
  id: string; number: string; organizationId: string; customerId: string; customer: string; version: number; stage: string;
  sentAt: Date | null; currentRevisionId: string | null; currentRevision: any; order: any | null;
  acceptance: any | null; approvalCases: Array<{ revisionId: string; state: string }>;
  lines: Array<{ id: string; productId: string }>;
};

type ConfirmationInput = {
  actorId: string;
  organizationId: string;
  customerId: string;
  quoteId: string;
  revisionId: string;
  expectedVersion: number;
  termsHash: string;
  idempotencyKey: string;
  requestId?: string;
};

const asJson = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const payloadHash = (input: ConfirmationInput) => crypto.createHash('sha256').update(JSON.stringify({
  quoteId: input.quoteId, revisionId: input.revisionId, expectedVersion: input.expectedVersion, termsHash: input.termsHash,
})).digest('hex');

export function validateEligibleRevision(quote: ConfirmationQuote, input: Pick<ConfirmationInput, 'revisionId'|'expectedVersion'|'termsHash'>) {
  const revision = quote.currentRevision;
  if (quote.currentRevisionId !== input.revisionId || revision?.id !== input.revisionId) {
    throw new OrderConfirmationError(409, 'INVALID_STATE', 'Only the exact current sent revision can be accepted.');
  }
  if (quote.version !== input.expectedVersion) throw new OrderConfirmationError(409, 'INVALID_STATE', 'Refresh the quotation before accepting it.');
  if (quote.stage !== 'APPROVED' || !quote.sentAt || revision.state !== 'SENT') {
    throw new OrderConfirmationError(409, 'INVALID_STATE', 'Only an approved revision that was sent to this customer can be accepted.');
  }
  if (revision.termsHash !== input.termsHash) throw new OrderConfirmationError(409, 'INVALID_STATE', 'The quotation terms have changed. Refresh before accepting.');
  if (revision.validUntil && new Date(revision.validUntil) < new Date()) throw new OrderConfirmationError(409, 'INVALID_STATE', 'This quotation has expired.');
  if (!quote.approvalCases.some((approval) => approval.revisionId === revision.id && approval.state === 'APPROVED')) {
    throw new OrderConfirmationError(409, 'INVALID_STATE', 'This exact revision has not completed approval.');
  }
}

function frozenLines(value: unknown) {
  if (!Array.isArray(value) || !value.length) throw new OrderConfirmationError(409, 'INVALID_SNAPSHOT', 'The sent quotation has no frozen commercial lines.');
  return value.map((line, index) => {
    if (!line || typeof line !== 'object') throw new OrderConfirmationError(409, 'INVALID_SNAPSHOT', `Frozen line ${index + 1} is invalid.`);
    const item = line as Record<string, unknown>;
    const productId = String(item.productId ?? '');
    const quantity = Number(item.quantity ?? 0);
    if (!productId || !Number.isInteger(quantity) || quantity <= 0) throw new OrderConfirmationError(409, 'INVALID_SNAPSHOT', `Frozen line ${index + 1} is invalid.`);
    return { item, productId, quantity, cadence: item.cadence ? String(item.cadence) : null };
  });
}

function replayBody(value: Prisma.JsonValue) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new OrderConfirmationError(409, 'IDEMPOTENCY_CONFLICT', 'The stored response is invalid.');
  return value as Record<string, unknown>;
}

export async function confirmEligibleRevision(tx: Prisma.TransactionClient, input: ConfirmationInput) {
  const operation = 'PORTAL_ACCEPT_QUOTATION';
  const fingerprint = payloadHash(input);
  const replay = await tx.idempotencyRecord.findUnique({ where: { actorId_operation_resourceKey_key: { actorId: input.actorId, operation, resourceKey: input.quoteId, key: input.idempotencyKey } } });
  if (replay) {
    if (replay.payloadHash !== fingerprint) throw new OrderConfirmationError(409, 'IDEMPOTENCY_CONFLICT', 'This idempotency key was already used with different acceptance data.');
    return { ...replayBody(replay.responseBody), replayed: true };
  }

  await tx.$queryRaw`SELECT "id" FROM "Quote" WHERE "id" = ${input.quoteId} FOR UPDATE`;
  // A matching request may have committed while this transaction waited for the quote lock.
  const lockedReplay = await tx.idempotencyRecord.findUnique({ where: { actorId_operation_resourceKey_key: { actorId: input.actorId, operation, resourceKey: input.quoteId, key: input.idempotencyKey } } });
  if (lockedReplay) {
    if (lockedReplay.payloadHash !== fingerprint) throw new OrderConfirmationError(409, 'IDEMPOTENCY_CONFLICT', 'This idempotency key was already used with different acceptance data.');
    return { ...replayBody(lockedReplay.responseBody), replayed: true };
  }
  const quote = await tx.quote.findFirst({
    where: { id: input.quoteId, organizationId: input.organizationId, customerId: input.customerId },
    include: { currentRevision: true, order: { include: { invoices: { select: { id: true } }, subscriptions: { select: { id: true } } } }, acceptance: true, approvalCases: { select: { revisionId: true, state: true } }, lines: { select: { id: true, productId: true } } },
  }) as ConfirmationQuote | null;
  if (!quote) throw new OrderConfirmationError(404, 'NOT_FOUND', 'Quotation not found.');

  if (quote.order) {
    if (quote.order.revisionId !== input.revisionId || quote.acceptance?.termsHash !== input.termsHash) {
      throw new OrderConfirmationError(409, 'ALREADY_CONFIRMED', 'This quotation was already confirmed from another revision.');
    }
    const body = { acceptanceId: quote.acceptance.id, orderId: quote.order.id, orderNumber: quote.order.number, revisionId: quote.order.revisionId, invoiceId: quote.order.invoices[0]?.id ?? null, subscriptionIds: quote.order.subscriptions.map((item: {id:string}) => item.id), state: 'CONFIRMED' };
    await tx.idempotencyRecord.create({ data: { actorId: input.actorId, operation, resourceKey: input.quoteId, key: input.idempotencyKey, payloadHash: fingerprint, responseStatus: 200, responseBody: asJson(body) } });
    return { ...body, replayed: true };
  }

  validateEligibleRevision(quote, input);
  const lines = frozenLines(quote.currentRevision.linesSnapshot);
  const quoteLineIds = new Map<string, string[]>();
  for (const line of quote.lines) quoteLineIds.set(line.productId, [...(quoteLineIds.get(line.productId) ?? []), line.id]);
  const orderLineData = lines.map(({ item, productId, quantity, cadence }) => {
    const available = quoteLineIds.get(productId) ?? [];
    const quoteLineId = available.shift();
    quoteLineIds.set(productId, available);
    if (!quoteLineId) throw new OrderConfirmationError(409, 'INVALID_SNAPSHOT', 'The frozen quotation line no longer has a matching source line.');
    return { quoteLineId, productId, quantity, recurring: Boolean(cadence && cadence !== 'One-time'), cadence: cadence === 'One-time' ? null : cadence, snapshot: asJson(item) };
  });
  const acceptance = await tx.customerAcceptance.create({ data: { quoteId: quote.id, revisionId: input.revisionId, customerId: quote.customerId, acceptedById: input.actorId, termsHash: input.termsHash } });
  const order = await tx.order.create({
    data: { number: `SO-${quote.number.replace(/^Q-/, '')}`, quoteId: quote.id, revisionId: input.revisionId, acceptanceId: acceptance.id, customerId: quote.customerId, currency: quote.currentRevision.currency, lines: { create: orderLineData } },
    include: { lines: true },
  });
  const billing = await createConfirmationBilling(tx, { organizationId: input.organizationId, actorId: input.actorId, requestId: input.requestId, confirmedAt: acceptance.acceptedAt, quote: { id: quote.id, number: quote.number, customer: quote.customer, customerId: quote.customerId }, revision: { id: input.revisionId, total: quote.currentRevision.total, currency: quote.currentRevision.currency }, order });
  await tx.quote.update({ where: { id: quote.id }, data: { stage: 'CONFIRMED', version: { increment: 1 }, lastActivity: new Date() } });
  await tx.auditEvent.create({ data: { organizationId: input.organizationId, actorId: input.actorId, action: 'CUSTOMER_ACCEPTED', resource: 'Quote', resourceId: quote.id, revisionId: input.revisionId, requestId: input.requestId } });
  const body = { acceptanceId: acceptance.id, orderId: order.id, orderNumber: order.number, revisionId: input.revisionId, invoiceId: billing.invoice.id, subscriptionIds: billing.subscriptions.map((item) => item.id), state: 'CONFIRMED' };
  await tx.idempotencyRecord.create({ data: { actorId: input.actorId, operation, resourceKey: input.quoteId, key: input.idempotencyKey, payloadHash: fingerprint, responseStatus: 201, responseBody: asJson(body) } });
  return { ...body, replayed: false };
}
