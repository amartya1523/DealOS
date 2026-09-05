import { describe, expect, it, vi } from 'vitest';
import { BillingError, changeSubscription, createConfirmationBilling, DEFAULT_CONFIRMATION_INVOICE_DUE_DAYS, recordPayment, reversePayment } from '../src/billing.js';

describe('confirmation billing', () => {
  it('creates one combined mixed invoice and one subscription for each recurring line', async () => {
    const invoiceCreate = vi.fn(async ({ data }: any) => ({ id: 'invoice-1', ...data }));
    const subscriptionCreate = vi.fn(async ({ data }: any) => ({ id: 'subscription-1', ...data }));
    const tx: any = { invoice: { create: invoiceCreate }, subscription: { create: subscriptionCreate }, auditEvent: { create: vi.fn(async () => ({})) } };
    const confirmedAt = new Date('2026-01-31T10:00:00.000Z');
    const result = await createConfirmationBilling(tx, {
      organizationId: 'org-1', actorId: 'customer-user', confirmedAt,
      quote: { id: 'quote-1', number: 'Q-1', customer: 'Acme', customerId: 'customer-1' },
      revision: { id: 'revision-1', total: '354.00', currency: 'INR' },
      order: { id: 'order-1', number: 'SO-1', lines: [
        { id: 'line-1', productId: 'hardware', quantity: 1, recurring: false, cadence: null, snapshot: { name: 'Device', unitPrice: '200', discount: 0, net: 200, tax: 36 } },
        { id: 'line-2', productId: 'plan', quantity: 1, recurring: true, cadence: 'Monthly', snapshot: { name: 'Care plan', unitPrice: '100', discount: 0, net: 100, tax: 18 } },
      ] },
    });
    expect(result.invoice.amount.toString()).toBe('354');
    expect(result.invoice.dueAt).toEqual(new Date(confirmedAt.getTime() + DEFAULT_CONFIRMATION_INVOICE_DUE_DAYS * 86_400_000));
    expect(invoiceCreate.mock.calls[0]![0].data.lines).toHaveLength(2);
    expect(subscriptionCreate).toHaveBeenCalledTimes(1);
    expect(subscriptionCreate.mock.calls[0]![0].data).toMatchObject({ orderLineId: 'line-2', cadence: 'Monthly' });
    expect(subscriptionCreate.mock.calls[0]![0].data.nextBillAt).toEqual(new Date('2026-02-28T10:00:00.000Z'));
  });
});

