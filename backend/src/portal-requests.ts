import crypto from 'node:crypto';
import { Prisma, PrismaClient, type LeadStatus, type RfqHandlingMode } from '@prisma/client';
import { z } from 'zod';
import { createDraft, QuotationCreationError } from './quotations.js';

export const PORTAL_REQUESTS_PER_HOUR = 5;

const portalRequestLineSchema = z.object({
  productId: z.string().trim().min(1).max(100).optional(),
  freeTextDescription: z.string().trim().min(1).max(1000).optional(),
  quantity: z.number().positive().max(1_000_000).optional(),
}).strict().refine((line) => Boolean(line.productId || line.freeTextDescription), {
  message: 'Choose a catalog product or describe the requested item.',
});

export const portalRequestSchema = z.object({
  requirementsText: z.string().trim().min(5).max(5000),
  preferredDeliveryDate: z.string().date().nullable().optional(),
  lines: z.array(portalRequestLineSchema).max(50).default([]),
}).strict();

export const leadListSchema = z.object({
  status: z.enum(['NEW', 'CONVERTED', 'DISMISSED']).optional(),
}).strict();

export const dismissLeadSchema = z.object({
  reason: z.string().trim().min(5).max(1000),
}).strict();

export const rfqHandlingSettingSchema = z.object({
  mode: z.enum(['LEAD_FIRST', 'DIRECT_DRAFT']),
  reason: z.string().trim().min(5).max(500).optional(),
}).strict();

export class PortalRequestError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly retryAfter?: number) { super(message); }
}

type PortalRequestActor = {
  id: string;
  role: string;
  organizationId: string;
  customerId?: string | null;
  requestId?: string;
};

type SubmissionInput = z.infer<typeof portalRequestSchema> & {
  idempotencyKey: string;
};
type SubmissionResult = { id:string; status:'RECEIVED'|'IN_PROGRESS'; handlingMode:RfqHandlingMode; replayed:boolean };

const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const fingerprint = (value: unknown) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const quantity = (value: Prisma.Decimal | null) => value === null ? null : value.toString();

export function safeRequestDto(request: any) {
  const customerStatus = request.status === 'DISMISSED' ? 'DECLINED' : request.status === 'PROCESSED' ? 'IN_PROGRESS' : 'RECEIVED';
  return {
    id: request.id,
    requirementsText: request.requirementsText,
    preferredDeliveryDate: request.preferredDeliveryDate?.toISOString?.() ?? request.preferredDeliveryDate ?? null,
    status: customerStatus,
    createdAt: request.createdAt?.toISOString?.() ?? request.createdAt,
    lines: (request.lines ?? []).map((line: any) => ({
      id: line.id,
      product: line.product ? { id: line.product.id, name: line.product.name, sku: line.product.sku } : null,
      description: line.freeTextDescription,
      quantity: quantity(line.quantity),
      catalogMatch: !line.degraded && Boolean(line.product),
    })),
  };
}

function internalRequestDto(request: any) {
  return {
    id: request.id,
    requirementsText: request.requirementsText,
    preferredDeliveryDate: request.preferredDeliveryDate?.toISOString?.() ?? request.preferredDeliveryDate ?? null,
    status: request.status,
    createdAt: request.createdAt?.toISOString?.() ?? request.createdAt,
    lines: (request.lines ?? []).map((line: any) => ({
      id: line.id,
      product: line.product ? { id: line.product.id, name: line.product.name, sku: line.product.sku, active: line.product.active } : null,
      freeTextDescription: line.freeTextDescription,
      quantity: quantity(line.quantity),
      degraded: line.degraded,
      degradedReason: line.degradedReason,
    })),
  };
}

const requestInclude = {
  lines: { include: { product: { select: { id: true, name: true, sku: true, active: true } } }, orderBy: { id: 'asc' as const } },
} satisfies Prisma.PortalRequestInclude;

