import './env.js';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { db } from './db.js';
import { acceptCustomerGoogleInvitation, createGoogleOrganizationAdmin, createOrganizationAdmin, findOrLinkGoogleLoginUser, googleSignupSchema, signupSchema, verifyGoogleSignupCredential } from './identity.js';
import { billingSchedule, calculateAddOnContribution, calculateQuote } from './rules.js';
import { allowedDiscountForCategory, buildQuotationWhere, createDraft, createQuotationSchema, customerListQuerySchema, primaryQuotationStages, quotationCapabilities, QuotationCreationError, quotationListQuerySchema, quotationOrderBy, quotationRecordScope, quotationStages, quotationSummaryDto, quoteDraftSchema, quotePreviewSchema, quoteSubmitSchema, revisionHistory } from './quotations.js';
import { renderQuotationPdf, type CustomerQuotationPreview } from './quotation-pdf.js';
import { authenticate as authenticatePlatform, csrfCookieName, hashToken as hashPlatformToken, identityDto, platformSessionCookieName } from './authorization.js';
import { platformRouter } from './platform.js';
import { clearPlatformLoginFailures, platformLoginAllowed, platformOwnerCredentialsMatch, readPlatformOwnerCredentials, recordPlatformLoginFailure } from './platform-owner.js';
import { discountPolicyUpdateSchema } from './policy.js';
import { CustomerRelationshipError, customerRecordScope, customerRelationshipDto, customerRelationshipInclude, customerRelationshipSchema, updateCustomerRelationships } from './customer-relationships.js';
import { acceptPortalInvitation, assertCustomerCreationPortalAccess, inspectPortalInvitation, issuePortalInvitation, PortalInvitationError, portalInvitationAcceptSchema, provisionCustomerPortalPassword, revokePortalInvitation } from './portal-invitations.js';
import { createReturnedDraft, decideStep, evaluateRisk, GovernanceError, openCase } from './governance.js';
import { customerSafeQuotationDto, idempotencyKey, PortalError, portalAcceptSchema, portalCommentSchema, portalProposalSchema, proposalResponseSchema, requireExactSentRevision, sendQuotationSchema } from './portal.js';
import { confirmEligibleRevision, OrderConfirmationError } from './orders.js';
import { BillingError, changeSubscription, recordPayment, requestInvoiceDueDateChange, reversePayment } from './billing.js';
import { evaluateAlerts } from './deal-health.js';
import { aggregateSales, reportAsPdf, reportAsXls } from './reporting.js';
import { consolidateBackorder, consolidateSchema, FulfillmentError, previewSplit, receiveStock, receiveStockSchema, reserveStock, reserveStockSchema } from './fulfillment.js';
import { assistantMessagesSchema, runAssistant, type AssistantContext } from './assistant.js';
import { convertLead, dismissLead, dismissLeadSchema, getLead, leadListSchema, listLeads, listPortalRequests, portalRequestCatalog, PortalRequestError, portalRequestSchema, rfqHandlingSettingSchema, submitPortalRequest, updateRfqHandlingMode } from './portal-requests.js';
import { createRazorpayClient, paymentWebhookKey, readRazorpayConfiguration, rupeesToPaise, verifyCheckoutSignature, verifyWebhookSignature } from './payments.js';
import { createCustomerProfile, customerCreationSchema, customerProfileSchema, CustomerProfileError } from './customers.js';
import { approveDirectoryJoinRequest, approveDirectoryJoinRequestSchema, createDirectoryJoinRequest, declineDirectoryJoinRequest, declineDirectoryJoinRequestSchema, directoryJoinListSchema, directoryJoinRequestSchema, DirectoryError, getOrganizationDirectoryProfile, listDirectoryBusinesses, listDirectoryJoinRequests, organizationProfileSchema, updateOrganizationDirectoryProfile } from './directory.js';
import { createSalesTeam, SalesTeamError, salesTeamMutationSchema, updateSalesTeam } from './sales-teams.js';

type Actor = { id: string; name: string; email: string; loginId: string | null; role: string; customerId: string | null; organizationId: string; moduleAccess: string[]; csrfToken: string; actorType: 'USER' | 'PLATFORM_OWNER'; platformSuperAdmin: boolean; readOnlyView: boolean; organization: { id: string; name: string; status: string } | null; viewContext: { readOnly: true; organizationId: string; organizationName: string; simulatedUserId: string | null; realActor: { id: string; name: string } } | null };
type AuthRequest = Request & { user?: Actor; requestId?: string };
type Tx = Prisma.TransactionClient;

class DomainError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

const cookieName = process.env.SESSION_COOKIE_NAME ?? 'dealos_session';
const allowedOrigin = process.env.FRONTEND_ORIGIN ?? 'http://localhost:5173';
const googleClientId = process.env.GOOGLE_CLIENT_ID?.trim() ?? '';
const googleClientAudiences = [
  googleClientId,
  process.env.GOOGLE_IOS_CLIENT_ID?.trim() ?? '',
  process.env.GOOGLE_ANDROID_CLIENT_ID?.trim() ?? '',
].filter((clientId): clientId is string => Boolean(clientId));
const modules = ['dashboard','quotations','approvals','fulfillment','subscriptions','invoices','health','reports','products','customers','policies'] as const;
const provisionableRoles = ['REP','MANAGER','FINANCE'] as const;
const roleModulePresets: Record<typeof provisionableRoles[number], Array<typeof modules[number]>> = {
  REP: ['dashboard', 'quotations', 'health'],
  MANAGER: ['dashboard', 'quotations', 'approvals', 'health', 'reports', 'customers', 'policies'],
  FINANCE: ['dashboard', 'approvals', 'fulfillment', 'invoices', 'reports'],
};
const ok = (req: AuthRequest, res: Response, data: unknown, status = 200) => res.status(status).json({ success: true, data, meta: { requestId: req.requestId } });
const fail = (req: AuthRequest, res: Response, status: number, code: string, message: string, details?: unknown) => res.status(status).json({ success: false, error: { code, message, details }, meta: { requestId: req.requestId } });
const decimal = (value: unknown) => Number(value);
const routeParam = (req: Request, name: string) => String(req.params[name] ?? '');
const hash = (value: string) => crypto.createHash('sha256').update(value).digest('hex');
const asJson = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const parseCookies = (header = '') => Object.fromEntries(header.split(';').map((part) => part.trim().split('=').map(decodeURIComponent)).filter(([key]) => key));
const csrfForToken = (token: string) => hash(`dealos-csrf:${token}`);
const termsHash = (value: unknown) => hash(JSON.stringify(value));
const loginAttempts = new Map<string, { count: number; resetAt: number }>();

const numeric = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const formatPercent = (value: number) => `${Number(value.toFixed(2))}%`;
const formatPoints = (value: number) => `${Number(value.toFixed(2))} pts`;
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

function approvalRiskBreakdown(quote: any) {
  const revision = quote.currentRevision;
  const snapshot = isRecord(revision?.policySnapshot) ? revision.policySnapshot : {};
  const calculation = isRecord(snapshot.components) ? snapshot.components : isRecord(snapshot.calculation) ? snapshot.calculation : {};
  const snapshottedPolicy = isRecord(snapshot.policy) ? snapshot.policy : snapshot;
  const orderDiscount = numeric(revision?.orderDiscount ?? quote.orderDiscount);
  const grossLines = (quote.lines ?? []).map((line: any) => {
    const discount = numeric(line.discount);
    const allowed = numeric(line.allowedDiscount);
    const effectiveDiscount = 100 - ((100 - discount) * (100 - orderDiscount)) / 100;
    const excess = Math.max(0, effectiveDiscount - allowed);
    return {
      productId: line.productId,
      product: line.product?.name ?? 'Line item',
      gross: numeric(line.unitPrice) * numeric(line.quantity, 1),
      discount,
      effectiveDiscount,
      allowed,
      excess,
    };
  });
  const grossTotal = grossLines.reduce((sum: number, line: any) => sum + line.gross, 0);
  const lineWeightedExcess = grossTotal ? grossLines.reduce((sum: number, line: any) => sum + line.gross * line.excess, 0) / grossTotal : 0;
  const worstLine = [...grossLines].sort((left, right) => right.excess - left.excess)[0] ?? null;
  const worstExcess = numeric(calculation.worstExcess, worstLine?.excess ?? 0);
  const weightedExcess = numeric(calculation.weightedExcess, lineWeightedExcess);
  const subtotal = numeric(revision?.subtotal, Math.max(0, numeric(quote.total) - numeric(quote.taxTotal)));
  const margin = numeric(revision?.margin ?? quote.margin);
  const marginPercent = numeric(calculation.marginPercent, subtotal ? (margin / subtotal) * 100 : 0);
  const financeThreshold = numeric(snapshottedPolicy.financeThreshold, 5);
  const minimumMarginPercent = numeric(snapshottedPolicy.minimumMarginPercent, 12);
  const version = Number.isInteger(numeric(snapshottedPolicy.version, NaN)) ? numeric(snapshottedPolicy.version) : null;
  const tier = String(snapshottedPolicy.tier ?? quote.customerTier ?? 'Customer');
  const steps = (quote.approvals ?? [])
    .filter((approval: any) => approval.revisionId === quote.currentRevisionId)
    .sort((left: any, right: any) => numeric(left.sequence) - numeric(right.sequence));
  const requiredSteps = [...new Set(steps.map((approval: any) => approval.step))];
  const managerReasons = [
    worstExcess > 0 ? `worst line excess is ${formatPoints(worstExcess)}` : '',
    weightedExcess > 0 ? `value-weighted excess is ${formatPoints(weightedExcess)}` : '',
  ].filter(Boolean);
  const financeReasons = [
    worstExcess > financeThreshold ? `worst line excess ${formatPoints(worstExcess)} exceeds ${formatPoints(financeThreshold)}` : '',
    weightedExcess > financeThreshold ? `weighted excess ${formatPoints(weightedExcess)} exceeds ${formatPoints(financeThreshold)}` : '',
    marginPercent < minimumMarginPercent ? `margin ${formatPercent(marginPercent)} is below ${formatPercent(minimumMarginPercent)}` : '',
  ].filter(Boolean);
  const approvalReason = [
    requiredSteps.includes('Sales Manager') ? `Manager: ${managerReasons.join('; ') || 'line or blended excess requires manager review'}.` : '',
    requiredSteps.includes('Finance') ? `Finance: ${financeReasons.join('; ') || 'finance review is required by the routed policy snapshot'}.` : '',
  ].filter(Boolean).join(' ') || 'No manager or finance approval is required for this revision.';
  const worstLabel = worstLine && worstLine.excess > 0 ? `${worstLine.product}: effective ${formatPercent(worstLine.effectiveDiscount)} vs ${formatPercent(worstLine.allowed)} limit` : 'No individual line exceeds its policy limit.';

  return {
    worstExcess,
    weightedExcess,
    aggregateDiscount:numeric(calculation.aggregateDiscount,orderDiscount),
    riskByCadence:isRecord(calculation.byCadence)?calculation.byCadence:{},
    orderDiscount,
    marginPercent,
    financeThreshold,
    minimumMarginPercent,
    policyVersion: version,
    policyTier: tier,
    managerReason: requiredSteps.includes('Sales Manager') ? (managerReasons.join('; ') || 'Line or blended excess requires manager review.') : 'Manager approval was not required.',
    financeReason: requiredSteps.includes('Finance') ? (financeReasons.join('; ') || 'Finance review is required by the routed policy snapshot.') : 'Finance approval was not required.',
    cards: [
      { key: 'worst-line-excess', label: 'Worst individual line excess', value: formatPoints(worstExcess), detail: worstLabel, tone: worstExcess > 0 ? 'warn' : 'ok' },
      { key: 'weighted-excess', label: 'Value-weighted excess', value: formatPoints(weightedExcess), detail: 'Weighted by each line gross value so larger lines influence routing more.', tone: weightedExcess > 0 ? 'warn' : 'ok' },
      { key: 'order-discount', label: 'Order discount', value: formatPercent(orderDiscount), detail: 'Applied across the order after line discounts.', tone: orderDiscount > 0 ? 'warn' : 'ok' },
      { key: 'margin-percentage', label: 'Margin percentage', value: formatPercent(marginPercent), detail: `Minimum margin floor is ${formatPercent(minimumMarginPercent)}.`, tone: marginPercent < minimumMarginPercent ? 'danger' : 'ok' },
      { key: 'approval-threshold', label: 'Approval threshold and policy version', value: `${formatPoints(financeThreshold)} / ${version ? `v${version}` : 'unversioned'}`, detail: `${tier} tier policy used for this revision.`, tone: 'neutral' },
      { key: 'required-review', label: 'Exact required review reason', value: requiredSteps.join(' + ') || 'None', detail: approvalReason, tone: requiredSteps.length ? 'danger' : 'ok' },
    ],
  };
}

const fulfillmentSplitSchema = z.object({
  split: z.array(z.object({ productId: z.string(), warehouseId: z.string(), warehouseName: z.string(), quantity: z.number().int().positive() })),
  backorders: z.array(z.object({ productId: z.string(), quantity: z.number().int().positive() })),
});
const parseFulfillmentSplit = (value: unknown) => {
  const parsed = fulfillmentSplitSchema.safeParse(value);
  return parsed.success ? parsed.data : { split: [], backorders: [] };
};

