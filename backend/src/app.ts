import './env.js';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { db } from './db.js';
import { createGoogleOrganizationAdmin, createOrganizationAdmin, findOrLinkGoogleLoginUser, googleSignupSchema, signupSchema, verifyGoogleSignupCredential } from './identity.js';
import { allocateStock, billingSchedule, calculateQuote } from './rules.js';
import { authenticate as authenticatePlatform, csrfCookieName, hashToken as hashPlatformToken, identityDto, platformSessionCookieName } from './authorization.js';
import { platformRouter } from './platform.js';
import { clearPlatformLoginFailures, platformLoginAllowed, platformOwnerCredentialsMatch, readPlatformOwnerCredentials, recordPlatformLoginFailure } from './platform-owner.js';

type Actor = { id: string; name: string; email: string; loginId: string | null; role: string; customerId: string | null; organizationId: string; moduleAccess: string[]; csrfToken: string; actorType: 'USER' | 'PLATFORM_OWNER'; platformSuperAdmin: boolean; readOnlyView: boolean; organization: { id: string; name: string; status: string } | null; viewContext: { readOnly: true; organizationId: string; organizationName: string; simulatedUserId: string | null; realActor: { id: string; name: string } } | null };
type AuthRequest = Request & { user?: Actor; requestId?: string };
type Tx = Prisma.TransactionClient;

class DomainError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

const cookieName = process.env.SESSION_COOKIE_NAME ?? 'dealos_session';
const allowedOrigin = process.env.FRONTEND_ORIGIN ?? 'http://localhost:5173';
const googleClientId = process.env.GOOGLE_CLIENT_ID?.trim() ?? '';
const modules = ['dashboard','quotations','approvals','fulfillment','subscriptions','invoices','health','reports','products','policies'] as const;
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

async function startSession(user: { id: string }, res: Response) {
  const token = crypto.randomBytes(32).toString('hex');
  await db.session.create({ data: { userId: user.id, tokenHash: hash(token), expiresAt: new Date(Date.now() + 12 * 60 * 60 * 1000) } });
  res.setHeader('Set-Cookie', `${cookieName}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=43200${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`);
  res.append('Set-Cookie', `${platformSessionCookieName}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
  return token;
}

export const app = express();
app.use((req: AuthRequest, res, next) => {
  req.requestId = /^[a-zA-Z0-9_-]{8,80}$/.test(String(req.headers['x-request-id'] ?? '')) ? String(req.headers['x-request-id']) : crypto.randomUUID();
  res.setHeader('X-Request-ID', req.requestId);
  next();
});
app.use(helmet());
app.use(cors({ origin: allowedOrigin, credentials: true }));
app.use(express.json({ limit: '256kb' }));

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
const canAccessInternalQuote = (actor: Actor, quote: { ownerId: string; organizationId: string }) => quote.organizationId === actor.organizationId && (actor.role !== 'REP' || quote.ownerId === actor.id);
const internalQuoteWhere = (actor: Actor) => ({ organizationId: actor.organizationId, ...(actor.role === 'REP' ? { ownerId: actor.id } : {}) });

function portalQuoteDto(quote: any) {
  return {
    id: quote.id, number: quote.number, customer: quote.customer, customerTier: quote.customerTier,
    stage: quote.stage, version: quote.version, orderDiscount: quote.orderDiscount, total: quote.total,
    taxTotal: quote.taxTotal, totalsByCadence: quote.totalsByCadence, sentAt: quote.sentAt,
    lines: quote.lines.map((line: any) => ({
      id: line.id, productId: line.productId, quantity: line.quantity, unitPrice: line.unitPrice,
      discount: line.discount, product: {
        id: line.product.id, name: line.product.name, sku: line.product.sku, category: line.product.category,
        description: line.product.description, unit: line.product.unit, price: line.product.price,
        taxRate: line.product.taxRate, recurring: line.product.recurring, cadence: line.product.cadence, active: line.product.active,
      },
    })),
    approvals: [], fulfillment: null, invoices: quote.invoices?.map((invoice: any) => ({ id: invoice.id, number: invoice.number, state: invoice.state })) ?? [],
    negotiation: quote.negotiation.map((record: any) => ({ id: record.id, author: record.author, message: record.message, counterDiscount: record.counterDiscount, kind: record.kind, state: record.state, createdAt: record.createdAt })),
  };
}

function portalInvoiceDto(invoice: any) {
  return {
    id: invoice.id, number: invoice.number, customer: invoice.customer, amount: invoice.amount,
    paidAmount: invoice.paidAmount, state: invoice.state, dueAt: invoice.dueAt, lines: invoice.lines,
    payments: invoice.payments.map((payment: any) => ({ id: payment.id, amount: payment.amount, paidAt: payment.paidAt })),
  };
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
    const profile = await verifyGoogleSignupCredential(parsed.data.credential, googleClientId);
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
    const profile = await verifyGoogleSignupCredential(parsed.data.credential, googleClientId);
    const user = await findOrLinkGoogleLoginUser(profile);
    if (!user) return fail(req, res, 401, 'INVALID_CREDENTIALS', 'No active workspace was found for this Google account. Create an account first or sign in with work email.');
    const token = await startSession(user, res);
    return ok(req, res, { id: user.id, name: user.name, email: user.email, role: user.role, csrfToken: csrfForToken(token) });
  } catch { return fail(req, res, 401, 'INVALID_GOOGLE_CREDENTIAL', 'Google could not verify this sign-in.'); }
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
  const users = await db.user.findMany({ where: { organizationId: req.user!.organizationId }, select: { id: true, name: true, email: true, loginId: true, role: true, status: true, moduleAccess: true, customerId: true, createdAt: true }, orderBy: { createdAt: 'desc' } });
  return ok(req, res, users);
});
app.patch('/api/v1/admin/users/:id', authenticate, requireRole('ADMIN'), requireCsrf, async (req: AuthRequest, res) => {
  const parsed = z.object({ status: z.enum(['PENDING', 'ACTIVE', 'DISABLED']).optional(), role: z.enum(['REP', 'MANAGER', 'FINANCE', 'ADMIN', 'CUSTOMER']).optional(), customerId: z.string().uuid().nullable().optional(), moduleAccess: z.array(z.enum(modules)).max(modules.length).optional() }).strict().safeParse(req.body);
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
  const parsed = z.object({ name: z.string().trim().min(1).max(120), modules: z.array(z.enum(modules)).min(1).max(modules.length) }).strict().safeParse(req.body);
  if (!parsed.success) return fail(req, res, 422, 'VALIDATION_ERROR', 'Enter a user name and select at least one module.');
  const loginId = `DL-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
  const password = `Deal-${crypto.randomBytes(4).toString('base64url')}-${crypto.randomBytes(4).toString('base64url')}!`;
  const passwordHash = await bcrypt.hash(password, 12);
  const user = await db.$transaction(async (tx) => {
    const created = await tx.user.create({ data: { organizationId: req.user!.organizationId, name: parsed.data.name, email: `${loginId.toLowerCase()}@users.dealos.local`, loginId, passwordHash, status: 'ACTIVE', role: 'REP', moduleAccess: parsed.data.modules } });
    await tx.organizationMembership.create({ data: { organizationId: req.user!.organizationId, userId: created.id, accessRole: 'ORGANIZATION_MEMBER', businessRole: 'REP' } });
    await audit(tx, req, 'USER_ACCESS_CREATED', 'User', created.id, parsed.data.modules.join(','));
    return created;
  });
  return ok(req, res, { user: { id: user.id, name: user.name, loginId: user.loginId, moduleAccess: user.moduleAccess }, credentials: { loginId, password } }, 201);
});

