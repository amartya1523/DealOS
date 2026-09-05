import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Quote } from '../../api';
import { CustomerQuotationRoom } from './CustomerQuotationRoom';

const quote={
  id:'quote-1',number:'Q-1001',customer:'Acme',customerTier:'Gold',stage:'SENT',version:7,
  revisionId:'11111111-1111-4111-8111-111111111111',currentRevisionId:'11111111-1111-4111-8111-111111111111',revisionNumber:3,revisionState:'SENT',termsHash:'terms-hash-12345678901234567890123456789012',currency:'INR',
  orderDiscount:'5',subtotal:'95',taxTotal:'18',total:'113',margin:'0',riskScore:'0',updatedAt:'2026-09-06T10:00:00Z',capabilities:{comment:true,accept:true,propose:true},approvals:[],invoices:[],negotiation:[],
  lines:[{id:'line-1',productId:'product-1',quantity:1,unitPrice:'100',discount:'5',net:'95',product:{id:'product-1',name:'Frozen product',sku:'SKU-1',category:'Hardware',description:'Approved description',unit:'Piece',price:'999',cost:'1',taxRate:'18',recurring:false,active:true,stocks:[]}}],
} as Quote;

afterEach(cleanup);

describe('customer quotation room',()=>{
  it('accepts with the exact revision, version and terms hash',async()=>{
    const mutate=vi.fn(async()=>undefined);
    render(<CustomerQuotationRoom quotes={[quote]} mutate={mutate}/>);
    fireEvent.click(screen.getByRole('button',{name:/Accept quotation/}));
    await waitFor(()=>expect(mutate).toHaveBeenCalledWith('/portal/quotations/quote-1/accept',{revisionId:quote.revisionId,expectedVersion:7,termsHash:quote.termsHash},'POST','Quotation accepted and order confirmed'));
  });

  it('sends a counter separately and displays a declined proposal reason',async()=>{
    const mutate=vi.fn(async()=>undefined);
    const declined={...quote,negotiation:[{id:'proposal-1',author:'Acme',message:'Please offer eight percent.',counterDiscount:'8',kind:'PROPOSAL',state:'DECLINED',responseReason:'This is our final approved price.',createdAt:'2026-09-06T10:00:00Z'}]};
    render(<CustomerQuotationRoom quotes={[declined]} mutate={mutate}/>);
    expect(screen.getByText(/This is our final approved price/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Counter discount %'),{target:{value:'9'}});
    fireEvent.change(screen.getByLabelText('Your comment'),{target:{value:'Could you approve nine percent?'}});
    fireEvent.click(screen.getByRole('button',{name:/Send counter proposal/}));
    await waitFor(()=>expect(mutate).toHaveBeenCalledWith('/portal/quotations/quote-1/proposals',expect.objectContaining({revisionId:quote.revisionId,expectedVersion:7,counterDiscount:9}), 'POST','Counter proposal sent'));
  });
});
