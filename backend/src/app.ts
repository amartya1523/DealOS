import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import { z } from 'zod';
import { db } from './db.js';
import { createGoogleOrganizationAdmin, createOrganizationAdmin, googleSignupSchema, signupSchema, verifyGoogleSignupCredential } from './identity.js';
import { allocateStock, calculateQuote } from './rules.js';

type CurrentUser = { id: string; name: string; email: string; loginId: string | null; role: string; customerId: string | null; organizationId: string; moduleAccess: string[] };
type AuthRequest = Request & { user?: CurrentUser };
const modules = ['dashboard','quotations','approvals','fulfillment','subscriptions','invoices','health','reports','products','policies'] as const;

const cookieName = process.env.SESSION_COOKIE_NAME ?? 'dealos_session';
const origin = process.env.FRONTEND_ORIGIN ?? 'http://localhost:5173';
const googleClientId = process.env.GOOGLE_CLIENT_ID?.trim() ?? '';
const ok = (res: Response, data: unknown, status = 200) => res.status(status).json({ success: true, data });
const fail = (res: Response, status: number, code: string, message: string, details?: unknown) => res.status(status).json({ success: false, error: { code, message, details } });
const decimal = (value: unknown) => Number(value);
const routeParam = (req: Request, name: string) => String(req.params[name] ?? '');
const hashToken = (token: string) => crypto.createHash('sha256').update(token).digest('hex');
const parseCookies = (header = '') => Object.fromEntries(header.split(';').map((part) => part.trim().split('=').map(decodeURIComponent)).filter(([key]) => key));
async function startSession(user: { id: string }, res: Response) {
  const token = crypto.randomBytes(32).toString('hex');
  await db.session.create({ data: { userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 12 * 60 * 60 * 1000) } });
  res.setHeader('Set-Cookie', `${cookieName}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=43200${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`);
}

export const app = express();
app.use(helmet());
app.use(cors({ origin, credentials: true }));
app.use(express.json({ limit: '256kb' }));

async function authenticate(req: AuthRequest, res: Response, next: NextFunction) {
  const token = parseCookies(req.headers.cookie)[cookieName];
  if (!token) return fail(res, 401, 'AUTH_REQUIRED', 'Please sign in to continue.');
  const session = await db.session.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: true } });
  if (!session || !session.user.organizationId || session.user.status !== 'ACTIVE' || session.expiresAt < new Date()) return fail(res, 401, 'AUTH_REQUIRED', 'Your session has expired.');
  req.user = { id: session.user.id, name: session.user.name, email: session.user.email, loginId: session.user.loginId, role: session.user.role, customerId: session.user.customerId, organizationId: session.user.organizationId, moduleAccess: session.user.moduleAccess };
  next();
}

const requireRole = (...roles: string[]) => (req: AuthRequest, res: Response, next: NextFunction) => roles.includes(req.user?.role ?? '') ? next() : fail(res, 403, 'FORBIDDEN', 'You do not have permission to perform this action.');
const requireModule = (module: typeof modules[number]) => (req: AuthRequest, res: Response, next: NextFunction) => hasModule(req.user, module) ? next() : fail(res, 403, 'FORBIDDEN', 'This module is not enabled for your account.');
const audit = (actor: CurrentUser | undefined, action: string, resource: string, resourceId: string, reason?: string) => db.auditEvent.create({ data: { organizationId: actor!.organizationId, actorId: actor?.id, action, resource, resourceId, reason } });
const hasModule = (user: CurrentUser | undefined, module: typeof modules[number]) => user?.role === 'ADMIN' || user?.moduleAccess.includes(module);

app.get('/api/v1/health/live', (_req, res) => ok(res, { status: 'alive' }));
app.get('/api/v1/health/ready', async (_req, res) => { await db.$queryRaw`SELECT 1`; return ok(res, { status: 'ready' }); });

app.post('/api/v1/auth/signup', async (req, res) => {
  const parsed = signupSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 422, 'VALIDATION_ERROR', 'Enter your organization and valid administrator credentials.');
  const organization = await createOrganizationAdmin(parsed.data);
  if (!organization) return fail(res, 409, 'ACCOUNT_EXISTS', 'An account already exists for this email. Sign in instead.');
  await startSession(organization.users[0]!, res);
  return ok(res, { status: 'ACTIVE', role: 'ADMIN', organizationId: organization.id }, 201);
});