app.get('/api/v1/workspace', authenticate, async (req: AuthRequest, res) => {
  if (req.user!.actorType === 'PLATFORM_OWNER' && !req.user!.organizationId) {
    return ok(req, res, { user: req.user, organization: null, users: [], quotes: [], products: [], policies: [], warehouses: [], subscriptions: [], invoices: [], alerts: [], audits: [] });
  }
  const portal = req.user!.role === 'CUSTOMER';
  if (portal && !req.user!.customerId) return fail(req, res, 403, 'FORBIDDEN', 'This portal account is not linked to a customer.');
  const quoteWhere = portal ? { organizationId: req.user!.organizationId, customerId: req.user!.customerId!, sentAt: { not: null } } : internalQuoteWhere(req.user!);
  const [organization, users, rawQuotes, products, policies, warehouses, rawSubscriptions, rawInvoices, alerts, audits] = await Promise.all([
    db.organization.findUnique({ where: { id: req.user!.organizationId }, select: { id: true, name: true } }),
    req.user!.role === 'ADMIN' ? db.user.findMany({ where: { organizationId: req.user!.organizationId }, select: { id: true, name: true, loginId: true, status: true, moduleAccess: true, createdAt: true }, orderBy: { createdAt: 'desc' } }) : [],
    db.quote.findMany({ where: quoteWhere, include: { owner: { select: { id: true, name: true } }, lines: { include: { product: true } }, approvals: { orderBy: [{ cycle: 'desc' }, { sequence: 'asc' }] }, fulfillment: true, negotiation: { orderBy: { createdAt: 'desc' } }, invoices: true }, orderBy: { updatedAt: 'desc' } }),
    !portal && hasModule(req.user, 'products') ? db.product.findMany({ where: { organizationId: req.user!.organizationId }, include: { stocks: { include: { warehouse: true } } }, orderBy: { name: 'asc' } }) : [],
    !portal && hasModule(req.user, 'policies') ? db.discountPolicy.findMany({ where: { organizationId: req.user!.organizationId }, orderBy: { tier: 'asc' } }) : [],
    !portal && hasModule(req.user, 'fulfillment') ? db.warehouse.findMany({ where: { organizationId: req.user!.organizationId }, include: { stocks: { include: { product: true } } }, orderBy: { priority: 'asc' } }) : [],
    !portal && hasModule(req.user, 'subscriptions') ? db.subscription.findMany({ where: { organizationId: req.user!.organizationId, ...(req.user!.role === 'REP' ? { order: { quote: { ownerId: req.user!.id } } } : {}) }, orderBy: { nextBillAt: 'asc' } }) : [],
    (portal || hasModule(req.user, 'invoices')) ? db.invoice.findMany({ where: { organizationId: req.user!.organizationId, ...(portal ? { customerId: req.user!.customerId! } : req.user!.role === 'REP' ? { quote: { ownerId: req.user!.id } } : {}) }, include: { payments: true }, orderBy: { createdAt: 'desc' } }) : [],
    !portal && hasModule(req.user, 'health') ? db.alert.findMany({ where: { organizationId: req.user!.organizationId }, orderBy: { createdAt: 'desc' } }) : [],
    !portal && (hasModule(req.user, 'reports') || hasModule(req.user, 'health')) ? db.auditEvent.findMany({ where: { organizationId: req.user!.organizationId, ...(req.user!.role === 'REP' ? { actorId: req.user!.id } : {}) }, orderBy: { createdAt: 'desc' }, take: 60 }) : [],
  ]);
  const quotes = portal ? rawQuotes.map(portalQuoteDto) : rawQuotes;
  const invoices = portal ? rawInvoices.map(portalInvoiceDto) : rawInvoices;
  const subscriptions = rawSubscriptions.map((subscription) => ({ ...subscription, schedule: billingSchedule(subscription.nextBillAt, subscription.cadence) }));
  return ok(req, res, { user: req.user, organization, users, quotes, products, policies, warehouses, subscriptions, invoices, alerts, audits });
});

