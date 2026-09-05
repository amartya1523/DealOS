import crypto from 'node:crypto';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { calculateQuote } from './rules.js';

export const primaryQuotationStages = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'NEGOTIATION', 'CONFIRMED'] as const;
export const quotationStages = [...primaryQuotationStages, 'REJECTED'] as const;
export type QuotationStage = typeof quotationStages[number];

export type QuotationActor = { id: string; role: string; organizationId: string; readOnlyView?: boolean };
export type QuotationCapability = 'editDraft'|'saveDraft'|'submit'|'assign'|'approve'|'send'|'negotiate'|'previewCustomer'|'downloadPdf'|'viewCost'|'viewMargin'|'viewActivity';

export const quotationListQuerySchema = z.object({
  stage: z.enum(quotationStages).optional(),
  customerId: z.string().uuid().optional(),
  ownerId: z.string().uuid().optional(),
  search: z.string().trim().min(1).max(100).optional(),
  activityPeriod: z.enum(['7d', '30d', '90d', 'all']).default('all'),
  sort: z.enum(['activity_desc', 'activity_asc', 'amount_desc', 'amount_asc', 'quotation_asc', 'quotation_desc']).default('activity_desc'),
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(100),
}).strict();

export const customerListQuerySchema = z.object({
  search: z.string().trim().min(1).max(100).optional(),
  assignment: z.enum(['all', 'assigned', 'unassigned']).default('all'),
  limit: z.coerce.number().int().min(1).max(200).default(100),
}).strict();

export const createQuotationSchema = z.object({
  customerId: z.string().uuid(),
  ownerId: z.string().uuid().optional(),
  validUntil: z.string().datetime().optional(),
  promisedDeliveryAt: z.string().datetime().optional(),
  terms: z.string().trim().max(5000).optional(),
}).strict().superRefine((value, context) => {
  if (value.validUntil && new Date(value.validUntil) <= new Date()) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['validUntil'], message: 'Validity date must be in the future.' });
  }
});

export class QuotationCreationError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

type QuotationCreationCustomer = {
  primarySalesTeamId: string | null;
  primarySalesTeam: { managerId: string | null; members: Array<{ userId: string }> } | null;
  assignments: Array<{ userId: string; user: { role: string; status: string } }>;
};

export function quotationCreationOwnership(
  actor: Pick<QuotationActor, 'id' | 'role'>,
  customer: QuotationCreationCustomer,
  requestedOwnerId?: string,
) {
  if (actor.role === 'REP' && requestedOwnerId) throw new QuotationCreationError(422, 'VALIDATION_ERROR', 'Representatives cannot choose a quotation owner.');
  if (actor.role !== 'REP' && !requestedOwnerId) throw new QuotationCreationError(422, 'OWNER_REQUIRED', 'Select an assigned representative to own this quotation.');
  if (!customer.primarySalesTeamId || !customer.primarySalesTeam) throw new QuotationCreationError(422, 'ASSIGNMENT_REQUIRED', 'Assign this customer to a sales team before creating a quotation.');
  if (actor.role === 'MANAGER' && customer.primarySalesTeam.managerId !== actor.id) throw new QuotationCreationError(403, 'FORBIDDEN', 'Managers can create quotations only for customers assigned to their team.');
  const ownerId = actor.role === 'REP' ? actor.id : requestedOwnerId!;
  const ownerAssignment = customer.assignments.find((assignment) => assignment.userId === ownerId && assignment.user.role === 'REP' && assignment.user.status === 'ACTIVE');
  if (!ownerAssignment) throw new QuotationCreationError(403, 'CUSTOMER_ASSIGNMENT_REQUIRED', 'The quotation owner must be an active representative assigned to this customer.');
  if (!customer.primarySalesTeam.members.some((member) => member.userId === ownerId)) throw new QuotationCreationError(403, 'TEAM_MEMBERSHIP_REQUIRED', 'The quotation owner must belong to the customer sales team.');
  return { ownerId, teamId: customer.primarySalesTeamId };
}

