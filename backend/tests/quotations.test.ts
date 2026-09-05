import { describe, expect, it } from 'vitest';
import { allowedDiscountForCategory, approvedDeliveryTransition, buildQuotationWhere, createQuotationSchema, deriveQuotationStage, quotationCapabilities, quotationCreationOwnership, quotationListQuerySchema, quotationSummaryDto, quotePreviewSchema, revisionHistory } from '../src/quotations.js';

const base = {
  stage: 'APPROVED', currentRevisionId: 'revision-1', currentRevision: { id: 'revision-1', state: 'SENT' },
  approvals: [], negotiation: [], order: null,
};

describe('quotation list read model', () => {
  it('derives the five workflow stages from the current lifecycle records', () => {
    expect(deriveQuotationStage({ ...base, currentRevision: { id: 'revision-1', state: 'DRAFT' } })).toBe('DRAFT');
    expect(deriveQuotationStage({ ...base, approvals: [{ revisionId: 'revision-1', state: 'PENDING' }] })).toBe('PENDING_APPROVAL');
    expect(deriveQuotationStage({ ...base, negotiation: [{ revisionId: 'revision-1', kind: 'PROPOSAL', state: 'OPEN' }] })).toBe('NEGOTIATION');
    expect(deriveQuotationStage(base)).toBe('APPROVED');
    expect(deriveQuotationStage({ ...base, order: { id: 'order-1' } })).toBe('CONFIRMED');
  });

  it('keeps rejected quotations discoverable and returned drafts in Draft', () => {
    expect(deriveQuotationStage({ ...base, stage: 'REJECTED' })).toBe('REJECTED');
    expect(deriveQuotationStage({ ...base, stage: 'REJECTED', currentRevision: { id: 'revision-1', state: 'DRAFT' } })).toBe('DRAFT');
  });

  it('always applies organization scope and gives representatives view-only team visibility', () => {
    expect(buildQuotationWhere({ id: 'rep-1', role: 'REP', organizationId: 'org-1' }, { ownerId: 'other-user' })).toMatchObject({ organizationId: 'org-1', AND: [{ OR: [{ ownerId: 'rep-1' }, { team: { is: { members: { some: { userId: 'rep-1' } } } } }] }] });
    expect(buildQuotationWhere({ id: 'manager-1', role: 'MANAGER', organizationId: 'org-1' }, { ownerId: 'rep-2' })).toMatchObject({ organizationId: 'org-1', AND: [expect.any(Object), { ownerId: 'rep-2' }] });
  });

  it('returns server-authored capabilities with state, role, read-only and self-approval checks',()=>{
    const draft={...base,stage:'DRAFT',ownerId:'rep-1',currentRevision:{id:'revision-1',state:'DRAFT',submittedById:null}};
    expect(quotationCapabilities({id:'rep-1',role:'REP',organizationId:'org-1'},draft)).toMatchObject({editDraft:true,submit:true,assign:false});
    expect(quotationCapabilities({id:'manager-1',role:'MANAGER',organizationId:'org-1'},draft)).toMatchObject({editDraft:false,assign:true});
    const pending={...base,ownerId:'rep-1',approvals:[{revisionId:'revision-1',state:'PENDING',step:'Sales Manager'}],currentRevision:{id:'revision-1',state:'SUBMITTED',submittedById:'rep-1'}};
    expect(quotationCapabilities({id:'manager-1',role:'MANAGER',organizationId:'org-1'},pending).approve).toBe(true);
    expect(quotationCapabilities({id:'rep-1',role:'ADMIN',organizationId:'org-1'},pending).approve).toBe(false);
    expect(quotationCapabilities({id:'admin-1',role:'ADMIN',organizationId:'org-1',readOnlyView:true},draft).submit).toBe(false);
    const negotiation={...base,stage:'NEGOTIATION',ownerId:'rep-1',negotiation:[{revisionId:'revision-1',kind:'PROPOSAL',state:'OPEN'}],currentRevision:{id:'revision-1',state:'SENT',submittedById:'rep-1'}};
    expect(quotationCapabilities({id:'rep-1',role:'REP',organizationId:'org-1'},negotiation).negotiate).toBe(true);
    expect(quotationCapabilities({id:'rep-2',role:'REP',organizationId:'org-1'},negotiation).negotiate).toBe(false);
  });

  it('sends the approved revision directly to the customer after the final approval', () => {
    const approvedAt = new Date('2026-09-06T10:00:00.000Z');
    expect(approvedDeliveryTransition(approvedAt)).toEqual({
      revision: { state: 'SENT', sentAt: approvedAt },
      quote: { stage: 'APPROVED', sentAt: approvedAt, version: { increment: 1 }, lastActivity: approvedAt },
    });
  });

  it('builds adjacent immutable revision comparisons and removes cost for unauthorized viewers',()=>{
    const history=revisionHistory([
      {id:'r2',revisionNumber:2,state:'SUBMITTED',total:'120',margin:'30',riskScore:'1',createdAt:new Date('2026-09-02'),linesSnapshot:[{productId:'p1',name:'Care',quantity:2,discount:7,unitPrice:'40',unitCost:'12'}]},
      {id:'r1',revisionNumber:1,state:'SUBMITTED',total:'80',margin:'20',riskScore:'0',createdAt:new Date('2026-09-01'),linesSnapshot:[{productId:'p1',name:'Care',quantity:1,discount:5,unitPrice:'40',unitCost:'12'}]},
    ],true,false);
    expect(history[0]).toMatchObject({revisionNumber:2,comparedWithRevision:1,changes:[{kind:'CHANGED',name:'Care',fields:['quantity','discount']}]});
    expect(history[0]!.lines[0]).not.toHaveProperty('unitCost');
  });

  it('validates bounded list filters and configured-customer creation', () => {
    expect(quotationListQuerySchema.parse({ limit: '25', stage: 'DRAFT' })).toMatchObject({ limit: 25, stage: 'DRAFT' });
    expect(quotationListQuerySchema.safeParse({ limit: 500 }).success).toBe(false);
    expect(createQuotationSchema.safeParse({ customer: 'Unconfigured customer', customerTier: 'Gold' }).success).toBe(false);
    expect(createQuotationSchema.safeParse({ customerId: '7ff1b0c6-bb15-4d02-8f23-14914fcbbc4b' }).success).toBe(true);
    expect(createQuotationSchema.safeParse({ customerId: '7ff1b0c6-bb15-4d02-8f23-14914fcbbc4b', teamId: '7ff1b0c6-bb15-4d02-8f23-14914fcbbc4b' }).success).toBe(false);
    expect(createQuotationSchema.safeParse({ customerId: '7ff1b0c6-bb15-4d02-8f23-14914fcbbc4b', tier: 'Gold' }).success).toBe(false);
    expect(createQuotationSchema.safeParse({ customerId: '7ff1b0c6-bb15-4d02-8f23-14914fcbbc4b', currency: 'INR' }).success).toBe(false);
  });

  it('derives quotation owner and team only from an active account assignment', () => {
    const configured={primarySalesTeamId:'team-1',primarySalesTeam:{managerId:'manager-1',members:[{userId:'rep-1'},{userId:'rep-2'}]},assignments:[{userId:'rep-1',user:{role:'REP',status:'ACTIVE'}},{userId:'rep-2',user:{role:'REP',status:'ACTIVE'}}]};
    expect(quotationCreationOwnership({id:'rep-1',role:'REP'},configured)).toEqual({ownerId:'rep-1',teamId:'team-1'});
    expect(quotationCreationOwnership({id:'manager-1',role:'MANAGER'},configured,'rep-2')).toEqual({ownerId:'rep-2',teamId:'team-1'});
  });

  it('rejects unassigned reps and client-selected owners for rep-created quotations', () => {
    const unassigned={primarySalesTeamId:'team-1',primarySalesTeam:{managerId:'manager-1',members:[{userId:'rep-2'}]},assignments:[{userId:'rep-2',user:{role:'REP',status:'ACTIVE'}}]};
    expect(()=>quotationCreationOwnership({id:'rep-1',role:'REP'},unassigned)).toThrowError(expect.objectContaining({code:'CUSTOMER_ASSIGNMENT_REQUIRED'}));
    expect(()=>quotationCreationOwnership({id:'rep-1',role:'REP'},unassigned,'rep-2')).toThrowError(expect.objectContaining({code:'VALIDATION_ERROR'}));
  });

  it('rejects a quotation draft for a brand-new customer with no primary assignment', () => {
    const newCustomer={primarySalesTeamId:null,primarySalesTeam:null,assignments:[]};
    expect(()=>quotationCreationOwnership({id:'rep-1',role:'REP'},newCustomer)).toThrowError(expect.objectContaining({code:'ASSIGNMENT_REQUIRED',status:422}));
  });

  it('validates authoritative preview input and rejects client-supplied prices', () => {
    const input = {
      revisionId: '68bc6fde-7f65-44c4-b0f8-d7175153ee5e',
      expectedVersion: 2,
      orderDiscount: 0,
      lines: [{ variantId: 'b1e2f7c3-9ee2-4391-b7f7-6fb9e9e56572', quantity: 1, lineDiscount: 5 }],
    };
    expect(quotePreviewSchema.safeParse(input).success).toBe(true);
    expect(quotePreviewSchema.safeParse({ ...input, lines: [{ ...input.lines[0], unitPrice: 1 }] }).success).toBe(false);
    expect(quotePreviewSchema.safeParse({ ...input, expectedVersion: 2, lines: [] }).success).toBe(false);
  });

  it('uses the stricter tier or category discount limit', () => {
    const policy = { maxDiscount: 15, hardwareLimit: 10, servicesLimit: 20, subscriptionLimit: 12 };
    expect(allowedDiscountForCategory('Hardware', policy).toString()).toBe('10');
    expect(allowedDiscountForCategory('Services', policy).toString()).toBe('15');
    expect(allowedDiscountForCategory('Subscriptions', policy).toString()).toBe('12');
  });

  it('returns an explicit summary without internal cost or margin fields', () => {
    const dto = quotationSummaryDto({
      ...base, id: 'quote-1', number: 'Q-1001', customerId: 'customer-1', customer: 'Acme', customerTier: 'Gold',
      total: '1200.00', riskScore: '4.00', version: 2, lastActivity: new Date('2026-09-05T10:00:00.000Z'),
      customerRecord: { currency: 'INR' }, owner: { id: 'rep-1', name: 'Priya' },
    });
    expect(dto).toMatchObject({ number: 'Q-1001', total: '1200.00', currency: 'INR', stage: 'APPROVED', owner: { name: 'Priya' } });
    expect(dto).not.toHaveProperty('margin');
    expect(dto).not.toHaveProperty('cost');
  });

  it('keeps a teammate read-only while preserving owner actions', () => {
    const draft={...base,stage:'DRAFT',ownerId:'rep-1',currentRevision:{id:'revision-1',state:'DRAFT',submittedById:null}};
    expect(quotationCapabilities({id:'rep-2',role:'REP',organizationId:'org-1'},draft)).toMatchObject({editDraft:false,saveDraft:false,submit:false,send:false});
  });
});