const quoteCreateSchema = z.object({ customer: z.string().trim().min(2).optional(), customerId: z.string().uuid().optional(), customerTier: z.string().trim().min(2).optional() }).strict().refine((value) => value.customer || value.customerId, { message: 'Customer is required.' });
app.post('/api/v1/quotations', authenticate, requireModule('quotations'), requireRole('REP', 'ADMIN'), requireCsrf, async (req: AuthRequest, res) => {
  const parsed = quoteCreateSchema.safeParse(req.body);
  if (!parsed.success) return fail(req, res, 422, 'VALIDATION_ERROR', 'Customer and tier are required.', parsed.error.flatten());
  let customer = parsed.data.customerId ? await db.customer.findFirst({ where: { id: parsed.data.customerId, organizationId: req.user!.organizationId, active: true } }) : await db.customer.findFirst({ where: { organizationId: req.user!.organizationId, name: { equals: parsed.data.customer!, mode: 'insensitive' }, active: true } });
  if (!customer && parsed.data.customer) customer = await db.customer.create({ data: { organizationId: req.user!.organizationId, name: parsed.data.customer, tier: parsed.data.customerTier ?? 'Bronze', currency: 'INR' } });
  if (!customer) return fail(req, res, 422, 'CONFIGURATION_REQUIRED', 'Select an active customer.');
  const number = `Q-${Date.now().toString().slice(-8)}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
  const quote = await db.$transaction(async (tx) => {
    const created = await tx.quote.create({ data: { organizationId: req.user!.organizationId, number, customer: customer!.name, customerId: customer!.id, customerTier: parsed.data.customerTier ?? customer!.tier, ownerId: req.user!.id } });
    const revision = await tx.quoteRevision.create({ data: { quoteId: created.id, revisionNumber: 1, state: 'DRAFT', orderDiscount: 0, subtotal: 0, taxTotal: 0, total: 0, margin: 0, riskScore: 0, totalsByCadence: {}, linesSnapshot: [], policySnapshot: {}, termsHash: termsHash({ quoteId: created.id, revision: 1, nonce: crypto.randomUUID() }) } });
    const result = await tx.quote.update({ where: { id: created.id }, data: { currentRevisionId: revision.id } });
    await audit(tx, req, 'QUOTE_CREATED', 'Quote', created.id, undefined, revision.id);
    return result;
  });
  return ok(req, res, quote, 201);
});

const draftSchema = z.object({ version: z.number().int(), orderDiscount: z.number().min(0).max(100), lines: z.array(z.object({ productId: z.string().uuid(), quantity: z.number().int().positive(), discount: z.number().min(0).max(100) }).strict()).min(1).max(200) }).strict();
app.put('/api/v1/quotations/:id/draft', authenticate, requireModule('quotations'), requireRole('REP', 'ADMIN'), requireCsrf, async (req: AuthRequest, res) => {
  const parsed = draftSchema.safeParse(req.body);
  if (!parsed.success) return fail(req, res, 422, 'VALIDATION_ERROR', 'Add valid quotation lines.', parsed.error.flatten());
  const quote = await db.quote.findUnique({ where: { id: routeParam(req, 'id') }, include: { currentRevision: true } });
  if (!quote || !canAccessInternalQuote(req.user!, quote)) return fail(req, res, 404, 'NOT_FOUND', 'Quotation not found.');
  if (quote.version !== parsed.data.version || quote.stage !== 'DRAFT' || quote.currentRevision?.state !== 'DRAFT') return fail(req, res, 409, 'STALE_VERSION', 'Refresh the quotation before saving.');
  const products = await db.product.findMany({ where: { id: { in: parsed.data.lines.map((line) => line.productId) }, organizationId: req.user!.organizationId, active: true } });
  if (products.length !== new Set(parsed.data.lines.map((line) => line.productId)).size) return fail(req, res, 422, 'CONFIGURATION_REQUIRED', 'One or more products are unavailable.');
  const policy = await db.discountPolicy.findFirst({ where: { organizationId: req.user!.organizationId, tier: quote.customerTier } });
  if (!policy) return fail(req, res, 422, 'CONFIGURATION_REQUIRED', 'Configure this customer tier before saving.');
  const inputs = parsed.data.lines.map((line) => { const product = products.find((item) => item.id === line.productId)!; const categoryLimit = product.category === 'Hardware' ? policy.hardwareLimit : product.category === 'Services' ? policy.servicesLimit : policy.subscriptionLimit; return { ...line, unitPrice: product.price, unitCost: product.cost, taxRate: product.taxRate, cadence: product.recurring ? product.cadence : 'One-time', allowedDiscount: Prisma.Decimal.min(policy.maxDiscount, categoryLimit) }; });
  const calculation = calculateQuote(inputs, parsed.data.orderDiscount, { financeThreshold: policy.financeThreshold });
  const snapshot = inputs.map((line) => ({ productId: line.productId, quantity: line.quantity, unitPrice: line.unitPrice.toString(), unitCost: line.unitCost.toString(), taxRate: line.taxRate.toString(), cadence: line.cadence, discount: line.discount, allowedDiscount: line.allowedDiscount.toString() }));
  const updated = await db.$transaction(async (tx) => {
    const won = await tx.quote.updateMany({ where: { id: quote.id, version: parsed.data.version, stage: 'DRAFT' }, data: { orderDiscount: parsed.data.orderDiscount, total: calculation.total, taxTotal: calculation.taxTotal, totalsByCadence: asJson(calculation.totalsByCadence), margin: calculation.margin, riskScore: calculation.riskScore, version: { increment: 1 }, lastActivity: new Date() } });
    if (won.count !== 1) throw new DomainError(409, 'STALE_VERSION', 'Refresh the quotation before saving.');
    await tx.quoteLine.deleteMany({ where: { quoteId: quote.id } });
    await tx.quoteLine.createMany({ data: inputs.map((line) => ({ quoteId: quote.id, productId: line.productId, quantity: line.quantity, unitPrice: line.unitPrice, unitCost: line.unitCost, discount: line.discount, allowedDiscount: line.allowedDiscount })) });
    await tx.quoteRevision.update({ where: { id: quote.currentRevisionId! }, data: { orderDiscount: parsed.data.orderDiscount, subtotal: calculation.subtotal, taxTotal: calculation.taxTotal, total: calculation.total, margin: calculation.margin, riskScore: calculation.riskScore, totalsByCadence: asJson(calculation.totalsByCadence), linesSnapshot: asJson(snapshot), policySnapshot: asJson({ id: policy.id, version: policy.version, tier: policy.tier, financeThreshold: policy.financeThreshold.toString() }), termsHash: termsHash({ quoteId: quote.id, revisionId: quote.currentRevisionId, snapshot, orderDiscount: parsed.data.orderDiscount, calculation }) } });
    await audit(tx, req, 'QUOTE_SAVED', 'Quote', quote.id, undefined, quote.currentRevisionId!);
    return tx.quote.findUniqueOrThrow({ where: { id: quote.id }, include: { lines: { include: { product: true } } } });
  });
  return ok(req, res, { quote: updated, calculation });
});

app.post('/api/v1/quotations/:id/submit', authenticate, requireModule('quotations'), requireRole('REP', 'ADMIN'), requireCsrf, async (req: AuthRequest, res) => {
  const quote = await db.quote.findUnique({ where: { id: routeParam(req, 'id') }, include: { currentRevision: true, lines: { include: { product: true } } } });
  if (!quote || !canAccessInternalQuote(req.user!, quote)) return fail(req, res, 404, 'NOT_FOUND', 'Quotation not found.');
  if (quote.stage !== 'DRAFT' || quote.currentRevision?.state !== 'DRAFT' || !quote.lines.length) return fail(req, res, 409, 'INVALID_STATE', 'Only a complete draft can be submitted.');
  const policy = await db.discountPolicy.findFirst({ where: { organizationId: req.user!.organizationId, tier: quote.customerTier } });
  if (!policy) return fail(req, res, 422, 'CONFIGURATION_REQUIRED', 'Configure this customer tier before submitting.');
  const calculation = calculateQuote(quote.lines.map((line) => ({ quantity: line.quantity, unitPrice: line.unitPrice, unitCost: line.unitCost, discount: line.discount, allowedDiscount: line.allowedDiscount, taxRate: line.product.taxRate, cadence: line.product.recurring ? line.product.cadence : 'One-time' })), quote.orderDiscount, { financeThreshold: policy.financeThreshold });
  const result = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Quote" WHERE "id" = ${quote.id} FOR UPDATE`;
    const latest = await tx.quote.findUniqueOrThrow({ where: { id: quote.id }, include: { currentRevision: true } });
    if (latest.stage !== 'DRAFT' || latest.currentRevisionId !== quote.currentRevisionId) throw new DomainError(409, 'STALE_VERSION', 'Refresh the quotation before submitting.');
    const previous = await tx.approval.findFirst({ where: { quoteId: quote.id }, orderBy: { cycle: 'desc' } });
    const cycle = (previous?.cycle ?? 0) + 1;
    const steps: Array<{ step: string; sequence: number; state: 'PENDING' | 'WAITING' }> = [];
    if (calculation.needsManager) steps.push({ step: 'Sales Manager', sequence: 1, state: 'PENDING' });
    if (calculation.needsFinance) steps.push({ step: 'Finance', sequence: steps.length + 1, state: steps.length ? 'WAITING' : 'PENDING' });
    await tx.quoteRevision.update({ where: { id: quote.currentRevisionId! }, data: { state: 'SUBMITTED', submittedById: req.user!.id, policySnapshot: asJson({ id: policy.id, version: policy.version, tier: policy.tier, financeThreshold: policy.financeThreshold.toString(), calculation: { worstExcess: calculation.worstExcess, weightedExcess: calculation.weightedExcess, marginPercent: calculation.marginPercent } }) } });
    if (steps.length) await tx.approval.createMany({ data: steps.map((step) => ({ quoteId: quote.id, revisionId: quote.currentRevisionId!, cycle, ...step })) });
    const updated = await tx.quote.update({ where: { id: quote.id }, data: { stage: steps.length ? 'PENDING_APPROVAL' : 'APPROVED', version: { increment: 1 }, lastActivity: new Date() } });
    await audit(tx, req, 'QUOTE_SUBMITTED', 'Quote', quote.id, steps.length ? steps.map((step) => step.step).join(' then ') : 'Within policy; auto-approved', quote.currentRevisionId!);
    return updated;
  });
  return ok(req, res, result);
});