app.get('/api/v1/auth/google/config', (_req, res) => {
  return ok(res, { enabled: Boolean(googleClientId), clientId: googleClientId || null });
});

app.post('/api/v1/auth/google/signup', async (req, res) => {
  if (!googleClientId) return fail(res, 503, 'AUTH_PROVIDER_UNAVAILABLE', 'Google signup is not configured.');
  const parsed = googleSignupSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 422, 'VALIDATION_ERROR', 'A valid Google credential is required.');
  let profile;
  try {
    profile = await verifyGoogleSignupCredential(parsed.data.credential, googleClientId);
  } catch {
    return fail(res, 401, 'INVALID_GOOGLE_CREDENTIAL', 'Google could not verify this signup. Please try again.');
  }
  const organization = await createGoogleOrganizationAdmin(profile, parsed.data.organizationName);
  if (!organization) return fail(res, 409, 'ACCOUNT_EXISTS', 'An account already exists for this Google email. Sign in instead.');
  await startSession(organization.users[0]!, res);
  return ok(res, { status: 'ACTIVE', role: 'ADMIN', organizationId: organization.id }, 201);
});

app.post('/api/v1/auth/google/login', async (req, res) => {
  if (!googleClientId) return fail(res, 503, 'AUTH_PROVIDER_UNAVAILABLE', 'Google sign-in is not configured.');
  const parsed = z.object({ credential: z.string().trim().min(1).max(8192) }).strict().safeParse(req.body);
  if (!parsed.success) return fail(res, 422, 'VALIDATION_ERROR', 'A valid Google credential is required.');
  try {
    const profile = await verifyGoogleSignupCredential(parsed.data.credential, googleClientId);
    const user = await db.user.findUnique({ where: { googleSubject: profile.subject } });
    if (!user || user.status !== 'ACTIVE') return fail(res, 401, 'INVALID_CREDENTIALS', 'Google account is not linked to an active workspace.');
    await startSession(user, res);
    return ok(res, { id: user.id, name: user.name, role: user.role });
  } catch {
    return fail(res, 401, 'INVALID_GOOGLE_CREDENTIAL', 'Google could not verify this sign-in.');
  }
});

