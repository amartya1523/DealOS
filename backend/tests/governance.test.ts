import type { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { approvalStepsForRoute, createReturnedDraft, decideStep, evaluateRisk, validateDecisionContext } from '../src/governance.js';
import { calculateQuote } from '../src/rules.js';

const policy = {
  id: 'policy-1',
  tier: 'Gold',
  version: 7,
  financeThreshold: 5,
  aggregateDiscountLimit: 20,
  minimumMarginPercent: 12,
};

function evaluate(lines: Parameters<typeof calculateQuote>[0], orderDiscount = 0) {
  const calculation = calculateQuote(lines, orderDiscount, policy);
  return evaluateRisk(calculation, policy);
}

describe('discount governance routing', () => {
  it('routes undiscounted healthy terms without approval', () => {
    expect(evaluate([{ productId: 'p1', quantity: 1, unitPrice: 100, unitCost: 50, discount: 0, allowedDiscount: 10 }]).route).toBe('NONE');
  });

  it('routes any discount to the Sales Manager even when it is within policy', () => {
    expect(evaluate([{ productId: 'p1', quantity: 1, unitPrice: 100, unitCost: 50, discount: 2, allowedDiscount: 10 }]).route).toBe('MANAGER');
  });

  it('routes a high excess to Manager and then Finance', () => {
    const result = evaluate([{ productId: 'p1', quantity: 1, unitPrice: 100, unitCost: 50, discount: 18, allowedDiscount: 10 }]);
    expect(result.route).toBe('MANAGER_FINANCE');
    expect(approvalStepsForRoute(result.route)).toEqual([
      { step: 'Sales Manager', sequence: 1, state: 'PENDING' },
      { step: 'Finance', sequence: 2, state: 'WAITING' },
    ]);
  });

  it('never creates a Finance-first route for a low-margin undiscounted quotation', () => {
    const result = evaluate([{ productId: 'p1', quantity: 1, unitPrice: 100, unitCost: 95, discount: 0, allowedDiscount: 10 }]);
    expect(result.route).toBe('MANAGER_FINANCE');
    expect(approvalStepsForRoute(result.route)[0]?.step).toBe('Sales Manager');
  });

  it('retains a badly over-limit line even when a larger line dilutes the weighted average', () => {
    const result = evaluate([
      { productId: 'small-risk', quantity: 1, unitPrice: 10, unitCost: 2, discount: 20, allowedDiscount: 10 },
      { productId: 'large-safe', quantity: 100, unitPrice: 100, unitCost: 40, discount: 0, allowedDiscount: 10 },
    ]);
    expect(result.components.weightedExcess).toBeLessThan(1);
    expect(result.components.worstExcess).toBe(10);
    expect(result.route).toBe('MANAGER_FINANCE');
    expect(result.flags).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'LINE_DISCOUNT_EXCESS', productId: 'small-risk' })]));
  });

  it('evaluates incomparable cadences independently and routes from the highest bucket', () => {
    const result = evaluate([
      { productId: 'one-time', quantity: 100, unitPrice: 100, unitCost: 40, discount: 0, allowedDiscount: 10, cadence: 'One-time' },
      { productId: 'monthly', quantity: 1, unitPrice: 10, unitCost: 2, discount: 20, allowedDiscount: 10, cadence: 'Monthly' },
    ]);
    expect(result.components.weightedExcess).toBe(10);
    expect(result.route).toBe('MANAGER_FINANCE');
  });

  it('keeps a submitted policy evaluation unchanged after a later policy version changes',()=>{
    const submitted=evaluate([{productId:'p1',quantity:1,unitPrice:100,unitCost:50,discount:13,allowedDiscount:10}]);
    const later=evaluateRisk(calculateQuote([{productId:'p1',quantity:1,unitPrice:100,unitCost:50,discount:13,allowedDiscount:10}],0,{...policy,financeThreshold:1}),{...policy,version:8,financeThreshold:1});
    expect(submitted.policy).toMatchObject({version:7,financeThreshold:5});
    expect(later.policy).toMatchObject({version:8,financeThreshold:1});
    expect(submitted.route).toBe('MANAGER');
    expect(later.route).toBe('MANAGER_FINANCE');
  });
});