app.post('/api/v1/approvals/:id/decision', authenticate, requireModule('approvals'), requireRole('MANAGER', 'FINANCE', 'ADMIN'), requireCsrf, async (req: AuthRequest, res) => {
  const parsed = z.object({ decision: z.enum(['APPROVE', 'RETURN', 'REJECT']), reason: z.string().trim().min(2).max(2000) }).strict().safeParse(req.body);
  if (!parsed.success) return fail(req, res, 422, 'VALIDATION_ERROR', 'A decision and reason are required.');
  const approvalId = routeParam(req, 'id');
  const result = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Approval" WHERE "id" = ${approvalId} FOR UPDATE`;
    const approval = await tx.approval.findUnique({ where: { id: approvalId }, include: { quote: true, revision: true } });
    if (!approval || approval.quote.organizationId !== req.user!.organizationId) throw new DomainError(404, 'NOT_FOUND', 'Approval not found.');
    if (approval.state === 'WAITING') throw new DomainError(409, 'APPROVAL_STEP_BLOCKED', 'The previous approval step is incomplete.');
    if (approval.state !== 'PENDING') throw new DomainError(409, 'INVALID_STATE', 'This approval is no longer pending.');
    if (approval.step === 'Sales Manager' && !['MANAGER', 'ADMIN'].includes(req.user!.role)) throw new DomainError(403, 'FORBIDDEN', 'A Sales Manager must complete this step.');
    if (approval.step === 'Finance' && !['FINANCE', 'ADMIN'].includes(req.user!.role)) throw new DomainError(403, 'FORBIDDEN', 'Finance must complete this step.');
    if (approval.quote.ownerId === req.user!.id || approval.revision.submittedById === req.user!.id) throw new DomainError(409, 'SELF_APPROVAL_NOT_ALLOWED', 'The quotation owner cannot approve their own deal.');
    const state = parsed.data.decision === 'APPROVE' ? 'APPROVED' : parsed.data.decision === 'RETURN' ? 'RETURNED' : 'REJECTED';
    const step = await tx.approval.update({ where: { id: approval.id }, data: { state, reviewerId: req.user!.id, reason: parsed.data.reason, decidedAt: new Date() } });
    if (state === 'APPROVED') {
      const next = await tx.approval.findFirst({ where: { quoteId: approval.quoteId, cycle: approval.cycle, state: 'WAITING' }, orderBy: { sequence: 'asc' } });
      if (next) await tx.approval.update({ where: { id: next.id }, data: { state: 'PENDING' } });
      else await tx.quote.update({ where: { id: approval.quoteId }, data: { stage: 'APPROVED', version: { increment: 1 }, lastActivity: new Date() } });
    } else {
      await tx.approval.updateMany({ where: { quoteId: approval.quoteId, cycle: approval.cycle, id: { not: approval.id }, state: { in: ['PENDING', 'WAITING'] } }, data: { state: 'SUPERSEDED' } });
      if (state === 'RETURNED') {
        const latestRevision = await tx.quoteRevision.findFirst({ where: { quoteId: approval.quoteId }, orderBy: { revisionNumber: 'desc' } });
        const revision = await tx.quoteRevision.create({ data: { quoteId: approval.quoteId, revisionNumber: (latestRevision?.revisionNumber ?? 0) + 1, state: 'DRAFT', orderDiscount: approval.revision.orderDiscount, subtotal: approval.revision.subtotal, taxTotal: approval.revision.taxTotal, total: approval.revision.total, margin: approval.revision.margin, riskScore: approval.revision.riskScore, totalsByCadence: approval.revision.totalsByCadence as Prisma.InputJsonValue, linesSnapshot: approval.revision.linesSnapshot as Prisma.InputJsonValue, policySnapshot: approval.revision.policySnapshot as Prisma.InputJsonValue, termsHash: termsHash({ source: approval.revisionId, nonce: crypto.randomUUID() }) } });
        await tx.quote.update({ where: { id: approval.quoteId }, data: { stage: 'DRAFT', currentRevisionId: revision.id, sentAt: null, version: { increment: 1 }, lastActivity: new Date() } });
      } else await tx.quote.update({ where: { id: approval.quoteId }, data: { stage: 'REJECTED', version: { increment: 1 }, lastActivity: new Date() } });
    }
    await audit(tx, req, `APPROVAL_${parsed.data.decision}`, 'Quote', approval.quoteId, parsed.data.reason, approval.revisionId);
    return step;
  });
  return ok(req, res, result);
});