const leadInclude = {
  customer: { select: { id: true, name: true, primarySalesTeam: { select: { id: true, name: true, managerId: true } } } },
  assignedRep: { select: { id: true, name: true } },
  portalRequest: { include: requestInclude },
  convertedQuotation: { select: { id: true, number: true } },
} satisfies Prisma.LeadInclude;

function leadDto(lead: Prisma.LeadGetPayload<{ include: typeof leadInclude }>) {
  return {
    id: lead.id,
    status: lead.status,
    requirementsSummary: lead.requirementsSummary,
    dismissReason: lead.dismissReason,
    customer: { id: lead.customer.id, name: lead.customer.name },
    team: lead.customer.primarySalesTeam ? { id: lead.customer.primarySalesTeam.id, name: lead.customer.primarySalesTeam.name } : null,
    assignedRep: lead.assignedRep,
    request: internalRequestDto(lead.portalRequest),
    convertedQuotation: lead.convertedQuotation,
    createdAt: lead.createdAt.toISOString(),
    updatedAt: lead.updatedAt.toISOString(),
  };
}

function internalNote(request: { id: string; requirementsText: string; lines: Array<{ product?: { name: string } | null; freeTextDescription: string | null; quantity: Prisma.Decimal | null; degraded: boolean; degradedReason: string | null }> }) {
  const lines = request.lines.map((line) => {
    const description = line.product?.name ?? line.freeTextDescription ?? 'Unmatched catalog selection';
    const amount = line.quantity ? ` × ${line.quantity.toString()}` : '';
    const warning = line.degraded ? ` [${line.degradedReason ?? 'catalog match unavailable'}]` : '';
    return `- ${description}${amount}${warning}`;
  });
  return [`Portal request ${request.id}`, request.requirementsText, ...(lines.length ? ['Requested items:', ...lines] : [])].join('\n');
}

export function leadScope(actor: Pick<PortalRequestActor, 'id' | 'role' | 'organizationId'>): Prisma.LeadWhereInput {
  if (actor.role === 'REP') return { organizationId: actor.organizationId, assignedRepId: actor.id };
  if (actor.role === 'MANAGER') return { organizationId: actor.organizationId, customer: { primarySalesTeam: { is: { managerId: actor.id } } } };
  return { organizationId: '__forbidden__' };
}

export async function updateRfqHandlingMode(tx: Prisma.TransactionClient, actor: PortalRequestActor, mode: RfqHandlingMode, reason?: string) {
  if (actor.role !== 'ADMIN') throw new PortalRequestError(403, 'FORBIDDEN', 'Administrator permission is required.');
  const current = await tx.organization.findUnique({ where: { id: actor.organizationId }, select: { rfqHandlingMode: true } });
  if (!current) throw new PortalRequestError(404, 'NOT_FOUND', 'Organization not found.');
  if (current.rfqHandlingMode === mode) return { mode: current.rfqHandlingMode, changed: false };
  const organization = await tx.organization.update({ where: { id: actor.organizationId }, data: { rfqHandlingMode: mode }, select: { rfqHandlingMode: true } });
  await tx.auditEvent.create({ data: {
    organizationId: actor.organizationId,
    actorId: actor.id,
    action: 'RFQ_HANDLING_MODE_CHANGED',
    resource: 'Organization',
    resourceId: actor.organizationId,
    reason: `${current.rfqHandlingMode} -> ${mode}${reason ? `: ${reason}` : ''}`,
    requestId: actor.requestId,
  } });
  return { mode: organization.rfqHandlingMode, changed: true };
}

