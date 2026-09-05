import { describe, expect, it } from 'vitest';
import { renderQuotationPdf } from '../src/quotation-pdf.js';

describe('customer quotation PDF', () => {
  it('renders a non-empty PDF without exposing internal commercial fields', async () => {
    const pdf = await renderQuotationPdf({
      organization: { name: 'DealOS' },
      quotation: {
        number: 'Q-TEST-001', customer: 'Beta Industries', customerTier: 'Silver', revisionNumber: 3,
        state: 'APPROVED', currency: 'INR', validUntil: '2026-10-01T00:00:00.000Z', promisedDeliveryAt: null,
        terms: 'Payment due within 30 days.', subtotal: '1000', taxTotal: '180', total: '1180', sentAt: null,
      },
      lines: [{ name: 'Implementation', sku: 'SVC-01', description: 'Customer onboarding', quantity: 1, unitPrice: '1000', discount: '0', net: '1000', cadence: null }],
    });

    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(1_500);
    expect(pdf.toString('latin1')).not.toContain('unitCost');
    expect(pdf.toString('latin1')).not.toContain('margin');
  });
});