app.post('/api/v1/quotations/:id/send', authenticate, requireModule('quotations'), requireRole('REP', 'ADMIN'), requireCsrf, async (req: AuthRequest, res) => {
  const quote = await db.quote.findUnique({ where: { id: routeParam(req, 'id') }, include: { currentRevision: true } });
  if (!quote || !canAccessInternalQuote(req.user!, quote)) return fail(req, res, 404, 'NOT_FOUND', 'Quotation not found.');
  if (quote.stage !== 'APPROVED' || !quote.currentRevision) return fail(req, res, 409, 'INVALID_STATE', 'Only the current approved revision can be sent.');
  const sentAt = new Date();
  const updated = await db.$transaction(async (tx) => {
    await tx.quoteRevision.update({ where: { id: quote.currentRevisionId! }, data: { state: 'SENT', sentAt } });
    const result = await tx.quote.update({ where: { id: quote.id }, data: { sentAt, version: { increment: 1 }, lastActivity: sentAt } });
    await audit(tx, req, 'QUOTE_SENT', 'Quote', quote.id, undefined, quote.currentRevisionId!);
    return result;
  });
  return ok(req, res, updated);
});

app.post('/api/v1/portal/quotations/:id/message', authenticate, requireRole('CUSTOMER'), requireCsrf, async (req: AuthRequest, res) => {
  const parsed = z.object({ message: z.string().trim().min(2).max(2000), counterDiscount: z.number().min(0).max(100).optional() }).strict().safeParse(req.body);
  if (!parsed.success) return fail(req, res, 422, 'VALIDATION_ERROR', 'Enter a valid request.');
  const quote = await db.quote.findFirst({ where: { id: routeParam(req, 'id'), organizationId: req.user!.organizationId, customerId: req.user!.customerId ?? '__none__', sentAt: { not: null } } });
  if (!quote?.currentRevisionId) return fail(req, res, 404, 'NOT_FOUND', 'Quotation not found.');
  const kind = parsed.data.counterDiscount === undefined ? 'COMMENT' : 'PROPOSAL';
  const negotiation = await db.$transaction(async (tx) => {
    const record = await tx.negotiation.create({ data: { quoteId: quote.id, revisionId: quote.currentRevisionId!, author: req.user!.name, message: parsed.data.message, counterDiscount: parsed.data.counterDiscount, kind } });
    if (kind === 'PROPOSAL') await tx.quote.update({ where: { id: quote.id }, data: { stage: 'NEGOTIATION', lastActivity: new Date() } });
    await audit(tx, req, kind === 'COMMENT' ? 'CUSTOMER_COMMENTED' : 'CUSTOMER_PROPOSED_CHANGE', 'Quote', quote.id, parsed.data.message, quote.currentRevisionId!);
    return record;
  });
  return ok(req, res, negotiation, 201);
});

