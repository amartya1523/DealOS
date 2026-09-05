import crypto from 'node:crypto';
import { Router, type Response } from 'express';
import { Prisma, type AccountStatus, type MembershipStatus, type OrganizationStatus } from '@prisma/client';
import { z } from 'zod';
import { db } from './db.js';
import { type AuthRequest, requirePlatformSuperAdmin } from './authorization.js';

const router = Router();
const success = (res: Response, data: unknown, status = 200) => res.status(status).json({ success: true, data });
const failure = (res: Response, status: number, code: string, message: string) => res.status(status).json({ success: false, error: { code, message } });
const reasonSchema = z.string().trim().min(10).max(1000);
const pageSchema = z.coerce.number().int().min(1).default(1);
const limitSchema = z.coerce.number().int().min(1).max(100).default(25);

type AuditInput = {
  action: string;
  affectedModel: string;
  recordId?: string;
  organizationId?: string | null;
  targetUserId?: string | null;
  beforeValues?: Prisma.InputJsonValue;
  afterValues?: Prisma.InputJsonValue;
  reason: string;
  result?: string;
};

export function buildPrivilegedAuditData(req: AuthRequest, input: AuditInput) {
  return {
    actorId: req.auth!.actorType === 'USER' ? req.auth!.realUser.id : null,
    platformActorId: req.auth!.platformActorId,
    simulatedUserId: req.auth!.simulatedUserId,
    organizationId: input.organizationId ?? req.auth!.organization?.id ?? null,
    targetUserId: input.targetUserId ?? null,
    action: input.action,
    affectedModel: input.affectedModel,
    recordId: input.recordId,
    beforeValues: input.beforeValues,
    afterValues: input.afterValues,
    reason: input.reason,
    requestId: req.requestId ?? crypto.randomUUID(),
    ipAddress: req.ip?.slice(0, 64),
    userAgent: req.get('user-agent')?.slice(0, 255),
    result: input.result ?? 'SUCCESS',
  };
}

