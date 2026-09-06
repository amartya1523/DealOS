import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { evaluateAlerts } from '../src/deal-health.js';
import { aggregateSales, reportAsPdf, reportAsXls } from '../src/reporting.js';

describe('continuing operations', () => {
  it('evaluates persisted quote state into all three supported health signals', async () => {
    const upsert = vi.fn(async (_args: any) => ({}));
    const now = new Date('2026-09-06T00:00:00.000Z');
    const tx: any = {
      quote: { findMany: vi.fn(async () => [
        { id: 'stalled', number: 'Q-1', stage: 'APPROVED', lastActivity: new Date('2026-08-20'), riskScore: 0, currentRevision: { riskScore: 0, promisedDeliveryAt: null }, order: null },
        { id: 'discount', number: 'Q-2', stage: 'PENDING_APPROVAL', lastActivity: now, riskScore: 9, currentRevision: { riskScore: 9, promisedDeliveryAt: null }, order: null },
        { id: 'late', number: 'Q-3', stage: 'CONFIRMED', lastActivity: now, riskScore: 0, currentRevision: { riskScore: 0, promisedDeliveryAt: new Date('2026-09-01') }, order: { state: 'CONFIRMED', fulfillment: { state: 'BACKORDER' } } },
      ]) },
      alert: { upsert, updateMany: vi.fn(async () => ({ count: 0 })) },
    };
    const result = await evaluateAlerts(tx, 'org-1', {}, now);
    expect(result).toEqual({ evaluated: 3, active: 3 });
    expect(upsert.mock.calls.map((call) => call[0].create.kind)).toEqual(['STALLED', 'DISCOUNT_ANOMALY', 'DELIVERY_SLIPPAGE']);
  });

  it('aggregates frozen order lines and real receivable state', async () => {
    const tx: any = { order: { findMany: vi.fn(async () => [{
      id: 'order-1', number: 'SO-1', quoteId: 'quote-1', customerId: 'customer-1', state: 'CONFIRMED', currency: 'INR', createdAt: new Date('2026-09-01'),
      quote: { number: 'Q-1', customer: 'Acme', owner: { id: 'rep-1', name: 'Riya' } },
      lines: [{ productId: 'product-1', snapshot: { net: 100, tax: 18 } }, { productId: 'product-2', snapshot: { net: 200, tax: 36 } }],
      invoices: [{ amount: 354, paidAmount: 100, state: 'PARTIAL' }],
    }]) } };
    const report = await aggregateSales(tx, 'org-1', {}, {});
    expect(report.rows[0]).toMatchObject({ total: 354, invoiced: 354, paid: 100, outstanding: 254 });
    expect(report.totalsByCurrency.INR).toMatchObject({ sales: 354, outstanding: 254 });
    expect(reportAsPdf(report).subarray(0, 4).toString()).toBe('%PDF');
    const workbook = await reportAsXls(report);
    expect(workbook.subarray(0,2).toString()).toBe('PK');
  });

  it('does not expose a customer portal payment-processing route', async () => {
    const source = await readFile(new URL('../src/app.ts', import.meta.url), 'utf8');
    expect(source).not.toContain("app.post('/api/v1/portal/invoices/:id/pay'");
  });
});