export type CreateDraftInput = {
  organizationId: string;
  actor: Pick<QuotationActor, 'id' | 'role'>;
  customerId: string;
  requestedOwnerId?: string;
  createdById?: string;
  lines?: Array<{ productId: string; quantity: number }>;
  validUntil?: Date | null;
  promisedDeliveryAt?: Date | null;
  terms?: string | null;
  internalNote?: string | null;
  auditActorId?: string;
  auditAction?: string;
  auditReason?: string;
  requestId?: string;
};

export async function createDraft(tx: Prisma.TransactionClient, input: CreateDraftInput) {
  const customer = await tx.customer.findFirst({
    where: { id: input.customerId, organizationId: input.organizationId, active: true },
    include: {
      primarySalesTeam: { include: { members: { select: { userId: true } } } },
      assignments: { where: { active: true }, include: { user: { select: { id: true, role: true, status: true } } } },
    },
  });
  if (!customer) throw new QuotationCreationError(422, 'CONFIGURATION_REQUIRED', 'Select an active customer.');
  const { ownerId, teamId } = quotationCreationOwnership(input.actor, customer, input.requestedOwnerId);
  const requestedLines = input.lines ?? [];
  if (requestedLines.some((line) => !Number.isInteger(line.quantity) || line.quantity <= 0)) {
    throw new QuotationCreationError(422, 'VALIDATION_ERROR', 'Quotation draft quantities must be positive whole numbers.');
  }

  const products = requestedLines.length ? await tx.product.findMany({
    where: { id: { in: [...new Set(requestedLines.map((line) => line.productId))] }, organizationId: input.organizationId, active: true },
  }) : [];
  if (products.length !== new Set(requestedLines.map((line) => line.productId)).size) {
    throw new QuotationCreationError(422, 'CONFIGURATION_REQUIRED', 'One or more products are unavailable.');
  }
  const policy = requestedLines.length ? await tx.discountPolicy.findFirst({ where: { organizationId: input.organizationId, tier: customer.tier } }) : null;
  if (requestedLines.length && !policy) throw new QuotationCreationError(422, 'CONFIGURATION_REQUIRED', 'Configure this customer tier before pricing the quotation.');

  const pricingInputs = requestedLines.map((line) => {
    const product = products.find((item) => item.id === line.productId)!;
    return {
      productId: product.id,
      quantity: line.quantity,
      unitPrice: product.price,
      unitCost: product.cost,
      discount: 0,
      allowedDiscount: allowedDiscountForCategory(product.category, policy!),
      taxRate: product.taxRate,
      cadence: product.recurring ? product.cadence : 'One-time',
    };
  });
  const calculation = pricingInputs.length ? calculateQuote(pricingInputs, 0, {
    financeThreshold: policy!.financeThreshold,
    aggregateDiscountLimit: policy!.aggregateDiscountLimit,
    minimumMarginPercent: policy!.minimumMarginPercent,
  }) : null;
  const snapshot = pricingInputs.map((line, index) => {
    const product = products.find((item) => item.id === line.productId)!;
    const calculated = calculation!.lines[index]!;
    return {
      productId: product.id, name: product.name, sku: product.sku, category: product.category, description: product.description,
      quantity: line.quantity, unitPrice: line.unitPrice.toString(), unitCost: line.unitCost.toString(), taxRate: line.taxRate.toString(),
      cadence: line.cadence, discount: 0, effectiveDiscount: calculated.effectiveDiscount, allowedDiscount: line.allowedDiscount.toString(),
      gross: calculated.gross, net: calculated.net, tax: calculated.tax, lineCost: calculated.lineCost, excess: calculated.excess,
    };
  });
  const number = `Q-${Date.now().toString().slice(-8)}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
  const quote = await tx.quote.create({ data: {
    organizationId: input.organizationId,
    number,
    customer: customer.name,
    customerId: customer.id,
    customerTier: customer.tier,
    ownerId,
    createdById: input.createdById ?? ownerId,
    teamId,
    total: calculation?.total ?? 0,
    taxTotal: calculation?.taxTotal ?? 0,
    totalsByCadence: (calculation?.totalsByCadence ?? {}) as Prisma.InputJsonValue,
    margin: calculation?.margin ?? 0,
    riskScore: calculation?.riskScore ?? 0,
  } });
  const revision = await tx.quoteRevision.create({ data: {
    quoteId: quote.id,
    revisionNumber: 1,
    state: 'DRAFT',
    currency: customer.currency,
    validUntil: input.validUntil ?? null,
    promisedDeliveryAt: input.promisedDeliveryAt ?? null,
    terms: input.terms ?? null,
    internalNote: input.internalNote ?? null,
    orderDiscount: 0,
    subtotal: calculation?.subtotal ?? 0,
    taxTotal: calculation?.taxTotal ?? 0,
    total: calculation?.total ?? 0,
    margin: calculation?.margin ?? 0,
    riskScore: calculation?.riskScore ?? 0,
    totalsByCadence: (calculation?.totalsByCadence ?? {}) as Prisma.InputJsonValue,
    linesSnapshot: snapshot as Prisma.InputJsonValue,
    policySnapshot: policy ? ({ policyId: policy.id, version: policy.version, source: input.auditAction ?? 'QUOTE_CREATED' } as Prisma.InputJsonValue) : {},
    termsHash: crypto.createHash('sha256').update(JSON.stringify({ quoteId: quote.id, revision: 1, snapshot, nonce: crypto.randomUUID() })).digest('hex'),
  } });
  if (pricingInputs.length) await tx.quoteLine.createMany({ data: pricingInputs.map((line) => ({
    quoteId: quote.id,
    productId: line.productId,
    quantity: line.quantity,
    unitPrice: line.unitPrice,
    unitCost: line.unitCost,
    discount: 0,
    allowedDiscount: line.allowedDiscount,
  })) });
  await tx.quote.update({ where: { id: quote.id }, data: { currentRevisionId: revision.id } });
  await tx.auditEvent.create({ data: {
    organizationId: input.organizationId,
    actorId: input.auditActorId ?? input.actor.id,
    action: input.auditAction ?? 'QUOTE_CREATED',
    resource: 'Quote',
    resourceId: quote.id,
    reason: input.auditReason,
    revisionId: revision.id,
    requestId: input.requestId,
  } });
  return { quoteId: quote.id, revisionId: revision.id, ownerId, teamId };
}

export const quotationLineInputSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.number().int().positive(),
  discount: z.number().min(0).max(100),
}).strict();

export const quoteDraftSchema = z.object({
  revisionId: z.string().uuid(),
  expectedVersion: z.number().int().nonnegative(),
  orderDiscount: z.number().min(0).max(100),
  lines: z.array(quotationLineInputSchema).min(1).max(200),
  validUntil: z.string().datetime().nullable().optional(),
  promisedDeliveryAt: z.string().datetime().nullable().optional(),
  terms: z.string().trim().max(5000).nullable().optional(),
}).strict().superRefine((value, context) => {
  if (value.validUntil && new Date(value.validUntil) <= new Date()) context.addIssue({ code: z.ZodIssueCode.custom, path: ['validUntil'], message: 'Validity date must be in the future.' });
});

export const quoteSubmitSchema = z.object({
  revisionId: z.string().uuid(),
  expectedVersion: z.number().int().nonnegative(),
  reason: z.string().trim().min(2).max(2000),
}).strict();

export const quotePreviewSchema = z.object({
  revisionId: z.string().uuid(),
  expectedVersion: z.number().int().nonnegative(),
  orderDiscount: z.number().min(0).max(100),
  lines: z.array(z.object({
    variantId: z.string().uuid(),
    quantity: z.number().int().positive(),
    lineDiscount: z.number().min(0).max(100),
  }).strict()).min(1).max(200),
}).strict();

type DiscountPolicyLimits = {
  maxDiscount: Prisma.Decimal | string | number;
  hardwareLimit: Prisma.Decimal | string | number;
  servicesLimit: Prisma.Decimal | string | number;
  subscriptionLimit: Prisma.Decimal | string | number;
};

export function allowedDiscountForCategory(category: string, policy: DiscountPolicyLimits) {
  const categoryLimit = category === 'Hardware'
    ? policy.hardwareLimit
    : category === 'Services'
      ? policy.servicesLimit
      : policy.subscriptionLimit;
  return Prisma.Decimal.min(policy.maxDiscount, categoryLimit);
}

type StageSource = {
  stage: string;
  currentRevisionId: string | null;
  currentRevision?: { id: string; state: string } | null;
  approvals?: Array<{ revisionId: string; state: string; step?: string; sequence?: number; cycle?: number }>;
  negotiation?: Array<{ revisionId: string; kind?: string; state?: string }>;
  order?: unknown | null;
};

export function deriveQuotationStage(quote: StageSource): QuotationStage {
  if (quote.order) return 'CONFIRMED';
  if (quote.currentRevision?.state === 'DRAFT') return 'DRAFT';
  const revisionId = quote.currentRevisionId;
  if (quote.approvals?.some((approval) => approval.revisionId === revisionId && ['PENDING', 'WAITING'].includes(approval.state))) return 'PENDING_APPROVAL';
  if (quote.negotiation?.some((proposal) => proposal.revisionId === revisionId && proposal.kind === 'PROPOSAL' && proposal.state === 'OPEN')) return 'NEGOTIATION';
  if (quote.stage === 'REJECTED') return 'REJECTED';
  return 'APPROVED';
}

type ListFilters = z.infer<typeof quotationListQuerySchema>;

function activitySince(period: ListFilters['activityPeriod']) {
  if (period === 'all') return undefined;
  const days = Number(period.slice(0, -1));
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

export function quotationStageWhere(stage: QuotationStage): Prisma.QuoteWhereInput {
  switch (stage) {
    case 'DRAFT': return { currentRevision: { is: { state: 'DRAFT' } } };
    case 'PENDING_APPROVAL': return { approvals: { some: { state: { in: ['PENDING', 'WAITING'] } } } };
    case 'NEGOTIATION': return { negotiation: { some: { kind: 'PROPOSAL', state: 'OPEN' } } };
    case 'CONFIRMED': return { order: { isNot: null } };
    case 'REJECTED': return { stage: 'REJECTED' };
    case 'APPROVED': return {
      AND: [
        { currentRevision: { is: { state: { in: ['SUBMITTED', 'SENT'] } } } },
        { approvals: { none: { state: { in: ['PENDING', 'WAITING'] } } } },
        { negotiation: { none: { kind: 'PROPOSAL', state: 'OPEN' } } },
        { order: { is: null } },
        { stage: { not: 'REJECTED' } },
      ],
    };
  }
}

export function quotationRecordScope(actor: QuotationActor): Prisma.QuoteWhereInput {
  if (actor.role === 'REP') return { OR: [
    { ownerId: actor.id },
    { team: { is: { members: { some: { userId: actor.id } } } } },
  ] };
  if (actor.role === 'MANAGER') return { team: { is: { managerId: actor.id } } };
  return {};
}

export function buildQuotationWhere(actor: QuotationActor, filters: Partial<ListFilters>): Prisma.QuoteWhereInput {
  const since = activitySince(filters.activityPeriod ?? 'all');
  const conditions: Prisma.QuoteWhereInput[] = [];
  const recordScope = quotationRecordScope(actor);
  if (Object.keys(recordScope).length) conditions.push(recordScope);
  if (actor.role !== 'REP' && filters.ownerId) conditions.push({ ownerId: filters.ownerId });
  if (filters.stage) conditions.push(quotationStageWhere(filters.stage));
  if (filters.search) {
    conditions.push({ OR: [
      { number: { contains: filters.search, mode: 'insensitive' } },
      { customer: { contains: filters.search, mode: 'insensitive' } },
      { owner: { name: { contains: filters.search, mode: 'insensitive' } } },
    ] });
  }
  return {
    organizationId: actor.organizationId,
    ...(filters.customerId ? { customerId: filters.customerId } : {}),
    ...(since ? { lastActivity: { gte: since } } : {}),
    ...(conditions.length ? { AND: conditions } : {}),
  };
}

type CapabilitySource = StageSource & {
  ownerId: string;
  sentAt?: Date | string | null;
  currentRevision?: ({ id: string; state: string; submittedById?: string | null } | null);
  approvals?: Array<{ revisionId: string; state: string; step?: string; sequence?: number; cycle?: number; reviewerId?: string | null }>;
};

export function quotationCapabilities(actor: QuotationActor, quote: CapabilitySource) {
  const stage = deriveQuotationStage(quote);
  const readOnly = Boolean(actor.readOnlyView);
  const seller = actor.role === 'REP' && quote.ownerId === actor.id;
  const currentApproval = quote.approvals
    ?.filter((approval) => approval.revisionId === quote.currentRevisionId && approval.state === 'PENDING')
    .sort((left, right) => (right.cycle ?? 0) - (left.cycle ?? 0) || (left.sequence ?? 0) - (right.sequence ?? 0))[0];
  const approvalRoleMatches = currentApproval?.step === 'Sales Manager'
    ? ['MANAGER', 'ADMIN'].includes(actor.role)
    : currentApproval?.step === 'Finance' && ['FINANCE', 'ADMIN'].includes(actor.role);
  const selfApproval = quote.ownerId === actor.id || quote.currentRevision?.submittedById === actor.id;
  const values:Record<QuotationCapability,boolean> = {
    editDraft: !readOnly && seller && stage === 'DRAFT',
    saveDraft: !readOnly && seller && stage === 'DRAFT',
    submit: !readOnly && seller && stage === 'DRAFT',
    assign: !readOnly && ['MANAGER','ADMIN'].includes(actor.role) && ['DRAFT','PENDING_APPROVAL'].includes(stage),
    approve: !readOnly && Boolean(currentApproval && approvalRoleMatches && !selfApproval),
    send: !readOnly && seller && stage === 'APPROVED' && !quote.sentAt,
    negotiate: !readOnly && seller && stage === 'NEGOTIATION',
    previewCustomer: true,
    downloadPdf: true,
    viewCost: ['FINANCE','ADMIN'].includes(actor.role),
    viewMargin: ['REP','MANAGER','FINANCE','ADMIN'].includes(actor.role),
    viewActivity: true,
  };
  const reasons:Partial<Record<QuotationCapability,string>> = {};
  if (readOnly) for (const action of ['editDraft','saveDraft','submit','assign','approve','send','negotiate'] as QuotationCapability[]) reasons[action] = 'View As mode is read-only.';
  if (!readOnly && stage !== 'DRAFT') reasons.editDraft = reasons.saveDraft = reasons.submit = 'Submitted revisions are immutable. Create or return a revision to Draft before editing.';
  if (!readOnly && !seller) reasons.editDraft = reasons.saveDraft = reasons.submit = reasons.send = reasons.negotiate = 'Only the quotation owner can perform this action.';
  if (!currentApproval) reasons.approve = 'There is no active approval step.';
  else if (selfApproval) reasons.approve = 'Quotation owners and submitters cannot approve their own submission.';
  else if (!approvalRoleMatches) reasons.approve = `This step requires the ${currentApproval.step} role.`;
  if (stage !== 'APPROVED') reasons.send = 'The quotation must complete approval before it can be sent.';
  if (stage !== 'NEGOTIATION') reasons.negotiate = 'There is no active customer proposal to review.';
  return { ...values, reasons };
}

export function approvedDeliveryTransition(sentAt = new Date()) {
  return {
    revision: { state: 'SENT' as const, sentAt },
    quote: { stage: 'APPROVED' as const, sentAt, version: { increment: 1 }, lastActivity: sentAt },
  };
}

type SnapshotLine = { productId?: string; name?: string; sku?: string; quantity?: number; discount?: number|string; unitPrice?: number|string; net?: number|string };
type RevisionSource = { id: string; revisionNumber: number; state: string; total: {toString():string}|string|number; margin: {toString():string}|string|number; riskScore: {toString():string}|string|number; createdAt: Date; linesSnapshot: unknown };

function snapshotLines(value:unknown):SnapshotLine[] { return Array.isArray(value) ? value.filter((line):line is SnapshotLine=>Boolean(line)&&typeof line==='object') : []; }

export function revisionHistory(revisions:RevisionSource[], canViewMargin:boolean, canViewCost:boolean) {
  return [...revisions].sort((a,b)=>b.revisionNumber-a.revisionNumber).map((revision,index,ordered)=>{
    const previous=ordered[index+1];
    const lines=snapshotLines(revision.linesSnapshot).map(line=>canViewCost?line:Object.fromEntries(Object.entries(line).filter(([key])=>key!=='unitCost'&&key!=='lineCost')));
    const oldLines=new Map(snapshotLines(previous?.linesSnapshot).map(line=>[line.productId??line.sku??line.name,line]));
    const changes=lines.map(line=>{
      const key=String(line.productId??line.sku??line.name??''); const old=oldLines.get(key);
      if(!old)return {kind:'ADDED',productId:line.productId,name:line.name??line.sku??line.productId??'Product'};
      const fields=['quantity','discount','unitPrice'] as const;
      const changed=fields.filter(field=>String(old[field]??'')!==String(line[field]??''));
      return changed.length?{kind:'CHANGED',productId:line.productId,name:line.name??line.sku??line.productId??'Product',fields:changed}:null;
    }).filter(Boolean);
    if(previous)for(const old of oldLines.values())if(!lines.some(line=>(line.productId??line.sku??line.name)===(old.productId??old.sku??old.name)))changes.push({kind:'REMOVED',productId:old.productId,name:old.name??old.sku??old.productId??'Product'});
    return {
      id:revision.id, revisionNumber:revision.revisionNumber, state:revision.state, total:revision.total.toString(),
      ...(canViewMargin?{margin:revision.margin.toString()}:{}), riskScore:revision.riskScore.toString(), createdAt:revision.createdAt.toISOString(), lines,
      comparedWithRevision:previous?.revisionNumber??null, changes,
    };
  });
}

export function quotationOrderBy(sort: ListFilters['sort']): Prisma.QuoteOrderByWithRelationInput[] {
  switch (sort) {
    case 'activity_asc': return [{ lastActivity: 'asc' }, { id: 'asc' }];
    case 'amount_desc': return [{ total: 'desc' }, { id: 'desc' }];
    case 'amount_asc': return [{ total: 'asc' }, { id: 'asc' }];
    case 'quotation_asc': return [{ number: 'asc' }, { id: 'asc' }];
    case 'quotation_desc': return [{ number: 'desc' }, { id: 'desc' }];
    default: return [{ lastActivity: 'desc' }, { id: 'desc' }];
  }
}

type SummarySource = StageSource & {
  id: string;
  number: string;
  customerId: string;
  customer: string;
  customerTier: string;
  total: { toString(): string } | string | number;
  riskScore: { toString(): string } | string | number;
  version: number;
  lastActivity: Date;
  customerRecord: { currency: string };
  owner: { id: string; name: string };
  sourcePortalRequest?: { id: string } | null;
};

export function quotationSummaryDto(quote: SummarySource) {
  const currentApproval = quote.approvals
    ?.filter((approval) => approval.revisionId === quote.currentRevisionId && approval.state === 'PENDING')
    .sort((left, right) => (right.cycle ?? 0) - (left.cycle ?? 0) || (left.sequence ?? 0) - (right.sequence ?? 0))[0];
  return {
    id: quote.id,
    number: quote.number,
    customer: { id: quote.customerId, name: quote.customer, tier: quote.customerTier },
    owner: quote.owner,
    stage: deriveQuotationStage(quote),
    total: quote.total.toString(),
    currency: quote.currentRevision && 'currency' in quote.currentRevision ? String((quote.currentRevision as { currency: string }).currency) : quote.customerRecord.currency,
    riskScore: quote.riskScore.toString(),
    currentApprovalStep: currentApproval?.step ?? null,
    currentRevisionId: quote.currentRevisionId,
    version: quote.version,
    lastActivityAt: quote.lastActivity.toISOString(),
    origin: quote.sourcePortalRequest ? { type: 'PORTAL_REQUEST', portalRequestId: quote.sourcePortalRequest.id } : { type: 'INTERNAL' },
  };
}
