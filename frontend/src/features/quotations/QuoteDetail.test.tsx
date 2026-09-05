import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Product, Quote } from '../../api';
import { QuoteDetail } from './QuoteDetail';

const fetchMock = vi.fn();
const product:Product = {
  id:'b1e2f7c3-9ee2-4391-b7f7-6fb9e9e56572',
  name:'Latitude Pro 14',
  sku:'HW-014',
  category:'Hardware',
  description:'Business laptop',
  unit:'Each',
  price:'1200.00',
  cost:'800.00',
  taxRate:'18.00',
  recurring:false,
  active:true,
  stocks:[],
};
const quote:Quote = {
  id:'68bc6fde-7f65-44c4-b0f8-d7175153ee5e',
  number:'Q-1001',
  customer:'Acme Corp',
  customerTier:'Gold',
  stage:'DRAFT',
  version:1,
  currentRevisionId:'9fdaf6ef-2aa2-4af1-87b0-e4576445bbc7',
  orderDiscount:0,
  total:0,
  margin:0,
  riskScore:0,
  updatedAt:'2026-09-05T00:00:00.000Z',
  lines:[],
  approvals:[],
  negotiation:[],
  invoices:[],
};

beforeEach(()=>{
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
});
afterEach(cleanup);

describe('quotation pricing preview', ()=>{
  it('shows the governed limit and authoritative totals before saving', async()=>{
    fetchMock.mockResolvedValue({
      ok:true,
      json:async()=>({ success:true, data:{
        revisionId:quote.currentRevisionId,
        version:1,
        subtotal:1200,
        taxTotal:216,
        total:1416,
        margin:400,
        marginPercent:33.3333,
        riskScore:0,
        worstExcess:0,
        weightedExcess:0,
        needsManager:false,
        needsFinance:false,
        totalsByCadence:{},
        lines:[{ productId:product.id, quantity:1, unitPrice:'1200', discount:0, allowedDiscount:'10', gross:1200, net:1200, tax:216, effectiveDiscount:0, excess:0, cadence:'One-time' }],
      }}),
    });

    render(<QuoteDetail quote={quote} products={[product]} mutate={vi.fn()}/>);
    fireEvent.click(screen.getByRole('button', { name:'Add' }));

    await waitFor(()=>expect(fetchMock).toHaveBeenCalledWith(
      `/api/v1/quotations/${quote.id}/preview`,
      expect.objectContaining({
        method:'POST',
        body:JSON.stringify({ revisionId:quote.currentRevisionId, expectedVersion:1, orderDiscount:0, lines:[{ variantId:product.id, quantity:1, lineDiscount:0 }] }),
      }),
    ));
    expect(await screen.findByText('10%')).toBeInTheDocument();
    expect(screen.getByText('Deal total').textContent).toContain('1,416');
    expect(screen.getByText('Margin').textContent).toContain('400');
  });

  it('keeps pricing failures inline and preserves the draft lines', async()=>{
    fetchMock.mockResolvedValue({
      ok:false,
      status:422,
      json:async()=>({ success:false, error:{ code:'CONFIGURATION_REQUIRED', message:'Configure this customer tier before pricing the quotation.' } }),
    });

    render(<QuoteDetail quote={quote} products={[product]} mutate={vi.fn()}/>);
    fireEvent.click(screen.getByRole('button', { name:'Add' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Configure this customer tier');
    expect(screen.getByText('Latitude Pro 14')).toBeInTheDocument();
    expect(screen.getByRole('button', { name:'Save draft' })).toBeInTheDocument();
  });
});
