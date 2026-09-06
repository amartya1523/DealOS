import { describe, expect, it, vi } from 'vitest';
import { confirmEligibleRevision, OrderConfirmationError, validateEligibleRevision } from '../src/orders.js';

const quote:any = {
  id: 'quote-1', number: 'Q-1', organizationId: 'org-1', customerId: 'customer-1', customer: 'Acme', version: 4,
  stage: 'APPROVED', sentAt: new Date(), currentRevisionId: 'revision-1', order: null, acceptance: null,
  currentRevision: { id: 'revision-1', state: 'SENT', termsHash: 'terms-1', validUntil: new Date(Date.now() + 86_400_000), total: 100, currency: 'INR' },
  approvalCases: [{ revisionId: 'revision-1', state: 'APPROVED' }], lines: [],
};

describe('order confirmation eligibility', () => {
  it('requires the exact approved SENT revision and terms', () => {
    expect(() => validateEligibleRevision(quote, { revisionId: 'revision-1', expectedVersion: 4, termsHash: 'terms-1' })).not.toThrow();
    expect(() => validateEligibleRevision(quote, { revisionId: 'revision-old', expectedVersion: 4, termsHash: 'terms-1' })).toThrowError(/exact current sent revision/);
    try { validateEligibleRevision(quote, { revisionId: 'revision-old', expectedVersion: 4, termsHash: 'terms-1' }); } catch (error) { expect(error).toMatchObject({ code: 'INVALID_STATE' }); }
    expect(() => validateEligibleRevision({ ...quote, approvalCases: [] }, { revisionId: 'revision-1', expectedVersion: 4, termsHash: 'terms-1' })).toThrowError(/not completed approval/);
    expect(() => validateEligibleRevision({ ...quote, currentRevision: { ...quote.currentRevision, state: 'SUPERSEDED' } }, { revisionId: 'revision-1', expectedVersion: 4, termsHash: 'terms-1' })).toThrowError(OrderConfirmationError);
  });

  it('creates one order from frozen lines and replays an identical acceptance', async () => {
    let stored:any=null;
    const tx:any={
      idempotencyRecord:{findUnique:vi.fn(async()=>stored),create:vi.fn(async({data}:any)=>{stored=data;return data})},
      $queryRaw:vi.fn(async()=>[]),
      quote:{findFirst:vi.fn(async()=>({...quote,currentRevision:{...quote.currentRevision,currency:'INR',linesSnapshot:[{productId:'product-1',quantity:2,name:'Frozen product',unitPrice:'50',unitCost:'20',cadence:'One-time'}]},lines:[{id:'line-1',productId:'product-1'}]})),update:vi.fn(async()=>({}))},
      customerAcceptance:{create:vi.fn(async()=>({id:'acceptance-1',acceptedAt:new Date('2026-09-06T00:00:00.000Z')}))},
      order:{create:vi.fn(async({data}:any)=>({id:'order-1',number:'SO-1',lines:data.lines.create.map((line:any,index:number)=>({id:`order-line-${index}`, ...line}))}))},
      invoice:{create:vi.fn(async({data}:any)=>({id:'invoice-1',...data}))},
      subscription:{create:vi.fn()},
      auditEvent:{create:vi.fn(async()=>({}))},
    };
    const input={actorId:'user-1',organizationId:'org-1',customerId:'customer-1',quoteId:'quote-1',revisionId:'revision-1',expectedVersion:4,termsHash:'terms-1',idempotencyKey:'acceptance-key-0001'};
    const first=await confirmEligibleRevision(tx,input);
    const second=await confirmEligibleRevision(tx,input);
    expect(first).toMatchObject({orderId:'order-1',revisionId:'revision-1',replayed:false});
    expect(first).toMatchObject({invoiceId:null,subscriptionIds:[],hardwareBillingState:'AWAITING_SHIPMENT'});
    expect(second).toMatchObject({orderId:'order-1',revisionId:'revision-1',replayed:true});
    expect(tx.order.create).toHaveBeenCalledTimes(1);
    expect(tx.order.create.mock.calls[0][0].data.lines.create[0]).toMatchObject({quantity:2,snapshot:{name:'Frozen product'}});
  });

  it('returns a scoped not-found instead of revealing another customer quotation', async () => {
    const tx:any={idempotencyRecord:{findUnique:vi.fn(async()=>null)},$queryRaw:vi.fn(async()=>[]),quote:{findFirst:vi.fn(async()=>null)}};
    await expect(confirmEligibleRevision(tx,{actorId:'user-a',organizationId:'org-1',customerId:'customer-a',quoteId:'quote-b',revisionId:'revision-b',expectedVersion:1,termsHash:'terms-b',idempotencyKey:'acceptance-key-0002'})).rejects.toMatchObject({status:404,code:'NOT_FOUND'});
  });

  it('rechecks idempotency after the row lock so concurrent retries return exactly one order', async () => {
    let stored:any=null;
    let lockCalls=0;
    let releaseLock!:()=>void;
    const firstCommitted=new Promise<void>((resolve)=>{releaseLock=resolve});
    const tx:any={
      idempotencyRecord:{findUnique:vi.fn(async()=>stored),create:vi.fn(async({data}:any)=>{stored=data;releaseLock();return data})},
      $queryRaw:vi.fn(async()=>{lockCalls++;if(lockCalls===2)await firstCommitted;return[]}),
      quote:{findFirst:vi.fn(async()=>({...quote,currentRevision:{...quote.currentRevision,linesSnapshot:[{productId:'product-1',quantity:1,name:'Frozen',unitPrice:'10',unitCost:'4',net:10,tax:0,cadence:'One-time'}],total:10},lines:[{id:'line-1',productId:'product-1'}]})),update:vi.fn(async()=>({}))},
      customerAcceptance:{create:vi.fn(async()=>({id:'acceptance-1',acceptedAt:new Date('2026-09-06T00:00:00.000Z')}))},
      order:{create:vi.fn(async({data}:any)=>({id:'order-1',number:'SO-1',lines:data.lines.create.map((line:any)=>({id:'order-line-1',...line}))}))},
      invoice:{create:vi.fn(async({data}:any)=>({id:'invoice-1',...data}))},subscription:{create:vi.fn()},auditEvent:{create:vi.fn(async()=>({}))},
    };
    const input={actorId:'user-1',organizationId:'org-1',customerId:'customer-1',quoteId:'quote-1',revisionId:'revision-1',expectedVersion:4,termsHash:'terms-1',idempotencyKey:'same-concurrent-key'};
    const [first,second]=await Promise.all([confirmEligibleRevision(tx,input),confirmEligibleRevision(tx,input)]);
    expect([first.replayed,second.replayed].sort()).toEqual([false,true]);
    expect(tx.order.create).toHaveBeenCalledTimes(1);
    expect(tx.invoice.create).not.toHaveBeenCalled();
  });
});
