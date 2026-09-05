import { describe, expect, it } from 'vitest';
import { customerSafeQuotationDto, PortalError, requireExactSentRevision } from '../src/portal.js';

const revision = {
  id: 'revision-1', revisionNumber: 3, state: 'SENT', termsHash: 'hash', currency: 'INR', validUntil: null,
  promisedDeliveryAt: null, terms: 'Net 30', orderDiscount: 5, subtotal: 95, taxTotal: 18, total: 113,
  totalsByCadence: { 'One-time': { subtotal: 95, tax: 18, total: 113, margin: 45 } }, sentAt: new Date('2026-09-06T10:00:00Z'),
  linesSnapshot: [{ productId: 'product-1', name: 'Frozen name', sku: 'SKU-1', quantity: 1, unitPrice: '100', unitCost: '50', discount: 5, net: 95, lineCost: 50, cadence: 'One-time' }],
};

describe('customer portal quotation boundary', () => {
  it('projects the frozen SENT snapshot and strips cost fields', () => {
    const dto = customerSafeQuotationDto({ id: 'quote-1', number: 'Q-1', customer: 'Acme', customerTier: 'Gold', stage: 'APPROVED', version: 4, sentAt: revision.sentAt, currentRevision: revision, negotiation: [], order: null });
    expect(dto.stage).toBe('SENT');
    expect(dto.lines[0]?.product.name).toBe('Frozen name');
    expect(dto.lines[0]).not.toHaveProperty('unitCost');
    expect(JSON.stringify(dto)).not.toContain('lineCost');
    expect(JSON.stringify(dto)).not.toContain('margin');
    expect(dto.capabilities).toMatchObject({ comment: true, accept: true, propose: true });
  });

  it('rejects stale and superseded revisions', () => {
    const quote = { version: 4, stage: 'APPROVED', sentAt: revision.sentAt, currentRevisionId: revision.id, currentRevision: revision, order: null };
    expect(() => requireExactSentRevision(quote, { revisionId: revision.id, expectedVersion: 3 })).toThrowError(PortalError);
    expect(() => requireExactSentRevision({ ...quote, currentRevision: { ...revision, state: 'SUPERSEDED' } }, { revisionId: revision.id, expectedVersion: 4 })).toThrowError(/current sent revision/);
  });

  it('keeps a declined counter visible while restoring accept capability', () => {
    const dto = customerSafeQuotationDto({ id: 'quote-1', number: 'Q-1', customer: 'Acme', customerTier: 'Gold', stage: 'APPROVED', version: 5, sentAt: revision.sentAt, currentRevision: revision, order: null, negotiation: [{ id: 'proposal-1', revisionId: revision.id, kind: 'PROPOSAL', state: 'DECLINED', author: 'Customer', message: 'Please offer 8%', messageType: 'COUNTER_DISCOUNT', counterDiscount: 8, responseReason: 'Final price', respondedAt: new Date(), createdAt: new Date() }] });
    expect(dto.stage).toBe('SENT');
    expect(dto.capabilities.accept).toBe(true);
    expect(dto.negotiation[0]).toMatchObject({ state: 'DECLINED', responseReason: 'Final price' });
  });
});