describe('approval decision guards',()=>{
  const valid={expectedVersion:2,caseVersion:2,caseState:'PENDING',step:{step:'Sales Manager',state:'PENDING'},actor:{id:'manager-1',role:'MANAGER'},submittedById:'rep-1',ownerId:'rep-1',managerId:'manager-1'};

  it('rejects a stale optimistic case version',()=>{
    expect(()=>validateDecisionContext({...valid,expectedVersion:1})).toThrowError(expect.objectContaining({code:'STALE_VERSION',status:409}));
  });

  it('prevents Finance from acting while the Manager step is active',()=>{
    expect(()=>validateDecisionContext({...valid,actor:{id:'finance-1',role:'FINANCE'}})).toThrowError(expect.objectContaining({code:'FORBIDDEN'}));
  });

  it('prevents the submitter from reviewing either role step',()=>{
    expect(()=>validateDecisionContext({...valid,actor:{id:'rep-1',role:'MANAGER'},managerId:'rep-1'})).toThrowError(expect.objectContaining({code:'SELF_APPROVAL_NOT_ALLOWED'}));
    expect(()=>validateDecisionContext({...valid,step:{step:'Finance',state:'PENDING'},actor:{id:'rep-1',role:'FINANCE'}})).toThrowError(expect.objectContaining({code:'SELF_APPROVAL_NOT_ALLOWED'}));
  });
});

describe('approval state transitions',()=>{
  const revision={id:'revision-1',revisionNumber:2,currency:'INR',validUntil:null,promisedDeliveryAt:null,terms:'Net 30',orderDiscount:10,subtotal:90,taxTotal:16.2,total:106.2,margin:40,riskScore:3,totalsByCadence:{'One-time':{total:106.2}},linesSnapshot:[{productId:'p1'}],policySnapshot:{policy:{version:7}}};
  const approvalCase={id:'case-1',quoteId:'quote-1',revisionId:revision.id,version:3,state:'PENDING',submittedById:'rep-1',revision,quote:{organizationId:'org-1',ownerId:'rep-1',team:{managerId:'manager-1'}},steps:[{id:'manager-step',step:'Sales Manager',state:'PENDING'},{id:'finance-step',step:'Finance',state:'WAITING'}]};
  const transaction=(record=approvalCase)=>({
    $queryRaw:vi.fn(),
    approvalCase:{findUnique:vi.fn().mockResolvedValue(record),update:vi.fn().mockResolvedValue({...record,version:record.version+1})},
    approval:{update:vi.fn().mockResolvedValue({}),updateMany:vi.fn().mockResolvedValue({count:1})},
    quote:{update:vi.fn().mockResolvedValue({})},
    quoteRevision:{findFirst:vi.fn().mockResolvedValue({revisionNumber:2}),update:vi.fn().mockResolvedValue({}),create:vi.fn().mockResolvedValue({id:'revision-2',revisionNumber:3})},
  });

  it('opens Finance only after the Sales Manager approves',async()=>{
    const tx=transaction();
    await decideStep(tx as unknown as Prisma.TransactionClient,{caseId:'case-1',expectedVersion:3,actor:{id:'manager-1',role:'MANAGER',organizationId:'org-1'},decision:'APPROVE',reason:'Commercial exception accepted.'});
    expect(tx.approval.update).toHaveBeenNthCalledWith(2,{where:{id:'finance-step'},data:{state:'PENDING'}});
    expect(tx.approvalCase.update).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({state:'PENDING',version:{increment:1}})}));
    expect(tx.quote.update).not.toHaveBeenCalled();
  });

  it('supersedes the unfinished route and creates a new Draft revision on return',async()=>{
    const tx=transaction();
    const decided=await decideStep(tx as unknown as Prisma.TransactionClient,{caseId:'case-1',expectedVersion:3,actor:{id:'manager-1',role:'MANAGER',organizationId:'org-1'},decision:'RETURN',reason:'Revise the discount.'});
    expect(tx.approval.updateMany).toHaveBeenCalledWith(expect.objectContaining({data:{state:'SUPERSEDED'}}));
    const draft=await createReturnedDraft(tx as unknown as Prisma.TransactionClient,{caseId:'case-1',quoteId:'quote-1',sourceRevision:decided.sourceRevision,termsHash:'return-hash'});
    expect(tx.quoteRevision.update).toHaveBeenCalledWith({where:{id:'revision-1'},data:{state:'SUPERSEDED'}});
    expect(tx.quoteRevision.create).toHaveBeenCalledWith({data:expect.objectContaining({quoteId:'quote-1',revisionNumber:3,state:'DRAFT',termsHash:'return-hash'})});
    expect(tx.quote.update).toHaveBeenCalledWith({where:{id:'quote-1'},data:expect.objectContaining({stage:'DRAFT',currentRevisionId:'revision-2',version:{increment:1}})});
    expect(draft).toMatchObject({id:'revision-2',revisionNumber:3});
  });
});