export async function submitPortalRequest(tx: Prisma.TransactionClient, actor: PortalRequestActor, input: SubmissionInput):Promise<SubmissionResult> {
  if (actor.role !== 'CUSTOMER' || !actor.customerId) throw new PortalRequestError(403, 'FORBIDDEN', 'A linked customer portal account is required.');
  const payloadHash = fingerprint({ requirementsText: input.requirementsText, preferredDeliveryDate: input.preferredDeliveryDate ?? null, lines: input.lines });
  const key = { actorId_operation_resourceKey_key: { actorId: actor.id, operation: 'PORTAL_REQUEST_SUBMIT', resourceKey: actor.customerId, key: input.idempotencyKey } };
  const replay = await tx.idempotencyRecord.findUnique({ where: key });
  if (replay) {
    if (replay.payloadHash !== payloadHash) throw new PortalRequestError(409, 'IDEMPOTENCY_CONFLICT', 'This request key was already used for different requirements.');
    return { ...(replay.responseBody as Omit<SubmissionResult, 'replayed'>), replayed: true };
  }

  await tx.$queryRaw`SELECT "id" FROM "Customer" WHERE "id" = ${actor.customerId} FOR UPDATE`;
  const lockedReplay = await tx.idempotencyRecord.findUnique({ where: key });
  if (lockedReplay) {
    if (lockedReplay.payloadHash !== payloadHash) throw new PortalRequestError(409, 'IDEMPOTENCY_CONFLICT', 'This request key was already used for different requirements.');
    return { ...(lockedReplay.responseBody as Omit<SubmissionResult, 'replayed'>), replayed: true };
  }
  const customer = await tx.customer.findFirst({
    where: { id: actor.customerId, organizationId: actor.organizationId, active: true },
    include: {
      organization: { select: { rfqHandlingMode: true } },
      primarySalesTeam: { include: { members: { select: { userId: true } } } },
      assignments: { where: { role: 'PRIMARY', active: true }, include: { user: { select: { id: true, role: true, status: true } } } },
    },
  });
  const primary = customer?.assignments[0];
  if (!customer || !customer.primarySalesTeamId || !customer.primarySalesTeam || customer.assignments.length !== 1 || !primary || primary.user.role !== 'REP' || primary.user.status !== 'ACTIVE' || !customer.primarySalesTeam.members.some((member) => member.userId === primary.user.id)) {
    throw new PortalRequestError(422, 'CONFIGURATION_REQUIRED', 'Your account does not currently have an active primary representative. Contact your account team before submitting a request.');
  }

  const since = new Date(Date.now() - 60 * 60 * 1000);
  const recent = await tx.portalRequest.findMany({
    where: { customerId: customer.id, submittedByUserId: actor.id, createdAt: { gte: since } },
    select: { createdAt: true },
    orderBy: { createdAt: 'asc' },
  });
  if (recent.length >= PORTAL_REQUESTS_PER_HOUR) {
    const retryAfter = Math.max(1, Math.ceil((recent[0]!.createdAt.getTime() + 60 * 60 * 1000 - Date.now()) / 1000));
    throw new PortalRequestError(429, 'RATE_LIMITED', `You can submit up to ${PORTAL_REQUESTS_PER_HOUR} quote requests per hour. Try again later.`, retryAfter);
  }

  const candidateIds = input.lines.map((line) => line.productId).filter((id): id is string => Boolean(id && /^[0-9a-f-]{36}$/i.test(id)));
  const products = candidateIds.length ? await tx.product.findMany({
    where: { id: { in: [...new Set(candidateIds)] }, organizationId: actor.organizationId, active: true },
    select: { id: true, name: true },
  }) : [];
  const productsById = new Map(products.map((product) => [product.id, product]));
  const lines = input.lines.map((line) => {
    const product = line.productId ? productsById.get(line.productId) : undefined;
    const degraded = Boolean(line.productId && !product) || Boolean(product && line.quantity !== undefined && !Number.isInteger(line.quantity));
    const degradedReason = line.productId && !product ? 'PRODUCT_UNAVAILABLE' : product && line.quantity !== undefined && !Number.isInteger(line.quantity) ? 'QUANTITY_NOT_PRICEABLE' : null;
    return {
      productId: product?.id ?? null,
      freeTextDescription: line.freeTextDescription ?? (!product ? 'Catalog selection could not be matched.' : null),
      quantity: line.quantity === undefined ? null : new Prisma.Decimal(line.quantity),
      degraded,
      degradedReason,
    };
  });
  const request = await tx.portalRequest.create({ data: {
    organizationId: actor.organizationId,
    customerId: customer.id,
    submittedByUserId: actor.id,
    requirementsText: input.requirementsText,
    preferredDeliveryDate: input.preferredDeliveryDate ? new Date(`${input.preferredDeliveryDate}T12:00:00.000Z`) : null,
    lines: { create: lines },
  }, include: requestInclude });

  let resultKind: 'LEAD' | 'QUOTATION';
  if (customer.organization.rfqHandlingMode === 'DIRECT_DRAFT') {
    const priceableLines = request.lines.filter((line) => line.product && !line.degraded && line.quantity && Number.isInteger(Number(line.quantity))).map((line) => ({ productId: line.productId!, quantity: Number(line.quantity) }));
    let draft;
    try {
      draft = await createDraft(tx, {
        organizationId: actor.organizationId,
        actor: { id: primary.user.id, role: 'REP' },
        customerId: customer.id,
        createdById: primary.user.id,
        lines: priceableLines,
        promisedDeliveryAt: request.preferredDeliveryDate,
        internalNote: internalNote(request),
        auditActorId: actor.id,
        auditAction: 'PORTAL_REQUEST_DRAFT_CREATED',
        auditReason: `Created automatically from portal request ${request.id}.`,
        requestId: actor.requestId,
      });
    } catch (error) {
      if (!(error instanceof QuotationCreationError) || error.code !== 'CONFIGURATION_REQUIRED') throw error;
      draft = await createDraft(tx, {
        organizationId: actor.organizationId,
        actor: { id: primary.user.id, role: 'REP' },
        customerId: customer.id,
        createdById: primary.user.id,
        promisedDeliveryAt: request.preferredDeliveryDate,
        internalNote: `${internalNote(request)}\n\nStructured pricing could not be pre-populated because catalog pricing policy requires configuration.`,
        auditActorId: actor.id,
        auditAction: 'PORTAL_REQUEST_DRAFT_CREATED',
        auditReason: `Created without priced lines from portal request ${request.id}; pricing configuration is required.`,
        requestId: actor.requestId,
      });
    }
    await tx.portalRequest.update({ where: { id: request.id }, data: { status: 'PROCESSED', resultingQuotationId: draft.quoteId, processedAt: new Date(), processedById: primary.user.id } });
    await tx.alert.create({ data: { organizationId: actor.organizationId, recipientId: primary.user.id, kind: 'PORTAL_REQUEST', title: `${customer.name} submitted a quote request`, detail: 'A quotation Draft was created from the customer portal request.', severity: 'info', resourceType: 'QUOTE', resourceId: draft.quoteId, evaluationKey: `PORTAL_REQUEST:${request.id}:${primary.user.id}` } });
    resultKind = 'QUOTATION';
  } else {
    const lead = await tx.lead.create({ data: { organizationId: actor.organizationId, customerId: customer.id, portalRequestId: request.id, assignedRepId: primary.user.id, requirementsSummary: request.requirementsText } });
    await tx.portalRequest.update({ where: { id: request.id }, data: { resultingLeadId: lead.id } });
    await tx.alert.create({ data: { organizationId: actor.organizationId, recipientId: primary.user.id, kind: 'PORTAL_REQUEST', title: `${customer.name} submitted a quote request`, detail: 'A new Lead is ready for review in the quotations workspace.', severity: 'info', resourceType: 'LEAD', resourceId: lead.id, evaluationKey: `PORTAL_REQUEST:${request.id}:${primary.user.id}` } });
    await tx.auditEvent.create({ data: { organizationId: actor.organizationId, actorId: actor.id, action: 'PORTAL_REQUEST_LEAD_CREATED', resource: 'PortalRequest', resourceId: request.id, reason: `Assigned to representative ${primary.user.id}.`, requestId: actor.requestId } });
    resultKind = 'LEAD';
  }
  await tx.auditEvent.create({ data: { organizationId: actor.organizationId, actorId: actor.id, action: 'PORTAL_REQUEST_SUBMITTED', resource: 'PortalRequest', resourceId: request.id, reason: `Handled as ${customer.organization.rfqHandlingMode}.`, requestId: actor.requestId } });
  const body:SubmissionResult = { id: request.id, status: resultKind === 'QUOTATION' ? 'IN_PROGRESS' : 'RECEIVED', handlingMode: customer.organization.rfqHandlingMode, replayed: false };
  await tx.idempotencyRecord.create({ data: { actorId: actor.id, operation: 'PORTAL_REQUEST_SUBMIT', resourceKey: customer.id, key: input.idempotencyKey, payloadHash, responseStatus: 201, responseBody: json(body) } });
  return body;
}