describe('manual settlement ledger', () => {
  it('rejects an amount beyond the locked invoice balance', async () => {
    const tx: any = {
      $queryRaw: vi.fn(async () => []),
      invoice: { findFirst: vi.fn(async () => ({ id: 'invoice-1', organizationId: 'org-1', currency: 'INR', amount: '100.00' })) },
      idempotencyRecord: { findUnique: vi.fn(async () => null) },
      payment: { findUnique: vi.fn(async () => null), findMany: vi.fn(async () => [{ amount: '80.00', reversalOfId: null }]), create: vi.fn() },
    };
    await expect(recordPayment(tx, { organizationId: 'org-1', actorId: 'finance-1', invoiceId: 'invoice-1', amount: 21, currency: 'INR', reference: 'UTR-1', paidAt: new Date(), idempotencyKey: 'pay-1' })).rejects.toMatchObject({ status: 422, code: 'AMOUNT_EXCEEDS_BALANCE' });
    expect(tx.payment.create).not.toHaveBeenCalled();
  });

  it('serializes concurrent recordings so they cannot jointly exceed the invoice', async () => {
    const ledger:any[]=[];
    let lockCalls=0;
    let release!:()=>void;
    const firstUpdated=new Promise<void>((resolve)=>{release=resolve});
    const tx:any={
      $queryRaw:vi.fn(async()=>{lockCalls++;if(lockCalls===2)await firstUpdated;return[]}),
      invoice:{findFirst:vi.fn(async()=>({id:'invoice-1',organizationId:'org-1',currency:'INR',amount:'100.00'})),findUniqueOrThrow:vi.fn(async()=>({id:'invoice-1',payments:ledger})),update:vi.fn(async({data}:any)=>{release();return{id:'invoice-1',...data}})},
      idempotencyRecord:{findUnique:vi.fn(async()=>null),create:vi.fn(async()=>({}))},
      payment:{findUnique:vi.fn(async()=>null),findMany:vi.fn(async()=>ledger),create:vi.fn(async({data}:any)=>{const payment={id:`payment-${ledger.length+1}`,...data,reversalOfId:null};ledger.push(payment);return payment})},
      auditEvent:{create:vi.fn(async()=>({}))},
    };
    const base={organizationId:'org-1',actorId:'finance-1',invoiceId:'invoice-1',currency:'INR',paidAt:new Date('2026-09-06T12:00:00.000Z')};
    const results=await Promise.allSettled([
      recordPayment(tx,{...base,amount:60,reference:'UTR-A',idempotencyKey:'pay-a'}),
      recordPayment(tx,{...base,amount:50,reference:'UTR-B',idempotencyKey:'pay-b'}),
    ]);
    expect(results.map(result=>result.status).sort()).toEqual(['fulfilled','rejected']);
    const rejected=results.find((result):result is PromiseRejectedResult=>result.status==='rejected');
    expect(rejected?.reason).toMatchObject({code:'AMOUNT_EXCEEDS_BALANCE'});
    expect(ledger).toHaveLength(1);
  });

  it('reverses through a compensating entry and moves PAID back to PARTIAL', async () => {
    const original = { id: 'payment-1', invoiceId: 'invoice-1', amount: '60.00', reversalOfId: null, reversal: null };
    const paymentCreate = vi.fn(async ({ data }: any) => ({ id: 'reversal-1', ...data }));
    const invoiceUpdate = vi.fn(async ({ data }: any) => ({ id: 'invoice-1', ...data }));
    const tx: any = {
      $queryRaw: vi.fn(async () => []), invoice: { findFirst: vi.fn(async () => ({ id: 'invoice-1', amount: '100.00' })), update: invoiceUpdate, findUniqueOrThrow: vi.fn() },
      payment: { findFirst: vi.fn(async () => original), findMany: vi.fn(async () => [{ amount: '60.00', reversalOfId: null }, { amount: '40.00', reversalOfId: null }]), create: paymentCreate },
      auditEvent: { create: vi.fn(async () => ({})) },
    };
    const result: any = await reversePayment(tx, { organizationId: 'org-1', actorId: 'finance-1', invoiceId: 'invoice-1', paymentId: 'payment-1', reason: 'Duplicate settlement evidence' });
    expect(original).toEqual({ id: 'payment-1', invoiceId: 'invoice-1', amount: '60.00', reversalOfId: null, reversal: null });
    expect(paymentCreate.mock.calls[0]![0].data).toMatchObject({ amount: '60.00', reversalOfId: 'payment-1', reason: 'Duplicate settlement evidence' });
    expect(result.state).toBe('PARTIAL');
    expect(result.paidAmount.toString()).toBe('40');
  });
});

describe('subscription governance', () => {
  it('records amount and lifecycle changes without touching invoices', async () => {
    const changes: any[] = [];
    const tx: any = {
      $queryRaw: vi.fn(async () => []),
      subscription: { findFirst: vi.fn(async () => ({ id: 'sub-1', organizationId: 'org-1', version: 2, state: 'ACTIVE', amount: '100.00', cancelledAt: null })), update: vi.fn(async ({ data }: any) => ({ id: 'sub-1', version: 3, state: data.state, amount: data.amount })) },
      subscriptionChange: { create: vi.fn(async ({ data }: any) => { changes.push(data); return data; }) },
      auditEvent: { create: vi.fn(async () => ({})) },
    };
    await changeSubscription(tx, { organizationId: 'org-1', actorId: 'admin-1', subscriptionId: 'sub-1', expectedVersion: 2, amount: 125, reason: 'Annual commercial review', effectiveAt: new Date('2026-10-01') });
    expect(changes[0]).toMatchObject({ kind: 'AMOUNT_CHANGED', previousAmount: '100.00', previousState: 'ACTIVE', newState: 'ACTIVE', reason: 'Annual commercial review' });
    expect(tx).not.toHaveProperty('invoice.update');
  });

  it('rejects stale subscription changes', async () => {
    const tx: any = { $queryRaw: vi.fn(async () => []), subscription: { findFirst: vi.fn(async () => ({ id: 'sub-1', organizationId: 'org-1', version: 3, state: 'ACTIVE', amount: '100', cancelledAt: null })) } };
    await expect(changeSubscription(tx, { organizationId: 'org-1', actorId: 'admin-1', subscriptionId: 'sub-1', expectedVersion: 2, action: 'PAUSE', reason: 'Customer requested pause', effectiveAt: new Date() })).rejects.toBeInstanceOf(BillingError);
  });
});