app.post('/api/v1/quotations/:id/proposals/:proposalId/respond', authenticate, requireModule('quotations'), requireRole('REP', 'ADMIN'), requireCsrf, async (req: AuthRequest, res) => {
  const parsed = z.object({ decision: z.enum(['ADOPT', 'DECLINE']), reason: z.string().trim().min(2).max(2000) }).strict().safeParse(req.body);
  if (!parsed.success) return fail(req, res, 422, 'VALIDATION_ERROR', 'A decision and reason are required.');
  const quote = await db.quote.findUnique({ where: { id: routeParam(req, 'id') }, include: { lines: { include: { product: true } }, currentRevision: true } });
  if (!quote || !canAccessInternalQuote(req.user!, quote)) return fail(req, res, 404, 'NOT_FOUND', 'Quotation not found.');
  const proposal = await db.negotiation.findFirst({ where: { id: routeParam(req, 'proposalId'), quoteId: quote.id, revisionId: quote.currentRevisionId ?? '__none__', kind: 'PROPOSAL', state: 'OPEN' } });
  if (!proposal) return fail(req, res, 409, 'INVALID_STATE', 'This proposal is no longer open.');
  if (parsed.data.decision === 'DECLINE') {
    const declined = await db.$transaction(async (tx) => { const record = await tx.negotiation.update({ where: { id: proposal.id }, data: { state: 'DECLINED' } }); await audit(tx, req, 'CUSTOMER_PROPOSAL_DECLINED', 'Quote', quote.id, parsed.data.reason, proposal.revisionId); return record; });
    return ok(req, res, { proposal: declined, quotation: quote });
  }
  const policy = await db.discountPolicy.findFirst({ where: { organizationId: req.user!.organizationId, tier: quote.customerTier } });
  const proposedDiscount = proposal.counterDiscount;
  if (!policy || proposedDiscount === null) return fail(req, res, 422, 'CONFIGURATION_REQUIRED', 'The proposal cannot be calculated.');
  const calculation = calculateQuote(quote.lines.map((line) => ({ quantity: line.quantity, unitPrice: line.unitPrice, unitCost: line.unitCost, discount: line.discount, allowedDiscount: line.allowedDiscount, taxRate: line.product.taxRate, cadence: line.product.recurring ? line.product.cadence : 'One-time' })), proposedDiscount, { financeThreshold: policy.financeThreshold });
  const adopted = await db.$transaction(async (tx) => {
    await tx.quoteRevision.update({ where: { id: quote.currentRevisionId! }, data: { state: 'SUPERSEDED' } });
    const latest = await tx.quoteRevision.findFirst({ where: { quoteId: quote.id }, orderBy: { revisionNumber: 'desc' } });
    const revision = await tx.quoteRevision.create({ data: { quoteId: quote.id, revisionNumber: (latest?.revisionNumber ?? 0) + 1, state: 'DRAFT', orderDiscount: proposedDiscount, subtotal: calculation.subtotal, taxTotal: calculation.taxTotal, total: calculation.total, margin: calculation.margin, riskScore: calculation.riskScore, totalsByCadence: asJson(calculation.totalsByCadence), linesSnapshot: quote.currentRevision!.linesSnapshot as Prisma.InputJsonValue, policySnapshot: asJson({ id: policy.id, version: policy.version, financeThreshold: policy.financeThreshold.toString() }), termsHash: termsHash({ source: proposal.revisionId, counterDiscount: proposedDiscount.toString(), calculation }) } });
    const updated = await tx.quote.update({ where: { id: quote.id }, data: { currentRevisionId: revision.id, stage: 'DRAFT', sentAt: null, orderDiscount: proposedDiscount, total: calculation.total, taxTotal: calculation.taxTotal, totalsByCadence: asJson(calculation.totalsByCadence), margin: calculation.margin, riskScore: calculation.riskScore, version: { increment: 1 }, lastActivity: new Date() } });
    const record = await tx.negotiation.update({ where: { id: proposal.id }, data: { state: 'ADOPTED' } });
    await audit(tx, req, 'CUSTOMER_PROPOSAL_ADOPTED', 'Quote', quote.id, parsed.data.reason, revision.id);
    return { proposal: record, quotation: updated, calculation };
  });
  return ok(req, res, adopted);
});

app.post('/api/v1/portal/quotations/:id/confirm', authenticate, requireRole('CUSTOMER'), requireCsrf, async (req: AuthRequest, res) => {
  const quoteId = routeParam(req, 'id');
  const result = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Quote" WHERE "id" = ${quoteId} FOR UPDATE`;
    const quote = await tx.quote.findFirst({ where: { id: quoteId, organizationId: req.user!.organizationId, customerId: req.user!.customerId ?? '__none__' }, include: { currentRevision: true, lines: { include: { product: true } }, order: true } });
    if (!quote) throw new DomainError(404, 'NOT_FOUND', 'Quotation not found.');
    if (quote.order) return tx.quote.update({ where: { id: quote.id }, data: { stage: 'CONFIRMED' } });
    if (quote.stage !== 'APPROVED' || quote.currentRevision?.state !== 'SENT' || !quote.sentAt) throw new DomainError(409, 'INVALID_STATE', 'This quotation requires approval before confirmation.');
    const acceptance = await tx.customerAcceptance.create({ data: { quoteId: quote.id, revisionId: quote.currentRevision.id, customerId: quote.customerId, acceptedById: req.user!.id, termsHash: quote.currentRevision.termsHash } });
    const order = await tx.order.create({ data: { number: `SO-${quote.number.replace(/^Q-/, '')}`, quoteId: quote.id, revisionId: quote.currentRevision.id, acceptanceId: acceptance.id, customerId: quote.customerId, currency: 'INR' } });
    const orderLines = [];
    for (const line of quote.lines) orderLines.push(await tx.orderLine.create({ data: { orderId: order.id, quoteLineId: line.id, productId: line.productId, quantity: line.quantity, recurring: line.product.recurring, cadence: line.product.cadence, snapshot: asJson({ description: line.product.name, sku: line.product.sku, unitPrice: line.unitPrice.toString(), unitCost: line.unitCost.toString(), taxRate: line.product.taxRate.toString(), discount: line.discount.toString(), orderDiscount: quote.orderDiscount.toString() }) } }));
    const calculation = calculateQuote(quote.lines.map((line) => ({ quantity: line.quantity, unitPrice: line.unitPrice, unitCost: line.unitCost, discount: line.discount, allowedDiscount: line.allowedDiscount, taxRate: line.product.taxRate, cadence: line.product.recurring ? line.product.cadence : 'One-time' })), quote.orderDiscount);
    const invoiceLines = calculation.lines.map((line, index) => ({ description: quote.lines[index]!.product.name, productId: quote.lines[index]!.productId, cadence: line.cadence, quantity: line.quantity, net: line.net, tax: line.tax, amount: line.net + line.tax }));
    await tx.invoice.create({ data: { organizationId: req.user!.organizationId, number: `INV-${quote.number.replace(/^Q-/, '')}`, quoteId: quote.id, orderId: order.id, customer: quote.customer, customerId: quote.customerId, amount: calculation.total, dueAt: new Date(Date.now() + 14 * 86_400_000), lines: asJson(invoiceLines) } });
    for (let index = 0; index < quote.lines.length; index++) { const line = quote.lines[index]!; if (!line.product.recurring) continue; const calculatedLine = calculation.lines[index]!; const nextBillAt = billingSchedule(new Date(), line.product.cadence ?? 'Monthly', 2)[1]!; await tx.subscription.create({ data: { organizationId: req.user!.organizationId, customer: quote.customer, customerId: quote.customerId, quoteId: quote.id, orderId: order.id, orderLineId: orderLines[index]!.id, productId: line.productId, productName: line.product.name, cadence: line.product.cadence ?? 'Monthly', amount: calculatedLine.net + calculatedLine.tax, nextBillAt } }); }
    const updated = await tx.quote.update({ where: { id: quote.id }, data: { stage: 'CONFIRMED', version: { increment: 1 }, lastActivity: new Date() } });
    await audit(tx, req, 'CUSTOMER_CONFIRMED', 'Quote', quote.id, undefined, quote.currentRevision.id);
    return updated;
  });
  return ok(req, res, result);
});