async function startSession(user: { id: string }, res: Response) {
  const token = crypto.randomBytes(32).toString('hex');
  await db.session.create({ data: { userId: user.id, tokenHash: hash(token), expiresAt: new Date(Date.now() + 12 * 60 * 60 * 1000) } });
  res.setHeader('Set-Cookie', `${cookieName}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=43200${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`);
  res.append('Set-Cookie', `${platformSessionCookieName}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
  return token;
}

function razorpayConfiguration() {
  try {
    return readRazorpayConfiguration();
  } catch (error) {
    const code = error instanceof Error ? error.message : 'RAZORPAY_CONFIGURATION_INVALID';
    throw new DomainError(503, code, 'Razorpay Test Mode is not configured correctly on the server.');
  }
}

const paymentDto = (payment: any) => ({
  id: payment.id,
  invoiceId: payment.invoiceId,
  amount: payment.amount,
  currency: payment.currency,
  reference: payment.reference,
  provider: payment.provider,
  status: payment.status,
  razorpayOrderId: payment.razorpayOrderId,
  razorpayPaymentId: payment.razorpayPaymentId,
  failureCode: payment.failureCode,
  failureDescription: payment.failureDescription,
  verifiedAt: payment.verifiedAt,
  paidAt: payment.paidAt,
  createdAt: payment.createdAt,
});

async function settleRazorpayPayment(tx: Tx, paymentId: string, gatewayPaymentId?: string, signature?: string) {
  const initial = await tx.payment.findUnique({ where: { id: paymentId } });
  if (!initial) throw new DomainError(404, 'PAYMENT_NOT_FOUND', 'Payment attempt not found.');
  await tx.$queryRaw`SELECT "id" FROM "Invoice" WHERE "id" = ${initial.invoiceId} FOR UPDATE`;
  const payment = await tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
  if (payment.razorpayPaymentId && gatewayPaymentId && payment.razorpayPaymentId !== gatewayPaymentId) {
    throw new DomainError(409, 'PAYMENT_ID_MISMATCH', 'The payment identifier does not match this order.');
  }
  const paidAt = payment.paidAt ?? new Date();
  const verifiedAt = payment.verifiedAt ?? new Date();
  const updatedPayment = await tx.payment.update({
    where: { id: payment.id },
    data: {
      status: 'SUCCESS', paidAt, verifiedAt,
      razorpayPaymentId: gatewayPaymentId ?? payment.razorpayPaymentId,
      razorpaySignature: signature ?? payment.razorpaySignature,
      failureCode: null, failureDescription: null,
    },
  });
  const invoice = await tx.invoice.findUniqueOrThrow({ where: { id: payment.invoiceId } });
  const ledger = await tx.payment.findMany({ where: { invoiceId: invoice.id, status: 'SUCCESS' }, select: { amount: true, reversalOfId: true } });
  const ledgerPaid = new Prisma.Decimal(paymentLedgerTotal(ledger));
  const paidAmount = ledgerPaid.greaterThan(invoice.amount) ? invoice.amount : ledgerPaid;
  const state = paidAmount.greaterThanOrEqualTo(invoice.amount) ? 'PAID' : paidAmount.greaterThan(0) ? 'PARTIAL' : 'UNPAID';
  const updatedInvoice = await tx.invoice.update({ where: { id: invoice.id }, data: { paidAmount, state } });
  return { payment: updatedPayment, invoice: updatedInvoice };
}

function webhookEntity(payload: unknown, key: 'payment' | 'order') {
  if (!payload || typeof payload !== 'object') return null;
  const outer = (payload as Record<string, unknown>)[key];
  if (!outer || typeof outer !== 'object') return null;
  const entity = (outer as Record<string, unknown>).entity;
  return entity && typeof entity === 'object' ? entity as Record<string, unknown> : null;
}

async function handleRazorpayWebhook(req: AuthRequest, res: Response) {
  const config = razorpayConfiguration();
  if (!config.enabled) return fail(req, res, 503, 'RAZORPAY_NOT_CONFIGURED', 'Razorpay Test Mode is not configured.');
  const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  const signature = String(req.headers['x-razorpay-signature'] ?? '');
  if (!rawBody.length || !verifyWebhookSignature(rawBody, signature, config.webhookSecret)) {
    return fail(req, res, 401, 'WEBHOOK_SIGNATURE_INVALID', 'The webhook signature is invalid.');
  }
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(rawBody.toString('utf8')) as Record<string, unknown>;
  } catch {
    return fail(req, res, 400, 'WEBHOOK_PAYLOAD_INVALID', 'The webhook payload is invalid JSON.');
  }
  const eventType = String(body.event ?? 'unknown');
  const eventKey = paymentWebhookKey(rawBody, String(req.headers['x-razorpay-event-id'] ?? ''));
  const payloadHash = hash(rawBody.toString('base64'));
  const paymentEntity = webhookEntity(body.payload, 'payment');
  const orderEntity = webhookEntity(body.payload, 'order');
  const orderId = String(paymentEntity?.order_id ?? orderEntity?.id ?? '');
  const gatewayPaymentId = String(paymentEntity?.id ?? '');
  try {
    const outcome = await db.$transaction(async (tx) => {
      const replay = await tx.paymentWebhookEvent.findUnique({ where: { eventKey } });
      if (replay && replay.payloadHash !== payloadHash) throw new DomainError(409, 'WEBHOOK_EVENT_CONFLICT', 'This webhook event ID was already used with different content.');
      if (replay) return { duplicate: true, handled: true };
      const payment = orderId
        ? await tx.payment.findUnique({ where: { razorpayOrderId: orderId } })
        : gatewayPaymentId ? await tx.payment.findUnique({ where: { razorpayPaymentId: gatewayPaymentId } }) : null;
      await tx.paymentWebhookEvent.create({ data: { eventKey, eventType, payloadHash, organizationId: payment?.organizationId } });
      if (!payment) return { duplicate: false, handled: false };
      if (eventType === 'payment.captured' || eventType === 'order.paid') {
        const settled = await settleRazorpayPayment(tx, payment.id, gatewayPaymentId || undefined);
        await tx.auditEvent.create({ data: { organizationId: payment.organizationId, action: 'RAZORPAY_WEBHOOK_PAYMENT_CONFIRMED', resource: 'Invoice', resourceId: payment.invoiceId, reason: eventType, requestId: req.requestId } });
        return { duplicate: false, handled: true, invoiceState: settled.invoice.state };
      }
      if (eventType === 'payment.failed' && payment.status !== 'SUCCESS') {
        const error = paymentEntity?.error_reason ?? paymentEntity?.error_code;
        await tx.payment.update({ where: { id: payment.id }, data: { status: 'FAILED', failureCode: String(paymentEntity?.error_code ?? 'PAYMENT_FAILED').slice(0, 120), failureDescription: String(error ?? 'Razorpay reported a failed payment.').slice(0, 500) } });
        await tx.auditEvent.create({ data: { organizationId: payment.organizationId, action: 'RAZORPAY_WEBHOOK_PAYMENT_FAILED', resource: 'Invoice', resourceId: payment.invoiceId, reason: eventType, requestId: req.requestId } });
        return { duplicate: false, handled: true };
      }
      return { duplicate: false, handled: true };
    });
    return ok(req, res, outcome);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return ok(req, res, { duplicate: true, handled: true });
    throw error;
  }
}

export const app = express();
app.use((req: AuthRequest, res, next) => {
  req.requestId = /^[a-zA-Z0-9_-]{8,80}$/.test(String(req.headers['x-request-id'] ?? '')) ? String(req.headers['x-request-id']) : crypto.randomUUID();
  res.setHeader('X-Request-ID', req.requestId);
  next();
});
app.use(helmet());
app.use(cors({ origin: allowedOrigin, credentials: true }));
app.post('/api/v1/payments/webhook', express.raw({ type: 'application/json', limit: '256kb' }), handleRazorpayWebhook);
app.use(express.json({ limit: '256kb' }));

app.post('/api/v1/assistant/public', async (req: AuthRequest, res) => {
  const parsed = assistantMessagesSchema.safeParse(req.body);
  if (!parsed.success) return fail(req, res, 422, 'VALIDATION_ERROR', 'Send a valid conversation.');
  try {
    return ok(req, res, await runAssistant({ mode: 'public' }, parsed.data.messages));
  } catch (error) {
    if (error instanceof Error && error.message === 'GROQ_NOT_CONFIGURED') return fail(req, res, 503, 'AI_NOT_CONFIGURED', 'DealOS Assistant is not configured yet. Add GROQ_API_KEY to backend/.env.');
    return fail(req, res, 502, 'AI_UNAVAILABLE', error instanceof Error ? error.message : 'The assistant is temporarily unavailable.');
  }
});

app.get('/api/v1/directory/businesses', async (req: AuthRequest, res) => {
  return ok(req, res, await listDirectoryBusinesses(db));
});

app.post('/api/v1/directory/businesses/:organizationId/join-requests', async (req: AuthRequest, res) => {
  if (req.headers.origin !== allowedOrigin) return fail(req, res, 403, 'ORIGIN_INVALID', 'This request origin is not allowed.');
  const organizationId = z.string().uuid().safeParse(routeParam(req, 'organizationId'));
  const parsed = directoryJoinRequestSchema.safeParse(req.body);
  if (!organizationId.success || !parsed.success) return fail(req, res, 422, 'VALIDATION_ERROR', 'Enter a valid business, company, email, and request message.', parsed.success ? undefined : parsed.error.flatten());
  const result = await createDirectoryJoinRequest(db, organizationId.data, parsed.data, req.ip ?? 'unknown');
  return ok(req, res, result, 201);
});

async function authenticate(req: AuthRequest, res: Response, next: NextFunction) {
  const cookies = parseCookies(req.headers.cookie);
  const platformToken = cookies[platformSessionCookieName];
  if (platformToken) {
    const session = await db.platformOwnerSession.findUnique({ where: { tokenHash: hashPlatformToken(platformToken) } });
    if (!session || session.expiresAt < new Date()) return fail(req, res, 401, 'PLATFORM_AUTH_REQUIRED', 'Sign in through the Platform Owner portal.');
    const csrfToken = cookies[csrfCookieName] ?? '';
    if (!csrfToken || hashPlatformToken(csrfToken) !== session.csrfHash) return fail(req, res, 401, 'PLATFORM_AUTH_REQUIRED', 'Refresh the Platform Owner session.');
    const organization = session.viewAsOrganizationId ? await db.organization.findUnique({ where: { id: session.viewAsOrganizationId } }) : null;
    if (session.viewAsOrganizationId && !organization) return fail(req, res, 409, 'VIEW_CONTEXT_INVALID', 'The simulated organization no longer exists. Exit View As mode.');
    const simulated = session.viewAsUserId ? await db.user.findFirst({ where: { id: session.viewAsUserId, organizationId: session.viewAsOrganizationId ?? undefined, status: 'ACTIVE' } }) : null;
    if (session.viewAsUserId && !simulated) return fail(req, res, 409, 'VIEW_CONTEXT_INVALID', 'The simulated user is no longer active in this organization. Exit View As mode.');
    const ownerId = `platform-owner:${hashPlatformToken(session.loginId).slice(0, 16)}`;
    req.user = {
      id: simulated?.id ?? ownerId, name: simulated?.name ?? 'Platform Owner', email: simulated?.email ?? session.loginId,
      loginId: simulated?.loginId ?? session.loginId, role: simulated?.role ?? 'ADMIN', customerId: simulated?.customerId ?? null,
      organizationId: organization?.id ?? '', moduleAccess: simulated?.moduleAccess ?? [...modules], csrfToken,
      actorType: 'PLATFORM_OWNER', platformSuperAdmin: true, readOnlyView: Boolean(organization),
      organization: organization ? { id: organization.id, name: organization.name, status: organization.status } : null,
      viewContext: organization ? { readOnly: true, organizationId: organization.id, organizationName: organization.name, simulatedUserId: simulated?.id ?? null, realActor: { id: ownerId, name: 'Platform Owner' } } : null,
    };
    return next();
  }
  const token = cookies[cookieName];
  if (!token) return fail(req, res, 401, 'AUTH_REQUIRED', 'Please sign in to continue.');
  const session = await db.session.findUnique({ where: { tokenHash: hash(token) }, include: { user: { include: { organization: true } } } });
  if (!session || !session.user.organizationId || session.user.status !== 'ACTIVE' || session.expiresAt < new Date()) return fail(req, res, 401, 'AUTH_REQUIRED', 'Your session has expired.');
  if (session.user.organization?.status !== 'ACTIVE') return fail(req, res, 423, 'ORGANIZATION_SUSPENDED', 'This organization is not active.');
  req.user = { id: session.user.id, name: session.user.name, email: session.user.email, loginId: session.user.loginId, role: session.user.role, customerId: session.user.customerId, organizationId: session.user.organizationId, moduleAccess: session.user.moduleAccess, csrfToken: csrfForToken(token), actorType: 'USER', platformSuperAdmin: false, readOnlyView: false, organization: session.user.organization ? { id: session.user.organization.id, name: session.user.organization.name, status: session.user.organization.status } : null, viewContext: null };
  return next();
}

const requireRole = (...roles: string[]) => (req: AuthRequest, res: Response, next: NextFunction) => roles.includes(req.user?.role ?? '') ? next() : fail(req, res, 403, 'FORBIDDEN', 'You do not have permission to perform this action.');
const hasModule = (actor: Actor | undefined, module: typeof modules[number]) => actor?.role === 'ADMIN' || actor?.moduleAccess.includes(module);
const requireModule = (module: typeof modules[number]) => (req: AuthRequest, res: Response, next: NextFunction) => hasModule(req.user, module) ? next() : fail(req, res, 403, 'FORBIDDEN', 'This module is not enabled for your account.');
const requireCsrf = (req: AuthRequest, res: Response, next: NextFunction) => {
  if (req.user?.readOnlyView) return fail(req, res, 403, 'VIEW_AS_READ_ONLY', 'Exit View As mode before making changes.');
  if (req.headers.origin !== allowedOrigin || req.headers['x-csrf-token'] !== req.user?.csrfToken) return fail(req, res, 403, 'CSRF_INVALID', 'Refresh the workspace and try again.');
  return next();
};
const audit = (tx: Tx, req: AuthRequest, action: string, resource: string, resourceId: string, reason?: string, revisionId?: string) => tx.auditEvent.create({ data: { organizationId: req.user!.organizationId, actorId: req.user?.id, action, resource, resourceId, reason, revisionId, requestId: req.requestId } });
async function canAccessInternalQuote(actor: Actor, quote: { ownerId: string; organizationId: string; teamId?: string | null }) {
  if (quote.organizationId !== actor.organizationId) return false;
  if (['ADMIN', 'FINANCE'].includes(actor.role)) return true;
  if (!quote.teamId) return quote.ownerId === actor.id;
  if (actor.role === 'MANAGER') return Boolean(await db.salesTeam.findFirst({ where: { id: quote.teamId, organizationId: actor.organizationId, managerId: actor.id }, select: { id: true } }));
  if (actor.role === 'REP') return quote.ownerId === actor.id || Boolean(await db.salesTeamMember.findFirst({ where: { teamId: quote.teamId, userId: actor.id }, select: { id: true } }));
  return false;
}
const internalQuoteWhere = (actor: Actor):Prisma.QuoteWhereInput => ({ organizationId: actor.organizationId, ...quotationRecordScope(actor) });
const quotationListInclude = {
  owner: { select: { id: true, name: true } },
  customerRecord: { select: { currency: true } },
  team: { select: { id: true, name: true } },
  currentRevision: { select: { id: true, state: true, currency: true } },
  approvals: { select: { revisionId: true, state: true, step: true, sequence: true, cycle: true }, orderBy: [{ cycle: 'desc' }, { sequence: 'asc' }] },
  negotiation: { select: { revisionId: true, kind: true, state: true } },
  order: { select: { id: true } },
  sourcePortalRequest: { select: { id: true } },
} satisfies Prisma.QuoteInclude;

app.post('/api/v1/assistant', authenticate, async (req: AuthRequest, res) => {
  const parsed = assistantMessagesSchema.safeParse(req.body);
  if (!parsed.success) return fail(req, res, 422, 'VALIDATION_ERROR', 'Send a valid conversation.');
  if (req.user!.actorType === 'PLATFORM_OWNER' && !req.user!.organizationId) return fail(req, res, 403, 'WORKSPACE_REQUIRED', 'Open an organization workspace to use the internal assistant.');
  const portal = req.user!.role === 'CUSTOMER';
  const canCreateInvoices = Boolean(!portal && hasModule(req.user, 'invoices') && ['FINANCE', 'ADMIN'].includes(req.user!.role) && !req.user!.readOnlyView);
  const canCommentOnQuotes = Boolean(portal && req.user!.customerId && !req.user!.readOnlyView);
  const canReadCustomers = Boolean(!portal && (hasModule(req.user, 'customers') || canCreateInvoices));
  const canReadProducts = Boolean(!portal && (hasModule(req.user, 'products') || hasModule(req.user, 'fulfillment') || canCreateInvoices));
  const canReadInvoices = Boolean(portal || hasModule(req.user, 'invoices'));
  const canReadQuotes = Boolean(portal || ['quotations', 'approvals', 'fulfillment', 'health', 'reports'].some((module) => hasModule(req.user, module as typeof modules[number])));
  const readableModules = portal
    ? ['customer-portal', 'quotations', 'invoices']
    : modules.filter((module) => hasModule(req.user, module));
  const [organization, customers, products, invoices, quotes] = await Promise.all([
    db.organization.findUnique({ where: { id: req.user!.organizationId }, select: { name: true } }),
    canReadCustomers ? db.customer.findMany({ where: { organizationId: req.user!.organizationId, active: true }, select: { id: true, name: true, paymentTerms: true, email: true }, orderBy: { name: 'asc' }, take: 100 }) : Promise.resolve([]),
    canReadProducts ? db.product.findMany({ where: { organizationId: req.user!.organizationId, active: true }, select: { id: true, name: true, sku: true, price: true, taxRate: true, recurring: true, stocks: { select: { onHand: true, reserved: true } } }, orderBy: { name: 'asc' }, take: 100 }) : Promise.resolve([]),
    canReadInvoices ? db.invoice.findMany({ where: { organizationId: req.user!.organizationId, ...(portal ? { customerId: req.user!.customerId! } : req.user!.role === 'REP' ? { quote: { ownerId: req.user!.id } } : {}) }, select: { number: true, customer: true, amount: true, state: true, dueAt: true }, orderBy: { createdAt: 'desc' }, take: 20 }) : Promise.resolve([]),
    canReadQuotes ? db.quote.findMany({ where: portal ? { organizationId: req.user!.organizationId, customerId: req.user!.customerId!, sentAt: { not: null } } : internalQuoteWhere(req.user!), select: { id: true, number: true, customer: true, total: true, stage: true }, orderBy: { updatedAt: 'desc' }, take: 20 }) : Promise.resolve([]),
  ]);
  const context: AssistantContext = {
    mode: 'workspace', organization: organization?.name, screen: parsed.data.screen, today: new Date().toISOString().slice(0, 10),
    user: { name: req.user!.name, role: req.user!.role, canCreateInvoices, canCommentOnQuotes, readOnly: req.user!.readOnlyView, readableModules },
    customers, products: products.map((product) => ({ id: product.id, name: product.name, sku: product.sku, price: decimal(product.price), taxRate: decimal(product.taxRate), recurring: product.recurring, available: product.recurring ? null : product.stocks.reduce((sum, stock) => sum + stock.onHand - stock.reserved, 0) })),
    invoices: invoices.map((invoice) => ({ ...invoice, amount: decimal(invoice.amount), dueAt: invoice.dueAt.toISOString() })),
    quoteSummary: quotes.map((quote) => ({ ...quote, total: decimal(quote.total) })),
  };
  try {
    return ok(req, res, await runAssistant(context, parsed.data.messages));
  } catch (error) {
    if (error instanceof Error && error.message === 'GROQ_NOT_CONFIGURED') return fail(req, res, 503, 'AI_NOT_CONFIGURED', 'DealOS Assistant is not configured yet. Add GROQ_API_KEY to backend/.env.');
    return fail(req, res, 502, 'AI_UNAVAILABLE', error instanceof Error ? error.message : 'The assistant is temporarily unavailable.');
  }
});

function portalQuoteDto(quote: any) {
  return customerSafeQuotationDto(quote);
}

function portalInvoiceDto(invoice: any) {
  return {
    id: invoice.id, number: invoice.number, customer: invoice.customer, amount: invoice.amount,
    paidAmount: invoice.paidAmount, state: invoice.state, dueAt: invoice.dueAt, createdAt: invoice.createdAt,
    currency: invoice.currency, lines: invoice.lines,
    quoteId: invoice.quoteId, quote: invoice.quote, orderId: invoice.orderId,
    order: invoice.order ? { id: invoice.order.id, number: invoice.order.number, state: invoice.order.state, currency: invoice.order.currency, fulfillment: invoice.order.fulfillment } : null,
    payments: invoice.payments.map((payment: any) => ({
      id: payment.id, amount: payment.amount, currency: payment.currency, reference: payment.reference,
      provider: payment.provider, status: payment.status, razorpayOrderId: payment.razorpayOrderId,
      razorpayPaymentId: payment.razorpayPaymentId, failureCode: payment.failureCode,
      failureDescription: payment.failureDescription, verifiedAt: payment.verifiedAt, paidAt: payment.paidAt,
      reversalOfId: payment.reversalOfId, reason: payment.reason,
    })),
    notes: (invoice.notes ?? []).map((note: any) => ({ id: note.id, kind: note.kind, message: note.message, requestedDueAt: note.requestedDueAt, createdAt: note.createdAt })),
  };
}

function internalInvoiceDto(invoice: any) {
  return {
    ...invoice,
    currency: invoice.currency,
    credits: [],
  };
}

function paymentLedgerTotal(payments: Array<{ amount: unknown; reversalOfId?: string | null }>) {
  return payments.reduce((total, payment) => total + (payment.reversalOfId ? -decimal(payment.amount) : decimal(payment.amount)), 0);
}

const pdfText = (value: unknown) => String(value ?? '').normalize('NFKD').replace(/[^\x20-\x7E]/g, '').replace(/([\\()])/g, '\\$1');
function buildInvoicePdf(invoice: any, organizationName: string) {
  const lines = Array.isArray(invoice.lines) ? invoice.lines.slice(0, 24) : [];
  const commands = [
    'BT /F1 22 Tf 54 770 Td', `(${pdfText(organizationName)}) Tj`,
    '0 -30 Td /F1 15 Tf', `(Invoice ${pdfText(invoice.number)}) Tj`,
    '0 -25 Td /F1 10 Tf', `(Bill to: ${pdfText(invoice.customer)}) Tj`,
    '0 -16 Td', `(Due: ${pdfText(new Date(invoice.dueAt).toISOString().slice(0, 10))}) Tj`,
    '0 -30 Td /F1 11 Tf', '(Description) Tj', '330 0 Td', '(Amount) Tj', '-330 -18 Td /F1 9 Tf',
  ];
  for (const line of lines) {
    commands.push(`(${pdfText(line.description).slice(0, 70)}) Tj`, '330 0 Td', `(INR ${Number(line.amount ?? 0).toFixed(2)}) Tj`, '-330 -17 Td');
  }
  commands.push('0 -12 Td /F1 12 Tf', `(Total: INR ${Number(invoice.amount).toFixed(2)}) Tj`, '0 -19 Td /F1 9 Tf', `(Paid: INR ${Number(invoice.paidAmount).toFixed(2)}   Status: ${pdfText(invoice.state)}) Tj`, 'ET');
  const stream = commands.join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let output = '%PDF-1.4\n'; const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(output)); output += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(output);
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n `).join('\n')}\ntrailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(output);
}

app.get('/api/v1/health/live', (req: AuthRequest, res) => ok(req, res, { status: 'alive' }));
app.get('/api/v1/health/ready', async (req: AuthRequest, res) => { await db.$queryRaw`SELECT 1`; return ok(req, res, { status: 'ready' }); });

app.post('/api/v1/auth/signup', async (req: AuthRequest, res) => {
  if (req.headers.origin !== allowedOrigin) return fail(req, res, 403, 'ORIGIN_INVALID', 'This request origin is not allowed.');
  const parsed = signupSchema.safeParse(req.body);
  if (!parsed.success) return fail(req, res, 422, 'VALIDATION_ERROR', 'Enter your organization and valid administrator credentials.');
  const organization = await createOrganizationAdmin(parsed.data);
  if (!organization) return fail(req, res, 409, 'ACCOUNT_EXISTS', 'An account already exists for this email. Sign in instead.');
  const token = await startSession(organization.users[0]!, res);
  return ok(req, res, { status: 'ACTIVE', role: 'ADMIN', organizationId: organization.id, csrfToken: csrfForToken(token) }, 201);
});

app.get('/api/v1/auth/google/config', (req: AuthRequest, res) => ok(req, res, { enabled: Boolean(googleClientId), clientId: googleClientId || null }));

app.post('/api/v1/auth/google/signup', async (req: AuthRequest, res) => {
  if (req.headers.origin !== allowedOrigin) return fail(req, res, 403, 'ORIGIN_INVALID', 'This request origin is not allowed.');
  if (!googleClientId) return fail(req, res, 503, 'AUTH_PROVIDER_UNAVAILABLE', 'Google signup is not configured.');
  const parsed = googleSignupSchema.safeParse(req.body);
  if (!parsed.success) return fail(req, res, 422, 'VALIDATION_ERROR', 'A valid Google credential is required.');
  try {
    const profile = await verifyGoogleSignupCredential(parsed.data.credential, googleClientAudiences);
    const organization = await createGoogleOrganizationAdmin(profile, parsed.data.organizationName);
    if (!organization) return fail(req, res, 409, 'ACCOUNT_EXISTS', 'An account already exists for this Google email. Sign in instead.');
    const token = await startSession(organization.users[0]!, res);
    return ok(req, res, { status: 'ACTIVE', role: 'ADMIN', organizationId: organization.id, csrfToken: csrfForToken(token) }, 201);
  } catch { return fail(req, res, 401, 'INVALID_GOOGLE_CREDENTIAL', 'Google could not verify this signup. Please try again.'); }
});

app.post('/api/v1/auth/google/login', async (req: AuthRequest, res) => {
  if (req.headers.origin !== allowedOrigin) return fail(req, res, 403, 'ORIGIN_INVALID', 'This request origin is not allowed.');
  if (!googleClientId) return fail(req, res, 503, 'AUTH_PROVIDER_UNAVAILABLE', 'Google sign-in is not configured.');
  const parsed = z.object({ credential: z.string().trim().min(1).max(8192) }).strict().safeParse(req.body);
  if (!parsed.success) return fail(req, res, 422, 'VALIDATION_ERROR', 'A valid Google credential is required.');
  try {
    const profile = await verifyGoogleSignupCredential(parsed.data.credential, googleClientAudiences);
    const user = await findOrLinkGoogleLoginUser(profile);
    if (!user) return fail(req, res, 401, 'INVALID_CREDENTIALS', 'No active workspace was found for this Google account. Create an account first or sign in with work email.');
    const token = await startSession(user, res);
    return ok(req, res, { id: user.id, name: user.name, email: user.email, role: user.role, csrfToken: csrfForToken(token) });
  } catch { return fail(req, res, 401, 'INVALID_GOOGLE_CREDENTIAL', 'Google could not verify this sign-in.'); }
});

app.post('/api/v1/auth/google/customer', async (req: AuthRequest, res) => {
  if (req.headers.origin !== allowedOrigin) return fail(req, res, 403, 'ORIGIN_INVALID', 'This request origin is not allowed.');
  if (!googleClientId) return fail(req, res, 503, 'AUTH_PROVIDER_UNAVAILABLE', 'Google sign-in is not configured.');
  const parsed = z.object({ credential: z.string().trim().min(1).max(8192), email: z.string().trim().email().toLowerCase().optional() }).strict().safeParse(req.body);
  if (!parsed.success) return fail(req, res, 422, 'VALIDATION_ERROR', 'A valid Google credential is required.');
  try {
    const profile = await verifyGoogleSignupCredential(parsed.data.credential, googleClientAudiences);
    if (parsed.data.email && profile.email !== parsed.data.email) return fail(req, res, 401, 'EMAIL_MISMATCH', `Google signed in as ${profile.email}. Enter that Email ID above or choose the Google account for ${parsed.data.email}.`);
    const user = await acceptCustomerGoogleInvitation(profile);
    if (!user) return fail(req, res, 401, 'CUSTOMER_ACCESS_NOT_FOUND', 'No shared quotation, invoice, or active customer invitation was found for this Google email.');
    const token = await startSession(user, res);
    return ok(req, res, { id: user.id, name: user.name, email: user.email, role: user.role, destination: '/customer', csrfToken: csrfForToken(token) });
  } catch (error) {
    if (res.headersSent) return;
    return fail(req, res, 401, 'INVALID_GOOGLE_CREDENTIAL', 'Google could not verify this customer sign-in.');
  }
});

app.post('/api/v1/auth/customer/login', async (req: AuthRequest, res) => {
  if (req.headers.origin !== allowedOrigin) return fail(req, res, 403, 'ORIGIN_INVALID', 'This request origin is not allowed.');
  const key = `customer:${req.ip}:${String(req.body?.email ?? '').toLowerCase()}`;
  const attempt = loginAttempts.get(key);
  if (attempt && attempt.resetAt > Date.now() && attempt.count >= 10) {
    res.setHeader('Retry-After', Math.ceil((attempt.resetAt - Date.now()) / 1000));
    return fail(req, res, 429, 'RATE_LIMITED', 'Too many login attempts. Try again later.');
  }
  const parsed = z.object({ email: z.string().trim().email().toLowerCase(), password: z.string().min(8).max(128) }).strict().safeParse(req.body);
  if (!parsed.success) return fail(req, res, 422, 'VALIDATION_ERROR', 'Enter a valid customer email and password.');
  const user = await db.user.findUnique({ where: { email: parsed.data.email }, include: { customer: { select: { active: true } } } });
  if (!user || user.role !== 'CUSTOMER' || !user.customerId || !user.customer?.active || !(await bcrypt.compare(parsed.data.password, user.passwordHash))) {
    loginAttempts.set(key, { count: (attempt?.resetAt ?? 0) > Date.now() ? attempt!.count + 1 : 1, resetAt: Date.now() + 15 * 60_000 });
    return fail(req, res, 401, 'INVALID_CUSTOMER_CREDENTIALS', 'Customer email or password is incorrect. You can also continue with Google.');
  }
  if (user.status !== 'ACTIVE') return fail(req, res, 403, 'ACCOUNT_INACTIVE', 'This customer account is not active. Continue with Google or ask the sender to share access again.');
  loginAttempts.delete(key);
  const token = await startSession(user, res);
  return ok(req, res, { id: user.id, name: user.name, email: user.email, role: user.role, destination: '/customer', csrfToken: csrfForToken(token) });
});