app.post('/api/v1/auth/login', async (req, res) => {
  const parsed = z.object({ identifier: z.string().trim().min(3).max(254), password: z.string().min(8) }).safeParse(req.body);
  if (!parsed.success) return fail(res, 422, 'VALIDATION_ERROR', 'Check your email and password.', parsed.error.flatten());
  const identifier = parsed.data.identifier.toLowerCase();
  const user = await db.user.findFirst({ where: { OR: [{ email: identifier }, { loginId: { equals: parsed.data.identifier, mode: 'insensitive' } }] } });
  if (!user || !(await bcrypt.compare(parsed.data.password, user.passwordHash))) return fail(res, 401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');
  if (user.status !== 'ACTIVE') return fail(res, 403, 'ACCOUNT_INACTIVE', 'Your account is awaiting administrator activation or has been disabled. Contact your administrator.');
  await startSession(user, res);
  return ok(res, { id: user.id, name: user.name, email: user.email, role: user.role });
});

app.post('/api/v1/auth/logout', authenticate, async (req: AuthRequest, res) => {
  const token = parseCookies(req.headers.cookie)[cookieName];
  if (token) await db.session.deleteMany({ where: { tokenHash: hashToken(token) } });
  res.setHeader('Set-Cookie', `${cookieName}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
  return ok(res, { loggedOut: true });
});

app.get('/api/v1/auth/me', authenticate, (req: AuthRequest, res) => ok(res, req.user));

app.get('/api/v1/workspace', authenticate, async (req: AuthRequest, res) => {
  const portal = req.user?.role === 'CUSTOMER';
  const organizationId = req.user!.organizationId;
  const quoteWhere = { organizationId, ...(portal ? { customer: { contains: req.user?.customerId ?? '__none__', mode: 'insensitive' as const } } : {}) };
  const [organization, users, quotes, products, policies, warehouses, subscriptions, invoices, alerts, audits] = await Promise.all([
    db.organization.findUnique({ where: { id: organizationId }, select: { id: true, name: true } }),
    req.user!.role === 'ADMIN' ? db.user.findMany({ where: { organizationId }, select: { id: true, name: true, loginId: true, status: true, moduleAccess: true, createdAt: true }, orderBy: { createdAt: 'desc' } }) : [],
    (portal || hasModule(req.user,'quotations') || hasModule(req.user,'approvals') || hasModule(req.user,'fulfillment')) ? db.quote.findMany({ where: quoteWhere, include: { lines: { include: { product: true } }, approvals: { orderBy: { sequence: 'asc' } }, fulfillment: true, negotiation: { orderBy: { createdAt: 'desc' } }, invoices: true }, orderBy: { updatedAt: 'desc' } }) : [],
    !portal && hasModule(req.user,'products') ? db.product.findMany({ where: { organizationId }, include: { stocks: { include: { warehouse: true } } }, orderBy: { name: 'asc' } }) : [],
    !portal && hasModule(req.user,'policies') ? db.discountPolicy.findMany({ where: { organizationId }, orderBy: { tier: 'asc' } }) : [],
    !portal && hasModule(req.user,'fulfillment') ? db.warehouse.findMany({ where: { organizationId }, include: { stocks: { include: { product: true } } }, orderBy: { priority: 'asc' } }) : [],
    !portal && hasModule(req.user,'subscriptions') ? db.subscription.findMany({ where: { organizationId }, orderBy: { nextBillAt: 'asc' } }) : [],
    (portal || hasModule(req.user,'invoices')) ? db.invoice.findMany({ where: { organizationId, ...(portal ? { customer: { contains: req.user?.customerId ?? '__none__', mode: 'insensitive' } } : {}) }, include: { payments: true }, orderBy: { createdAt: 'desc' } }) : [],
    !portal && hasModule(req.user,'health') ? db.alert.findMany({ where: { organizationId }, orderBy: { createdAt: 'desc' } }) : [],
    !portal && hasModule(req.user,'reports') ? db.auditEvent.findMany({ where: { organizationId }, orderBy: { createdAt: 'desc' }, take: 30 }) : [],
  ]);
  return ok(res, { user: req.user, organization, users, quotes, products, policies, warehouses, subscriptions, invoices, alerts, audits });
});

app.post('/api/v1/admin/users', authenticate, requireRole('ADMIN'), async (req: AuthRequest, res) => {
  const parsed = z.object({ name: z.string().trim().min(1).max(120), modules: z.array(z.enum(modules)).min(1).max(modules.length) }).strict().safeParse(req.body);
  if (!parsed.success) return fail(res, 422, 'VALIDATION_ERROR', 'Enter a user name and select at least one module.');
  const loginId = `DL-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
  const password = `Deal-${crypto.randomBytes(4).toString('base64url')}-${crypto.randomBytes(4).toString('base64url')}!`;
  const passwordHash = await bcrypt.hash(password, 12);
  const user = await db.user.create({ data: { organizationId: req.user!.organizationId, name: parsed.data.name, email: `${loginId.toLowerCase()}@users.dealos.local`, loginId, passwordHash, status: 'ACTIVE', role: 'REP', moduleAccess: parsed.data.modules } });
  await audit(req.user, 'USER_ACCESS_CREATED', 'User', user.id, parsed.data.modules.join(','));
  return ok(res, { user: { id: user.id, name: user.name, loginId: user.loginId, moduleAccess: user.moduleAccess }, credentials: { loginId, password } }, 201);
});

app.post('/api/v1/quotations', authenticate, requireModule('quotations'), requireRole('REP', 'ADMIN'), async (req: AuthRequest, res) => {
  const parsed = z.object({ customer: z.string().min(2), customerTier: z.string().min(2) }).safeParse(req.body);
  if (!parsed.success) return fail(res, 422, 'VALIDATION_ERROR', 'Customer and tier are required.');
  const quote = await db.quote.create({ data: { organizationId: req.user!.organizationId, number: `Q-${crypto.randomBytes(4).toString('hex').toUpperCase()}`, customer: parsed.data.customer, customerTier: parsed.data.customerTier, ownerId: req.user!.id } });
  await audit(req.user, 'QUOTE_CREATED', 'Quote', quote.id);
  return ok(res, quote, 201);
});

app.put('/api/v1/quotations/:id/draft', authenticate, requireModule('quotations'), requireRole('REP', 'ADMIN'), async (req: AuthRequest, res) => {
  const parsed = z.object({ version: z.number().int(), orderDiscount: z.number().min(0).max(100), lines: z.array(z.object({ productId: z.string().uuid(), quantity: z.number().int().positive(), discount: z.number().min(0).max(100) })).min(1) }).safeParse(req.body);
  if (!parsed.success) return fail(res, 422, 'VALIDATION_ERROR', 'Add valid quotation lines.', parsed.error.flatten());
  const quote = await db.quote.findFirst({ where: { id: routeParam(req, 'id'), organizationId: req.user!.organizationId } });
  if (!quote || quote.version !== parsed.data.version || quote.stage !== 'DRAFT') return fail(res, 409, 'STALE_VERSION', 'Refresh the quotation before saving.');
  const products = await db.product.findMany({ where: { id: { in: parsed.data.lines.map((line) => line.productId) }, organizationId: req.user!.organizationId, active: true } });
  if (products.length !== new Set(parsed.data.lines.map((line) => line.productId)).size) return fail(res, 422, 'CONFIGURATION_REQUIRED', 'One or more products are unavailable.');
  const policy = await db.discountPolicy.findFirst({ where: { tier: quote.customerTier, organizationId: req.user!.organizationId } });
  if (!policy) return fail(res, 422, 'CONFIGURATION_REQUIRED', 'Configure this customer tier before saving.');
  const inputs = parsed.data.lines.map((line) => { const product = products.find((item) => item.id === line.productId)!; const categoryLimit = product.category === 'Hardware' ? policy.hardwareLimit : product.category === 'Services' ? policy.servicesLimit : policy.subscriptionLimit; return { ...line, unitPrice: decimal(product.price), unitCost: decimal(product.cost), allowedDiscount: Math.min(decimal(policy.maxDiscount), decimal(categoryLimit)) }; });
  const calculation = calculateQuote(inputs, parsed.data.orderDiscount);
  const updated = await db.$transaction(async (tx) => {
    await tx.quoteLine.deleteMany({ where: { quoteId: quote.id } });
    await tx.quoteLine.createMany({ data: inputs.map((line) => ({ quoteId: quote.id, productId: line.productId, quantity: line.quantity, unitPrice: line.unitPrice, unitCost: line.unitCost, discount: line.discount, allowedDiscount: line.allowedDiscount })) });
    return tx.quote.update({ where: { id: quote.id }, data: { orderDiscount: parsed.data.orderDiscount, total: calculation.total, margin: calculation.margin, riskScore: calculation.riskScore, version: { increment: 1 }, lastActivity: new Date() }, include: { lines: { include: { product: true } } } });
  });
  await audit(req.user, 'QUOTE_SAVED', 'Quote', quote.id);
  return ok(res, { quote: updated, calculation });
});

app.post('/api/v1/quotations/:id/submit', authenticate, requireModule('quotations'), requireRole('REP', 'ADMIN'), async (req: AuthRequest, res) => {
  const quote = await db.quote.findFirst({ where: { id: routeParam(req, 'id'), organizationId: req.user!.organizationId }, include: { lines: true } });
  if (!quote || quote.stage !== 'DRAFT' || !quote.lines.length) return fail(res, 409, 'INVALID_STATE', 'Only a complete draft can be submitted.');
  const needsFinance = decimal(quote.riskScore) > 5;
  const updated = await db.$transaction(async (tx) => {
    await tx.approval.deleteMany({ where: { quoteId: quote.id } });
    await tx.approval.create({ data: { quoteId: quote.id, step: 'Sales Manager', sequence: 1 } });
    if (needsFinance) await tx.approval.create({ data: { quoteId: quote.id, step: 'Finance', sequence: 2 } });
    return tx.quote.update({ where: { id: quote.id }, data: { stage: 'PENDING_APPROVAL', version: { increment: 1 }, lastActivity: new Date() } });
  });
  await audit(req.user, 'QUOTE_SUBMITTED', 'Quote', quote.id, needsFinance ? 'Manager and Finance approval required' : 'Manager approval required');
  return ok(res, updated);
});

app.post('/api/v1/approvals/:id/decision', authenticate, requireModule('approvals'), requireRole('MANAGER', 'FINANCE', 'ADMIN'), async (req: AuthRequest, res) => {
  const parsed = z.object({ decision: z.enum(['APPROVE', 'RETURN', 'REJECT']), reason: z.string().min(2) }).safeParse(req.body);
  if (!parsed.success) return fail(res, 422, 'VALIDATION_ERROR', 'A decision and reason are required.');
  const approval = await db.approval.findFirst({ where: { id: routeParam(req, 'id'), quote: { organizationId: req.user!.organizationId } }, include: { quote: true } });
  if (!approval || approval.state !== 'PENDING') return fail(res, 409, 'INVALID_STATE', 'This approval is no longer pending.');
  if (approval.step === 'Sales Manager' && !['MANAGER', 'ADMIN'].includes(req.user!.role)) return fail(res, 403, 'FORBIDDEN', 'A Sales Manager must complete this step.');
  if (approval.step === 'Finance' && !['FINANCE', 'ADMIN'].includes(req.user!.role)) return fail(res, 403, 'FORBIDDEN', 'Finance must complete this step.');
  if (approval.sequence > 1 && await db.approval.findFirst({ where: { quoteId: approval.quoteId, sequence: approval.sequence - 1, state: { not: 'APPROVED' } } })) return fail(res, 409, 'APPROVAL_STEP_BLOCKED', 'The previous approval step is incomplete.');
  if (approval.quote.ownerId === req.user!.id) return fail(res, 409, 'SELF_APPROVAL_NOT_ALLOWED', 'The quotation owner cannot approve their own deal.');
  const state: 'APPROVED' | 'RETURNED' | 'REJECTED' = parsed.data.decision === 'APPROVE' ? 'APPROVED' : parsed.data.decision === 'RETURN' ? 'RETURNED' : 'REJECTED';
  const result = await db.$transaction(async (tx) => {
    const step = await tx.approval.update({ where: { id: approval.id }, data: { state, reviewerId: req.user!.id, reason: parsed.data.reason, decidedAt: new Date() } });
    const remaining = await tx.approval.count({ where: { quoteId: approval.quoteId, state: 'PENDING' } });
    const nextStage = state === 'RETURNED' ? 'DRAFT' : state === 'REJECTED' ? 'REJECTED' : remaining === 0 ? 'APPROVED' : 'PENDING_APPROVAL';
    await tx.quote.update({ where: { id: approval.quoteId }, data: { stage: nextStage, version: { increment: 1 }, lastActivity: new Date() } });
    return step;
  });
  await audit(req.user, `APPROVAL_${parsed.data.decision}`, 'Quote', approval.quoteId, parsed.data.reason);
  return ok(res, result);
});

app.post('/api/v1/portal/quotations/:id/message', authenticate, requireRole('CUSTOMER'), async (req: AuthRequest, res) => {
  const parsed = z.object({ message: z.string().min(2).max(2000), counterDiscount: z.number().min(0).max(100).optional() }).safeParse(req.body);
  if (!parsed.success) return fail(res, 422, 'VALIDATION_ERROR', 'Enter a valid request.');
  const quote = await db.quote.findFirst({ where: { id: routeParam(req, 'id'), organizationId: req.user!.organizationId } });
  if (!quote) return fail(res, 404, 'NOT_FOUND', 'Quotation not found.');
  const negotiation = await db.$transaction(async (tx) => {
    const record = await tx.negotiation.create({ data: { quoteId: quote.id, author: req.user!.name, message: parsed.data.message, counterDiscount: parsed.data.counterDiscount } });
    await tx.approval.updateMany({ where: { quoteId: quote.id }, data: { state: 'PENDING', reviewerId: null, reason: null, decidedAt: null } });
    await tx.quote.update({ where: { id: quote.id }, data: { stage: 'PENDING_APPROVAL', ...(parsed.data.counterDiscount !== undefined ? { orderDiscount: parsed.data.counterDiscount } : {}), version: { increment: 1 }, lastActivity: new Date() } });
    return record;
  });
  await audit(req.user, 'CUSTOMER_CHANGE_REQUESTED', 'Quote', quote.id, parsed.data.message);
  return ok(res, negotiation, 201);
});

app.post('/api/v1/portal/quotations/:id/confirm', authenticate, requireRole('CUSTOMER'), async (req: AuthRequest, res) => {
  const quote = await db.quote.findFirst({ where: { id: routeParam(req, 'id'), organizationId: req.user!.organizationId } });
  if (!quote || quote.stage !== 'APPROVED') return fail(res, 409, 'INVALID_STATE', 'This quotation requires approval before confirmation.');
  const result = await db.quote.update({ where: { id: quote.id }, data: { stage: 'CONFIRMED', version: { increment: 1 }, lastActivity: new Date() } });
  await audit(req.user, 'CUSTOMER_CONFIRMED', 'Quote', quote.id);
  return ok(res, result);
});

app.post('/api/v1/fulfillment/:quoteId/allocate', authenticate, requireModule('fulfillment'), requireRole('FINANCE', 'ADMIN'), async (req: AuthRequest, res) => {
  const quote = await db.quote.findFirst({ where: { id: routeParam(req, 'quoteId'), organizationId: req.user!.organizationId }, include: { lines: { include: { product: true } } } });
  if (!quote || quote.stage !== 'CONFIRMED') return fail(res, 409, 'INVALID_STATE', 'Confirm the quotation before reserving stock.');
  const tracked = quote.lines.filter((line) => !line.product.recurring && line.product.category === 'Hardware');
  const balances = await db.stockBalance.findMany({ where: { productId: { in: tracked.map((line) => line.productId) }, warehouse: { organizationId: req.user!.organizationId } }, include: { warehouse: true } });
  const allocation = allocateStock(tracked.map((line) => ({ productId: line.productId, quantity: line.quantity })), balances.map((b) => ({ productId: b.productId, warehouseId: b.warehouseId, warehouseName: b.warehouse.name, priority: b.warehouse.priority, shippingCost: decimal(b.warehouse.shippingCost), onHand: b.onHand, reserved: b.reserved })));
  const cost = [...new Set(allocation.split.map((row) => row.warehouseId))].reduce((sum, id) => sum + decimal(balances.find((row) => row.warehouseId === id)!.warehouse.shippingCost), 0);
  const fulfillment = await db.$transaction(async (tx) => {
    for (const row of allocation.split) await tx.stockBalance.update({ where: { warehouseId_productId: { warehouseId: row.warehouseId, productId: row.productId } }, data: { reserved: { increment: row.quantity } } });
    return tx.fulfillment.upsert({ where: { quoteId: quote.id }, update: { split: allocation, state: allocation.backorders.length ? 'BACKORDER' : 'RESERVED', estimatedCost: cost, shipmentCount: new Set(allocation.split.map((row) => row.warehouseId)).size }, create: { quoteId: quote.id, split: allocation, state: allocation.backorders.length ? 'BACKORDER' : 'RESERVED', estimatedCost: cost, shipmentCount: new Set(allocation.split.map((row) => row.warehouseId)).size } });
  });
  await audit(req.user, 'STOCK_ALLOCATED', 'Quote', quote.id);
  return ok(res, fulfillment);
});

app.post('/api/v1/subscriptions/:id/change', authenticate, requireModule('subscriptions'), requireRole('FINANCE', 'ADMIN'), async (req: AuthRequest, res) => {
  const parsed = z.object({ amount: z.number().positive().optional(), cancel: z.boolean().optional() }).safeParse(req.body);
  if (!parsed.success) return fail(res, 422, 'VALIDATION_ERROR', 'Enter a valid subscription change.');
  const existing = await db.subscription.findFirst({ where: { id: routeParam(req, 'id'), organizationId: req.user!.organizationId } });
  if (!existing) return fail(res, 404, 'NOT_FOUND', 'Subscription not found.');
  const subscription = await db.subscription.update({ where: { id: existing.id }, data: { ...(parsed.data.amount ? { amount: parsed.data.amount } : {}), ...(parsed.data.cancel ? { state: 'CANCELLED' as const } : {}) } });
  await audit(req.user, parsed.data.cancel ? 'SUBSCRIPTION_CANCELLED' : 'SUBSCRIPTION_CHANGED', 'Subscription', subscription.id);
  return ok(res, subscription);
});

app.post('/api/v1/invoices/:id/payments', authenticate, requireModule('invoices'), requireRole('FINANCE', 'ADMIN'), async (req: AuthRequest, res) => {
  const parsed = z.object({ amount: z.number().positive(), reference: z.string().min(2) }).safeParse(req.body);
  if (!parsed.success) return fail(res, 422, 'VALIDATION_ERROR', 'Amount and reference are required.');
  const invoice = await db.invoice.findFirst({ where: { id: routeParam(req, 'id'), organizationId: req.user!.organizationId } });
  if (!invoice || decimal(invoice.paidAmount) + parsed.data.amount > decimal(invoice.amount)) return fail(res, 422, 'AMOUNT_EXCEEDS_BALANCE', 'Payment exceeds the outstanding balance.');
  const updated = await db.$transaction(async (tx) => {
    await tx.payment.create({ data: { invoiceId: invoice.id, amount: parsed.data.amount, reference: parsed.data.reference, paidAt: new Date() } });
    const paid = decimal(invoice.paidAmount) + parsed.data.amount;
    return tx.invoice.update({ where: { id: invoice.id }, data: { paidAmount: paid, state: paid === decimal(invoice.amount) ? 'PAID' : 'PARTIAL' }, include: { payments: true } });
  });
  await audit(req.user, 'PAYMENT_RECORDED', 'Invoice', invoice.id, parsed.data.reference);
  return ok(res, updated, 201);
});

app.post('/api/v1/alerts/:id/nudge', authenticate, requireModule('health'), requireRole('REP', 'MANAGER', 'ADMIN'), async (req: AuthRequest, res) => {
  const existing = await db.alert.findFirst({ where: { id: routeParam(req, 'id'), organizationId: req.user!.organizationId } });
  if (!existing) return fail(res, 404, 'NOT_FOUND', 'Alert not found.');
  const alert = await db.alert.update({ where: { id: existing.id }, data: { nudged: true } });
  await audit(req.user, 'ALERT_NUDGED', 'Alert', alert.id);
  return ok(res, alert);
});

app.patch('/api/v1/products/:id', authenticate, requireModule('products'), requireRole('ADMIN'), async (req: AuthRequest, res) => {
  const parsed = z.object({ price: z.number().nonnegative().optional(), cost: z.number().nonnegative().optional(), active: z.boolean().optional() }).safeParse(req.body);
  if (!parsed.success) return fail(res, 422, 'VALIDATION_ERROR', 'Enter valid product values.');
  const existing = await db.product.findFirst({ where: { id: routeParam(req, 'id'), organizationId: req.user!.organizationId } });
  if (!existing) return fail(res, 404, 'NOT_FOUND', 'Product not found.');
  const product = await db.product.update({ where: { id: existing.id }, data: parsed.data });
  await audit(req.user, 'PRODUCT_UPDATED', 'Product', product.id);
  return ok(res, product);
});

app.patch('/api/v1/policies/:id', authenticate, requireModule('policies'), requireRole('ADMIN', 'MANAGER'), async (req: AuthRequest, res) => {
  const parsed = z.object({ maxDiscount: z.number().min(0).max(100), financeThreshold: z.number().min(0).max(100) }).safeParse(req.body);
  if (!parsed.success) return fail(res, 422, 'VALIDATION_ERROR', 'Enter valid policy values.');
  const existing = await db.discountPolicy.findFirst({ where: { id: routeParam(req, 'id'), organizationId: req.user!.organizationId } });
  if (!existing) return fail(res, 404, 'NOT_FOUND', 'Policy not found.');
  const policy = await db.discountPolicy.update({ where: { id: existing.id }, data: parsed.data });
  await audit(req.user, 'POLICY_UPDATED', 'DiscountPolicy', policy.id);
  return ok(res, policy);
});

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error(error);
  return fail(res, 500, 'INTERNAL_ERROR', 'The request could not be completed.');
});
