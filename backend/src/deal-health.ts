import { Prisma, type AlertKind } from '@prisma/client';

export const STALLED_DEAL_DAYS = 7;

type Candidate = { kind: AlertKind; title: string; detail: string; severity: string; resourceId: string; evaluationKey: string };

export async function evaluateAlerts(tx: Prisma.TransactionClient, organizationId: string, quoteScope: Prisma.QuoteWhereInput, now = new Date()) {
  const quotes = await tx.quote.findMany({
    where: { organizationId, AND: [quoteScope] },
    include: { currentRevision: true, order: { include: { fulfillment: true } } },
  });
  const candidates: Candidate[] = [];
  const stalledBefore = new Date(now.getTime() - STALLED_DEAL_DAYS * 86_400_000);
  for (const quote of quotes) {
    if (!['CONFIRMED', 'REJECTED'].includes(quote.stage) && quote.lastActivity <= stalledBefore) {
      const days = Math.floor((now.getTime() - quote.lastActivity.getTime()) / 86_400_000);
      candidates.push({ kind: 'STALLED', title: `${quote.number} has stalled`, detail: `No persisted deal activity for ${days} days.`, severity: days >= 14 ? 'high' : 'medium', resourceId: quote.id, evaluationKey: `${organizationId}:${quote.id}:STALLED` });
    }
    const risk = Number(quote.currentRevision?.riskScore ?? quote.riskScore);
    if (!['CONFIRMED', 'REJECTED'].includes(quote.stage) && risk > 0) {
      candidates.push({ kind: 'DISCOUNT_ANOMALY', title: `${quote.number} exceeds discount policy`, detail: `The current immutable revision has a persisted discount-risk score of ${risk.toFixed(2)}.`, severity: risk > 5 ? 'high' : 'medium', resourceId: quote.id, evaluationKey: `${organizationId}:${quote.id}:DISCOUNT_ANOMALY` });
    }
    const promisedAt = quote.currentRevision?.promisedDeliveryAt;
    if (quote.stage === 'CONFIRMED' && promisedAt && promisedAt < now && quote.order && !['FULFILLED', 'CANCELLED'].includes(quote.order.state)) {
      candidates.push({ kind: 'DELIVERY_SLIPPAGE', title: `${quote.number} missed its promised delivery date`, detail: `Promised ${promisedAt.toISOString().slice(0, 10)}; current fulfillment is ${quote.order.fulfillment?.state ?? 'not allocated'}.`, severity: 'high', resourceId: quote.id, evaluationKey: `${organizationId}:${quote.id}:DELIVERY_SLIPPAGE` });
    }
  }
  for (const candidate of candidates) {
    await tx.alert.upsert({ where: { evaluationKey: candidate.evaluationKey }, create: { organizationId, ...candidate, lastEvaluatedAt: now }, update: { title: candidate.title, detail: candidate.detail, severity: candidate.severity, resolved: false, resolvedAt: null, lastEvaluatedAt: now } });
  }
  const quoteIds = quotes.map((quote) => quote.id);
  if (quoteIds.length) {
    await tx.alert.updateMany({ where: { organizationId, resourceId: { in: quoteIds }, evaluationKey: { not: null, notIn: candidates.map((candidate) => candidate.evaluationKey) }, resolved: false }, data: { resolved: true, resolvedAt: now, lastEvaluatedAt: now } });
  }
  return { evaluated: quotes.length, active: candidates.length };
}