app.post('/api/v1/auth/login', async (req: AuthRequest, res) => {
  if (req.headers.origin !== allowedOrigin) return fail(req, res, 403, 'ORIGIN_INVALID', 'This request origin is not allowed.');
  const key = `${req.ip}:${String(req.body?.identifier ?? '').toLowerCase()}`;
  const attempt = loginAttempts.get(key);
  if (attempt && attempt.resetAt > Date.now() && attempt.count >= 10) { res.setHeader('Retry-After', Math.ceil((attempt.resetAt - Date.now()) / 1000)); return fail(req, res, 429, 'RATE_LIMITED', 'Too many login attempts. Try again later.'); }
  const parsed = z.object({ identifier: z.string().trim().min(3).max(254), password: z.string().min(8) }).strict().safeParse(req.body);
  if (!parsed.success) return fail(req, res, 422, 'VALIDATION_ERROR', 'Check your email and password.', parsed.error.flatten());
  const identifier = parsed.data.identifier.toLowerCase();
  const user = await db.user.findFirst({ where: { OR: [{ email: identifier }, { loginId: { equals: parsed.data.identifier, mode: 'insensitive' } }] } });
  if (!user || !(await bcrypt.compare(parsed.data.password, user.passwordHash))) {
    loginAttempts.set(key, { count: (attempt?.resetAt ?? 0) > Date.now() ? attempt!.count + 1 : 1, resetAt: Date.now() + 15 * 60_000 });
    return fail(req, res, 401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');
  }
  if (user.status !== 'ACTIVE') return fail(req, res, 403, 'ACCOUNT_INACTIVE', 'Your account is awaiting administrator activation or has been disabled. Contact your administrator.');
  loginAttempts.delete(key);
  const token = await startSession(user, res);
  return ok(req, res, { id: user.id, name: user.name, email: user.email, role: user.role, customerId: user.customerId, csrfToken: csrfForToken(token) });
});

app.post('/api/v1/auth/super-admin/login', async (req: AuthRequest, res) => {
  if (req.headers.origin !== allowedOrigin) return fail(req, res, 403, 'ORIGIN_INVALID', 'This request origin is not allowed.');
  const parsed = z.object({ loginId: z.string().trim().min(1).max(200), password: z.string().min(1).max(256) }).strict().safeParse(req.body);
  if (!parsed.success) return fail(req, res, 422, 'VALIDATION_ERROR', 'Enter the configured Platform Owner login ID and password.');
  const credentials = readPlatformOwnerCredentials();
  if (!credentials) return fail(req, res, 503, 'PLATFORM_OWNER_NOT_CONFIGURED', 'Platform Owner credentials are not configured securely on the server.');
  const attemptKey = `${req.ip}:${parsed.data.loginId.toLowerCase()}`;
  if (!platformLoginAllowed(attemptKey)) return fail(req, res, 429, 'TOO_MANY_ATTEMPTS', 'Too many Platform Owner login attempts. Try again later.');
  if (!platformOwnerCredentialsMatch(parsed.data, credentials)) {
    recordPlatformLoginFailure(attemptKey);
    return fail(req, res, 401, 'INVALID_PLATFORM_CREDENTIALS', 'Platform Owner login ID or password is incorrect.');
  }
  clearPlatformLoginFailures(attemptKey);
  const token = crypto.randomBytes(32).toString('hex');
  const csrfToken = crypto.randomBytes(32).toString('hex');
  const session = await db.platformOwnerSession.create({ data: { tokenHash: hashPlatformToken(token), csrfHash: hashPlatformToken(csrfToken), loginId: credentials.loginId, expiresAt: new Date(Date.now() + 4 * 60 * 60 * 1000) } });
  await db.privilegedAudit.create({ data: { actorId: null, platformActorId: credentials.loginId, action: 'PLATFORM_OWNER_LOGIN', affectedModel: 'PlatformOwnerSession', recordId: session.id, reason: 'Platform Owner authenticated through the dedicated environment-controlled login.', requestId: req.requestId ?? crypto.randomUUID(), ipAddress: req.ip?.slice(0, 64), userAgent: req.get('user-agent')?.slice(0, 255), result: 'SUCCESS' } });
  res.setHeader('Set-Cookie', `${platformSessionCookieName}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=14400${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`);
  res.append('Set-Cookie', `${cookieName}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
  res.append('Set-Cookie', `${csrfCookieName}=${encodeURIComponent(csrfToken)}; SameSite=Strict; Path=/; Max-Age=14400${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`);
  return ok(req, res, { actorType: 'PLATFORM_OWNER', loginId: credentials.loginId, name: 'Platform Owner' });
});

app.get('/api/v1/auth/super-admin/me', authenticatePlatform, (req, res) => ok(req as AuthRequest, res, identityDto(req)));
app.use('/api/v1/platform', authenticatePlatform, platformRouter);

app.post('/api/v1/auth/logout', authenticate, requireCsrf, async (req: AuthRequest, res) => {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[cookieName];
  const platformToken = cookies[platformSessionCookieName];
  if (platformToken) await db.platformOwnerSession.deleteMany({ where: { tokenHash: hashPlatformToken(platformToken) } });
  else if (token) await db.session.deleteMany({ where: { tokenHash: hash(token) } });
  res.setHeader('Set-Cookie', `${cookieName}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
  res.append('Set-Cookie', `${platformSessionCookieName}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
  res.append('Set-Cookie', `${csrfCookieName}=; SameSite=Strict; Path=/; Max-Age=0`);
  return ok(req, res, { loggedOut: true });
});
app.get('/api/v1/auth/me', authenticate, (req: AuthRequest, res) => ok(req, res, req.user));

app.get('/api/v1/admin/users', authenticate, requireRole('ADMIN'), async (req: AuthRequest, res) => {
  const memberships = await db.organizationMembership.findMany({ where: { organizationId: req.user!.organizationId }, select: { accessRole: true, businessRole: true, status: true, createdAt: true, user: { select: { id: true, name: true, email: true, loginId: true, status: true, moduleAccess: true, customerId: true, createdAt: true } } }, orderBy: { createdAt: 'desc' } });
  const users = memberships.map(({ user, ...membership }) => ({ ...user, role: membership.businessRole, membershipStatus: membership.status, accessRole: membership.accessRole, joinedAt: membership.createdAt }));
  return ok(req, res, users);
});
app.get('/api/v1/admin/users/:id', authenticate, requireRole('ADMIN'), async (req: AuthRequest, res) => {
  const membership = await db.organizationMembership.findFirst({
    where: { organizationId: req.user!.organizationId, userId: routeParam(req, 'id') },
    select: {
      accessRole: true,
      businessRole: true,
      status: true,
      createdAt: true,
      user: { select: { id: true, name: true, email: true, loginId: true, status: true, moduleAccess: true, createdAt: true } },
    },
  });
  if (!membership) return fail(req, res, 404, 'NOT_FOUND', 'Organization member not found.');
  return ok(req, res, { ...membership.user, role: membership.businessRole, accessRole: membership.accessRole, membershipStatus: membership.status, joinedAt: membership.createdAt });
});
app.patch('/api/v1/admin/users/:id', authenticate, requireRole('ADMIN'), requireCsrf, async (req: AuthRequest, res) => {
  const parsed = z.object({ status: z.enum(['PENDING', 'ACTIVE', 'DISABLED']).optional(), role: z.enum(['REP', 'MANAGER', 'FINANCE', 'ADMIN', 'CUSTOMER']).optional(), customerId: z.string().uuid().nullable().optional(), moduleAccess: z.array(z.enum(modules)).max(modules.length).refine((values) => !values.includes('subscriptions'), 'Subscriptions are restricted to organization admins.').optional() }).strict().safeParse(req.body);
  if (!parsed.success) return fail(req, res, 422, 'VALIDATION_ERROR', 'Enter valid account changes.', parsed.error.flatten());
  const target = await db.user.findFirst({ where: { id: routeParam(req, 'id'), organizationId: req.user!.organizationId } });
  if (!target) return fail(req, res, 404, 'NOT_FOUND', 'Account not found.');
  const nextRole = parsed.data.role ?? target.role;
  const nextCustomerId = parsed.data.customerId === undefined ? target.customerId : parsed.data.customerId;
  if (nextRole === 'CUSTOMER' && !nextCustomerId) return fail(req, res, 422, 'VALIDATION_ERROR', 'Customer accounts require a linked customer.');
  if (nextRole !== 'CUSTOMER' && nextCustomerId) return fail(req, res, 422, 'VALIDATION_ERROR', 'Internal accounts cannot be linked to a portal customer.');
  const updated = await db.$transaction(async (tx) => {
    const user = await tx.user.update({ where: { id: target.id }, data: { ...parsed.data, customerId: nextRole === 'CUSTOMER' ? nextCustomerId : null } });
    await tx.organizationMembership.upsert({ where: { organizationId_userId: { organizationId: req.user!.organizationId, userId: target.id } }, update: { businessRole: nextRole, accessRole: nextRole === 'ADMIN' ? 'ORGANIZATION_ADMIN' : nextRole === 'CUSTOMER' ? 'PORTAL_USER' : 'ORGANIZATION_MEMBER', status: user.status === 'ACTIVE' ? 'ACTIVE' : 'SUSPENDED' }, create: { organizationId: req.user!.organizationId, userId: target.id, businessRole: nextRole, accessRole: nextRole === 'ADMIN' ? 'ORGANIZATION_ADMIN' : nextRole === 'CUSTOMER' ? 'PORTAL_USER' : 'ORGANIZATION_MEMBER', status: user.status === 'ACTIVE' ? 'ACTIVE' : 'SUSPENDED' } });
    if (parsed.data.status || parsed.data.role || parsed.data.customerId !== undefined) await tx.session.deleteMany({ where: { userId: target.id } });
    await audit(tx, req, 'ACCOUNT_UPDATED', 'User', target.id, `${user.status}/${user.role}`);
    return { id: user.id, name: user.name, email: user.email, loginId: user.loginId, role: user.role, status: user.status, moduleAccess: user.moduleAccess, customerId: user.customerId };
  });
  return ok(req, res, updated);
});

app.post('/api/v1/admin/users', authenticate, requireRole('ADMIN'), requireCsrf, async (req: AuthRequest, res) => {
  const parsed = z.object({ name: z.string().trim().min(1).max(120), email: z.string().trim().email().toLowerCase(), password: z.string().min(12).max(128), role: z.enum(provisionableRoles), moduleAccess: z.array(z.enum(modules)).min(1).max(modules.length).refine((values) => !values.includes('subscriptions'), 'Subscriptions are restricted to organization admins.').optional() }).strict().safeParse(req.body);
  if (!parsed.success) return fail(req, res, 422, 'VALIDATION_ERROR', 'Enter a user name, email, password, and valid role.');
  const existing = await db.user.findUnique({ where: { email: parsed.data.email } });
  if (existing) return fail(req, res, 409, 'EMAIL_EXISTS', 'An account already exists for this email.');
  const loginId = `DL-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
  const passwordHash = await bcrypt.hash(parsed.data.password, 12);
  const moduleAccess = [...new Set(parsed.data.moduleAccess ?? roleModulePresets[parsed.data.role])];
  const user = await db.$transaction(async (tx) => {
    const created = await tx.user.create({ data: { organizationId: req.user!.organizationId, name: parsed.data.name, email: parsed.data.email, loginId, passwordHash, status: 'ACTIVE', role: parsed.data.role, moduleAccess } });
    await tx.organizationMembership.create({ data: { organizationId: req.user!.organizationId, userId: created.id, accessRole: 'ORGANIZATION_MEMBER', businessRole: parsed.data.role } });
    await audit(tx, req, 'USER_ACCESS_CREATED', 'User', created.id, `${parsed.data.role}: ${moduleAccess.join(',')}`);
    return created;
  });
  return ok(req, res, { user: { id: user.id, name: user.name, email: user.email, loginId: user.loginId, role: user.role, moduleAccess: user.moduleAccess }, credentials: { email: user.email, loginId, password: parsed.data.password } }, 201);
});

app.get('/api/v1/workspace', authenticate, async (req: AuthRequest, res) => {
  if (req.user!.actorType === 'PLATFORM_OWNER' && !req.user!.organizationId) {
    return ok(req, res, { user: req.user, organization: null, users: [], customers: [], quotes: [], products: [], policies: [], warehouses: [], subscriptions: [], invoices: [], alerts: [], audits: [] });
  }
  const portal = req.user!.role === 'CUSTOMER';
  if (portal && !req.user!.customerId) return fail(req, res, 403, 'FORBIDDEN', 'This portal account is not linked to a customer.');
  const quoteWhere = portal ? { organizationId: req.user!.organizationId, customerId: req.user!.customerId!, sentAt: { not: null } } : internalQuoteWhere(req.user!);
  const repScopingEnabled = process.env.NODE_ENV !== 'production' || process.env.CUSTOMER_ASSIGNMENT_SCOPING_ENABLED === 'true';
  const workspaceCustomerScope = req.user!.role === 'REP' && !repScopingEnabled ? {} : customerRecordScope(req.user!);
  if (!portal && !req.user!.readOnlyView && hasModule(req.user, 'health')) await db.$transaction((tx) => evaluateAlerts(tx, req.user!.organizationId, quotationRecordScope(req.user!)));
  const [organization, users, customers, rawQuotes, products, policies, warehouses, rawSubscriptions, rawInvoices, alerts, audits] = await Promise.all([
    db.organization.findUnique({ where: { id: req.user!.organizationId }, select: { id: true, name: true, rfqHandlingMode: true } }),
    req.user!.role === 'ADMIN' ? db.organizationMembership.findMany({ where: { organizationId: req.user!.organizationId }, select: { accessRole: true, businessRole: true, status: true, createdAt: true, user: { select: { id: true, name: true, email: true, loginId: true, status: true, moduleAccess: true, createdAt: true } } }, orderBy: { createdAt: 'desc' } }).then((memberships) => memberships.map(({ user, ...membership }) => ({ ...user, role: membership.businessRole, membershipStatus: membership.status, accessRole: membership.accessRole, joinedAt: membership.createdAt }))) : [],
    !portal && (hasModule(req.user, 'customers') || hasModule(req.user, 'invoices')) ? db.customer.findMany({ where: { organizationId: req.user!.organizationId, AND: [workspaceCustomerScope] }, include: { primarySalesTeam: { select: { id: true, name: true } }, assignments: { where: { active: true }, select: { role: true, assignedAt: true, user: { select: { id: true, name: true } } }, orderBy: { assignedAt: 'asc' } }, quotes: { select: { id: true, number: true, stage: true, total: true, version: true, ownerId: true, updatedAt: true }, orderBy: { updatedAt: 'desc' }, take: 20 }, invoices: { select: { id: true, number: true, state: true, amount: true, paidAmount: true, dueAt: true }, orderBy: { createdAt: 'desc' }, take: 5 }, users: { where: { role: 'CUSTOMER' }, select: { id: true, email: true, status: true, googleSubject: true } }, invitations: { orderBy: { createdAt: 'desc' }, take: 25, select: { id: true, email: true, status: true, expiresAt: true, acceptedAt: true, revokedAt: true, createdAt: true } } }, orderBy: { updatedAt: 'desc' } }) : [],
    db.quote.findMany({ where: quoteWhere, include: { currentRevision: true, owner: { select: { id: true, name: true } }, lines: { include: { product: true } }, approvals: { orderBy: [{ cycle: 'desc' }, { sequence: 'asc' }] }, fulfillment: true, order: true, negotiation: { orderBy: { createdAt: 'desc' } }, invoices: true }, orderBy: { updatedAt: 'desc' } }),
    !portal && (hasModule(req.user, 'products') || hasModule(req.user, 'invoices')) ? db.product.findMany({ where: { organizationId: req.user!.organizationId }, include: { stocks: { include: { warehouse: true } } }, orderBy: { name: 'asc' } }) : [],
    !portal && hasModule(req.user, 'policies') ? db.discountPolicy.findMany({ where: { organizationId: req.user!.organizationId }, orderBy: { tier: 'asc' } }) : [],
    !portal && hasModule(req.user, 'fulfillment') ? db.warehouse.findMany({ where: { organizationId: req.user!.organizationId }, include: { stocks: { include: { product: true } } }, orderBy: { priority: 'asc' } }) : [],
    !portal && req.user!.role === 'ADMIN' ? db.subscription.findMany({ where: { organizationId: req.user!.organizationId }, include: { changes: { orderBy: { createdAt: 'desc' }, take: 50 } }, orderBy: { nextBillAt: 'asc' } }) : [],
    (portal || hasModule(req.user, 'invoices')) ? db.invoice.findMany({ where: { organizationId: req.user!.organizationId, ...(portal ? { customerId: req.user!.customerId! } : req.user!.role === 'REP' ? { quote: { ownerId: req.user!.id } } : {}) }, include: { payments: true, notes: { orderBy: { createdAt: 'desc' } }, customerRecord: { select: { id: true, email: true, phone: true, countryCode: true, contactPerson: true, currency: true } }, quote: { select: { id: true, number: true, stage: true } }, order: { include: { fulfillment: true } } }, orderBy: { createdAt: 'desc' } }) : [],
    !portal && (hasModule(req.user, 'health') || hasModule(req.user, 'quotations')) ? db.alert.findMany({ where: { organizationId: req.user!.organizationId, OR: [{ recipientId: null }, { recipientId: req.user!.id }] }, orderBy: { createdAt: 'desc' } }) : [],
    !portal && (hasModule(req.user, 'reports') || hasModule(req.user, 'health')) ? db.auditEvent.findMany({ where: { organizationId: req.user!.organizationId, ...(req.user!.role === 'REP' ? { actorId: req.user!.id } : {}) }, orderBy: { createdAt: 'desc' }, take: 60 }) : [],
  ]);
  const quotes = portal ? rawQuotes.map(portalQuoteDto) : rawQuotes.map((quote) => ({ ...quote, riskBreakdown: approvalRiskBreakdown(quote) }));
  const invoices = portal ? rawInvoices.map(portalInvoiceDto) : rawInvoices.map(internalInvoiceDto);
  const subscriptions = rawSubscriptions.map((subscription) => ({ ...subscription, schedule: billingSchedule(subscription.nextBillAt, subscription.cadence) }));
  const warehouseDtos = warehouses.map((warehouse) => ({ ...warehouse, stocks: warehouse.stocks.map((stock) => ({ ...stock, available: stock.onHand - stock.reserved })) }));
  const customerDtos = customers.map((customer) => {
    const primary = customer.assignments.find((assignment) => assignment.role === 'PRIMARY');
    return { ...customer, invitations: customer.invitations.map((invitation) => ({ ...invitation, invitedAt: invitation.createdAt, status: invitation.status === 'PENDING' && invitation.expiresAt <= new Date() ? 'EXPIRED' : invitation.status })), primaryTeam: customer.primarySalesTeam, primaryRepresentative: primary ? { ...primary.user, assignedAt: primary.assignedAt.toISOString() } : null, collaborators: customer.assignments.filter((assignment) => assignment.role === 'COLLABORATOR').map((assignment) => ({ ...assignment.user, assignedAt: assignment.assignedAt.toISOString() })), openQuotationCount: customer.quotes.filter((quote) => !['CONFIRMED','REJECTED'].includes(quote.stage)).length, lastActivity: customer.quotes[0]?.updatedAt.toISOString() ?? customer.updatedAt.toISOString() };
  });
  return ok(req, res, { user: req.user, organization, users, customers: customerDtos, quotes, products, policies, warehouses: warehouseDtos, subscriptions, invoices, alerts, audits });
});

app.post('/api/v1/customers', authenticate, requireModule('customers'), requireRole('ADMIN', 'MANAGER'), requireCsrf, async (req: AuthRequest, res) => {
  const parsed = customerCreationSchema.safeParse(req.body);
  if (!parsed.success) return fail(req, res, 422, 'VALIDATION_ERROR', 'Enter a customer name, tier, and currency.', parsed.error.flatten());
  const { temporaryPassword, ...profile } = parsed.data;
  const provisionPortalAccess = assertCustomerCreationPortalAccess(req.user!.role, profile.email, temporaryPassword);
  const customer = await db.$transaction(async (tx) => {
    return createCustomerProfile(tx, req.user!, profile, provisionPortalAccess ? { temporaryPassword } : {});
  });
  return ok(req, res, customer, 201);
});

app.patch('/api/v1/customers/:id', authenticate, requireModule('customers'), requireRole('ADMIN', 'MANAGER'), requireCsrf, async (req: AuthRequest, res) => {
  const parsed = customerProfileSchema.partial().safeParse(req.body);
  if (!parsed.success) return fail(req, res, 422, 'VALIDATION_ERROR', 'Enter valid customer values.', parsed.error.flatten());
  const existing = await db.customer.findFirst({ where: { id: routeParam(req, 'id'), organizationId: req.user!.organizationId } });
  if (!existing) return fail(req, res, 404, 'NOT_FOUND', 'Customer not found.');
  if (parsed.data.email) {
    const duplicate = await db.customer.findFirst({ where: { organizationId: req.user!.organizationId, email: { equals: parsed.data.email, mode: 'insensitive' }, id: { not: existing.id } } });
    if (duplicate) return fail(req, res, 409, 'CUSTOMER_EMAIL_EXISTS', 'This customer email is already used in this workspace.');
  }
  const customer = await db.$transaction(async (tx) => {
    const updated = await tx.customer.update({ where: { id: existing.id }, data: { ...parsed.data, ...(parsed.data.currency ? { currency: parsed.data.currency.toUpperCase() } : {}) } });
    if (parsed.data.email !== undefined && parsed.data.email !== existing.email) {
      await tx.organizationInvitation.updateMany({ where: { organizationId: req.user!.organizationId, customerId: existing.id, status: 'PENDING' }, data: { status: 'REVOKED' } });
      const portalUsers = await tx.user.findMany({ where: { organizationId: req.user!.organizationId, customerId: existing.id, role: 'CUSTOMER' } });
      for (const user of portalUsers) {
        if (updated.email) await tx.user.update({ where: { id: user.id }, data: { email: updated.email, googleSubject: null, status: 'PENDING' } });
        else await tx.user.update({ where: { id: user.id }, data: { status: 'DISABLED', googleSubject: null } });
        await tx.session.deleteMany({ where: { userId: user.id } });
      }
    }
    await audit(tx, req, 'CUSTOMER_UPDATED', 'Customer', updated.id);
    return updated;
  });
  return ok(req, res, customer);
});

const createPortalInvitation = async (req: AuthRequest, res: Response) => {
  const parsed = z.object({}).strict().safeParse(req.body ?? {});
  if (!parsed.success) return fail(req, res, 422, 'VALIDATION_ERROR', 'Portal invitation creation does not accept recipient or role overrides.', parsed.error.flatten());
  const invitation = await issuePortalInvitation(db, { id: req.user!.id, role: req.user!.role, organizationId: req.user!.organizationId, requestId: req.requestId }, routeParam(req, 'id'), allowedOrigin);
  return ok(req, res, invitation, 201);
};

app.post('/api/v1/customers/:id/portal-invitations', authenticate, requireModule('customers'), requireRole('ADMIN', 'MANAGER'), requireCsrf, createPortalInvitation);
app.post('/api/v1/customers/:id/portal-invite', authenticate, requireModule('customers'), requireRole('ADMIN', 'MANAGER'), requireCsrf, createPortalInvitation);

app.post('/api/v1/customers/:id/portal-invitations/:invitationId/revoke', authenticate, requireModule('customers'), requireRole('ADMIN', 'MANAGER'), requireCsrf, async (req: AuthRequest, res) => {
  const invitation = await revokePortalInvitation(db, { id: req.user!.id, role: req.user!.role, organizationId: req.user!.organizationId, requestId: req.requestId }, routeParam(req, 'id'), routeParam(req, 'invitationId'));
  return ok(req, res, invitation);
});

app.get('/api/v1/portal/invitations/:token', async (req: AuthRequest, res) => {
  const invitation = await inspectPortalInvitation(db, routeParam(req, 'token'));
  return ok(req, res, invitation);
});

app.post('/api/v1/portal/invitations/:token/accept', async (req: AuthRequest, res) => {
  if (req.headers.origin !== allowedOrigin) return fail(req, res, 403, 'ORIGIN_INVALID', 'This request origin is not allowed.');
  const parsed = portalInvitationAcceptSchema.safeParse(req.body);
  if (!parsed.success) return fail(req, res, 422, 'VALIDATION_ERROR', 'Enter your name and a password of at least 12 characters.', parsed.error.flatten());
  const user = await acceptPortalInvitation(db, routeParam(req, 'token'), parsed.data, req.requestId);
  const sessionToken = await startSession(user, res);
  return ok(req, res, { id: user.id, name: user.name, email: user.email, role: user.role, customerId: user.customerId, destination: '/customer', csrfToken: csrfForToken(sessionToken) }, 201);
});

app.put('/api/v1/customers/:id/portal-password', authenticate, requireModule('customers'), requireRole('ADMIN', 'MANAGER'), requireCsrf, async (req: AuthRequest, res) => {
  const parsed = z.object({ password: z.string().min(12).max(128) }).strict().safeParse(req.body);
  if (!parsed.success) return fail(req, res, 422, 'VALIDATION_ERROR', 'Customer portal passwords must be at least 12 characters.', parsed.error.flatten());
  const customer = await db.customer.findFirst({
    where: { id: routeParam(req, 'id'), organizationId: req.user!.organizationId, active: true },
    include: {
      primarySalesTeam: { select: { managerId: true } },
      assignments: { where: { role: 'PRIMARY', active: true }, select: { id: true } },
    },
  });
  if (!customer) return fail(req, res, 404, 'NOT_FOUND', 'Customer not found.');
  if (req.user!.role === 'MANAGER' && customer.primarySalesTeam?.managerId !== req.user!.id) return fail(req, res, 403, 'FORBIDDEN', 'Managers can manage portal access only for teams they manage.');
  if (!customer.primarySalesTeamId || !customer.primarySalesTeam || customer.assignments.length !== 1) return fail(req, res, 422, 'CONFIGURATION_REQUIRED', 'Assign a primary sales team and representative before activating portal access.');
  try {
    const user = await db.$transaction((tx) => provisionCustomerPortalPassword(tx, req.user!, customer, parsed.data.password));
    return ok(req, res, { id: user.id, email: user.email, status: user.status });
  } catch (error) {
    if (error instanceof DomainError) return fail(req, res, error.status, error.code, error.message);
    throw error;
  }
});

app.get('/api/v1/customers', authenticate, requireModule('quotations'), requireRole('REP', 'MANAGER', 'FINANCE', 'ADMIN'), async (req: AuthRequest, res) => {
  const parsed = customerListQuerySchema.safeParse(req.query);
  if (!parsed.success) return fail(req, res, 422, 'VALIDATION_ERROR', 'Use valid customer filters.', parsed.error.flatten());
  const repScopingEnabled = process.env.NODE_ENV !== 'production' || process.env.CUSTOMER_ASSIGNMENT_SCOPING_ENABLED === 'true';
  const assignmentScope = req.user!.role === 'REP' && !repScopingEnabled ? {} : customerRecordScope(req.user!);
  const assignmentFilter: Prisma.CustomerWhereInput = parsed.data.assignment === 'unassigned'
    ? { OR: [{ primarySalesTeamId: null }, { assignments: { none: { role: 'PRIMARY', active: true } } }] }
    : parsed.data.assignment === 'assigned'
      ? { primarySalesTeamId: { not: null }, assignments: { some: { role: 'PRIMARY', active: true } } }
      : {};
  const customers = await db.customer.findMany({
    where: {
      organizationId: req.user!.organizationId,
      active: true,
      AND: [assignmentScope, assignmentFilter],
      ...(parsed.data.search ? { name: { contains: parsed.data.search, mode: 'insensitive' as const } } : {}),
    },
    include: {
      ...customerRelationshipInclude,
      quotes: { where: { stage: { notIn: ['CONFIRMED', 'REJECTED'] } }, select: { id: true, number: true, stage: true, version: true, ownerId: true, updatedAt: true }, orderBy: { updatedAt: 'desc' } },
    },
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
    take: parsed.data.limit,
  });
  return ok(req, res, { items: customers.map((customer) => ({
    id: customer.id, name: customer.name, tier: customer.tier, currency: customer.currency,
    ...customerRelationshipDto(customer),
    openQuotationCount: customer.quotes.length,
    lastActivity: customer.quotes[0]?.updatedAt.toISOString() ?? customer.updatedAt.toISOString(),
    openQuotations: customer.quotes.map((quote) => ({ id: quote.id, number: quote.number, stage: quote.stage, version: quote.version, ownerId: quote.ownerId, canReassign: ['DRAFT', 'PENDING_APPROVAL'].includes(quote.stage) })),
  })) });
});

app.get('/api/v1/sales-teams', authenticate, requireModule('customers'), requireRole('MANAGER', 'ADMIN'), async (req: AuthRequest, res) => {
  const [teams, representatives, managers] = await Promise.all([
    db.salesTeam.findMany({
      where: { organizationId: req.user!.organizationId, ...(req.user!.role === 'MANAGER' ? { managerId: req.user!.id } : {}) },
      select: {
        id: true,
        name: true,
        managerId: true,
        manager: { select: { id: true, name: true } },
        members: { where: { user: { status: 'ACTIVE', role: 'REP' } }, select: { user: { select: { id: true, name: true } } }, orderBy: { user: { name: 'asc' } } },
      },
      orderBy: { name: 'asc' },
    }),
    req.user!.role === 'ADMIN' ? db.user.findMany({ where: { organizationId: req.user!.organizationId, status: 'ACTIVE', role: 'REP' }, select: { id: true, name: true }, orderBy: { name: 'asc' } }) : [],
    req.user!.role === 'ADMIN' ? db.user.findMany({ where: { organizationId: req.user!.organizationId, status: 'ACTIVE', role: { in: ['MANAGER', 'ADMIN'] } }, select: { id: true, name: true }, orderBy: { name: 'asc' } }) : [],
  ]);
  return ok(req, res, {
    items: teams.map((team) => ({ id: team.id, name: team.name, managerId: team.managerId, manager: team.manager, representatives: team.members.map((member) => member.user) })),
    canManage: req.user!.role === 'ADMIN',
    options: { representatives, managers },
  });
});

app.get('/api/v1/directory/join-requests', authenticate, requireModule('customers'), requireRole('MANAGER', 'ADMIN'), async (req: AuthRequest, res) => {
  const parsed = directoryJoinListSchema.safeParse(req.query);
  if (!parsed.success) return fail(req, res, 422, 'VALIDATION_ERROR', 'Use a valid join-request status filter.', parsed.error.flatten());
  return ok(req, res, await listDirectoryJoinRequests(db, { ...req.user!, requestId: req.requestId! }, parsed.data.status));
});

app.post('/api/v1/directory/join-requests/:id/approve', authenticate, requireModule('customers'), requireRole('MANAGER', 'ADMIN'), requireCsrf, async (req: AuthRequest, res) => {
  const parsed = approveDirectoryJoinRequestSchema.safeParse(req.body);
  if (!parsed.success) return fail(req, res, 422, 'VALIDATION_ERROR', 'Select an eligible team and representative, customer tier, and currency.', parsed.error.flatten());
  const result = await db.$transaction((tx) => approveDirectoryJoinRequest(tx, { ...req.user!, requestId: req.requestId! }, routeParam(req, 'id'), parsed.data));
  return ok(req, res, result);
});

app.post('/api/v1/directory/join-requests/:id/decline', authenticate, requireModule('customers'), requireRole('MANAGER', 'ADMIN'), requireCsrf, async (req: AuthRequest, res) => {
  const parsed = declineDirectoryJoinRequestSchema.safeParse(req.body);
  if (!parsed.success) return fail(req, res, 422, 'VALIDATION_ERROR', 'Provide a decline reason of at least five characters.', parsed.error.flatten());
  return ok(req, res, await db.$transaction((tx) => declineDirectoryJoinRequest(tx, { ...req.user!, requestId: req.requestId! }, routeParam(req, 'id'), parsed.data.reason)));
});

app.put('/api/v1/customers/:id/relationships', authenticate, requireModule('customers'), requireRole('MANAGER', 'ADMIN'), requireCsrf, async (req: AuthRequest, res, next) => {
  const parsed = customerRelationshipSchema.safeParse(req.body);
  if (!parsed.success) return fail(req, res, 422, 'VALIDATION_ERROR', 'Select a team, primary representative, collaborators, and a reason.', parsed.error.flatten());
  try {
    const result = await updateCustomerRelationships(db, { id: req.user!.id, role: req.user!.role, organizationId: req.user!.organizationId, requestId: req.requestId! }, routeParam(req, 'id'), parsed.data);
    return ok(req, res, { ...customerRelationshipDto(result.customer), openQuotations: await db.quote.findMany({ where: { customerId: result.customer.id, organizationId: req.user!.organizationId, stage: { notIn: ['CONFIRMED', 'REJECTED'] } }, select: { id: true, number: true, stage: true, version: true, ownerId: true }, orderBy: { lastActivity: 'desc' } }) });
  } catch (error) { return next(error); }
});

app.post('/api/v1/sales-teams',authenticate,requireModule('quotations'),requireRole('ADMIN'),requireCsrf,async(req:AuthRequest,res,next)=>{
  const parsed=salesTeamMutationSchema.safeParse(req.body);
  if(!parsed.success)return fail(req,res,422,'VALIDATION_ERROR','Enter a team name and select at least one active sales representative.',parsed.error.flatten());
  try{return ok(req,res,await createSalesTeam(db,{id:req.user!.id,role:req.user!.role,organizationId:req.user!.organizationId,requestId:req.requestId},parsed.data),201)}catch(error){return next(error)}
});

app.patch('/api/v1/sales-teams/:id',authenticate,requireModule('quotations'),requireRole('ADMIN'),requireCsrf,async(req:AuthRequest,res,next)=>{
  const parsed=salesTeamMutationSchema.safeParse(req.body);
  if(!parsed.success)return fail(req,res,422,'VALIDATION_ERROR','Enter a team name and select at least one active sales representative.',parsed.error.flatten());
  try{return ok(req,res,await updateSalesTeam(db,{id:req.user!.id,role:req.user!.role,organizationId:req.user!.organizationId,requestId:req.requestId},routeParam(req,'id'),parsed.data))}catch(error){return next(error)}
});

app.get('/api/v1/quotations', authenticate, requireModule('quotations'), requireRole('REP', 'MANAGER', 'FINANCE', 'ADMIN'), async (req: AuthRequest, res) => {
  const parsed = quotationListQuerySchema.safeParse(req.query);
  if (!parsed.success) return fail(req, res, 422, 'VALIDATION_ERROR', 'Use valid quotation filters.', parsed.error.flatten());
  const actor = req.user!;
  const where = buildQuotationWhere(actor, parsed.data);
  const facetFilters = { ...parsed.data, stage: undefined, cursor: undefined };
  const ownerWhere = actor.role === 'REP'
    ? { id: actor.id }
    : { organizationId: actor.organizationId, quotes: { some: { organizationId: actor.organizationId } } };
  const [rows, total, owners, stageCountEntries] = await Promise.all([
    db.quote.findMany({
      where,
      include: quotationListInclude,
      orderBy: quotationOrderBy(parsed.data.sort),
      ...(parsed.data.cursor ? { cursor: { id: parsed.data.cursor }, skip: 1 } : {}),
      take: parsed.data.limit + 1,
    }),
    db.quote.count({ where }),
    db.user.findMany({ where: ownerWhere, select: { id: true, name: true }, orderBy: [{ name: 'asc' }, { id: 'asc' }] }),
    Promise.all(quotationStages.map(async (stage) => [stage, await db.quote.count({ where: buildQuotationWhere(actor, { ...facetFilters, stage }) })] as const)),
  ]);
  const hasMore = rows.length > parsed.data.limit;
  const page = hasMore ? rows.slice(0, parsed.data.limit) : rows;
  return ok(req, res, {
    items: page.map(quotationSummaryDto),
    pagination: { total, nextCursor: hasMore ? page.at(-1)?.id ?? null : null },
    stageCounts: Object.fromEntries(stageCountEntries),
    owners,
    primaryStages: primaryQuotationStages,
  });
});

app.get('/api/v1/quotations/:id', authenticate, requireModule('quotations'), requireRole('REP', 'MANAGER', 'FINANCE', 'ADMIN'), async (req: AuthRequest, res) => {
  const quote = await db.quote.findUnique({
    where: { id: routeParam(req, 'id') },
    include: {
      owner: { select: { id: true, name: true } },
      createdBy: { select: { id: true, name: true } },
      customerRecord: { select: { id: true, name: true, tier: true, currency: true } },
      team: { select: { id: true, name: true, managerId: true } },
      currentRevision: true,
      revisions: { orderBy: { revisionNumber: 'desc' } },
      lines: { include: { product: true } },
      approvals: { include: { reviewer: { select: { id: true, name: true } }, revision: { select: { submittedById: true } } }, orderBy: [{ cycle: 'desc' }, { sequence: 'asc' }] },
      approvalCases: { orderBy: { cycle: 'desc' }, take: 10 },
      negotiation: { orderBy: { createdAt: 'desc' } },
      order: { select: { id: true, number: true, state: true } },
      invoices: { select: { id: true, number: true, state: true } },
      sourcePortalRequest: { include: { lines: { include: { product: { select: { id: true, name: true, sku: true } } }, orderBy: { id: 'asc' } } } },
    },
  });
  if (!quote || !(await canAccessInternalQuote(req.user!, quote))) return fail(req, res, 404, 'NOT_FOUND', 'Quotation not found.');
  const capabilities = quotationCapabilities(req.user!, quote);
  const [activity, teams, owners, managers, submittedBy, catalog, viewerAssignment, activePolicy] = await Promise.all([
    db.auditEvent.findMany({ where: { organizationId: req.user!.organizationId, resource: 'Quote', resourceId: quote.id }, include: { actor: { select: { id: true, name: true } } }, orderBy: { createdAt: 'desc' }, take: 100 }),
    db.salesTeam.findMany({ where: { organizationId: req.user!.organizationId, ...(req.user!.role === 'MANAGER' ? { managerId: req.user!.id } : {}) }, select: { id: true, name: true, managerId: true, members: { select: { userId: true } } }, orderBy: { name: 'asc' } }),
    db.user.findMany({ where: { organizationId: req.user!.organizationId, status: 'ACTIVE', role: 'REP' }, select: { id: true, name: true, role: true }, orderBy: { name: 'asc' } }),
    db.user.findMany({ where: { organizationId: req.user!.organizationId, status: 'ACTIVE', role: { in: ['MANAGER','ADMIN'] } }, select: { id: true, name: true, role: true }, orderBy: { name: 'asc' } }),
    quote.currentRevision?.submittedById ? db.user.findUnique({ where: { id: quote.currentRevision.submittedById }, select: { id: true, name: true } }) : Promise.resolve(null),
    db.product.findMany({where:{organizationId:req.user!.organizationId,active:true},select:{id:true,name:true,sku:true,category:true,description:true,unit:true,price:true,cost:true,taxRate:true,recurring:true,cadence:true,active:true},orderBy:{name:'asc'}}),
    req.user!.role === 'REP' ? db.customerRepresentative.findFirst({ where: { customerId: quote.customerId, userId: req.user!.id, active: true }, select: { role: true } }) : Promise.resolve(null),
    db.discountPolicy.findFirst({where:{organizationId:req.user!.organizationId,tier:quote.customerTier}}),
  ]);
  const lines = quote.lines.map((line) => ({
    id: line.id, productId: line.productId, quantity: line.quantity, unitPrice: line.unitPrice.toString(),
    ...(capabilities.viewCost ? { unitCost: line.unitCost.toString() } : {}), discount: line.discount.toString(), allowedDiscount: line.allowedDiscount.toString(),
    product: { id: line.product.id, name: line.product.name, sku: line.product.sku, category: line.product.category, description: line.product.description, unit: line.product.unit, price: line.product.price.toString(), ...(capabilities.viewCost ? { cost: line.product.cost.toString() } : {}), taxRate: line.product.taxRate.toString(), recurring: line.product.recurring, cadence: line.product.cadence, active: line.product.active },
  }));
  const currentCalculation=calculateQuote(quote.lines.map((line)=>({quantity:line.quantity,unitPrice:line.unitPrice,unitCost:line.unitCost,discount:line.discount,allowedDiscount:line.allowedDiscount,taxRate:line.product.taxRate,cadence:line.product.recurring?line.product.cadence:'One-time'})),quote.orderDiscount);
  const riskBreakdown = approvalRiskBreakdown(quote);
  const violations = lines.map((line) => { const effectiveDiscount=100-((100-Number(line.discount))*(100-Number(quote.orderDiscount)))/100; return { productId: line.productId, product: line.product.name, discount: String(effectiveDiscount), limit: line.allowedDiscount, excess: Math.max(0, effectiveDiscount-Number(line.allowedDiscount)) }; }).filter((line) => line.excess > 0).sort((a,b)=>b.excess-a.excess);
  const currentApproval = quote.approvals.find((approval) => approval.revisionId === quote.currentRevisionId && approval.state === 'PENDING');
  const currentApprovalCase = quote.approvalCases.find((approvalCase)=>approvalCase.revisionId===quote.currentRevisionId)??null;
  const explanation = violations.length
    ? `${violations[0]!.product} is discounted ${violations[0]!.excess.toFixed(2)} points above its ${Number(violations[0]!.limit).toFixed(2)}% policy limit.${currentApproval ? ` ${currentApproval.step} approval is currently required.` : ''}`
    : currentApproval ? `${currentApproval.step} review is required by the active margin and aggregate discount policy.` : 'All persisted lines are within their line-level discount limits.';
  return ok(req, res, {
    ...quotationSummaryDto(quote), team: quote.team ? { id: quote.team.id, name: quote.team.name } : null,
    createdBy: quote.createdBy,
    viewerAccess: { accountRole: quote.ownerId === req.user!.id ? 'DEAL_OWNER' : viewerAssignment?.role ?? (req.user!.role === 'REP' ? 'TEAM_MEMBER' : req.user!.role), readOnlyTeamView: req.user!.role === 'REP' && quote.ownerId !== req.user!.id },
    sentAt: quote.sentAt?.toISOString() ?? null, orderDiscount: quote.orderDiscount.toString(), subtotal:String(currentCalculation.subtotal), taxTotal:String(currentCalculation.taxTotal), total:String(currentCalculation.total), totalsByCadence:currentCalculation.totalsByCadence,
    ...(capabilities.viewMargin ? { margin:String(currentCalculation.margin) } : {}), capabilities,
    currentRevision: quote.currentRevision ? { id: quote.currentRevision.id, revisionNumber: quote.currentRevision.revisionNumber, state: quote.currentRevision.state, currency: quote.currentRevision.currency, validUntil: quote.currentRevision.validUntil?.toISOString()??null, promisedDeliveryAt: quote.currentRevision.promisedDeliveryAt?.toISOString()??null, terms: quote.currentRevision.terms, internalNote: quote.currentRevision.internalNote, submittedBy } : null,
    lines,
    approval: { caseId:currentApprovalCase?.id??null, caseVersion:currentApprovalCase?.version??null, route:currentApprovalCase?.route??'NONE', state:currentApprovalCase?.state??null, explanation, riskBreakdown, violations, currentStep: currentApproval?.step??null, timeline: quote.approvals.filter((approval)=>approval.revisionId===quote.currentRevisionId).map((approval)=>({ id:approval.id, step:approval.step, sequence:approval.sequence, cycle:approval.cycle, state:approval.state, reason:approval.reason, reviewer:approval.reviewer, decidedAt:approval.decidedAt?.toISOString()??null, createdAt:approval.createdAt.toISOString() })) },
    revisions: revisionHistory(quote.revisions, capabilities.viewMargin, capabilities.viewCost),
    activity: activity.map((event)=>({ id:event.id, action:event.action, reason:event.reason, revisionId:event.revisionId, actor:event.actor??{id:'system',name:'System'}, createdAt:event.createdAt.toISOString() })),
    assignmentOptions: { teams: teams.map((team)=>({id:team.id,name:team.name,managerId:team.managerId,memberIds:team.members.map((member)=>member.userId)})), owners, managers, canCreateTeam:req.user!.role==='ADMIN'&&!req.user!.readOnlyView },
    catalog:catalog.map((product)=>({id:product.id,name:product.name,sku:product.sku,category:product.category,description:product.description,unit:product.unit,price:product.price.toString(),...(capabilities.viewCost?{cost:product.cost.toString()}:{}),taxRate:product.taxRate.toString(),recurring:product.recurring,cadence:product.cadence,active:product.active})),
    addOns:activePolicy?catalog.filter((product)=>!quote.lines.some((line)=>line.productId===product.id)).map((product)=>{const contribution=calculateAddOnContribution({productId:product.id,quantity:1,unitPrice:product.price,unitCost:product.cost,discount:0,allowedDiscount:allowedDiscountForCategory(product.category,activePolicy),taxRate:product.taxRate,cadence:product.recurring?product.cadence:'One-time'},quote.orderDiscount,{financeThreshold:activePolicy.financeThreshold,aggregateDiscountLimit:activePolicy.aggregateDiscountLimit,minimumMarginPercent:activePolicy.minimumMarginPercent});return{id:product.id,name:product.name,sku:product.sku,category:product.category,cadence:contribution.cadence,marginContribution:String(contribution.marginContribution),netContribution:String(contribution.netContribution)}}):[],
    negotiation: quote.negotiation, order: quote.order, invoices: quote.invoices,
    origin: quote.sourcePortalRequest ? { type: 'PORTAL_REQUEST', request: { id: quote.sourcePortalRequest.id, requirementsText: quote.sourcePortalRequest.requirementsText, preferredDeliveryDate: quote.sourcePortalRequest.preferredDeliveryDate?.toISOString()??null, createdAt: quote.sourcePortalRequest.createdAt.toISOString(), lines: quote.sourcePortalRequest.lines.map((line) => ({ id: line.id, product: line.product, freeTextDescription: line.freeTextDescription, quantity: line.quantity?.toString()??null, degraded: line.degraded, degradedReason: line.degradedReason })) } } : { type: 'INTERNAL' },
  });
});

app.patch('/api/v1/quotations/:id/assignment', authenticate, requireModule('quotations'), requireRole('MANAGER', 'ADMIN'), requireCsrf, async (req: AuthRequest, res) => {
  const parsed = z.object({ version:z.number().int().nonnegative(), ownerId:z.string().uuid(), teamId:z.string().uuid().nullable(), reason:z.string().trim().min(2).max(500) }).strict().safeParse(req.body);
  if(!parsed.success)return fail(req,res,422,'VALIDATION_ERROR','Select a valid owner and team and enter an assignment reason.',parsed.error.flatten());
  const quote=await db.quote.findUnique({where:{id:routeParam(req,'id')},include:{currentRevision:true,approvals:true,negotiation:true,order:true}});
  if(!quote||!(await canAccessInternalQuote(req.user!,quote)))return fail(req,res,404,'NOT_FOUND','Quotation not found.');
  if(!quotationCapabilities(req.user!,quote).assign)return fail(req,res,409,'INVALID_STATE','This quotation cannot be reassigned in its current state.');
  const [owner,team]=await Promise.all([
    db.user.findFirst({where:{id:parsed.data.ownerId,organizationId:req.user!.organizationId,status:'ACTIVE',role:'REP'}}),
    parsed.data.teamId?db.salesTeam.findFirst({where:{id:parsed.data.teamId,organizationId:req.user!.organizationId},include:{members:true}}):Promise.resolve(null),
  ]);
  if(!owner||parsed.data.teamId&&!team)return fail(req,res,422,'VALIDATION_ERROR','The selected owner or team is unavailable.');
  if(team&&!team.members.some((member)=>member.userId===owner.id)&&team.managerId!==owner.id)return fail(req,res,422,'OWNER_NOT_ON_TEAM','Select an owner who belongs to the assigned team.');
  if(req.user!.role==='MANAGER'&&(!team||team.managerId!==req.user!.id))return fail(req,res,403,'FORBIDDEN','Managers can only assign quotations within teams they manage.');
  const updated=await db.$transaction(async(tx)=>{
    const won=await tx.quote.updateMany({where:{id:quote.id,version:parsed.data.version},data:{ownerId:owner.id,teamId:team?.id??null,version:{increment:1},lastActivity:new Date()}});
    if(won.count!==1)throw new DomainError(409,'STALE_VERSION','Refresh the quotation before changing its assignment.');
    await audit(tx,req,'QUOTE_ASSIGNED','Quote',quote.id,`${owner.name}${team?` / ${team.name}`:' / Unassigned'}: ${parsed.data.reason}`,quote.currentRevisionId??undefined);
    return {owner:{id:owner.id,name:owner.name},team:team?{id:team.id,name:team.name}:null};
  });
  return ok(req,res,updated);
});

async function customerQuotationPreview(actor:Actor, quoteId:string):Promise<CustomerQuotationPreview|null> {
  const quote=await db.quote.findUnique({where:{id:quoteId},include:{organization:{select:{name:true}},currentRevision:true}});
  if(!quote||!(await canAccessInternalQuote(actor,quote))||!quote.currentRevision)return null;
  const snapshotLines=(Array.isArray(quote.currentRevision.linesSnapshot)?quote.currentRevision.linesSnapshot.filter(isRecord):[]) as Record<string,unknown>[];
  return {
    organization:quote.organization,
    quotation:{number:quote.number,customer:quote.customer,customerTier:quote.customerTier,revisionNumber:quote.currentRevision.revisionNumber,state:quote.currentRevision.state==='SENT'?'SENT':quote.stage,currency:quote.currentRevision.currency,validUntil:quote.currentRevision.validUntil?.toISOString()??null,promisedDeliveryAt:quote.currentRevision.promisedDeliveryAt?.toISOString()??null,terms:quote.currentRevision.terms,subtotal:quote.currentRevision.subtotal.toString(),taxTotal:quote.currentRevision.taxTotal.toString(),total:quote.currentRevision.total.toString(),sentAt:quote.currentRevision.sentAt?.toISOString()??null},
    lines:snapshotLines.map((line)=>({name:String(line.name??'Line item'),sku:String(line.sku??''),description:String(line.description??''),quantity:numeric(line.quantity),unitPrice:String(line.unitPrice??0),discount:String(line.discount??0),net:String(line.net??0),cadence:line.cadence&&line.cadence!=='One-time'?String(line.cadence):null})),
  };
}

app.get('/api/v1/quotations/:id/customer-preview',authenticate,requireModule('quotations'),requireRole('REP','MANAGER','FINANCE','ADMIN'),async(req:AuthRequest,res)=>{
  const preview=await customerQuotationPreview(req.user!,routeParam(req,'id'));
  if(!preview)return fail(req,res,404,'NOT_FOUND','Quotation not found.');
  return ok(req,res,preview);
});

app.get('/api/v1/quotations/:id/pdf',authenticate,requireModule('quotations'),requireRole('REP','MANAGER','FINANCE','ADMIN'),async(req:AuthRequest,res)=>{
  const preview=await customerQuotationPreview(req.user!,routeParam(req,'id'));
  if(!preview)return fail(req,res,404,'NOT_FOUND','Quotation not found.');
  const pdf=await renderQuotationPdf(preview);
  res.setHeader('Content-Type','application/pdf');res.setHeader('Content-Disposition',`attachment; filename="${preview.quotation.number}.pdf"`);res.setHeader('Content-Length',pdf.length);return res.status(200).send(pdf);
});

app.post('/api/v1/quotations', authenticate, requireModule('quotations'), requireRole('REP', 'MANAGER', 'ADMIN'), requireCsrf, async (req: AuthRequest, res) => {
  const parsed = createQuotationSchema.safeParse(req.body);
  if (!parsed.success) return fail(req, res, 422, 'VALIDATION_ERROR', 'Select an active customer and enter valid quotation details.', parsed.error.flatten());
  let created;
  try {
    created = await db.$transaction((tx) => createDraft(tx, {
      organizationId: req.user!.organizationId,
      actor: req.user!,
      customerId: parsed.data.customerId,
      requestedOwnerId: parsed.data.ownerId,
      createdById: req.user!.id,
      validUntil: parsed.data.validUntil ? new Date(parsed.data.validUntil) : null,
      promisedDeliveryAt: parsed.data.promisedDeliveryAt ? new Date(parsed.data.promisedDeliveryAt) : null,
      terms: parsed.data.terms || null,
      requestId: req.requestId,
    }));
  } catch (error) {
    if (error instanceof QuotationCreationError) return fail(req, res, error.status, error.code, error.message);
    throw error;
  }
  const quoteId = created.quoteId;
  const quote = await db.quote.findUniqueOrThrow({ where: { id: quoteId }, include: quotationListInclude });
  return ok(req, res, quotationSummaryDto(quote), 201);
});

type CommercialLine = { productId: string; quantity: number; discount: number };

async function prepareQuoteCalculation(organizationId: string, customerTier: string, lines: CommercialLine[], orderDiscount: number) {
  const productIds = [...new Set(lines.map((line) => line.productId))];
  const products = await db.product.findMany({ where: { id: { in: productIds }, organizationId, active: true } });
  if (products.length !== productIds.length) throw new DomainError(422, 'CONFIGURATION_REQUIRED', 'One or more products are unavailable.');
  const policy = await db.discountPolicy.findFirst({ where: { organizationId, tier: customerTier } });
  if (!policy) throw new DomainError(422, 'CONFIGURATION_REQUIRED', 'Configure this customer tier before pricing the quotation.');
  const inputs = lines.map((line) => {
    const product = products.find((item) => item.id === line.productId)!;
    return {
      ...line,
      unitPrice: product.price,
      unitCost: product.cost,
      taxRate: product.taxRate,
      cadence: product.recurring ? product.cadence : 'One-time',
      allowedDiscount: allowedDiscountForCategory(product.category, policy),
    };
  });
  return { inputs, products, policy, calculation: calculateQuote(inputs, orderDiscount, {
    financeThreshold: policy.financeThreshold,
    aggregateDiscountLimit: policy.aggregateDiscountLimit,
    minimumMarginPercent: policy.minimumMarginPercent,
  }) };
}

function quoteCalculationDto(prepared: Awaited<ReturnType<typeof prepareQuoteCalculation>>) {
  const { calculation } = prepared;
  const { lines: _lines, cost: _cost, totalsByCadence, ...summary } = calculation;
  return {
    ...summary,
    totalsByCadence: Object.fromEntries(Object.entries(totalsByCadence).map(([cadence, totals]) => [cadence, {
      subtotal: totals.subtotal,
      tax: totals.tax,
      total: totals.total,
      margin: totals.margin,
    }])),
    lines: calculation.lines.map((line, index) => ({
      productId: prepared.inputs[index]!.productId,
      quantity: line.quantity,
      unitPrice: line.unitPrice.toString(),
      discount: line.discount,
      allowedDiscount: line.allowedDiscount.toString(),
      gross: line.gross,
      net: line.net,
      tax: line.tax,
      effectiveDiscount: line.effectiveDiscount,
      excess: line.excess,
      cadence: line.cadence,
    })),
  };
}

app.post('/api/v1/quotations/:id/preview', authenticate, requireModule('quotations'), requireRole('REP'), requireCsrf, async (req: AuthRequest, res) => {
  const parsed = quotePreviewSchema.safeParse(req.body);
  if (!parsed.success) return fail(req, res, 422, 'VALIDATION_ERROR', 'Add valid quotation lines to calculate a preview.', parsed.error.flatten());
  const quote = await db.quote.findUnique({ where: { id: routeParam(req, 'id') }, include: { currentRevision: true } });
  if (!quote || !(await canAccessInternalQuote(req.user!, quote))) return fail(req, res, 404, 'NOT_FOUND', 'Quotation not found.');
  if (quote.ownerId !== req.user!.id) return fail(req, res, 403, 'OWNER_REQUIRED', 'Only the quotation owner can calculate edits.');
  if (quote.stage !== 'DRAFT' || quote.currentRevision?.state !== 'DRAFT') return fail(req, res, 409, 'INVALID_STATE', 'Only a draft quotation can be previewed.');
  if (quote.version !== parsed.data.expectedVersion || quote.currentRevisionId !== parsed.data.revisionId) return fail(req, res, 409, 'STALE_VERSION', 'Refresh the quotation before recalculating.');
  const lines = parsed.data.lines.map((line) => ({ productId: line.variantId, quantity: line.quantity, discount: line.lineDiscount }));
  const prepared = await prepareQuoteCalculation(req.user!.organizationId, quote.customerTier, lines, parsed.data.orderDiscount);
  return ok(req, res, {
    revisionId: quote.currentRevisionId,
    version: quote.version,
    ...quoteCalculationDto(prepared),
  });
});

app.put('/api/v1/quotations/:id/draft', authenticate, requireModule('quotations'), requireRole('REP'), requireCsrf, async (req: AuthRequest, res) => {
  const parsed = quoteDraftSchema.safeParse(req.body);
  if (!parsed.success) return fail(req, res, 422, 'VALIDATION_ERROR', 'Add valid quotation lines.', parsed.error.flatten());
  const quote = await db.quote.findUnique({ where: { id: routeParam(req, 'id') }, include: { currentRevision: true } });
  if (!quote || !(await canAccessInternalQuote(req.user!, quote))) return fail(req, res, 404, 'NOT_FOUND', 'Quotation not found.');
  if (quote.ownerId !== req.user!.id) return fail(req, res, 403, 'OWNER_REQUIRED', 'Only the quotation owner can save this draft.');
  if (quote.version !== parsed.data.expectedVersion || quote.currentRevisionId !== parsed.data.revisionId || quote.stage !== 'DRAFT' || quote.currentRevision?.state !== 'DRAFT') return fail(req, res, 409, 'STALE_VERSION', 'Refresh the quotation before saving.');
  const { inputs, products, policy, calculation } = await prepareQuoteCalculation(req.user!.organizationId, quote.customerTier, parsed.data.lines, parsed.data.orderDiscount);
  const evaluation = evaluateRisk(calculation, policy);
  const snapshot = inputs.map((line,index) => { const product=products.find((item)=>item.id===line.productId)!; const calculated=calculation.lines[index]!; return { productId: line.productId, name:product.name, sku:product.sku, category:product.category, description:product.description, quantity: line.quantity, unitPrice: line.unitPrice.toString(), unitCost: line.unitCost.toString(), taxRate: line.taxRate.toString(), cadence: line.cadence, discount: line.discount, effectiveDiscount: calculated.effectiveDiscount, allowedDiscount: line.allowedDiscount.toString(), gross: calculated.gross, net:calculated.net, tax:calculated.tax, lineCost:calculated.lineCost, excess:calculated.excess }; });
  const updated = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Quote" WHERE "id" = ${quote.id} FOR UPDATE`;
    const latest = await tx.quote.findUniqueOrThrow({ where: { id: quote.id }, include: { currentRevision: true } });
    if (latest.version !== parsed.data.expectedVersion || latest.currentRevisionId !== parsed.data.revisionId || latest.stage !== 'DRAFT' || latest.currentRevision?.state !== 'DRAFT') throw new DomainError(409, 'STALE_VERSION', 'Refresh the quotation before saving.');
    await tx.quoteRevision.update({ where: { id: parsed.data.revisionId }, data: { state: 'SUPERSEDED' } });
    const revision = await tx.quoteRevision.create({ data: {
      quoteId: quote.id, revisionNumber: latest.currentRevision.revisionNumber + 1, state: 'DRAFT', currency: latest.currentRevision.currency,
      validUntil: parsed.data.validUntil === undefined ? latest.currentRevision.validUntil : parsed.data.validUntil ? new Date(parsed.data.validUntil) : null,
      promisedDeliveryAt: parsed.data.promisedDeliveryAt === undefined ? latest.currentRevision.promisedDeliveryAt : parsed.data.promisedDeliveryAt ? new Date(parsed.data.promisedDeliveryAt) : null,
      terms: parsed.data.terms === undefined ? latest.currentRevision.terms : parsed.data.terms || null,
      orderDiscount: parsed.data.orderDiscount, subtotal: calculation.subtotal, taxTotal: calculation.taxTotal, total: calculation.total,
      margin: calculation.margin, riskScore: calculation.riskScore, totalsByCadence: asJson(calculation.totalsByCadence), linesSnapshot: asJson(snapshot),
      policySnapshot: asJson(evaluation), termsHash: termsHash({ quoteId: quote.id, sourceRevisionId: parsed.data.revisionId, snapshot, orderDiscount: parsed.data.orderDiscount, calculation, validUntil: parsed.data.validUntil, promisedDeliveryAt: parsed.data.promisedDeliveryAt, terms: parsed.data.terms }),
    } });
    await tx.quoteLine.deleteMany({ where: { quoteId: quote.id } });
    await tx.quoteLine.createMany({ data: inputs.map((line) => ({ quoteId: quote.id, productId: line.productId, quantity: line.quantity, unitPrice: line.unitPrice, unitCost: line.unitCost, discount: line.discount, allowedDiscount: line.allowedDiscount })) });
    const savedQuote = await tx.quote.update({ where: { id: quote.id }, data: { currentRevisionId: revision.id, orderDiscount: parsed.data.orderDiscount, total: calculation.total, taxTotal: calculation.taxTotal, totalsByCadence: asJson(calculation.totalsByCadence), margin: calculation.margin, riskScore: calculation.riskScore, version: { increment: 1 }, lastActivity: new Date() } });
    await audit(tx, req, 'QUOTE_DRAFT_SNAPSHOT_SAVED', 'Quote', quote.id, 'Saved a new immutable draft calculation snapshot.', revision.id);
    return { quote: savedQuote, revisionId: revision.id, version: savedQuote.version };
  });
  return ok(req, res, { ...updated, calculation: quoteCalculationDto({ inputs, products, policy, calculation }) });
});

app.post('/api/v1/quotations/:id/submit', authenticate, requireModule('quotations'), requireRole('REP'), requireCsrf, async (req: AuthRequest, res) => {
  const parsed = quoteSubmitSchema.safeParse(req.body);
  if (!parsed.success) return fail(req, res, 422, 'VALIDATION_ERROR', 'Submit the current saved revision with a reason.', parsed.error.flatten());
  const quote = await db.quote.findUnique({ where: { id: routeParam(req, 'id') }, include: { currentRevision: true, lines: { include: { product: true } } } });
  if (!quote || !(await canAccessInternalQuote(req.user!, quote))) return fail(req, res, 404, 'NOT_FOUND', 'Quotation not found.');
  if (quote.ownerId !== req.user!.id) return fail(req, res, 403, 'OWNER_REQUIRED', 'Only the quotation owner can submit this draft.');
  if (quote.version !== parsed.data.expectedVersion || quote.currentRevisionId !== parsed.data.revisionId) return fail(req, res, 409, 'STALE_VERSION', 'Refresh the quotation before submitting.');
  if (quote.stage !== 'DRAFT' || quote.currentRevision?.state !== 'DRAFT' || !quote.lines.length) return fail(req, res, 409, 'INVALID_STATE', 'Only a complete saved draft can be submitted.');
  const prepared = await prepareQuoteCalculation(req.user!.organizationId, quote.customerTier, quote.lines.map((line) => ({ productId: line.productId, quantity: line.quantity, discount: Number(line.discount) })), Number(quote.orderDiscount));
  const { inputs, products, policy, calculation } = prepared;
  const evaluation = evaluateRisk(calculation, policy);
  const snapshot = inputs.map((line,index) => { const product=products.find((item)=>item.id===line.productId)!; const calculated=calculation.lines[index]!; return { productId: line.productId, name:product.name, sku:product.sku, category:product.category, description:product.description, quantity: line.quantity, unitPrice: line.unitPrice.toString(), unitCost: line.unitCost.toString(), taxRate: line.taxRate.toString(), cadence: line.cadence, discount: line.discount, effectiveDiscount: calculated.effectiveDiscount, allowedDiscount: line.allowedDiscount.toString(), gross:calculated.gross, net:calculated.net, tax:calculated.tax, lineCost:calculated.lineCost, excess:calculated.excess }; });
  const result = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Quote" WHERE "id" = ${quote.id} FOR UPDATE`;
    const latest = await tx.quote.findUniqueOrThrow({ where: { id: quote.id }, include: { currentRevision: true } });
    if (latest.version !== parsed.data.expectedVersion || latest.stage !== 'DRAFT' || latest.currentRevisionId !== parsed.data.revisionId || latest.currentRevision?.state !== 'DRAFT') throw new DomainError(409, 'STALE_VERSION', 'Refresh the quotation before submitting.');
    const previous = await tx.approvalCase.findFirst({ where: { quoteId: quote.id }, orderBy: { cycle: 'desc' } });
    const cycle = (previous?.cycle ?? 0) + 1;
    await tx.quoteLine.deleteMany({ where: { quoteId: quote.id } });
    await tx.quoteLine.createMany({ data: inputs.map((line) => ({ quoteId: quote.id, productId: line.productId, quantity: line.quantity, unitPrice: line.unitPrice, unitCost: line.unitCost, discount: line.discount, allowedDiscount: line.allowedDiscount })) });
    await tx.quoteRevision.update({ where: { id: parsed.data.revisionId }, data: { state: 'SUPERSEDED' } });
    const submittedRevision = await tx.quoteRevision.create({ data: {
      quoteId: quote.id, revisionNumber: latest.currentRevision.revisionNumber + 1, state: 'SUBMITTED', currency: latest.currentRevision.currency,
      validUntil: latest.currentRevision.validUntil, promisedDeliveryAt: latest.currentRevision.promisedDeliveryAt, terms: latest.currentRevision.terms,
      orderDiscount: latest.orderDiscount, submittedById: req.user!.id, subtotal:calculation.subtotal, taxTotal:calculation.taxTotal, total:calculation.total,
      margin:calculation.margin, riskScore:calculation.riskScore, totalsByCadence:asJson(calculation.totalsByCadence), linesSnapshot:asJson(snapshot), policySnapshot:asJson(evaluation),
      termsHash:termsHash({quoteId:quote.id,sourceRevisionId:parsed.data.revisionId,submittedAt:new Date().toISOString(),snapshot,evaluation,nonce:crypto.randomUUID()}),
    } });
    const approvalCase = await openCase(tx, { quoteId: quote.id, revisionId: submittedRevision.id, policyId: policy.id, cycle, submittedById: req.user!.id, evaluation });
    const updated = await tx.quote.update({ where: { id: quote.id }, data: { currentRevisionId:submittedRevision.id, stage: evaluation.route === 'NONE' ? 'APPROVED' : 'PENDING_APPROVAL', total:calculation.total, taxTotal:calculation.taxTotal, totalsByCadence:asJson(calculation.totalsByCadence), margin:calculation.margin, riskScore:calculation.riskScore, version: { increment: 1 }, lastActivity: new Date() } });
    await audit(tx, req, 'QUOTE_SUBMITTED', 'Quote', quote.id, `${parsed.data.reason} Route: ${evaluation.route}.`, submittedRevision.id);
    return { quotation: updated, approvalCase };
  });
  return ok(req, res, result);
});

