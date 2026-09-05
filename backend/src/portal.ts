import { z } from 'zod';

export const sendQuotationSchema = z.object({
  revisionId: z.string().uuid(),
  expectedVersion: z.number().int().nonnegative(),
}).strict();

export const portalCommentSchema = z.object({
  revisionId: z.string().uuid(),
  message: z.string().trim().min(2).max(2000),
  type: z.enum(['COMMENT', 'QUESTION', 'DECLINE_NOTE']).default('COMMENT'),
  requestedDeliveryAt: z.string().datetime().nullable().optional(),
}).strict();

export const portalAcceptSchema = z.object({
  revisionId: z.string().uuid(),
  expectedVersion: z.number().int().nonnegative(),
  termsHash: z.string().min(32).max(128),
}).strict();

export const portalProposalSchema = z.object({
  revisionId: z.string().uuid(),
  expectedVersion: z.number().int().nonnegative(),
  counterDiscount: z.number().min(0).max(100),
  message: z.string().trim().min(2).max(2000),
  requestedDeliveryAt: z.string().datetime().nullable().optional(),
}).strict();

export const proposalResponseSchema = z.object({
  expectedVersion: z.number().int().nonnegative(),
  decision: z.enum(['ADOPT', 'DECLINE']),
  reason: z.string().trim().min(2).max(2000),
}).strict();

export class PortalError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

export function requireExactSentRevision(quote: {
  version: number;
  stage: string;
  sentAt: Date | string | null;
  currentRevisionId: string | null;
  currentRevision: { id: string; state: string } | null;
  order?: unknown | null;
}, input: { revisionId: string; expectedVersion?: number }, allowNegotiation = false) {
  if (input.expectedVersion !== undefined && quote.version !== input.expectedVersion) {
    throw new PortalError(409, 'STALE_VERSION', 'Refresh the quotation before continuing.');
  }
  if (quote.currentRevisionId !== input.revisionId || quote.currentRevision?.id !== input.revisionId) {
    throw new PortalError(409, 'STALE_REVISION', 'This is no longer the current customer-visible revision.');
  }
  if (!quote.sentAt || quote.currentRevision.state !== 'SENT' || quote.order) {
    throw new PortalError(409, 'INVALID_STATE', 'Only the current sent revision can be changed.');
  }
  if (!allowNegotiation && quote.stage !== 'APPROVED') {
    throw new PortalError(409, 'INVALID_STATE', 'This quotation is not currently open for that action.');
  }
}

type SnapshotLine = Record<string, unknown> & {
  productId?: string; name?: string; sku?: string; category?: string; description?: string;
  quantity?: number; unitPrice?: string | number; discount?: string | number;
  gross?: string | number; net?: string | number; tax?: string | number; cadence?: string;
};

function snapshotLines(value: unknown): SnapshotLine[] {
  return Array.isArray(value) ? value.filter((line): line is SnapshotLine => Boolean(line) && typeof line === 'object') : [];
}

const stringValue = (value: unknown, fallback = '0') => value === undefined || value === null ? fallback : String(value);

function customerCadenceTotals(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).map(([cadence, raw]) => {
    const totals = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
    return [cadence, { subtotal: stringValue(totals.subtotal), tax: stringValue(totals.tax), total: stringValue(totals.total) }];
  }));
}

export function customerSafeQuotationDto(quote: any) {
  const revision = quote.currentRevision;
  if (!revision) throw new PortalError(409, 'INVALID_STATE', 'The quotation has no current revision.');
  const hasOpenProposal = (quote.negotiation ?? []).some((item: any) => item.kind === 'PROPOSAL' && item.state === 'OPEN' && item.revisionId === revision.id);
  const accepted = Boolean(quote.order || quote.acceptance);
  const customerStatus = accepted ? 'ACCEPTED' : hasOpenProposal || quote.stage === 'NEGOTIATION' ? 'NEGOTIATION' : 'SENT';
  const lines = snapshotLines(revision.linesSnapshot).map((line, index) => ({
    id: `${revision.id}:${index}`,
    productId: String(line.productId ?? ''),
    quantity: Number(line.quantity ?? 0),
    unitPrice: stringValue(line.unitPrice),
    discount: stringValue(line.discount),
    gross: stringValue(line.gross),
    net: stringValue(line.net),
    tax: stringValue(line.tax),
    cadence: line.cadence ? String(line.cadence) : null,
    product: {
      id: String(line.productId ?? ''), name: String(line.name ?? 'Line item'), sku: String(line.sku ?? ''),
      category: String(line.category ?? ''), description: String(line.description ?? ''),
      recurring: Boolean(line.cadence && line.cadence !== 'One-time'), cadence: line.cadence ? String(line.cadence) : null,
    },
  }));
  return {
    id: quote.id,
    number: quote.number,
    customer: quote.customer,
    customerTier: quote.customerTier,
    stage: customerStatus,
    version: quote.version,
    currentRevisionId: revision.id,
    revisionId: revision.id,
    revisionNumber: revision.revisionNumber,
    revisionState: revision.state,
    termsHash: revision.termsHash,
    currency: revision.currency,
    validUntil: revision.validUntil,
    promisedDeliveryAt: revision.promisedDeliveryAt,
    terms: revision.terms,
    orderDiscount: stringValue(revision.orderDiscount),
    subtotal: stringValue(revision.subtotal),
    taxTotal: stringValue(revision.taxTotal),
    total: stringValue(revision.total),
    totalsByCadence: customerCadenceTotals(revision.totalsByCadence),
    sentAt: revision.sentAt ?? quote.sentAt,
    lines,
    negotiation: (quote.negotiation ?? []).filter((record: any) => record.revisionId === revision.id).map((record: any) => ({
      id: record.id, author: record.author, message: record.message, messageType: record.messageType,
      counterDiscount: record.counterDiscount === null || record.counterDiscount === undefined ? null : String(record.counterDiscount),
      requestedDeliveryAt: record.requestedDeliveryAt, kind: record.kind, state: record.state,
      responseReason: record.responseReason, respondedAt: record.respondedAt, createdAt: record.createdAt,
    })),
    order: quote.order ? { id: quote.order.id, number: quote.order.number, state: quote.order.state } : null,
    capabilities: {
      comment: Boolean(quote.sentAt),
      accept: !accepted && !hasOpenProposal && quote.stage === 'APPROVED' && revision.state === 'SENT',
      propose: !accepted && !hasOpenProposal && quote.stage === 'APPROVED' && revision.state === 'SENT',
    },
    approvals: [],
    fulfillment: null,
    invoices: [],
  };
}

export function idempotencyKey(header: string | string[] | undefined) {
  const value = Array.isArray(header) ? header[0] : header;
  if (!value || !/^[A-Za-z0-9._:-]{16,128}$/.test(value)) {
    throw new PortalError(422, 'IDEMPOTENCY_KEY_REQUIRED', 'A valid Idempotency-Key header is required.');
  }
  return value;
}