export async function listPortalRequests(prisma: PrismaClient, actor: PortalRequestActor) {
  if (actor.role !== 'CUSTOMER' || !actor.customerId) throw new PortalRequestError(403, 'FORBIDDEN', 'A linked customer portal account is required.');
  const items = await prisma.portalRequest.findMany({
    where: { organizationId: actor.organizationId, customerId: actor.customerId, submittedByUserId: actor.id },
    include: requestInclude,
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  return { items: items.map(safeRequestDto), rateLimit: { maximum: PORTAL_REQUESTS_PER_HOUR, windowMinutes: 60 } };
}

export async function portalRequestCatalog(prisma: PrismaClient, actor: PortalRequestActor) {
  if (actor.role !== 'CUSTOMER' || !actor.customerId) throw new PortalRequestError(403, 'FORBIDDEN', 'A linked customer portal account is required.');
  const products = await prisma.product.findMany({
    where: { organizationId: actor.organizationId, active: true, storeVisible: true },
    select: { id: true, name: true, sku: true, category: true, description: true, unit: true },
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
    take: 200,
  });
  return { items: products };
}

export async function listLeads(prisma: PrismaClient, actor: PortalRequestActor, status?: LeadStatus) {
  if (!['REP', 'MANAGER'].includes(actor.role)) throw new PortalRequestError(403, 'FORBIDDEN', 'Representative or Manager permission is required.');
  const items = await prisma.lead.findMany({ where: { ...leadScope(actor), ...(status ? { status } : {}) }, include: leadInclude, orderBy: { createdAt: 'desc' }, take: 100 });
  return { items: items.map(leadDto) };
}

export async function getLead(prisma: PrismaClient, actor: PortalRequestActor, leadId: string) {
  if (!['REP', 'MANAGER'].includes(actor.role)) throw new PortalRequestError(403, 'FORBIDDEN', 'Representative or Manager permission is required.');
  const lead = await prisma.lead.findFirst({ where: { id: leadId, ...leadScope(actor) }, include: leadInclude });
  if (!lead) throw new PortalRequestError(404, 'NOT_FOUND', 'Lead not found.');
  return leadDto(lead);
}

export async function convertLead(tx: Prisma.TransactionClient, actor: PortalRequestActor, leadId: string) {
  if (actor.role !== 'REP') throw new PortalRequestError(403, 'FORBIDDEN', 'Only the assigned representative can convert this Lead.');
  await tx.$queryRaw`SELECT "id" FROM "Lead" WHERE "id" = ${leadId} FOR UPDATE`;
  const lead = await tx.lead.findFirst({ where: { id: leadId, organizationId: actor.organizationId, assignedRepId: actor.id }, include: leadInclude });
  if (!lead) throw new PortalRequestError(404, 'NOT_FOUND', 'Lead not found.');
  if (lead.status === 'CONVERTED' && lead.convertedQuotationId && lead.convertedQuotation) return { lead: leadDto(lead), quotation: lead.convertedQuotation, replayed: true };
  if (lead.status !== 'NEW') throw new PortalRequestError(409, 'INVALID_STATE', 'This Lead is no longer open for conversion.');
  const requestedProductIds = lead.portalRequest.lines.flatMap((line) => line.productId ? [line.productId] : []);
  const activeProducts = requestedProductIds.length ? await tx.product.findMany({ where: { id: { in: requestedProductIds }, organizationId: actor.organizationId, active: true }, select: { id: true } }) : [];
  const activeIds = new Set(activeProducts.map((product) => product.id));
  const priceableLines = lead.portalRequest.lines.filter((line) => line.productId && activeIds.has(line.productId) && !line.degraded && line.quantity && Number.isInteger(Number(line.quantity))).map((line) => ({ productId: line.productId!, quantity: Number(line.quantity) }));
  const draft = await createDraft(tx, {
    organizationId: actor.organizationId,
    actor: { id: actor.id, role: 'REP' },
    customerId: lead.customerId,
    createdById: actor.id,
    lines: priceableLines,
    promisedDeliveryAt: lead.portalRequest.preferredDeliveryDate,
    internalNote: internalNote(lead.portalRequest),
    auditActorId: actor.id,
    auditAction: 'LEAD_CONVERTED_TO_DRAFT',
    auditReason: `Converted from Lead ${lead.id}.`,
    requestId: actor.requestId,
  });
  const now = new Date();
  const updated = await tx.lead.update({ where: { id: lead.id }, data: { status: 'CONVERTED', convertedQuotationId: draft.quoteId } });
  await tx.portalRequest.update({ where: { id: lead.portalRequestId }, data: { status: 'PROCESSED', resultingQuotationId: draft.quoteId, processedAt: now, processedById: actor.id } });
  await tx.alert.updateMany({ where: { evaluationKey: `PORTAL_REQUEST:${lead.portalRequestId}:${actor.id}` }, data: { resolved: true, resolvedAt: now } });
  await tx.auditEvent.create({ data: { organizationId: actor.organizationId, actorId: actor.id, action: 'LEAD_CONVERTED', resource: 'Lead', resourceId: lead.id, reason: `Converted to quotation ${draft.quoteId}.`, requestId: actor.requestId } });
  return { lead: { id: updated.id, status: updated.status }, quotation: { id: draft.quoteId, revisionId: draft.revisionId }, replayed: false };
}

export async function dismissLead(tx: Prisma.TransactionClient, actor: PortalRequestActor, leadId: string, reason: string) {
  if (!['REP', 'MANAGER'].includes(actor.role)) throw new PortalRequestError(403, 'FORBIDDEN', 'Representative or Manager permission is required.');
  await tx.$queryRaw`SELECT "id" FROM "Lead" WHERE "id" = ${leadId} FOR UPDATE`;
  const lead = await tx.lead.findFirst({ where: { id: leadId, ...leadScope(actor) }, include: { customer: { select: { id: true } } } });
  if (!lead) throw new PortalRequestError(404, 'NOT_FOUND', 'Lead not found.');
  if (lead.status !== 'NEW') throw new PortalRequestError(409, 'INVALID_STATE', 'Only a new Lead can be dismissed.');
  const now = new Date();
  const updated = await tx.lead.update({ where: { id: lead.id }, data: { status: 'DISMISSED', dismissReason: reason } });
  await tx.portalRequest.update({ where: { id: lead.portalRequestId }, data: { status: 'DISMISSED', processedAt: now, processedById: actor.id } });
  await tx.alert.updateMany({ where: { evaluationKey: `PORTAL_REQUEST:${lead.portalRequestId}:${lead.assignedRepId}` }, data: { resolved: true, resolvedAt: now } });
  await tx.auditEvent.create({ data: { organizationId: actor.organizationId, actorId: actor.id, action: 'LEAD_DISMISSED', resource: 'Lead', resourceId: lead.id, reason, requestId: actor.requestId } });
  return { id: updated.id, status: updated.status };
}