router.use((req: AuthRequest, res, next) => {
  res.on('finish', () => {
    if (res.statusCode < 400 || ['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return;
    const suppliedReason = typeof req.body?.reason === 'string' && req.body.reason.trim().length >= 10 ? req.body.reason.trim().slice(0, 1000) : 'Privileged request rejected by server-side authorization or validation.';
    void db.privilegedAudit.create({ data: buildPrivilegedAuditData(req, { action: 'PRIVILEGED_REQUEST_FAILED', affectedModel: 'PlatformControl', recordId: typeof req.params.id === 'string' ? req.params.id : undefined, reason: suppliedReason, result: `FAILED_${res.statusCode}` }) }).catch(() => undefined);
  });
  next();
});
router.use(requirePlatformSuperAdmin);
router.use((req: AuthRequest, res, next) => {
  if (req.auth!.readOnlyView && req.method !== 'GET' && req.path !== '/view-as/exit') return failure(res, 403, 'VIEW_AS_READ_ONLY', 'Exit View As mode before performing a privileged mutation.');
  next();
});

router.get('/dashboard', async (req: AuthRequest, res) => {
  const parsed = z.object({ page: pageSchema, limit: limitSchema, query: z.string().trim().max(100).default(''), status: z.enum(['ACTIVE', 'SUSPENDED', 'ARCHIVED']).optional() }).safeParse(req.query);
  if (!parsed.success) return failure(res, 422, 'VALIDATION_ERROR', 'Invalid dashboard filters.');
  const { page, limit, query, status } = parsed.data;
  const organizationWhere: Prisma.OrganizationWhereInput = {
    ...(query ? { OR: [{ name: { contains: query, mode: 'insensitive' } }, { slug: { contains: query, mode: 'insensitive' } }] } : {}),
    ...(status ? { status } : {}),
  };
  const [totalOrganizations, activeOrganizations, suspendedOrganizations, activeUsers, pendingInvitations, blockedDeals, organizations, filteredCount, recentActions] = await Promise.all([
    db.organization.count(),
    db.organization.count({ where: { status: 'ACTIVE' } }),
    db.organization.count({ where: { status: 'SUSPENDED' } }),
    db.user.count({ where: { status: 'ACTIVE' } }),
    db.organizationInvitation.count({ where: { status: 'PENDING', expiresAt: { gt: new Date() } } }),
    db.quote.count({ where: { stage: 'PENDING_APPROVAL', approvals: { some: { state: 'PENDING' } } } }),
    db.organization.findMany({ where: organizationWhere, orderBy: [{ status: 'asc' }, { name: 'asc' }], skip: (page - 1) * limit, take: limit, include: { _count: { select: { memberships: true, quotes: true, invoices: true } } } }),
    db.organization.count({ where: organizationWhere }),
    db.privilegedAudit.findMany({ orderBy: { createdAt: 'desc' }, take: 12, include: { actor: { select: { id: true, name: true, email: true } }, simulatedUser: { select: { id: true, name: true } }, organization: { select: { id: true, name: true } }, targetUser: { select: { id: true, name: true, email: true } } } }),
  ]);
  return success(res, {
    metrics: { totalOrganizations, activeOrganizations, suspendedOrganizations, activeUsers, pendingInvitations, blockedDeals },
    organizations,
    pagination: { page, limit, total: filteredCount, pages: Math.max(1, Math.ceil(filteredCount / limit)) },
    recentActions,
  });
});

router.get('/organizations/:id', async (req: AuthRequest, res) => {
  const organization = await db.organization.findUnique({
    where: { id: String(req.params.id) },
    include: {
      memberships: { include: { user: { select: { id: true, name: true, email: true, status: true, createdAt: true } } }, orderBy: { createdAt: 'asc' } },
      quotes: { select: { id: true, number: true, customer: true, stage: true, total: true, updatedAt: true, approvals: { select: { id: true, step: true, state: true, decidedAt: true } } }, orderBy: { updatedAt: 'desc' }, take: 50 },
      warehouses: { select: { id: true, name: true, priority: true, stocks: { select: { onHand: true, reserved: true, product: { select: { name: true, sku: true } } } } } },
      subscriptions: { select: { id: true, customer: true, productName: true, cadence: true, amount: true, nextBillAt: true, state: true }, take: 50 },
      invoices: { select: { id: true, number: true, customer: true, amount: true, paidAmount: true, state: true, dueAt: true, _count: { select: { payments: true } } }, take: 50 },
      privilegedAudits: { include: { actor: { select: { name: true, email: true } }, targetUser: { select: { name: true, email: true } } }, orderBy: { createdAt: 'desc' }, take: 50 },
      _count: { select: { products: true, alerts: true, invitations: true } },
    },
  });
  if (!organization) return failure(res, 404, 'NOT_FOUND', 'Organization not found.');
  return success(res, organization);
});

router.post('/organizations', async (req: AuthRequest, res) => {
  const parsed = z.object({ name: z.string().trim().min(2).max(120), slug: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(80), reason: reasonSchema }).strict().safeParse(req.body);
  if (!parsed.success) return failure(res, 422, 'VALIDATION_ERROR', 'Name, lowercase slug, and a written reason are required.');
  const organization = await db.$transaction(async (tx) => {
    const created = await tx.organization.create({ data: { name: parsed.data.name, slug: parsed.data.slug } });
    await tx.privilegedAudit.create({ data: buildPrivilegedAuditData(req, { action: 'ORGANIZATION_CREATED', affectedModel: 'Organization', recordId: created.id, organizationId: created.id, afterValues: { name: created.name, slug: created.slug, status: created.status }, reason: parsed.data.reason }) });
    return created;
  });
  return success(res, organization, 201);
});

router.patch('/organizations/:id', async (req: AuthRequest, res) => {
  const parsed = z.object({ name: z.string().trim().min(2).max(120).optional(), status: z.enum(['ACTIVE', 'SUSPENDED', 'ARCHIVED']).optional(), reason: reasonSchema, confirmation: z.string().optional() }).strict().safeParse(req.body);
  if (!parsed.success || (!parsed.data.name && !parsed.data.status)) return failure(res, 422, 'VALIDATION_ERROR', 'A valid change and written reason are required.');
  if (parsed.data.status && parsed.data.status !== 'ACTIVE' && parsed.data.confirmation !== parsed.data.status) return failure(res, 422, 'CONFIRMATION_REQUIRED', `Type ${parsed.data.status} to confirm this high-risk action.`);
  const before = await db.organization.findUnique({ where: { id: String(req.params.id) } });
  if (!before) return failure(res, 404, 'NOT_FOUND', 'Organization not found.');
  const organization = await db.$transaction(async (tx) => {
    const updated = await tx.organization.update({ where: { id: before.id }, data: { name: parsed.data.name, status: parsed.data.status as OrganizationStatus | undefined } });
    await tx.privilegedAudit.create({ data: buildPrivilegedAuditData(req, { action: parsed.data.status ? `ORGANIZATION_${parsed.data.status}` : 'ORGANIZATION_UPDATED', affectedModel: 'Organization', recordId: updated.id, organizationId: updated.id, beforeValues: { name: before.name, status: before.status }, afterValues: { name: updated.name, status: updated.status }, reason: parsed.data.reason }) });
    return updated;
  });
  return success(res, organization);
});

router.get('/members', async (req: AuthRequest, res) => {
  const parsed = z.object({ page: pageSchema, limit: limitSchema, query: z.string().trim().max(100).default(''), organizationId: z.string().uuid().optional(), status: z.enum(['PENDING', 'ACTIVE', 'DISABLED']).optional() }).safeParse(req.query);
  if (!parsed.success) return failure(res, 422, 'VALIDATION_ERROR', 'Invalid member filters.');
  const { page, limit, query, organizationId, status } = parsed.data;
  const where: Prisma.UserWhereInput = {
    ...(query ? { OR: [{ name: { contains: query, mode: 'insensitive' } }, { email: { contains: query, mode: 'insensitive' } }] } : {}),
    ...(status ? { status } : {}),
    ...(organizationId ? { memberships: { some: { organizationId } } } : {}),
  };
  const [items, total] = await Promise.all([
    db.user.findMany({ where, orderBy: { name: 'asc' }, skip: (page - 1) * limit, take: limit, select: { id: true, name: true, email: true, status: true, createdAt: true, memberships: { select: { id: true, organizationId: true, accessRole: true, businessRole: true, status: true, organization: { select: { name: true, status: true } } } }, privilegedTargets: { orderBy: { createdAt: 'desc' }, take: 5, select: { id: true, action: true, reason: true, result: true, createdAt: true, platformActorId: true, actor: { select: { name: true, email: true } }, organization: { select: { name: true } } } } } }),
    db.user.count({ where }),
  ]);
  return success(res, { items, pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) } });
});