app.post('/api/v1/fulfillment/:quoteId/allocate', authenticate, requireModule('fulfillment'), requireRole('FINANCE', 'ADMIN'), requireCsrf, async (req: AuthRequest, res) => {
  const quoteId = routeParam(req, 'quoteId');
  const fulfillment = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Quote" WHERE "id" = ${quoteId} FOR UPDATE`;
    const quote = await tx.quote.findUnique({ where: { id: quoteId }, include: { lines: { include: { product: true } }, order: true, fulfillment: true } });
    if (!quote || quote.organizationId !== req.user!.organizationId || quote.stage !== 'CONFIRMED' || !quote.order) throw new DomainError(409, 'INVALID_STATE', 'Confirm the quotation before reserving stock.');
    if (quote.fulfillment) return quote.fulfillment;
    const tracked = quote.lines.filter((line) => !line.product.recurring && line.product.category === 'Hardware');
    const ids = await tx.stockBalance.findMany({ where: { productId: { in: tracked.map((line) => line.productId) }, warehouse: { organizationId: req.user!.organizationId } }, select: { id: true }, orderBy: { id: 'asc' } });
    if (ids.length) await tx.$queryRaw`SELECT "id" FROM "StockBalance" WHERE "id" IN (${Prisma.join(ids.map((item) => item.id))}) ORDER BY "id" FOR UPDATE`;
    const balances = await tx.stockBalance.findMany({ where: { id: { in: ids.map((item) => item.id) } }, include: { warehouse: true } });
    const allocation = allocateStock(tracked.map((line) => ({ productId: line.productId, quantity: line.quantity })), balances.map((balance) => ({ productId: balance.productId, warehouseId: balance.warehouseId, warehouseName: balance.warehouse.name, priority: balance.warehouse.priority, shippingCost: decimal(balance.warehouse.shippingCost), onHand: balance.onHand, reserved: balance.reserved })));
    for (const row of allocation.split) { const changed = await tx.stockBalance.updateMany({ where: { warehouseId: row.warehouseId, productId: row.productId, reserved: { lte: balances.find((balance) => balance.warehouseId === row.warehouseId && balance.productId === row.productId)!.onHand - row.quantity } }, data: { reserved: { increment: row.quantity } } }); if (changed.count !== 1) throw new DomainError(409, 'STOCK_CHANGED', 'Stock changed. Refresh the allocation.'); }
    const warehouseIds = [...new Set(allocation.split.map((row) => row.warehouseId))];
    const cost = warehouseIds.reduce((sum, id) => sum + decimal(balances.find((row) => row.warehouseId === id)!.warehouse.shippingCost), 0);
    const result = await tx.fulfillment.create({ data: { quoteId: quote.id, orderId: quote.order.id, split: asJson(allocation), state: allocation.backorders.length ? 'BACKORDER' : 'RESERVED', estimatedCost: cost, shipmentCount: warehouseIds.length } });
    await audit(tx, req, 'STOCK_ALLOCATED', 'Order', quote.order.id, undefined, quote.currentRevisionId ?? undefined);
    return result;
  });
  return ok(req, res, fulfillment);
});

app.post('/api/v1/subscriptions/:id/change', authenticate, requireModule('subscriptions'), requireRole('FINANCE', 'ADMIN'), requireCsrf, async (req: AuthRequest, res) => {
  const parsed = z.object({ amount: z.number().positive().optional(), cancel: z.boolean().optional() }).strict().safeParse(req.body);
  if (!parsed.success || (parsed.data.amount === undefined && !parsed.data.cancel)) return fail(req, res, 422, 'VALIDATION_ERROR', 'Enter a valid subscription change.');
  const id = routeParam(req, 'id');
  const existing = await db.subscription.findFirst({ where: { id, organizationId: req.user!.organizationId } });
  if (!existing) return fail(req, res, 404, 'NOT_FOUND', 'Subscription not found.');
  const subscription = await db.$transaction(async (tx) => { await tx.$queryRaw`SELECT "id" FROM "Subscription" WHERE "id" = ${id} FOR UPDATE`; const updated = await tx.subscription.update({ where: { id }, data: { ...(parsed.data.amount !== undefined ? { amount: parsed.data.amount } : {}), ...(parsed.data.cancel ? { state: 'CANCELLED' as const } : {}) } }); await audit(tx, req, parsed.data.cancel ? 'SUBSCRIPTION_CANCELLED' : 'SUBSCRIPTION_CHANGED', 'Subscription', updated.id); return updated; });
  return ok(req, res, { ...subscription, schedule: billingSchedule(subscription.nextBillAt, subscription.cadence) });
});