const approvalCaseInclude = {
  quote: { include: { team: { select: { id: true, name: true, managerId: true } }, owner: { select: { id: true, name: true } }, lines: { include: { product: { select: { id: true, name: true, category: true } } } } } },
  revision: { select: { id: true, revisionNumber: true, currency: true, submittedById: true, linesSnapshot:true, createdAt: true } },
  submittedBy: { select: { id: true, name: true } },
  steps: { include: { reviewer: { select: { id: true, name: true } } }, orderBy: { sequence: 'asc' as const } },
};

function approvalCaseDto(approvalCase:any, audits:any[] = []) {
  const risk = isRecord(approvalCase.riskSnapshot) ? approvalCase.riskSnapshot : {};
  const flags = Array.isArray(risk.flags) ? risk.flags : [];
  const components = isRecord(risk.components) ? risk.components : {};
  const currentStep = approvalCase.steps.find((step:any)=>step.state==='PENDING') ?? approvalCase.steps.find((step:any)=>step.state==='WAITING') ?? null;
  const stepDto = (step:any) => step ? { id:step.id, name:step.step, sequence:step.sequence, state:step.state, reviewer:step.reviewer, reason:step.reason, decidedAt:step.decidedAt?.toISOString()??null, createdAt:step.createdAt.toISOString() } : null;
  const managerStep = approvalCase.steps.find((step:any)=>step.step==='Sales Manager');
  const financeStep = approvalCase.route==='MANAGER_FINANCE' ? approvalCase.steps.find((step:any)=>step.step==='Finance') : null;
  const snapshotLines = Array.isArray(approvalCase.revision.linesSnapshot) ? approvalCase.revision.linesSnapshot.filter(isRecord) : [];
  return {
    id:approvalCase.id, version:approvalCase.version, state:approvalCase.state, route:approvalCase.route, revisionId:approvalCase.revisionId,
    policyId:approvalCase.policyId, createdAt:approvalCase.createdAt.toISOString(), completedAt:approvalCase.completedAt?.toISOString()??null,
    quotation:{ id:approvalCase.quote.id, number:approvalCase.quote.number, customer:approvalCase.quote.customer, customerTier:approvalCase.quote.customerTier, total:approvalCase.quote.total.toString(), currency:approvalCase.revision.currency, owner:approvalCase.quote.owner, team:approvalCase.quote.team ? {id:approvalCase.quote.team.id,name:approvalCase.quote.team.name}:null },
    submittedBy:approvalCase.submittedBy, currentStep:stepDto(currentStep), managerStep:stepDto(managerStep), ...(approvalCase.route==='MANAGER_FINANCE'?{financeStep:stepDto(financeStep)}:{}),
    risk:{ components, flags, reasons:Array.isArray(risk.reasons)?risk.reasons:[], policy:isRecord(risk.policy)?risk.policy:{} },
    lines:snapshotLines.map((line:any,index:number)=>({id:`${approvalCase.revisionId}:${index}`,productId:String(line.productId??''),product:String(line.name??'Product'),category:String(line.category??''),quantity:Number(line.quantity??0),discount:String(line.discount??0),allowedDiscount:String(line.allowedDiscount??0)})),
    steps:approvalCase.steps.map(stepDto),
    audit:audits.map((event)=>({id:event.id,action:event.action,reason:event.reason,actor:event.actor??{id:'system',name:'System'},createdAt:event.createdAt.toISOString()})),
  };
}