router.post('/invitations', async (req: AuthRequest, res) => {
  const parsed = z.object({ organizationId: z.string().uuid(), email: z.string().trim().email().transform((value) => value.toLowerCase()), accessRole: z.enum(['ORGANIZATION_ADMIN', 'ORGANIZATION_MEMBER', 'PORTAL_USER']), businessRole: z.enum(['REP', 'MANAGER', 'FINANCE', 'ADMIN', 'CUSTOMER']), reason: reasonSchema }).strict().safeParse(req.body);
  if (!parsed.success) return failure(res, 422, 'VALIDATION_ERROR', 'Valid organization, email, roles, and reason are required.');
  if ((parsed.data.accessRole === 'PORTAL_USER') !== (parsed.data.businessRole === 'CUSTOMER') || (parsed.data.accessRole === 'ORGANIZATION_ADMIN') !== (parsed.data.businessRole === 'ADMIN')) return failure(res, 422, 'INVALID_ROLE_COMBINATION', 'The organization access level does not match the business role.');
  const organization = await db.organization.findUnique({ where: { id: parsed.data.organizationId } });
  if (!organization || organization.status === 'ARCHIVED') return failure(res, 404, 'NOT_FOUND', 'Active organization not found.');
  const tokenHash = crypto.createHash('sha256').update(crypto.randomBytes(32)).digest('hex');
  const invitation = await db.$transaction(async (tx) => {
    await tx.organizationInvitation.updateMany({ where: { organizationId: organization.id, email: parsed.data.email, status: 'PENDING' }, data: { status: 'REVOKED' } });
    const created = await tx.organizationInvitation.create({ data: { organizationId: organization.id, email: parsed.data.email, accessRole: parsed.data.accessRole, businessRole: parsed.data.businessRole, tokenHash, invitedById: req.auth!.realUser.id, expiresAt: new Date(Date.now() + 7 * 86400000) } });
    await tx.privilegedAudit.create({ data: buildPrivilegedAuditData(req, { action: 'USER_INVITED', affectedModel: 'OrganizationInvitation', recordId: created.id, organizationId: organization.id, afterValues: { email: created.email, accessRole: created.accessRole, businessRole: created.businessRole, expiresAt: created.expiresAt.toISOString() }, reason: parsed.data.reason }) });
    return created;
  });
  return success(res, { id: invitation.id, email: invitation.email, status: invitation.status, expiresAt: invitation.expiresAt }, 201);
});

