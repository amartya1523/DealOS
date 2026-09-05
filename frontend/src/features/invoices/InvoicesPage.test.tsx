import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Invoice, Workspace } from '../../api';
import { InvoiceDetailPage, InvoicesPage, invoiceDisplayState } from './InvoicesPage';

const openInvoice:Invoice={id:'open',number:'INV-1042',customer:'Acme Corp',quoteId:'quote-1',quote:{id:'quote-1',number:'Q-1042',stage:'CONFIRMED'},orderId:'order-1',order:{id:'order-1',number:'SO-1042',state:'PARTIALLY_FULFILLED',currency:'INR',fulfillment:{state:'BACKORDER',shipmentCount:1,updatedAt:'2026-09-04T10:00:00.000Z'}},currency:'INR',amount:'1000',paidAmount:'250',state:'PARTIAL',dueAt:'2026-09-01T00:00:00.000Z',createdAt:'2026-08-15T00:00:00.000Z',lines:[{description:'Implementation',amount:1000,quantity:1,net:847.46,tax:152.54,cadence:'One-time'}],payments:[{id:'payment-1',amount:'250',reference:'UTR-100',paidAt:'2026-08-30T12:00:00.000Z'}]};
const paidInvoice:Invoice={id:'paid',number:'INV-1043',customer:'Nova Retail',currency:'INR',amount:'500',paidAmount:'500',state:'PAID',dueAt:'2026-09-20T00:00:00.000Z',createdAt:'2026-09-02T00:00:00.000Z',lines:[],payments:[{id:'payment-2',amount:'500',reference:'UTR-200',paidAt:'2026-09-03T12:00:00.000Z'}]};
const workspace={user:{id:'finance',name:'Finance User',email:'finance@example.com',role:'FINANCE',moduleAccess:['invoices'],actorType:'USER',platformSuperAdmin:false,viewContext:null},organization:{id:'org',name:'Acme'},users:[],customers:[],quotes:[{id:'quote-1',number:'Q-1042',customer:'Acme Corp',customerTier:'Gold',stage:'CONFIRMED',version:1,orderDiscount:0,total:1000,margin:200,riskScore:0,updatedAt:'2026-09-01T00:00:00.000Z',order:{id:'order-1',number:'SO-1042',state:'PARTIALLY_FULFILLED'},lines:[],approvals:[],negotiation:[],invoices:[{id:'open',number:'INV-1042',state:'PARTIAL'}]}],products:[],policies:[],warehouses:[],subscriptions:[],invoices:[openInvoice,paidInvoice],alerts:[],audits:[]} as Workspace;

beforeEach(()=>vi.setSystemTime(new Date('2026-09-05T10:00:00.000Z')));
afterEach(()=>{cleanup();vi.useRealTimers()});

describe('invoice receivables workspace',()=>{
  it('derives overdue separately from the stored financial lifecycle',()=>{
    expect(invoiceDisplayState(openInvoice)).toBe('overdue');
    expect(invoiceDisplayState(paidInvoice)).toBe('paid');
  });

  it('shows receivable metrics and functional count filters',()=>{
    const open=vi.fn();
    render(<InvoicesPage data={workspace} openInvoice={open} mutate={vi.fn()}/>);
    expect(screen.getByText('Total outstanding').closest('article')).toHaveTextContent('₹750.00');
    expect(screen.getByText('Overdue',{selector:'.invoice-metrics span'}).closest('article')).toHaveTextContent('₹750.00');
    expect(screen.getByRole('button',{name:/All invoices.*2/})).toHaveAttribute('aria-pressed','true');
    fireEvent.click(screen.getByRole('button',{name:/Paid.*1/}));
    expect(screen.getByText('INV-1043')).toBeInTheDocument();
    expect(screen.queryByText('INV-1042')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('row',{name:'Open INV-1043 for Nova Retail'}));
    expect(open).toHaveBeenCalledWith('paid');
  });

  it('records dated payments and requires a reason for reversals',async()=>{
    const mutate=vi.fn().mockResolvedValue(undefined);
    render(<InvoiceDetailPage invoice={openInvoice} quotes={workspace.quotes} audits={[]} role="FINANCE" readOnly={false} mutate={mutate} onBack={vi.fn()} onOpenQuote={vi.fn()}/>);
    expect(screen.getByText('Payment and credit ledger')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Bank or settlement reference'),{target:{value:'UTR-NEW'}});
    fireEvent.click(screen.getByRole('button',{name:'Record verified payment'}));
    await waitFor(()=>expect(mutate).toHaveBeenCalledWith('/invoices/open/payments',{amount:750,reference:'UTR-NEW',paidAt:'2026-09-05',currency:'INR'},'POST','Payment recorded and balance reconciled'));
    fireEvent.click(screen.getByRole('button',{name:'Reverse'}));
    const dialog=screen.getByRole('dialog',{name:'Reverse recorded payment'});
    expect(within(dialog).getByRole('button',{name:'Record reversal'})).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText('Correction reason'),{target:{value:'Duplicate bank posting'}});
    fireEvent.click(within(dialog).getByRole('button',{name:'Record reversal'}));
    await waitFor(()=>expect(mutate).toHaveBeenCalledWith('/invoices/open/payments/payment-1/reversals',{reason:'Duplicate bank posting'},'POST','Payment reversal recorded'));
  });
});