const approvalListQuerySchema = z.object({ state:z.enum(['PENDING','RETURNED','APPROVED']).default('PENDING') }).strict();

app.get('/api/v1/approvals', authenticate, requireModule('approvals'), requireRole('MANAGER','FINANCE'), async (req:AuthRequest,res)=>{
  const parsed=approvalListQuerySchema.safeParse(req.query);
  if(!parsed.success)return fail(req,res,422,'VALIDATION_ERROR','Select a valid approval status.',parsed.error.flatten());
  const rows=await db.approvalCase.findMany({
    where:{state:parsed.data.state,quote:{organizationId:req.user!.organizationId,...(req.user!.role==='MANAGER'?{team:{is:{managerId:req.user!.id}}}:{})},...(req.user!.role==='FINANCE'?{route:'MANAGER_FINANCE'}:{})},
    include:approvalCaseInclude,orderBy:{createdAt:'desc'},take:100,
  });
  return ok(req,res,{items:rows.map((row)=>approvalCaseDto(row))});
});

app.get('/api/v1/approvals/:id', authenticate, requireModule('approvals'), requireRole('MANAGER','FINANCE'), async (req:AuthRequest,res)=>{
  const approvalCase=await db.approvalCase.findUnique({where:{id:routeParam(req,'id')},include:approvalCaseInclude});
  if(!approvalCase||approvalCase.quote.organizationId!==req.user!.organizationId)return fail(req,res,404,'NOT_FOUND','Approval case not found.');
  if(req.user!.role==='MANAGER'&&approvalCase.quote.team?.managerId!==req.user!.id)return fail(req,res,404,'NOT_FOUND','Approval case not found.');
  if(req.user!.role==='FINANCE'&&approvalCase.route!=='MANAGER_FINANCE')return fail(req,res,404,'NOT_FOUND','Approval case not found.');
  const audits=await db.auditEvent.findMany({where:{organizationId:req.user!.organizationId,resource:'Quote',resourceId:approvalCase.quoteId,revisionId:approvalCase.revisionId},include:{actor:{select:{id:true,name:true}}},orderBy:{createdAt:'asc'}});
  return ok(req,res,approvalCaseDto(approvalCase,audits));
});