router.post('/organizations/:id/members', async (req: AuthRequest, res) => {
  const parsed = z.object({ userId: z.string().uuid(), accessRole: z.enum(['ORGANIZATION_ADMIN', 'ORGANIZATION_MEMBER', 'PORTAL_USER']), businessRole: z.enum(['REP', 'MANAGER', 'FINANCE', 'ADMIN', 'CUSTOMER']), reason: reasonSchema }).strict().safeParse(req.body);
  if (!parsed.success) return failure(res, 422, 'VALIDATION_ERROR', 'Valid user, roles, and reason are required.');
  if ((parsed.data.accessRole === 'PORTAL_USER') !== (parsed.data.businessRole === 'CUSTOMER') || (parsed.data.accessRole === 'ORGANIZATION_ADMIN') !== (parsed.data.businessRole === 'ADMIN')) return failure(res, 422, 'INVALID_ROLE_COMBINATION', 'The organization access level does not match the business role.');
  const organizationId = String(req.params.id);
  const [organization, user] = await Promise.all([db.organization.findUnique({ where: { id: organizationId } }), db.user.findUnique({ where: { id: parsed.data.userId } })]);
  if (!organization || !user) return failure(res, 404, 'NOT_FOUND', 'Organization or user not found.');
  const membership = await db.$transaction(async (tx) => {
    const updated = await tx.organizationMembership.upsert({ where: { organizationId_userId: { organizationId, userId: user.id } }, update: { accessRole: parsed.data.accessRole, businessRole: parsed.data.businessRole, status: 'ACTIVE' }, create: { organizationId, userId: user.id, accessRole: parsed.data.accessRole, businessRole: parsed.data.businessRole } });
    await tx.privilegedAudit.create({ data: buildPrivilegedAuditData(req, { action: 'ORGANIZATION_MEMBERSHIP_GRANTED', affectedModel: 'OrganizationMembership', recordId: updated.id, organizationId, targetUserId: user.id, afterValues: { accessRole: updated.accessRole, businessRole: updated.businessRole, status: updated.status }, reason: parsed.data.reason }) });
    return updated;
  });
  return success(res, membership, 201);
});

router.patch('/memberships/:id', async (req: AuthRequest, res) => {
  const parsed = z.object({ accessRole: z.enum(['ORGANIZATION_ADMIN', 'ORGANIZATION_MEMBER', 'PORTAL_USER']).optional(), businessRole: z.enum(['REP', 'MANAGER', 'FINANCE', 'ADMIN', 'CUSTOMER']).optional(), status: z.enum(['ACTIVE', 'SUSPENDED', 'REVOKED']).optional(), reason: reasonSchema, confirmation: z.string().optional() }).strict().safeParse(req.body);
  if (!parsed.success || (!parsed.data.accessRole && !parsed.data.businessRole && !parsed.data.status)) return failure(res, 422, 'VALIDATION_ERROR', 'A valid membership change and reason are required.');
  if (parsed.data.status && parsed.data.status !== 'ACTIVE' && parsed.data.confirmation !== parsed.data.status) return failure(res, 422, 'CONFIRMATION_REQUIRED', `Type ${parsed.data.status} to confirm this action.`);
  const before = await db.organizationMembership.findUnique({ where: { id: String(req.params.id) } });
  if (!before) return failure(res, 404, 'NOT_FOUND', 'Membership not found.');
  const accessRole = parsed.data.accessRole ?? before.accessRole;
  const businessRole = parsed.data.businessRole ?? before.businessRole;
  if ((accessRole === 'PORTAL_USER') !== (businessRole === 'CUSTOMER') || (accessRole === 'ORGANIZATION_ADMIN') !== (businessRole === 'ADMIN')) return failure(res, 422, 'INVALID_ROLE_COMBINATION', 'The organization access level does not match the business role.');
  const membership = await db.$transaction(async (tx) => {
    const updated = await tx.organizationMembership.update({ where: { id: before.id }, data: { accessRole, businessRole, status: parsed.data.status as MembershipStatus | undefined } });
    await tx.privilegedAudit.create({ data: buildPrivilegedAuditData(req, { action: 'ORGANIZATION_MEMBERSHIP_CHANGED', affectedModel: 'OrganizationMembership', recordId: updated.id, organizationId: updated.organizationId, targetUserId: updated.userId, beforeValues: { accessRole: before.accessRole, businessRole: before.businessRole, status: before.status }, afterValues: { accessRole: updated.accessRole, businessRole: updated.businessRole, status: updated.status }, reason: parsed.data.reason }) });
    return updated;
  });
  return success(res, membership);
});