app.post('/api/v1/invoices/:id/payments', authenticate, requireModule('invoices'), requireRole('FINANCE', 'ADMIN'), requireCsrf, async (req: AuthRequest, res) => {
  const parsed = z.object({ amount: z.number().positive(), reference: z.string().trim().min(2).max(128) }).strict().safeParse(req.body);
  if (!parsed.success) return fail(req, res, 422, 'VALIDATION_ERROR', 'Amount and reference are required.');
  const invoiceId = routeParam(req, 'id');
  const idempotencyKey = String(req.headers['idempotency-key'] ?? parsed.data.reference);
  if (idempotencyKey.length < 2 || idempotencyKey.length > 128) return fail(req, res, 422, 'VALIDATION_ERROR', 'Use a valid idempotency key.');
  const payloadHash = termsHash(parsed.data);
  const updated = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Invoice" WHERE "id" = ${invoiceId} FOR UPDATE`;
    const invoice = await tx.invoice.findFirst({ where: { id: invoiceId, organizationId: req.user!.organizationId } });
    if (!invoice) throw new DomainError(404, 'NOT_FOUND', 'Invoice not found.');
    const replay = await tx.idempotencyRecord.findUnique({ where: { actorId_operation_resourceKey_key: { actorId: req.user!.id, operation: 'PAYMENT', resourceKey: invoice.id, key: idempotencyKey } } });
    if (replay && replay.payloadHash !== payloadHash) throw new DomainError(409, 'IDEMPOTENCY_CONFLICT', 'This idempotency key was already used for a different payment.');
    if (replay) return tx.invoice.findUniqueOrThrow({ where: { id: invoice.id }, include: { payments: true } });
    const duplicate = await tx.payment.findUnique({ where: { invoiceId_reference: { invoiceId: invoice.id, reference: parsed.data.reference } } });
    if (duplicate && decimal(duplicate.amount) !== parsed.data.amount) throw new DomainError(409, 'IDEMPOTENCY_CONFLICT', 'This payment reference already has a different amount.');
    if (duplicate) return tx.invoice.findUniqueOrThrow({ where: { id: invoice.id }, include: { payments: true } });
    const ledger = await tx.payment.aggregate({ where: { invoiceId: invoice.id }, _sum: { amount: true } });
    const paid = decimal(ledger._sum.amount ?? 0);
    if (paid + parsed.data.amount > decimal(invoice.amount)) throw new DomainError(422, 'AMOUNT_EXCEEDS_BALANCE', 'Payment exceeds the outstanding balance.');
    const payment = await tx.payment.create({ data: { invoiceId: invoice.id, amount: parsed.data.amount, reference: parsed.data.reference, paidAt: new Date() } });
    const newPaid = paid + parsed.data.amount;
    const result = await tx.invoice.update({ where: { id: invoice.id }, data: { paidAmount: newPaid, state: newPaid === decimal(invoice.amount) ? 'PAID' : 'PARTIAL' }, include: { payments: true } });
    await tx.idempotencyRecord.create({ data: { actorId: req.user!.id, operation: 'PAYMENT', resourceKey: invoice.id, key: idempotencyKey, payloadHash, responseStatus: 201, responseBody: asJson({ invoiceId: invoice.id, paymentId: payment.id }) } });
    await audit(tx, req, 'PAYMENT_RECORDED', 'Invoice', invoice.id, parsed.data.reference);
    return result;
  });
  return ok(req, res, updated, 201);
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
  const parsed = z.object({ name: z.string().min(2), sku: z.string().min(2), category: z.string().min(2), description: z.string(), unit: z.string().min(1), price: z.number().nonnegative(), cost: z.number().nonnegative(), taxRate: z.number().min(0).max(100), recurring: z.boolean().default(false), cadence: z.string().nullable().optional() }).strict().safeParse(req.body);
  if (!parsed.success) return fail(req, res, 422, 'VALIDATION_ERROR', 'Enter valid product values.', parsed.error.flatten());
  const product = await db.$transaction(async (tx) => { const created = await tx.product.create({ data: { ...parsed.data, organizationId: req.user!.organizationId } }); await audit(tx, req, 'PRODUCT_CREATED', 'Product', created.id); return created; });
  return ok(req, res, product, 201);
});
app.patch('/api/v1/products/:id', authenticate, requireModule('products'), requireRole('ADMIN'), requireCsrf, async (req: AuthRequest, res) => {
  const parsed = z.object({ name: z.string().min(2).optional(), category: z.string().min(2).optional(), description: z.string().optional(), unit: z.string().min(1).optional(), price: z.number().nonnegative().optional(), cost: z.number().nonnegative().optional(), taxRate: z.number().min(0).max(100).optional(), active: z.boolean().optional(), cadence: z.string().nullable().optional() }).strict().safeParse(req.body);
  if (!parsed.success) return fail(req, res, 422, 'VALIDATION_ERROR', 'Enter valid product values.');
  const existing = await db.product.findFirst({ where: { id: routeParam(req, 'id'), organizationId: req.user!.organizationId } });
  if (!existing) return fail(req, res, 404, 'NOT_FOUND', 'Product not found.');
  const product = await db.$transaction(async (tx) => { const updated = await tx.product.update({ where: { id: existing.id }, data: parsed.data }); await audit(tx, req, 'PRODUCT_UPDATED', 'Product', updated.id); return updated; });
  return ok(req, res, product);
});

app.patch('/api/v1/policies/:id', authenticate, requireModule('policies'), requireRole('ADMIN', 'MANAGER'), requireCsrf, async (req: AuthRequest, res) => {
  const parsed = z.object({ maxDiscount: z.number().min(0).max(100), financeThreshold: z.number().min(0).max(100) }).strict().safeParse(req.body);
  if (!parsed.success) return fail(req, res, 422, 'VALIDATION_ERROR', 'Enter valid policy values.');
  const existing = await db.discountPolicy.findFirst({ where: { id: routeParam(req, 'id'), organizationId: req.user!.organizationId } });
  if (!existing) return fail(req, res, 404, 'NOT_FOUND', 'Policy not found.');
  const policy = await db.$transaction(async (tx) => { const updated = await tx.discountPolicy.update({ where: { id: existing.id }, data: { ...parsed.data, version: { increment: 1 }, publishedAt: new Date() } }); await audit(tx, req, 'POLICY_UPDATED', 'DiscountPolicy', updated.id); return updated; });
  return ok(req, res, policy);
});

app.use((error: unknown, req: AuthRequest, res: Response, _next: NextFunction) => {
  if (error instanceof DomainError) return fail(req, res, error.status, error.code, error.message);
  console.error(JSON.stringify({ level: 'error', requestId: req.requestId, route: req.path, error: error instanceof Error ? error.name : 'UnknownError' }));
  return fail(req, res, 500, 'INTERNAL_ERROR', 'The request could not be completed.');
});