app.post('/api/v1/approvals/:id/decision', authenticate, requireModule('approvals'), requireRole('MANAGER', 'FINANCE'), requireCsrf, async (req: AuthRequest, res) => {
  const parsed = z.object({ expectedVersion:z.number().int().positive(), decision: z.enum(['APPROVE', 'RETURN', 'REJECT']), reason: z.string().trim().min(2).max(2000) }).strict().safeParse(req.body);
  if (!parsed.success) return fail(req, res, 422, 'VALIDATION_ERROR', 'A current version, decision, and reason are required.',parsed.error.flatten());
  const caseId=routeParam(req,'id');
  const result=await db.$transaction(async(tx)=>{
    const decided=await decideStep(tx,{caseId,expectedVersion:parsed.data.expectedVersion,actor:req.user!,decision:parsed.data.decision,reason:parsed.data.reason});
    if(decided.returned){
      const source=decided.sourceRevision;
      await createReturnedDraft(tx,{caseId,quoteId:decided.approvalCase.quoteId,sourceRevision:source,termsHash:termsHash({source:source.id,returnedCaseId:caseId,nonce:crypto.randomUUID()})});
    }
    await audit(tx,req,`APPROVAL_${parsed.data.decision}`,'Quote',decided.approvalCase.quoteId,parsed.data.reason,decided.approvalCase.revisionId);
    return decided.approvalCase.id;
  });
  const approvalCase=await db.approvalCase.findUniqueOrThrow({where:{id:result},include:approvalCaseInclude});
  return ok(req,res,approvalCaseDto(approvalCase));
});

app.post('/api/v1/quotations/:id/send', authenticate, requireModule('quotations'), requireRole('REP'), requireCsrf, async (req: AuthRequest, res) => {
  const parsed = sendQuotationSchema.safeParse(req.body);
  if (!parsed.success) return fail(req, res, 422, 'VALIDATION_ERROR', 'The current revision and version are required.', parsed.error.flatten());
  const quote = await db.quote.findUnique({ where: { id: routeParam(req, 'id') }, include: { currentRevision: true, customerRecord: true, approvalCases: { select: { revisionId: true, state: true } } } });
  if (!quote || !(await canAccessInternalQuote(req.user!, quote))) return fail(req, res, 404, 'NOT_FOUND', 'Quotation not found.');
  if (quote.ownerId !== req.user!.id) return fail(req, res, 403, 'OWNER_REQUIRED', 'Only the quotation owner can send it.');
  if (quote.version !== parsed.data.expectedVersion || quote.currentRevisionId !== parsed.data.revisionId) return fail(req, res, 409, 'STALE_VERSION', 'Refresh the quotation before sending it.');
  if (quote.stage !== 'APPROVED' || !quote.currentRevision || quote.currentRevision.state !== 'SUBMITTED' || !quote.approvalCases.some((item) => item.revisionId === quote.currentRevisionId && item.state === 'APPROVED')) return fail(req, res, 409, 'INVALID_STATE', 'Only the exact current approved revision can be sent.');
  const sentAt = new Date();
  const updated = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Quote" WHERE "id" = ${quote.id} FOR UPDATE`;
    const latest = await tx.quote.findUniqueOrThrow({ where: { id: quote.id }, include: { currentRevision: true, approvalCases: { select: { revisionId: true, state: true } } } });
    if (latest.version !== parsed.data.expectedVersion || latest.currentRevisionId !== parsed.data.revisionId) throw new PortalError(409, 'STALE_VERSION', 'Refresh the quotation before sending it.');
    if (latest.stage !== 'APPROVED' || latest.currentRevision?.state !== 'SUBMITTED' || !latest.approvalCases.some((item) => item.revisionId === parsed.data.revisionId && item.state === 'APPROVED')) throw new PortalError(409, 'INVALID_STATE', 'Only the exact current approved revision can be sent.');
    await tx.quoteRevision.update({ where: { id: parsed.data.revisionId }, data: { state: 'SENT', sentAt } });
    const result = await tx.quote.update({ where: { id: quote.id }, data: { sentAt, version: { increment: 1 }, lastActivity: sentAt } });
    await audit(tx, req, 'QUOTE_SENT', 'Quote', quote.id, undefined, parsed.data.revisionId);
    return result;
  });
  return ok(req, res, { quoteId: updated.id, revisionId: parsed.data.revisionId, state: 'SENT', version: updated.version, sentAt });
});

app.get('/api/v1/leads', authenticate, requireModule('quotations'), requireRole('REP', 'MANAGER'), async (req: AuthRequest, res) => {
  const parsed = leadListSchema.safeParse(req.query);
  if (!parsed.success) return fail(req, res, 422, 'VALIDATION_ERROR', 'Use a valid Lead status filter.', parsed.error.flatten());
  return ok(req, res, await listLeads(db, req.user!, parsed.data.status));
});

app.get('/api/v1/leads/:id', authenticate, requireModule('quotations'), requireRole('REP', 'MANAGER'), async (req: AuthRequest, res) => {
  return ok(req, res, await getLead(db, req.user!, routeParam(req, 'id')));
});

app.post('/api/v1/leads/:id/convert', authenticate, requireModule('quotations'), requireRole('REP'), requireCsrf, async (req: AuthRequest, res) => {
  const parsed = z.object({}).strict().safeParse(req.body ?? {});
  if (!parsed.success) return fail(req, res, 422, 'VALIDATION_ERROR', 'This action does not accept quotation ownership or pricing fields.', parsed.error.flatten());
  const result = await db.$transaction((tx) => convertLead(tx, req.user!, routeParam(req, 'id')));
  return ok(req, res, result, result.replayed ? 200 : 201);
});

app.post('/api/v1/leads/:id/dismiss', authenticate, requireModule('quotations'), requireRole('REP', 'MANAGER'), requireCsrf, async (req: AuthRequest, res) => {
  const parsed = dismissLeadSchema.safeParse(req.body);
  if (!parsed.success) return fail(req, res, 422, 'VALIDATION_ERROR', 'Provide a reason of at least five characters.', parsed.error.flatten());
  return ok(req, res, await db.$transaction((tx) => dismissLead(tx, req.user!, routeParam(req, 'id'), parsed.data.reason)));
});

app.get('/api/v1/portal/requests/catalog', authenticate, requireRole('CUSTOMER'), async (req: AuthRequest, res) => {
  return ok(req, res, await portalRequestCatalog(db, req.user!));
});

app.get('/api/v1/portal/requests', authenticate, requireRole('CUSTOMER'), async (req: AuthRequest, res) => {
  return ok(req, res, await listPortalRequests(db, req.user!));
});

app.post('/api/v1/portal/requests', authenticate, requireRole('CUSTOMER'), requireCsrf, async (req: AuthRequest, res) => {
  const parsed = portalRequestSchema.safeParse(req.body);
  if (!parsed.success) return fail(req, res, 422, 'VALIDATION_ERROR', 'Describe what you need and correct any invalid request lines.', parsed.error.flatten());
  const result = await db.$transaction((tx) => submitPortalRequest(tx, req.user!, { ...parsed.data, idempotencyKey: idempotencyKey(req.headers['idempotency-key']) }));
  return ok(req, res, result, result.replayed ? 200 : 201);
});

const portalQuotationInclude = { currentRevision: true, negotiation: { orderBy: { createdAt: 'asc' as const } }, order: { select: { id: true, number: true, state: true, revisionId: true } }, acceptance: true } satisfies Prisma.QuoteInclude;

app.get('/api/v1/portal/quotations', authenticate, requireRole('CUSTOMER'), async (req: AuthRequest, res) => {
  if (!req.user!.customerId) return fail(req, res, 403, 'FORBIDDEN', 'This portal account is not linked to a customer.');
  const quotes = await db.quote.findMany({ where: { organizationId: req.user!.organizationId, customerId: req.user!.customerId, sentAt: { not: null } }, include: portalQuotationInclude, orderBy: { lastActivity: 'desc' } });
  return ok(req, res, { items: quotes.map(customerSafeQuotationDto) });
});

app.get('/api/v1/portal/quotations/:id', authenticate, requireRole('CUSTOMER'), async (req: AuthRequest, res) => {
  const quote = await db.quote.findFirst({ where: { id: routeParam(req, 'id'), organizationId: req.user!.organizationId, customerId: req.user!.customerId ?? '__none__', sentAt: { not: null } }, include: portalQuotationInclude });
  if (!quote) return fail(req, res, 404, 'NOT_FOUND', 'Quotation not found.');
  return ok(req, res, customerSafeQuotationDto(quote));
});

app.post('/api/v1/portal/quotations/:id/comment', authenticate, requireRole('CUSTOMER'), requireCsrf, async (req: AuthRequest, res) => {
  const parsed = portalCommentSchema.safeParse(req.body);
  if (!parsed.success) return fail(req, res, 422, 'VALIDATION_ERROR', 'Enter a valid customer message.', parsed.error.flatten());
  const quote = await db.quote.findFirst({ where: { id: routeParam(req, 'id'), organizationId: req.user!.organizationId, customerId: req.user!.customerId ?? '__none__', sentAt: { not: null } }, include: { currentRevision: true } });
  if (!quote || quote.currentRevisionId !== parsed.data.revisionId || quote.currentRevision?.state !== 'SENT') return fail(req, res, 404, 'NOT_FOUND', 'Quotation not found.');
  const negotiation = await db.$transaction(async (tx) => {
    const record = await tx.negotiation.create({ data: { quoteId: quote.id, revisionId: parsed.data.revisionId, author: req.user!.name, message: parsed.data.message, messageType: parsed.data.type, requestedDeliveryAt: parsed.data.requestedDeliveryAt ? new Date(parsed.data.requestedDeliveryAt) : null, kind: 'COMMENT' } });
    await tx.quote.update({ where: { id: quote.id }, data: { lastActivity: new Date() } });
    await audit(tx, req, 'CUSTOMER_COMMENTED', 'Quote', quote.id, parsed.data.message, parsed.data.revisionId);
    return record;
  });
  return ok(req, res, negotiation, 201);
});

app.post('/api/v1/portal/quotations/:id/proposals', authenticate, requireRole('CUSTOMER'), requireCsrf, async (req: AuthRequest, res) => {
  const parsed = portalProposalSchema.safeParse(req.body);
  if (!parsed.success) return fail(req, res, 422, 'VALIDATION_ERROR', 'Enter a valid counter proposal.', parsed.error.flatten());
  const quoteId = routeParam(req, 'id');
  const proposal = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Quote" WHERE "id" = ${quoteId} FOR UPDATE`;
    const quote = await tx.quote.findFirst({ where: { id: quoteId, organizationId: req.user!.organizationId, customerId: req.user!.customerId ?? '__none__' }, include: { currentRevision: true, order: true, negotiation: { where: { kind: 'PROPOSAL', state: 'OPEN' } } } });
    if (!quote) throw new PortalError(404, 'NOT_FOUND', 'Quotation not found.');
    requireExactSentRevision(quote, parsed.data);
    if (quote.negotiation.length) throw new PortalError(409, 'PROPOSAL_ALREADY_OPEN', 'A counter proposal is already awaiting the representative.');
    const record = await tx.negotiation.create({ data: { quoteId, revisionId: parsed.data.revisionId, author: req.user!.name, message: parsed.data.message, messageType: 'COUNTER_DISCOUNT', counterDiscount: parsed.data.counterDiscount, requestedDeliveryAt: parsed.data.requestedDeliveryAt ? new Date(parsed.data.requestedDeliveryAt) : null, kind: 'PROPOSAL' } });
    await tx.quote.update({ where: { id: quoteId }, data: { stage: 'NEGOTIATION', version: { increment: 1 }, lastActivity: new Date() } });
    await audit(tx, req, 'CUSTOMER_PROPOSED_CHANGE', 'Quote', quoteId, parsed.data.message, parsed.data.revisionId);
    return record;
  });
  return ok(req, res, proposal, 201);
});

app.post('/api/v1/quotations/:id/proposals/:proposalId/respond', authenticate, requireModule('quotations'), requireRole('REP'), requireCsrf, async (req: AuthRequest, res) => {
  const parsed = proposalResponseSchema.safeParse(req.body);
  if (!parsed.success) return fail(req, res, 422, 'VALIDATION_ERROR', 'A decision and reason are required.');
  const quote = await db.quote.findUnique({ where: { id: routeParam(req, 'id') }, include: { lines: { include: { product: true } }, currentRevision: true, approvals: true, negotiation: true, order: true } });
  if (!quote || !(await canAccessInternalQuote(req.user!, quote))) return fail(req, res, 404, 'NOT_FOUND', 'Quotation not found.');
  if (quote.ownerId !== req.user!.id) return fail(req, res, 403, 'OWNER_REQUIRED', 'Only the quotation owner can respond to commercial proposals.');
  if (quote.version !== parsed.data.expectedVersion) return fail(req, res, 409, 'STALE_VERSION', 'Refresh the quotation before responding.');
  const proposal = await db.negotiation.findFirst({ where: { id: routeParam(req, 'proposalId'), quoteId: quote.id, revisionId: quote.currentRevisionId ?? '__none__', kind: 'PROPOSAL', state: 'OPEN' } });
  if (!proposal) return fail(req, res, 409, 'INVALID_STATE', 'This proposal is no longer open.');
  if (parsed.data.decision === 'DECLINE') {
    const declined = await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Quote" WHERE "id" = ${quote.id} FOR UPDATE`;
      const latest = await tx.quote.findUniqueOrThrow({ where: { id: quote.id }, include: { currentRevision: true } });
      if (latest.version !== parsed.data.expectedVersion || latest.stage !== 'NEGOTIATION' || latest.currentRevisionId !== proposal.revisionId || latest.currentRevision?.state !== 'SENT') throw new PortalError(409, 'STALE_VERSION', 'Refresh the quotation before responding.');
      const record = await tx.negotiation.update({ where: { id: proposal.id }, data: { state: 'DECLINED', respondedById: req.user!.id, responseReason: parsed.data.reason, respondedAt: new Date() } });
      const restored = await tx.quote.update({ where: { id: quote.id }, data: { stage: 'APPROVED', version: { increment: 1 }, lastActivity: new Date() } });
      await audit(tx, req, 'CUSTOMER_PROPOSAL_DECLINED', 'Quote', quote.id, parsed.data.reason, proposal.revisionId);
      return { proposal: record, quotation: restored, restoredRevisionId: proposal.revisionId, customerState: 'SENT' };
    });
    return ok(req, res, declined);
  }
  const proposedDiscount = proposal.counterDiscount;
  if (proposedDiscount === null) return fail(req, res, 422, 'CONFIGURATION_REQUIRED', 'The proposal cannot be calculated.');
  const prepared = await prepareQuoteCalculation(req.user!.organizationId, quote.customerTier, quote.lines.map((line) => ({ productId: line.productId, quantity: line.quantity, discount: Number(line.discount) })), Number(proposedDiscount));
  const { inputs, products, policy, calculation } = prepared;
  const evaluation = evaluateRisk(calculation, policy);
  const snapshot = inputs.map((line,index) => { const product=products.find((item)=>item.id===line.productId)!; const calculated=calculation.lines[index]!; return { productId: line.productId, name:product.name, sku:product.sku, category:product.category, description:product.description, quantity:line.quantity, unitPrice:line.unitPrice.toString(), unitCost:line.unitCost.toString(), taxRate:line.taxRate.toString(), cadence:line.cadence, discount:line.discount, effectiveDiscount:calculated.effectiveDiscount, allowedDiscount:line.allowedDiscount.toString(), gross:calculated.gross, net:calculated.net, tax:calculated.tax, lineCost:calculated.lineCost, excess:calculated.excess }; });
  const adopted = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Quote" WHERE "id" = ${quote.id} FOR UPDATE`;
    const current = await tx.quote.findUniqueOrThrow({ where: { id: quote.id }, include: { currentRevision: true } });
    const openProposal = await tx.negotiation.findFirst({ where: { id: proposal.id, quoteId: quote.id, revisionId: proposal.revisionId, kind: 'PROPOSAL', state: 'OPEN' } });
    if (current.version !== parsed.data.expectedVersion || current.stage !== 'NEGOTIATION' || current.currentRevisionId !== proposal.revisionId || current.currentRevision?.state !== 'SENT' || !openProposal) throw new PortalError(409, 'STALE_VERSION', 'Refresh the quotation before responding.');
    await tx.quoteRevision.update({ where: { id: proposal.revisionId }, data: { state: 'SUPERSEDED' } });
    const latest = await tx.quoteRevision.findFirst({ where: { quoteId: quote.id }, orderBy: { revisionNumber: 'desc' } });
    const revision = await tx.quoteRevision.create({ data: { quoteId: quote.id, revisionNumber: (latest?.revisionNumber ?? 0) + 1, state: 'DRAFT', currency:current.currentRevision!.currency, validUntil:current.currentRevision!.validUntil, promisedDeliveryAt:proposal.requestedDeliveryAt ?? current.currentRevision!.promisedDeliveryAt, terms:current.currentRevision!.terms, orderDiscount:proposedDiscount, subtotal:calculation.subtotal, taxTotal:calculation.taxTotal, total:calculation.total, margin:calculation.margin, riskScore:calculation.riskScore, totalsByCadence:asJson(calculation.totalsByCadence), linesSnapshot:asJson(snapshot), policySnapshot:asJson(evaluation), termsHash:termsHash({ source:proposal.revisionId, proposalId:proposal.id, counterDiscount:proposedDiscount.toString(), snapshot, calculation }) } });
    await tx.quoteLine.deleteMany({ where: { quoteId: quote.id } });
    await tx.quoteLine.createMany({ data: inputs.map((line) => ({ quoteId: quote.id, productId: line.productId, quantity: line.quantity, unitPrice: line.unitPrice, unitCost: line.unitCost, discount: line.discount, allowedDiscount: line.allowedDiscount })) });
    const updated = await tx.quote.update({ where: { id: quote.id }, data: { currentRevisionId: revision.id, stage: 'DRAFT', sentAt: null, orderDiscount: proposedDiscount, total: calculation.total, taxTotal: calculation.taxTotal, totalsByCadence: asJson(calculation.totalsByCadence), margin: calculation.margin, riskScore: calculation.riskScore, version: { increment: 1 }, lastActivity: new Date() } });
    const record = await tx.negotiation.update({ where: { id: proposal.id }, data: { state: 'ADOPTED', respondedById:req.user!.id, responseReason:parsed.data.reason, respondedAt:new Date(), adoptedRevisionId:revision.id } });
    await audit(tx, req, 'CUSTOMER_PROPOSAL_ADOPTED', 'Quote', quote.id, parsed.data.reason, revision.id);
    return { proposal: record, quotation: updated, revision, calculation: quoteCalculationDto(prepared), governanceRestarted: true };
  });
  return ok(req, res, adopted);
});

const acceptPortalQuotation = async (req: AuthRequest, res: Response) => {
  const parsed = portalAcceptSchema.safeParse(req.body);
  if (!parsed.success) return fail(req, res, 422, 'VALIDATION_ERROR', 'The exact quotation revision, version, and terms hash are required.', parsed.error.flatten());
  if (!req.user!.customerId) return fail(req, res, 403, 'FORBIDDEN', 'This portal account is not linked to a customer.');
  const result = await db.$transaction((tx) => confirmEligibleRevision(tx, { actorId:req.user!.id, organizationId:req.user!.organizationId, customerId:req.user!.customerId!, quoteId:routeParam(req,'id'), ...parsed.data, idempotencyKey:idempotencyKey(req.headers['idempotency-key']), requestId:req.requestId }));
  return ok(req, res, result, result.replayed ? 200 : 201);
};
app.post('/api/v1/portal/quotations/:id/accept', authenticate, requireRole('CUSTOMER'), requireCsrf, acceptPortalQuotation);
app.post('/api/v1/portal/quotations/:id/confirm', authenticate, requireRole('CUSTOMER'), requireCsrf, acceptPortalQuotation);

app.get('/api/v1/warehouses/stock', authenticate, requireModule('fulfillment'), requireRole('REP', 'MANAGER', 'FINANCE', 'ADMIN'), async (req: AuthRequest, res) => {
  const warehouses = await db.warehouse.findMany({ where: { organizationId: req.user!.organizationId, active: true }, include: { stocks: { include: { product: true } } }, orderBy: [{ priority: 'asc' }, { id: 'asc' }] });
  return ok(req, res, warehouses.map((warehouse) => ({ ...warehouse, stocks: warehouse.stocks.map((stock) => ({ ...stock, available: stock.onHand - stock.reserved })) })));
});

app.get('/api/v1/warehouses', authenticate, requireModule('fulfillment'), requireRole('REP', 'MANAGER', 'FINANCE', 'ADMIN'), async (req: AuthRequest, res) => {
  const warehouses = await db.warehouse.findMany({ where: { organizationId: req.user!.organizationId, active: true }, include: { stocks: { include: { product: true } } }, orderBy: [{ priority: 'asc' }, { id: 'asc' }] });
  return ok(req, res, warehouses.map((warehouse) => ({ ...warehouse, stocks: warehouse.stocks.map((stock) => ({ ...stock, available: stock.onHand - stock.reserved })) })));
});

app.get('/api/v1/fulfillment/:orderId/preview', authenticate, requireModule('fulfillment'), requireRole('REP', 'MANAGER', 'FINANCE', 'ADMIN'), async (req: AuthRequest, res) => {
  const result = await previewSplit(db, { organizationId: req.user!.organizationId, orderId: routeParam(req, 'orderId'), quoteScope: quotationRecordScope(req.user!) });
  return ok(req, res, result);
});

app.post('/api/v1/fulfillment/:orderId/reserve', authenticate, requireModule('fulfillment'), requireRole('FINANCE', 'ADMIN'), requireCsrf, async (req: AuthRequest, res) => {
  const parsed = reserveStockSchema.safeParse(req.body);
  if (!parsed.success) return fail(req, res, 422, 'VALIDATION_ERROR', 'Choose a valid split; manual overrides require a reason.', parsed.error.flatten());
  const result = await db.$transaction((tx) => reserveStock(tx, { ...parsed.data, organizationId: req.user!.organizationId, actorId: req.user!.id, orderId: routeParam(req, 'orderId'), idempotencyKey: idempotencyKey(req.headers['idempotency-key']), requestId: req.requestId }));
  return ok(req, res, result, result.replayed ? 200 : 201);
});

app.post('/api/v1/fulfillment/:orderId/receive', authenticate, requireModule('fulfillment'), requireRole('FINANCE', 'ADMIN'), requireCsrf, async (req: AuthRequest, res) => {
  const parsed = receiveStockSchema.safeParse(req.body);
  if (!parsed.success) return fail(req, res, 422, 'VALIDATION_ERROR', 'Choose a warehouse and hardware product, enter a positive receipt, and provide a reason.', parsed.error.flatten());
  const result = await db.$transaction((tx) => receiveStock(tx, { ...parsed.data, organizationId: req.user!.organizationId, actorId: req.user!.id, orderId: routeParam(req, 'orderId'), idempotencyKey: idempotencyKey(req.headers['idempotency-key']), requestId: req.requestId }));
  return ok(req, res, result, result.replayed ? 200 : 201);
});

app.post('/api/v1/fulfillment/:orderId/consolidate', authenticate, requireModule('fulfillment'), requireRole('FINANCE', 'ADMIN'), requireCsrf, async (req: AuthRequest, res) => {
  const parsed = consolidateSchema.safeParse(req.body);
  if (!parsed.success) return fail(req, res, 422, 'VALIDATION_ERROR', 'Provide a reason for consolidating the backorder.', parsed.error.flatten());
  const result = await db.$transaction((tx) => consolidateBackorder(tx, { ...parsed.data, organizationId: req.user!.organizationId, actorId: req.user!.id, orderId: routeParam(req, 'orderId'), idempotencyKey: idempotencyKey(req.headers['idempotency-key']), requestId: req.requestId }));
  return ok(req, res, result);
});