router.patch('/users/:id/status', async (req: AuthRequest, res) => {
  const parsed = z.object({ status: z.enum(['ACTIVE', 'DISABLED']), reason: reasonSchema, confirmation: z.string() }).strict().safeParse(req.body);
  if (!parsed.success || parsed.data.confirmation !== parsed.data.status) return failure(res, 422, 'CONFIRMATION_REQUIRED', 'Type the requested status to confirm this action.');
  const targetId = String(req.params.id);
  const before = await db.user.findUnique({ where: { id: targetId } });
  if (!before) return failure(res, 404, 'NOT_FOUND', 'User not found.');
  const user = await db.$transaction(async (tx) => {
    const updated = await tx.user.update({ where: { id: targetId }, data: { status: parsed.data.status as AccountStatus } });
    if (parsed.data.status === 'DISABLED') await tx.session.deleteMany({ where: { userId: targetId } });
    await tx.privilegedAudit.create({ data: buildPrivilegedAuditData(req, { action: `USER_${parsed.data.status}`, affectedModel: 'User', recordId: updated.id, targetUserId: updated.id, beforeValues: { status: before.status }, afterValues: { status: updated.status }, reason: parsed.data.reason }) });
    return { id: updated.id, name: updated.name, email: updated.email, status: updated.status };
  });
  return success(res, user);
});

router.post('/users/:id/reset-access', async (req: AuthRequest, res) => {
  const parsed = z.object({ reason: reasonSchema, confirmation: z.literal('RESET ACCESS') }).strict().safeParse(req.body);
  if (!parsed.success) return failure(res, 422, 'CONFIRMATION_REQUIRED', 'Type RESET ACCESS and provide a written reason.');
  const target = await db.user.findUnique({ where: { id: String(req.params.id) } });
  if (!target) return failure(res, 404, 'NOT_FOUND', 'User not found.');
  const revokedSessions = await db.$transaction(async (tx) => {
    const result = await tx.session.deleteMany({ where: { userId: target.id, ...(target.id === req.auth!.realUser.id ? { id: { not: req.auth!.sessionId } } : {}) } });
    await tx.privilegedAudit.create({ data: buildPrivilegedAuditData(req, { action: 'USER_ACCESS_RESET', affectedModel: 'Session', recordId: target.id, targetUserId: target.id, afterValues: { revokedSessions: result.count }, reason: parsed.data.reason }) });
    return result.count;
  });
  return success(res, { userId: target.id, revokedSessions, message: 'Existing sessions were revoked. Password delivery is intentionally not simulated.' });
});

router.post('/view-as', async (req: AuthRequest, res) => {
  const parsed = z.object({ organizationId: z.string().uuid(), userId: z.string().uuid().optional(), reason: reasonSchema }).strict().safeParse(req.body);
  if (!parsed.success) return failure(res, 422, 'VALIDATION_ERROR', 'Organization and written reason are required.');
  const organization = await db.organization.findUnique({ where: { id: parsed.data.organizationId } });
  if (!organization) return failure(res, 404, 'NOT_FOUND', 'Organization not found.');
  if (parsed.data.userId) {
    const membership = await db.organizationMembership.findFirst({ where: { organizationId: organization.id, userId: parsed.data.userId, status: 'ACTIVE', user: { status: 'ACTIVE' } } });
    if (!membership) return failure(res, 422, 'INVALID_SIMULATED_IDENTITY', 'The selected user is not active in this organization.');
  }
  await db.$transaction(async (tx) => {
    await tx.platformOwnerSession.update({ where: { id: req.auth!.sessionId }, data: { viewAsOrganizationId: organization.id, viewAsUserId: parsed.data.userId ?? null, viewAsStartedAt: new Date() } });
    await tx.privilegedAudit.create({ data: buildPrivilegedAuditData(req, { action: 'VIEW_AS_ENTERED', affectedModel: 'Organization', recordId: organization.id, organizationId: organization.id, targetUserId: parsed.data.userId, afterValues: { readOnly: true, simulatedUserId: parsed.data.userId ?? null }, reason: parsed.data.reason }) });
  });
  return success(res, { readOnly: true, organization: { id: organization.id, name: organization.name }, simulatedUserId: parsed.data.userId ?? null });
});

router.post('/view-as/exit', async (req: AuthRequest, res) => {
  if (!req.auth!.readOnlyView) return success(res, { exited: true });
  const organizationId = req.auth!.organization?.id;
  await db.$transaction(async (tx) => {
    await tx.platformOwnerSession.update({ where: { id: req.auth!.sessionId }, data: { viewAsOrganizationId: null, viewAsUserId: null, viewAsStartedAt: null } });
    await tx.privilegedAudit.create({ data: buildPrivilegedAuditData(req, { action: 'VIEW_AS_EXITED', affectedModel: 'Organization', recordId: organizationId, organizationId, beforeValues: { readOnly: true, simulatedUserId: req.auth!.simulatedUserId }, afterValues: { readOnly: false }, reason: 'Platform administrator explicitly exited read-only View As mode.' }) });
  });
  return success(res, { exited: true });
});

export const platformRouter = router;