const retiredQuoteFulfillmentRoute = (req: AuthRequest, res: Response) => fail(req, res, 410, 'ORDER_ID_REQUIRED', 'This legacy fulfillment write has been retired. Refresh and use the confirmed order ID.');
app.post('/api/v1/warehouses/:id/restock', authenticate, requireModule('fulfillment'), requireRole('FINANCE', 'ADMIN'), requireCsrf, retiredQuoteFulfillmentRoute);
app.post('/api/v1/fulfillment/:quoteId/allocate', authenticate, requireModule('fulfillment'), requireRole('FINANCE', 'ADMIN'), requireCsrf, retiredQuoteFulfillmentRoute);
app.post('/api/v1/fulfillment/:quoteId/allocate-manual', authenticate, requireModule('fulfillment'), requireRole('FINANCE', 'ADMIN'), requireCsrf, retiredQuoteFulfillmentRoute);
app.post('/api/v1/fulfillment/:quoteId/consolidate-backorder', authenticate, requireModule('fulfillment'), requireRole('FINANCE', 'ADMIN'), requireCsrf, retiredQuoteFulfillmentRoute);

app.patch('/api/v1/warehouses/:id', authenticate, requireModule('fulfillment'), requireRole('ADMIN'), requireCsrf, async (req: AuthRequest, res) => {
  const parsed = z.object({ name: z.string().trim().min(2).max(120).optional(), priority: z.number().int().min(1).max(10_000).optional(), shippingCost: z.number().nonnegative().max(1_000_000).optional(), active: z.boolean().optional(), reason: z.string().trim().min(5).max(240) }).strict().refine((value) => value.name !== undefined || value.priority !== undefined || value.shippingCost !== undefined || value.active !== undefined, 'Choose a warehouse field to update.').safeParse(req.body);
  if (!parsed.success) return fail(req, res, 422, 'VALIDATION_ERROR', 'Enter valid warehouse settings and a reason.', parsed.error.flatten());
  const warehouse = await db.warehouse.findFirst({ where: { id: routeParam(req, 'id'), organizationId: req.user!.organizationId } });
  if (!warehouse) return fail(req, res, 404, 'NOT_FOUND', 'Warehouse not found.');
  const { reason, ...changes } = parsed.data;
  const updated = await db.$transaction(async (tx) => { const result = await tx.warehouse.update({ where: { id: warehouse.id }, data: changes }); await audit(tx, req, 'WAREHOUSE_UPDATED', 'Warehouse', result.id, reason); return result; });
  return ok(req, res, updated);
});

app.get('/api/v1/fulfillment', authenticate, requireModule('fulfillment'), requireRole('REP', 'MANAGER', 'FINANCE', 'ADMIN'), async (req: AuthRequest, res) => {
  const quotes = await db.quote.findMany({ where: { ...internalQuoteWhere(req.user!), stage: 'CONFIRMED', order: { is: { state: { notIn: ['FULFILLED', 'CANCELLED'] } } }, lines: { some: { product: { category: 'Hardware', recurring: false } } } }, include: { order: true, fulfillment: true }, orderBy: { updatedAt: 'desc' } });
  return ok(req, res, quotes.map((quote) => { const split = quote.fulfillment ? parseFulfillmentSplit(quote.fulfillment.split) : { split: [], backorders: [] }; return { quoteId: quote.id, orderId: quote.order?.id, orderNumber: quote.order?.number ?? quote.number, quoteNumber: quote.number, customer: quote.customer, status: quote.fulfillment?.state ?? 'SPLIT_PENDING', warehouses: [...new Set(split.split.map((row) => row.warehouseName))] }; }));
});

app.get('/api/v1/invoices/:id/pdf', authenticate, async (req: AuthRequest, res) => {
  const portal = req.user!.role === 'CUSTOMER';
  if (!portal && !hasModule(req.user, 'invoices')) return fail(req, res, 403, 'FORBIDDEN', 'The invoices module is not enabled for your account.');
  const invoice = await db.invoice.findFirst({
    where: { id: routeParam(req, 'id'), organizationId: req.user!.organizationId, ...(portal ? { customerId: req.user!.customerId ?? '__none__' } : {}) },
    include: { organization: { select: { name: true } } },
  });
  if (!invoice) return fail(req, res, 404, 'NOT_FOUND', 'Invoice not found.');
  const pdf = buildInvoicePdf(invoice, invoice.organization.name);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${invoice.number.replace(/[^a-zA-Z0-9_-]/g, '-')}.pdf"`);
  res.setHeader('Cache-Control', 'private, no-store');
  return res.status(200).send(pdf);
});

app.get('/api/v1/payments/config', authenticate, requireRole('CUSTOMER'), (req: AuthRequest, res) => {
  const config = razorpayConfiguration();
  return ok(req, res, { enabled: config.enabled, testMode: true, provider: 'RAZORPAY' });
});

app.post('/api/v1/payments/orders', authenticate, requireRole('CUSTOMER'), requireCsrf, async (req: AuthRequest, res) => {
  const parsed = z.object({ invoiceId: z.string().uuid() }).strict().safeParse(req.body);
  if (!parsed.success) return fail(req, res, 422, 'VALIDATION_ERROR', 'Select a valid invoice to pay.');
  const config = razorpayConfiguration();
  if (!config.enabled) return fail(req, res, 503, 'RAZORPAY_NOT_CONFIGURED', 'Razorpay Test Mode is not configured on the server.');
  const result = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Invoice" WHERE "id" = ${parsed.data.invoiceId} FOR UPDATE`;
    const invoice = await tx.invoice.findFirst({
      where: { id: parsed.data.invoiceId, organizationId: req.user!.organizationId, customerId: req.user!.customerId ?? '__none__' },
      include: { customerRecord: { select: { currency: true, email: true, phone: true, countryCode: true, contactPerson: true } } },
    });
    if (!invoice) throw new DomainError(404, 'NOT_FOUND', 'Invoice not found.');
    const outstanding = invoice.amount.minus(invoice.paidAmount);
    if (invoice.state === 'PAID' || outstanding.lessThanOrEqualTo(0)) throw new DomainError(409, 'INVOICE_ALREADY_PAID', 'This invoice is already paid.');
    if (invoice.customerRecord.currency.toUpperCase() !== 'INR') throw new DomainError(422, 'UNSUPPORTED_CURRENCY', 'Razorpay checkout currently supports INR invoices only.');
    const reusable = await tx.payment.findFirst({
      where: { invoiceId: invoice.id, organizationId: req.user!.organizationId, provider: 'RAZORPAY', status: 'CREATED', amount: outstanding, razorpayOrderId: { not: null } },
      orderBy: { createdAt: 'desc' },
    });
    if (reusable) return { payment: reusable, invoice, amountPaise: rupeesToPaise(outstanding.toFixed(2)) };
    const amountPaise = rupeesToPaise(outstanding.toFixed(2));
    let order: { id: string };
    try {
      order = await createRazorpayClient(config).orders.create({
        amount: amountPaise,
        currency: 'INR',
        receipt: `inv_${invoice.number}_${invoice.id.slice(0, 8)}`.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40),
        notes: { invoiceId: invoice.id, organizationId: invoice.organizationId, customerId: invoice.customerId },
      });
    } catch {
      throw new DomainError(502, 'RAZORPAY_ORDER_FAILED', 'Razorpay could not create a checkout order. Please try again.');
    }
    const payment = await tx.payment.create({
      data: {
        organizationId: invoice.organizationId, invoiceId: invoice.id, amount: outstanding, currency: 'INR',
        reference: `RAZORPAY:${order.id}`, provider: 'RAZORPAY', status: 'CREATED', razorpayOrderId: order.id,
      },
    });
    await audit(tx, req, 'RAZORPAY_ORDER_CREATED', 'Invoice', invoice.id, order.id);
    return { payment, invoice, amountPaise };
  });
  const contact = result.invoice.customerRecord;
  return ok(req, res, {
    paymentRecordId: result.payment.id,
    orderId: result.payment.razorpayOrderId,
    amount: result.amountPaise,
    amountRupees: result.payment.amount,
    currency: 'INR',
    keyId: config.keyId,
    testMode: true,
    invoice: { id: result.invoice.id, number: result.invoice.number, customer: result.invoice.customer },
    prefill: {
      name: contact.contactPerson ?? result.invoice.customer,
      email: contact.email ?? req.user!.email,
      contact: contact.phone ? `${contact.countryCode}${contact.phone}`.replace(/\s+/g, '') : '',
    },
  }, 201);
});

app.post('/api/v1/payments/verify', authenticate, requireRole('CUSTOMER'), requireCsrf, async (req: AuthRequest, res) => {
  const parsed = z.object({
    paymentRecordId: z.string().uuid(),
    razorpayOrderId: z.string().trim().min(4).max(100),
    razorpayPaymentId: z.string().trim().min(4).max(100),
    razorpaySignature: z.string().regex(/^[a-f0-9]{64}$/i),
  }).strict().safeParse(req.body);
  if (!parsed.success) return fail(req, res, 422, 'VALIDATION_ERROR', 'Razorpay returned an incomplete payment response.');
  const config = razorpayConfiguration();
  if (!config.enabled) return fail(req, res, 503, 'RAZORPAY_NOT_CONFIGURED', 'Razorpay Test Mode is not configured on the server.');
  const payment = await db.payment.findFirst({
    where: { id: parsed.data.paymentRecordId, organizationId: req.user!.organizationId, invoice: { customerId: req.user!.customerId ?? '__none__' } },
  });
  if (!payment) return fail(req, res, 404, 'PAYMENT_NOT_FOUND', 'Payment attempt not found.');
  if (payment.razorpayOrderId !== parsed.data.razorpayOrderId) return fail(req, res, 409, 'PAYMENT_ORDER_MISMATCH', 'The Razorpay order does not match this invoice.');
  if (!verifyCheckoutSignature(payment.razorpayOrderId, parsed.data.razorpayPaymentId, parsed.data.razorpaySignature, config.keySecret)) {
    await db.$transaction(async (tx) => { await audit(tx, req, 'RAZORPAY_SIGNATURE_REJECTED', 'Invoice', payment.invoiceId, payment.razorpayOrderId ?? undefined); });
    return fail(req, res, 400, 'PAYMENT_SIGNATURE_INVALID', 'Razorpay could not verify this payment. The invoice was not marked paid.');
  }
  const result = await db.$transaction(async (tx) => {
    const settled = await settleRazorpayPayment(tx, payment.id, parsed.data.razorpayPaymentId, parsed.data.razorpaySignature);
    await audit(tx, req, 'RAZORPAY_PAYMENT_VERIFIED', 'Invoice', payment.invoiceId, parsed.data.razorpayPaymentId);
    return settled;
  });
  return ok(req, res, { payment: paymentDto(result.payment), invoice: portalInvoiceDto({ ...result.invoice, payments: [result.payment] }) });
});

app.post('/api/v1/payments/failure', authenticate, requireRole('CUSTOMER'), requireCsrf, async (req: AuthRequest, res) => {
  const parsed = z.object({
    paymentRecordId: z.string().uuid(), razorpayOrderId: z.string().trim().min(4).max(100),
    code: z.union([z.string(), z.number()]).optional(), message: z.string().trim().max(500).optional(),
  }).strict().safeParse(req.body);
  if (!parsed.success) return fail(req, res, 422, 'VALIDATION_ERROR', 'The failed payment response is invalid.');
  const payment = await db.payment.findFirst({ where: { id: parsed.data.paymentRecordId, organizationId: req.user!.organizationId, invoice: { customerId: req.user!.customerId ?? '__none__' } } });
  if (!payment) return fail(req, res, 404, 'PAYMENT_NOT_FOUND', 'Payment attempt not found.');
  if (payment.razorpayOrderId !== parsed.data.razorpayOrderId) return fail(req, res, 409, 'PAYMENT_ORDER_MISMATCH', 'The Razorpay order does not match this invoice.');
  const updated = payment.status === 'SUCCESS' ? payment : await db.$transaction(async (tx) => {
    const failed = await tx.payment.update({ where: { id: payment.id }, data: { status: 'FAILED', failureCode: String(parsed.data.code ?? 'CHECKOUT_CANCELLED').slice(0, 120), failureDescription: parsed.data.message ?? 'The customer closed checkout or Razorpay reported a failure.' } });
    await audit(tx, req, 'RAZORPAY_CHECKOUT_FAILED', 'Invoice', payment.invoiceId, failed.failureCode ?? undefined);
    return failed;
  });
  return ok(req, res, { payment: paymentDto(updated) });
});

app.get('/api/v1/payments/:id', authenticate, async (req: AuthRequest, res) => {
  const portal = req.user!.role === 'CUSTOMER';
  if (!portal && !hasModule(req.user, 'invoices')) return fail(req, res, 403, 'FORBIDDEN', 'The invoices module is not enabled for your account.');
  const payment = await db.payment.findFirst({
    where: { id: routeParam(req, 'id'), organizationId: req.user!.organizationId, ...(portal ? { invoice: { customerId: req.user!.customerId ?? '__none__' } } : {}) },
  });
  if (!payment) return fail(req, res, 404, 'PAYMENT_NOT_FOUND', 'Payment not found.');
  return ok(req, res, paymentDto(payment));
});

app.get('/api/v1/invoices/:id/payments', authenticate, async (req: AuthRequest, res) => {
  const portal = req.user!.role === 'CUSTOMER';
  if (!portal && !hasModule(req.user, 'invoices')) return fail(req, res, 403, 'FORBIDDEN', 'The invoices module is not enabled for your account.');
  const invoice = await db.invoice.findFirst({
    where: { id: routeParam(req, 'id'), organizationId: req.user!.organizationId, ...(portal ? { customerId: req.user!.customerId ?? '__none__' } : {}) },
    select: {
      id: true, number: true, state: true, amount: true, paidAmount: true,
      payments: { select: { id: true, invoiceId: true, amount: true, currency: true, reference: true, provider: true, status: true, razorpayOrderId: true, razorpayPaymentId: true, failureCode: true, failureDescription: true, verifiedAt: true, paidAt: true, createdAt: true }, orderBy: { createdAt: 'desc' } },
    },
  });
  if (!invoice) return fail(req, res, 404, 'NOT_FOUND', 'Invoice not found.');
  return ok(req, res, { invoice: { id: invoice.id, number: invoice.number, state: invoice.state, amount: invoice.amount, paidAmount: invoice.paidAmount }, payments: invoice.payments.map(paymentDto) });
});

app.post('/api/v1/portal/invoices/:id/request-change', authenticate, requireRole('CUSTOMER'), requireCsrf, async (req: AuthRequest, res) => {
  const parsed = z.object({ requestedDate: z.string().date(), message: z.string().trim().min(2).max(1000) }).strict().safeParse(req.body);
  if (!parsed.success) return fail(req, res, 422, 'VALIDATION_ERROR', 'Enter a requested date and message.', parsed.error.flatten());
  const note = await db.$transaction((tx) => requestInvoiceDueDateChange(tx, { organizationId: req.user!.organizationId, customerId: req.user!.customerId ?? '__none__', actorId: req.user!.id, invoiceId: routeParam(req, 'id'), requestedDueAt: new Date(`${parsed.data.requestedDate}T12:00:00.000Z`), message: parsed.data.message, requestId: req.requestId }));
  return ok(req, res, { requested: true, noteId: note.id }, 201);
});

app.get('/api/v1/fulfillment/:orderId', authenticate, requireModule('fulfillment'), requireRole('REP', 'MANAGER', 'FINANCE', 'ADMIN'), async (req: AuthRequest, res) => {
  const result = await previewSplit(db, { organizationId: req.user!.organizationId, orderId: routeParam(req, 'orderId'), quoteScope: quotationRecordScope(req.user!) });
  return ok(req, res, result);
});

app.post('/api/v1/subscriptions/:id/change', authenticate, requireModule('subscriptions'), requireRole('ADMIN'), requireCsrf, async (req: AuthRequest, res) => {
  const parsed = z.object({ expectedVersion: z.number().int().positive(), amount: z.number().positive().optional(), action: z.enum(['PAUSE', 'RESUME', 'CANCEL']).optional(), effectiveAt: z.string().date().optional(), reason: z.string().trim().min(5).max(240) }).strict().refine((value) => (value.amount === undefined) !== (value.action === undefined), 'Choose exactly one amount or lifecycle action.').safeParse(req.body);
  if (!parsed.success) return fail(req, res, 422, 'VALIDATION_ERROR', 'Enter a valid subscription change and reason.', parsed.error.flatten());
  const effectiveAt = parsed.data.effectiveAt ? new Date(`${parsed.data.effectiveAt}T12:00:00.000Z`) : new Date();
  const subscription = await db.$transaction((tx) => changeSubscription(tx, { organizationId: req.user!.organizationId, actorId: req.user!.id, subscriptionId: routeParam(req, 'id'), expectedVersion: parsed.data.expectedVersion, amount: parsed.data.amount, action: parsed.data.action, reason: parsed.data.reason, effectiveAt, requestId: req.requestId }));
  return ok(req, res, { ...subscription, schedule: billingSchedule(subscription.nextBillAt, subscription.cadence) });
});

app.post('/api/v1/orders/:id/invoices', authenticate, requireModule('invoices'), requireRole('FINANCE', 'ADMIN'), requireCsrf, async (req: AuthRequest, res) => {
  const parsed = z.object({ kind: z.literal('ONE_TIME').default('ONE_TIME'), dueAt: z.string().datetime().or(z.string().date()) }).strict().safeParse(req.body);
  if (!parsed.success) return fail(req, res, 422, 'VALIDATION_ERROR', 'Choose an eligible billing type and due date.', parsed.error.flatten());
  const orderId = routeParam(req, 'id');
  const dueAt = new Date(parsed.data.dueAt);
  if (Number.isNaN(dueAt.getTime())) return fail(req, res, 422, 'VALIDATION_ERROR', 'Enter a valid due date.');
  const invoice = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${orderId} FOR UPDATE`;
    const order = await tx.order.findFirst({ where: { id: orderId, quote: { organizationId: req.user!.organizationId } }, include: { quote: true, customer: true, lines: true, invoices: { include: { payments: true, customerRecord: true, quote: { select: { id: true, number: true, stage: true } }, order: { include: { fulfillment: true } } } } } });
    if (!order) throw new DomainError(404, 'NOT_FOUND', 'Confirmed order not found.');
    if (!['CONFIRMED', 'PARTIALLY_FULFILLED', 'FULFILLED'].includes(order.state)) throw new DomainError(409, 'INVALID_STATE', 'Only an active confirmed order can be invoiced.');
    const existing = order.invoices[0];
    if (existing) return existing;
    const oneTimeLines = order.lines.filter((line) => !line.recurring);
    if (!oneTimeLines.length) throw new DomainError(422, 'NO_ELIGIBLE_CHARGES', 'This order has no unbilled one-time charges. Recurring charges come from the billing schedule.');
    const inputs = oneTimeLines.map((line) => {
      const snapshot = isRecord(line.snapshot) ? line.snapshot : {};
      return {
        quantity: line.quantity,
        unitPrice: numeric(snapshot.unitPrice),
        unitCost: numeric(snapshot.unitCost),
        discount: numeric(snapshot.discount),
        allowedDiscount: numeric(snapshot.discount),
        taxRate: numeric(snapshot.taxRate),
        cadence: 'One-time',
      };
    });
    const orderDiscount = numeric(isRecord(oneTimeLines[0]?.snapshot) ? oneTimeLines[0]!.snapshot.orderDiscount : 0);
    const calculation = calculateQuote(inputs, orderDiscount);
    const lines = calculation.lines.map((line, index) => {
      const source = oneTimeLines[index]!;
      const snapshot = isRecord(source.snapshot) ? source.snapshot : {};
      return { description: String(snapshot.description ?? 'Order charge'), productId: source.productId, cadence: 'One-time', quantity: line.quantity, unitPrice: line.unitPrice, discount: line.discount, net: line.net, tax: line.tax, amount: line.net + line.tax };
    });
    const created = await tx.invoice.create({ data: { organizationId: req.user!.organizationId, number: `INV-${order.number.replace(/^SO-/, '')}`, billingKey: `ORDER_MANUAL:${order.id}`, quoteId: order.quoteId, orderId: order.id, customer: order.customer.name, customerId: order.customerId, currency: order.currency, amount: calculation.total, dueAt, lines: asJson(lines) }, include: { payments: true, customerRecord: true, notes: true, quote: { select: { id: true, number: true, stage: true } }, order: { include: { fulfillment: true } } } });
    await audit(tx, req, 'INVOICE_ISSUED', 'Invoice', created.id, `Issued from ${order.number}`, order.revisionId);
    return created;
  });
  return ok(req, res, internalInvoiceDto(invoice), 201);
});

app.post('/api/v1/invoices', authenticate, requireModule('invoices'), requireRole('FINANCE', 'ADMIN'), requireCsrf, async (req: AuthRequest, res) => {
  const parsed = z.object({
    quoteId: z.string().min(1).optional(),
    customerId: z.string().min(1).optional(),
    dueAt: z.string().datetime().or(z.string().date()),
    lines: z.array(z.object({ productId: z.string().min(1), quantity: z.number().int().positive(), discount: z.number().min(0).max(100).default(0) }).strict()).min(1).max(100),
    sendReceipt: z.boolean().default(false),
    gstMode: z.enum(['CATALOG', 'EXCLUSIVE', 'INCLUSIVE']).default('CATALOG'),
    gstRate: z.number().min(0).max(100).optional(),
  }).strict().safeParse(req.body);
  if (!parsed.success) return fail(req, res, 422, 'VALIDATION_ERROR', 'Select a customer or quotation, due date, and invoice lines.', parsed.error.flatten());
  const customer = parsed.data.customerId ? await db.customer.findFirst({ where: { id: parsed.data.customerId, organizationId: req.user!.organizationId, active: true } }) : null;
  const quote = parsed.data.quoteId ? await db.quote.findFirst({ where: { id: parsed.data.quoteId, organizationId: req.user!.organizationId }, include: { order: true } }) : null;
  if (parsed.data.quoteId && !quote) return fail(req, res, 404, 'NOT_FOUND', 'Quotation not found.');
  if (!quote && !customer) return fail(req, res, 422, 'VALIDATION_ERROR', 'Select an active customer.');
  const productIds = [...new Set(parsed.data.lines.map((line) => line.productId))];
  const products = await db.product.findMany({ where: { id: { in: productIds }, organizationId: req.user!.organizationId, active: true } });
  if (products.length !== productIds.length) return fail(req, res, 422, 'CONFIGURATION_REQUIRED', 'One or more products are unavailable.');
  const inputLines = parsed.data.lines.map((line) => {
    const product = products.find((item) => item.id === line.productId)!;
    const taxRate = parsed.data.gstMode === 'CATALOG' ? product.taxRate : new Prisma.Decimal(parsed.data.gstRate ?? 18);
    const unitPrice = parsed.data.gstMode === 'INCLUSIVE'
      ? product.price.div(new Prisma.Decimal(1).add(taxRate.div(100)))
      : product.price;
    return { ...line, unitPrice, unitCost: product.cost, allowedDiscount: line.discount, taxRate, cadence: product.recurring ? product.cadence : 'One-time' };
  });
  const calculation = calculateQuote(inputLines, 0);
  const invoiceLines = calculation.lines.map((line, index) => {
    const product = products.find((item) => item.id === parsed.data.lines[index]!.productId)!;
    return { description: `${product.name} x ${line.quantity}`, productId: product.id, cadence: line.cadence, quantity: line.quantity, unitPrice: decimal(product.price), taxableUnitPrice: decimal(inputLines[index]!.unitPrice), discount: line.discount, gstMode: parsed.data.gstMode, gstRate: decimal(inputLines[index]!.taxRate), net: line.net, tax: line.tax, amount: line.net + line.tax };
  });
  const receiptCustomer = quote?.customerId ? await db.customer.findFirst({ where: { id: quote.customerId, organizationId: req.user!.organizationId } }) : customer;
  if (parsed.data.sendReceipt && !receiptCustomer?.email) return fail(req, res, 422, 'CUSTOMER_EMAIL_REQUIRED', 'Add a valid customer email before sending an invoice receipt.');
  const invoice = await db.$transaction(async (tx) => {
    const stockLines = parsed.data.lines
      .filter((line) => !products.find((product) => product.id === line.productId)!.recurring)
      .reduce((map, line) => map.set(line.productId, (map.get(line.productId) ?? 0) + line.quantity), new Map<string, number>());
    if (stockLines.size) {
      const stockIds = await tx.stockBalance.findMany({ where: { productId: { in: [...stockLines.keys()] }, warehouse: { organizationId: req.user!.organizationId } }, select: { id: true }, orderBy: { id: 'asc' } });
      if (stockIds.length) await tx.$queryRaw`SELECT "id" FROM "StockBalance" WHERE "id" IN (${Prisma.join(stockIds.map((item) => item.id))}) ORDER BY "id" FOR UPDATE`;
      const balances = await tx.stockBalance.findMany({ where: { id: { in: stockIds.map((item) => item.id) } }, include: { warehouse: true }, orderBy: [{ productId: 'asc' }, { warehouse: { priority: 'asc' } }] });
      for (const [productId, required] of stockLines) {
        const product = products.find((item) => item.id === productId)!;
        const productBalances = balances.filter((balance) => balance.productId === productId);
        const available = productBalances.reduce((sum, balance) => sum + Math.max(0, balance.onHand - balance.reserved), 0);
        if (required > available) throw new DomainError(422, 'INSUFFICIENT_STOCK', `${product.name} has only ${available} units available. Reduce the invoice quantity.`);
        let remaining = required;
        for (const balance of productBalances) {
          if (remaining <= 0) break;
          const take = Math.min(remaining, Math.max(0, balance.onHand - balance.reserved));
          if (!take) continue;
          const changed = await tx.stockBalance.updateMany({ where: { id: balance.id, onHand: { gte: balance.reserved + take } }, data: { onHand: { decrement: take } } });
          if (changed.count !== 1) throw new DomainError(409, 'STOCK_CHANGED', 'Stock changed while creating the invoice. Refresh and try again.');
          remaining -= take;
        }
      }
    }
    const fallbackOwner = quote ? null : await tx.customerRepresentative.findFirst({ where: { customerId: customer!.id, role: 'PRIMARY', active: true }, select: { userId: true } });
    if (!quote && (!fallbackOwner || !customer!.primarySalesTeamId)) throw new DomainError(422, 'ASSIGNMENT_REQUIRED', 'Assign this customer before creating an invoice-backed commercial record.');
    const fallbackQuote = quote ?? await tx.quote.create({ data: { organizationId: req.user!.organizationId, number: `Q-INV-${Date.now().toString().slice(-8)}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`, customer: customer!.name, customerId: customer!.id, customerTier: customer!.tier, ownerId: fallbackOwner!.userId, createdById: req.user!.id, teamId: customer!.primarySalesTeamId, stage: 'CONFIRMED', total: calculation.total, taxTotal: calculation.taxTotal, totalsByCadence: asJson(calculation.totalsByCadence), margin: calculation.margin, riskScore: 0 } });
    const created = await tx.invoice.create({ data: { organizationId: req.user!.organizationId, number: `INV-${Date.now().toString().slice(-8)}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`, quoteId: fallbackQuote.id, orderId: quote?.order?.id, customer: quote?.customer ?? customer!.name, customerId: quote?.customerId ?? customer!.id, currency: receiptCustomer!.currency, amount: calculation.total, dueAt: new Date(parsed.data.dueAt), lines: asJson(invoiceLines) }, include: { payments: true } });
    await audit(tx, req, 'INVOICE_CREATED', 'Invoice', created.id);
    if (parsed.data.sendReceipt) await audit(tx, req, 'INVOICE_RECEIPT_QUEUED', 'Invoice', created.id, receiptCustomer?.email ?? undefined);
    return created;
  });
  return ok(req, res, invoice, 201);
});

app.post('/api/v1/invoices/:id/payments', authenticate, requireModule('invoices'), requireRole('FINANCE', 'ADMIN'), requireCsrf, async (req: AuthRequest, res) => {
  const parsed = z.object({ amount: z.number().positive(), reference: z.string().trim().min(2).max(128), paidAt: z.string().date(), currency: z.string().trim().length(3).toUpperCase() }).strict().safeParse(req.body);
  if (!parsed.success) return fail(req, res, 422, 'VALIDATION_ERROR', 'Amount, payment date, currency, and settlement reference are required.', parsed.error.flatten());
  const paidAt = parsed.data.paidAt ? new Date(`${parsed.data.paidAt}T12:00:00.000Z`) : new Date();
  if (paidAt.getTime() > Date.now() + 5 * 60_000) return fail(req, res, 422, 'PAYMENT_DATE_IN_FUTURE', 'Payment date cannot be in the future.');
  const invoiceId = routeParam(req, 'id');
  const idempotencyKey = String(req.headers['idempotency-key'] ?? parsed.data.reference);
  if (idempotencyKey.length < 2 || idempotencyKey.length > 128) return fail(req, res, 422, 'VALIDATION_ERROR', 'Use a valid idempotency key.');
  const updated = await db.$transaction((tx) => recordPayment(tx, { organizationId: req.user!.organizationId, actorId: req.user!.id, invoiceId, amount: parsed.data.amount, currency: parsed.data.currency, reference: parsed.data.reference, paidAt, idempotencyKey, requestId: req.requestId }));
  return ok(req, res, updated, 201);
});

app.post('/api/v1/invoices/:id/payments/:paymentId/reversals', authenticate, requireModule('invoices'), requireRole('FINANCE', 'ADMIN'), requireCsrf, async (req: AuthRequest, res) => {
  const parsed = z.object({ reason: z.string().trim().min(5).max(240) }).strict().safeParse(req.body);
  if (!parsed.success) return fail(req, res, 422, 'VALIDATION_ERROR', 'Provide a reason of at least five characters for the correction.', parsed.error.flatten());
  const invoiceId = routeParam(req, 'id');
  const paymentId = routeParam(req, 'paymentId');
  const updated = await db.$transaction((tx) => reversePayment(tx, { organizationId: req.user!.organizationId, actorId: req.user!.id, invoiceId, paymentId, reason: parsed.data.reason, requestId: req.requestId }));
  return ok(req, res, updated, 201);
});

app.get('/api/v1/deal-health', authenticate, requireModule('health'), requireRole('REP', 'MANAGER', 'ADMIN'), async (req: AuthRequest, res) => {
  const scope = quotationRecordScope(req.user!);
  const evaluation = req.user!.readOnlyView ? { evaluated: 0, active: 0, skipped: 'VIEW_AS_READ_ONLY' } : await db.$transaction((tx) => evaluateAlerts(tx, req.user!.organizationId, scope));
  const visibleQuotes = await db.quote.findMany({ where: { organizationId: req.user!.organizationId, AND: [scope] }, select: { id: true } });
  const alerts = await db.alert.findMany({ where: { organizationId: req.user!.organizationId, resourceId: { in: visibleQuotes.map((quote) => quote.id) } }, orderBy: [{ resolved: 'asc' }, { createdAt: 'desc' }] });
  return ok(req, res, { evaluation, items: alerts });
});

app.post('/api/v1/deal-health/:id/actions', authenticate, requireModule('health'), requireRole('REP', 'MANAGER', 'ADMIN'), requireCsrf, async (req: AuthRequest, res) => {
  const parsed = z.object({ action: z.enum(['NUDGE', 'ACKNOWLEDGE', 'RESOLVE']), reason: z.string().trim().min(5).max(240) }).strict().safeParse(req.body);
  if (!parsed.success) return fail(req, res, 422, 'VALIDATION_ERROR', 'Choose an alert action and provide a reason.', parsed.error.flatten());
  const id = routeParam(req, 'id');
  const visibleQuoteIds = await db.quote.findMany({ where: { organizationId: req.user!.organizationId, AND: [quotationRecordScope(req.user!)] }, select: { id: true } });
  const existing = await db.alert.findFirst({ where: { id, organizationId: req.user!.organizationId, resourceId: { in: visibleQuoteIds.map((quote) => quote.id) } } });
  if (!existing) return fail(req, res, 404, 'NOT_FOUND', 'Alert not found.');
  const alert = await db.$transaction(async (tx) => {
    const data = parsed.data.action === 'NUDGE' ? { nudged: true } : parsed.data.action === 'ACKNOWLEDGE' ? { acknowledgedAt: new Date(), acknowledgedById: req.user!.id } : { resolved: true, resolvedAt: new Date() };
    const updated = await tx.alert.update({ where: { id }, data });
    await audit(tx, req, `ALERT_${parsed.data.action}D`, 'Alert', id, parsed.data.reason);
    return updated;
  });
  return ok(req, res, alert);
});

const salesReportQuerySchema = z.object({ from: z.string().date().optional(), to: z.string().date().optional(), repId: z.string().uuid().optional(), status: z.enum(['CONFIRMED', 'PARTIALLY_FULFILLED', 'FULFILLED', 'CANCELLED']).optional(), productId: z.string().uuid().optional(), format: z.enum(['pdf', 'xls']).optional() }).strict();
const reportFilters = (value: z.infer<typeof salesReportQuerySchema>) => ({ from: value.from ? new Date(`${value.from}T00:00:00.000Z`) : undefined, to: value.to ? new Date(`${value.to}T23:59:59.999Z`) : undefined, repId: value.repId, status: value.status, productId: value.productId });

app.get('/api/v1/reports/sales', authenticate, requireModule('reports'), requireRole('REP', 'MANAGER', 'FINANCE', 'ADMIN'), async (req: AuthRequest, res) => {
  const parsed = salesReportQuerySchema.omit({ format: true }).safeParse(req.query);
  if (!parsed.success) return fail(req, res, 422, 'VALIDATION_ERROR', 'Use valid report filters.', parsed.error.flatten());
  const filters = reportFilters(parsed.data);
  if (filters.from && filters.to && (filters.from > filters.to || filters.to.getTime() - filters.from.getTime() > 366 * 86_400_000)) return fail(req, res, 422, 'INVALID_PERIOD', 'Choose a report period of at most 366 days.');
  const report = await db.$transaction((tx) => aggregateSales(tx, req.user!.organizationId, quotationRecordScope(req.user!), filters));
  return ok(req, res, report);
});

app.get('/api/v1/reports/sales/export', authenticate, requireModule('reports'), requireRole('REP', 'MANAGER', 'FINANCE', 'ADMIN'), async (req: AuthRequest, res) => {
  const parsed = salesReportQuerySchema.required({ format: true }).safeParse(req.query);
  if (!parsed.success) return fail(req, res, 422, 'VALIDATION_ERROR', 'Choose PDF or XLS and valid report filters.', parsed.error.flatten());
  const filters = reportFilters(parsed.data);
  if (filters.from && filters.to && (filters.from > filters.to || filters.to.getTime() - filters.from.getTime() > 366 * 86_400_000)) return fail(req, res, 422, 'INVALID_PERIOD', 'Choose a report period of at most 366 days.');
  const report = await db.$transaction((tx) => aggregateSales(tx, req.user!.organizationId, quotationRecordScope(req.user!), filters));
  const extension = parsed.data.format;
  res.setHeader('Content-Type', extension === 'pdf' ? 'application/pdf' : 'application/vnd.ms-excel; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="dealos-sales-report.${extension}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  return res.status(200).send(extension === 'pdf' ? reportAsPdf(report) : reportAsXls(report));
});

app.post('/api/v1/alerts/:id/nudge', authenticate, requireModule('health'), requireRole('REP', 'MANAGER', 'ADMIN'), requireCsrf, async (req: AuthRequest, res) => {
  const existing = await db.alert.findFirst({ where: { id: routeParam(req, 'id'), organizationId: req.user!.organizationId } });
  if (!existing) return fail(req, res, 404, 'NOT_FOUND', 'Alert not found.');
  const alert = await db.$transaction(async (tx) => { const updated = await tx.alert.update({ where: { id: existing.id }, data: { nudged: true } }); await audit(tx, req, 'ALERT_NUDGED', 'Alert', updated.id); return updated; });
  return ok(req, res, alert);
});

app.post('/api/v1/alerts/:id/escalate', authenticate, requireModule('health'), requireRole('REP', 'MANAGER', 'ADMIN'), requireCsrf, async (req: AuthRequest, res) => {
  const existing = await db.alert.findFirst({ where: { id: routeParam(req, 'id'), organizationId: req.user!.organizationId, resolved: false } });
  if (!existing) return fail(req, res, 404, 'NOT_FOUND', 'Active alert not found.');
  const alert = await db.$transaction(async (tx) => {
    const updated = await tx.alert.update({ where: { id: existing.id }, data: { nudged: true } });
    await audit(tx, req, 'ALERT_ESCALATED', 'Alert', updated.id, `${updated.kind}:${updated.resourceId}`);
    return updated;
  });
  return ok(req, res, alert);
});

app.post('/api/v1/alerts/:id/resolve', authenticate, requireModule('health'), requireRole('REP', 'MANAGER', 'FINANCE', 'ADMIN'), requireCsrf, async (req: AuthRequest, res) => {
  const existing = await db.alert.findFirst({ where: { id: routeParam(req, 'id'), organizationId: req.user!.organizationId, resolved: false } });
  if (!existing) return fail(req, res, 404, 'NOT_FOUND', 'Active alert not found.');
  const alert = await db.$transaction(async (tx) => {
    const updated = await tx.alert.update({ where: { id: existing.id }, data: { resolved: true } });
    await audit(tx, req, 'ALERT_RESOLVED', 'Alert', updated.id, `${updated.kind}:${updated.resourceId}`);
    return updated;
  });
  return ok(req, res, alert);
});

app.post('/api/v1/products', authenticate, requireModule('products'), requireRole('ADMIN'), requireCsrf, async (req: AuthRequest, res) => {
  const parsed = z.object({ name: z.string().trim().min(2), sku: z.string().trim().min(2).max(80).optional(), category: z.string().trim().min(2), description: z.string(), unit: z.string().trim().min(1), brand: z.string().trim().max(120).nullable().optional(), price: z.number().positive(), cost: z.number().nonnegative().default(0), taxRate: z.number().min(0).max(100), recurring: z.boolean().default(false), cadence: z.string().nullable().optional(), active: z.boolean().default(true), storeVisible: z.boolean().default(true), featured: z.boolean().default(false), openingStock: z.number().int().nonnegative().default(0), minAlertLevel: z.number().int().nonnegative().default(0), maxCapacity: z.number().int().positive().nullable().optional() }).strict()
    .refine((value) => value.price > value.cost, { path: ['cost'], message: 'Purchase cost must be lower than the taxable selling price.' })
    .refine((value) => value.maxCapacity == null || value.maxCapacity >= value.openingStock, { path: ['maxCapacity'], message: 'Maximum capacity cannot be below opening stock.' })
    .safeParse(req.body);
  if (!parsed.success) return fail(req, res, 422, 'VALIDATION_ERROR', 'Enter valid product values.', parsed.error.flatten());
  const product = await db.$transaction(async (tx) => {
    const { openingStock, minAlertLevel, maxCapacity, sku: requestedSku, ...productData } = parsed.data;
    const skuStem = productData.name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 18).toUpperCase() || 'ITEM';
    const sku = requestedSku?.toUpperCase() ?? `${skuStem}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    const created = await tx.product.create({ data: { ...productData, sku, organizationId: req.user!.organizationId } });
    const needsStockBalance = !productData.recurring && (openingStock > 0 || minAlertLevel > 0 || maxCapacity);
    if (needsStockBalance) {
      const warehouse = await tx.warehouse.findFirst({ where: { organizationId: req.user!.organizationId }, orderBy: { priority: 'asc' } })
        ?? await tx.warehouse.upsert({
          where: { organizationId_name: { organizationId: req.user!.organizationId, name: 'Main Warehouse' } },
          update: {},
          create: { organizationId: req.user!.organizationId, name: 'Main Warehouse', priority: 1, shippingCost: 0 },
        });
      await tx.stockBalance.upsert({
        where: { warehouseId_productId: { warehouseId: warehouse.id, productId: created.id } },
        update: { onHand: openingStock, reserved: 0, minAlertLevel, maxCapacity: maxCapacity ?? null },
        create: { warehouseId: warehouse.id, productId: created.id, onHand: openingStock, reserved: 0, minAlertLevel, maxCapacity: maxCapacity ?? null },
      });
    }
    await audit(tx, req, 'PRODUCT_CREATED', 'Product', created.id);
    return tx.product.findUniqueOrThrow({ where: { id: created.id }, include: { stocks: { include: { warehouse: true } } } });
  });
  return ok(req, res, product, 201);
});
app.patch('/api/v1/products/:id', authenticate, requireModule('products'), requireRole('ADMIN'), requireCsrf, async (req: AuthRequest, res) => {
  const parsed = z.object({ name: z.string().min(2).optional(), sku: z.string().trim().min(2).max(80).optional(), category: z.string().min(2).optional(), description: z.string().optional(), unit: z.string().min(1).optional(), brand: z.string().trim().max(120).nullable().optional(), price: z.number().positive().optional(), cost: z.number().nonnegative().optional(), taxRate: z.number().min(0).max(100).optional(), recurring: z.boolean().optional(), active: z.boolean().optional(), storeVisible: z.boolean().optional(), featured: z.boolean().optional(), cadence: z.string().nullable().optional() }).strict().safeParse(req.body);
  if (!parsed.success) return fail(req, res, 422, 'VALIDATION_ERROR', 'Enter valid product values.');
  const existing = await db.product.findFirst({ where: { id: routeParam(req, 'id'), organizationId: req.user!.organizationId } });
  if (!existing) return fail(req, res, 404, 'NOT_FOUND', 'Product not found.');
  const nextPrice = parsed.data.price ?? Number(existing.price);
  const nextCost = parsed.data.cost ?? Number(existing.cost);
  if (nextCost >= nextPrice) return fail(req, res, 422, 'VALIDATION_ERROR', 'Purchase cost must be lower than the taxable selling price.');
  const product = await db.$transaction(async (tx) => { const updated = await tx.product.update({ where: { id: existing.id }, data: parsed.data }); await audit(tx, req, 'PRODUCT_UPDATED', 'Product', updated.id); return updated; });
  return ok(req, res, product);
});

app.patch('/api/v1/policies/:id', authenticate, requireModule('policies'), requireRole('ADMIN', 'MANAGER'), requireCsrf, async (req: AuthRequest, res) => {
  const parsed = discountPolicyUpdateSchema.safeParse(req.body);
  if (!parsed.success) return fail(req, res, 422, 'VALIDATION_ERROR', 'Enter valid policy values and a change reason.', parsed.error.flatten());
  const existing = await db.discountPolicy.findFirst({ where: { id: routeParam(req, 'id'), organizationId: req.user!.organizationId } });
  if (!existing) return fail(req, res, 404, 'NOT_FOUND', 'Policy not found.');
  const { reason, ...changes } = parsed.data;
  const policy = await db.$transaction(async (tx) => { const updated = await tx.discountPolicy.update({ where: { id: existing.id }, data: { ...changes, version: { increment: 1 }, publishedAt: new Date() } }); await audit(tx, req, 'POLICY_UPDATED', 'DiscountPolicy', updated.id, reason); return updated; });
  return ok(req, res, policy);
});

app.get('/api/v1/settings/rfq-handling', authenticate, requireRole('ADMIN'), async (req: AuthRequest, res) => {
  const organization = await db.organization.findUnique({ where: { id: req.user!.organizationId }, select: { rfqHandlingMode: true } });
  if (!organization) return fail(req, res, 404, 'NOT_FOUND', 'Organization not found.');
  return ok(req, res, { mode: organization.rfqHandlingMode, defaultClassification: 'PROPOSED' });
});

app.get('/api/v1/settings/directory-profile', authenticate, requireRole('ADMIN'), async (req: AuthRequest, res) => {
  return ok(req, res, await getOrganizationDirectoryProfile(db, { ...req.user!, requestId: req.requestId! }));
});

app.put('/api/v1/settings/directory-profile', authenticate, requireRole('ADMIN'), requireCsrf, async (req: AuthRequest, res) => {
  const parsed = organizationProfileSchema.safeParse(req.body);
  if (!parsed.success) return fail(req, res, 422, 'VALIDATION_ERROR', 'Enter a display name and valid public directory details.', parsed.error.flatten());
  return ok(req, res, await db.$transaction((tx) => updateOrganizationDirectoryProfile(tx, { ...req.user!, requestId: req.requestId! }, parsed.data)));
});

app.put('/api/v1/settings/rfq-handling', authenticate, requireRole('ADMIN'), requireCsrf, async (req: AuthRequest, res) => {
  const parsed = rfqHandlingSettingSchema.safeParse(req.body);
  if (!parsed.success) return fail(req, res, 422, 'VALIDATION_ERROR', 'Choose Lead first or Direct draft.', parsed.error.flatten());
  const updated = await db.$transaction((tx) => updateRfqHandlingMode(tx, req.user!, parsed.data.mode, parsed.data.reason));
  return ok(req, res, { mode: updated.mode, changed: updated.changed, defaultClassification: 'PROPOSED' });
});

app.use((error: unknown, req: AuthRequest, res: Response, _next: NextFunction) => {
  if (error instanceof PortalInvitationError) {
    if (error.retryAfter) res.setHeader('Retry-After', error.retryAfter);
    return fail(req, res, error.status, error.code, error.message);
  }
  if (error instanceof GovernanceError) return fail(req, res, error.status, error.code, error.message);
  if (error instanceof PortalError) return fail(req, res, error.status, error.code, error.message);
  if (error instanceof OrderConfirmationError) return fail(req, res, error.status, error.code, error.message);
  if (error instanceof BillingError) return fail(req, res, error.status, error.code, error.message);
  if (error instanceof FulfillmentError) return fail(req, res, error.status, error.code, error.message, error.details);
  if (error instanceof CustomerRelationshipError) return fail(req, res, error.status, error.code, error.message);
  if (error instanceof PortalRequestError) {
    if (error.retryAfter) res.setHeader('Retry-After', error.retryAfter);
    return fail(req, res, error.status, error.code, error.message);
  }
  if (error instanceof DirectoryError) {
    if (error.retryAfter) res.setHeader('Retry-After', error.retryAfter);
    return fail(req, res, error.status, error.code, error.message);
  }
  if (error instanceof CustomerProfileError) return fail(req, res, error.status, error.code, error.message);
  if (error instanceof QuotationCreationError) return fail(req, res, error.status, error.code, error.message);
  if (error instanceof SalesTeamError) return fail(req, res, error.status, error.code, error.message);
  if (error instanceof DomainError) return fail(req, res, error.status, error.code, error.message);
  console.error(JSON.stringify({ level: 'error', requestId: req.requestId, route: req.path, error: error instanceof Error ? error.name : 'UnknownError' }));
  return fail(req, res, 500, 'INTERNAL_ERROR', 'The request could not be completed.');
});
