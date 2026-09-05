import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { Prisma, PrismaClient } from '@prisma/client';
import { z } from 'zod';

export const portalInvitationAcceptSchema = z.object({
  displayName: z.string().trim().min(1).max(120),
  password: z.string().min(12).max(128),
}).strict();

export const customerTemporaryPasswordSchema = z.string().min(12).max(128);

export class PortalInvitationError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly retryAfter?: number,
  ) {
    super(message);
  }
}

export type PortalInvitationActor = {
  id: string;
  role: string;
  organizationId: string;
  requestId?: string;
};

type CustomerPortalIdentity = {
  id: string;
  name: string;
  contactPerson: string | null;
  email: string | null;
};

export function assertCustomerCreationPortalAccess(role: string, email: string | null | undefined, temporaryPassword: string | undefined) {
  if (role === 'ADMIN') {
    if (!email) throw new PortalInvitationError(422, 'CUSTOMER_EMAIL_REQUIRED', 'A customer email is required so the generated temporary password can be used to sign in.');
    if (!temporaryPassword) throw new PortalInvitationError(422, 'TEMPORARY_PASSWORD_REQUIRED', 'Generate a temporary password before creating this customer.');
    return true;
  }
  if (temporaryPassword) throw new PortalInvitationError(403, 'FORBIDDEN', 'Only an Administrator can provision customer login credentials during profile creation.');
  return false;
}

export async function provisionCustomerPortalPassword(
  tx: Prisma.TransactionClient,
  actor: Pick<PortalInvitationActor, 'id' | 'organizationId' | 'requestId'>,
  customer: CustomerPortalIdentity,
  password: string,
) {
  if (!customer.email) throw new PortalInvitationError(422, 'CUSTOMER_EMAIL_REQUIRED', 'Add a customer email before setting a portal password.');
  const email = customer.email.trim().toLowerCase();
  const existing = await tx.user.findUnique({ where: { email } });
  if (existing && (existing.organizationId !== actor.organizationId || existing.customerId !== customer.id || existing.role !== 'CUSTOMER')) {
    throw new PortalInvitationError(409, 'EMAIL_EXISTS', 'This email already belongs to another DealOS account. Use a different customer email.');
  }
  const passwordHash = await bcrypt.hash(password, 12);
  const user = existing
    ? await tx.user.update({ where: { id: existing.id }, data: { name: customer.contactPerson || customer.name, passwordHash, status: 'ACTIVE', moduleAccess: [] } })
    : await tx.user.create({ data: { organizationId: actor.organizationId, customerId: customer.id, name: customer.contactPerson || customer.name, email, passwordHash, status: 'ACTIVE', role: 'CUSTOMER', moduleAccess: [] } });
  await tx.organizationMembership.upsert({
    where: { organizationId_userId: { organizationId: actor.organizationId, userId: user.id } },
    update: { accessRole: 'PORTAL_USER', businessRole: 'CUSTOMER', status: 'ACTIVE' },
    create: { organizationId: actor.organizationId, userId: user.id, accessRole: 'PORTAL_USER', businessRole: 'CUSTOMER', status: 'ACTIVE' },
  });
  await tx.session.deleteMany({ where: { userId: user.id } });
  await tx.auditEvent.create({ data: {
    organizationId: actor.organizationId,
    actorId: actor.id,
    action: existing ? 'CUSTOMER_PORTAL_PASSWORD_RESET' : 'CUSTOMER_PORTAL_PASSWORD_CREATED',
    resource: 'Customer',
    resourceId: customer.id,
    reason: email,
    requestId: actor.requestId,
  } });
  return user;
}

const invitationLifetimeMs = 7 * 24 * 60 * 60 * 1000;
const invitationRateWindowMs = 60 * 60 * 1000;
const invitationRateLimit = 5;
const unavailableMessage = 'This invitation is invalid, expired, or no longer available.';

export const portalInvitationTokenHash = (token: string) => crypto.createHash('sha256').update(token).digest('hex');

export function portalInvitationTokenMatches(token: string, storedHash: string) {
  const candidate = Buffer.from(portalInvitationTokenHash(token), 'hex');
  const stored = Buffer.from(storedHash, 'hex');
  return candidate.length === stored.length && crypto.timingSafeEqual(candidate, stored);
}

function unavailable() {
  return new PortalInvitationError(410, 'INVITATION_UNAVAILABLE', unavailableMessage);
}

function invitationDto(invitation: {
  id: string;
  email: string;
  status: string;
  createdAt: Date;
  expiresAt: Date;
  acceptedAt: Date | null;
  revokedAt: Date | null;
}) {
  return {
    id: invitation.id,
    email: invitation.email,
    status: invitation.status,
    invitedAt: invitation.createdAt,
    expiresAt: invitation.expiresAt,
    acceptedAt: invitation.acceptedAt,
    revokedAt: invitation.revokedAt,
  };
}

async function findUsableInvitation(prisma: PrismaClient, token: string, now: Date) {
  if (!/^[a-f0-9]{64}$/i.test(token)) throw unavailable();
  const tokenHash = portalInvitationTokenHash(token);
  const invitation = await prisma.organizationInvitation.findUnique({
    where: { tokenHash },
    include: { customer: { select: { id: true, name: true, active: true } } },
  });
  if (!invitation || !portalInvitationTokenMatches(token, invitation.tokenHash) || !invitation.customerId || !invitation.customer?.active) throw unavailable();
  if (invitation.status !== 'PENDING') throw unavailable();
  if (invitation.expiresAt <= now) {
    await prisma.organizationInvitation.updateMany({
      where: { id: invitation.id, status: 'PENDING' },
      data: { status: 'EXPIRED' },
    });
    throw unavailable();
  }
  return invitation;
}

export async function issuePortalInvitation(
  prisma: PrismaClient,
  actor: PortalInvitationActor,
  customerId: string,
  frontendOrigin: string,
  now = new Date(),
) {
  if (!['MANAGER', 'ADMIN'].includes(actor.role)) throw new PortalInvitationError(403, 'FORBIDDEN', 'Manager or Administrator permission is required.');
  const customer = await prisma.customer.findFirst({
    where: { id: customerId, organizationId: actor.organizationId, active: true },
    include: {
      primarySalesTeam: { select: { id: true, managerId: true } },
      assignments: { where: { role: 'PRIMARY', active: true }, select: { id: true } },
    },
  });
  if (!customer) throw new PortalInvitationError(404, 'NOT_FOUND', 'Customer not found.');
  if (actor.role === 'MANAGER' && customer.primarySalesTeam?.managerId !== actor.id) throw new PortalInvitationError(403, 'FORBIDDEN', 'Managers can invite customers only for teams they manage.');
  if (!customer.primarySalesTeamId || !customer.primarySalesTeam || customer.assignments.length !== 1) {
    throw new PortalInvitationError(422, 'CONFIGURATION_REQUIRED', 'Assign a primary sales team and representative before creating a portal invitation.');
  }
  if (!customer.email) throw new PortalInvitationError(422, 'CUSTOMER_EMAIL_REQUIRED', 'Add a customer email before creating a portal invitation.');
  const email = customer.email.trim().toLowerCase();
  const activePortalUser = await prisma.user.findFirst({
    where: { organizationId: actor.organizationId, customerId: customer.id, email, role: 'CUSTOMER', status: 'ACTIVE' },
    select: { id: true },
  });
  if (activePortalUser) throw new PortalInvitationError(409, 'PORTAL_ACCOUNT_ACTIVE', 'This customer email already has active portal access.');

  const rateWindowStart = new Date(now.getTime() - invitationRateWindowMs);
  const recentCount = await prisma.organizationInvitation.count({
    where: { organizationId: actor.organizationId, customerId: customer.id, createdAt: { gte: rateWindowStart } },
  });
  if (recentCount >= invitationRateLimit) {
    throw new PortalInvitationError(429, 'RATE_LIMITED', 'Too many invitations were created for this customer. Try again later.', Math.ceil(invitationRateWindowMs / 1000));
  }

  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = portalInvitationTokenHash(token);
  const expiresAt = new Date(now.getTime() + invitationLifetimeMs);
  const invitation = await prisma.$transaction(async (tx) => {
    await tx.organizationInvitation.updateMany({
      where: { organizationId: actor.organizationId, customerId: customer.id, status: 'PENDING', expiresAt: { lte: now } },
      data: { status: 'EXPIRED' },
    });
    await tx.organizationInvitation.updateMany({
      where: { organizationId: actor.organizationId, customerId: customer.id, email, status: 'PENDING' },
      data: { status: 'REVOKED', revokedAt: now },
    });
    const created = await tx.organizationInvitation.create({ data: {
      organizationId: actor.organizationId,
      customerId: customer.id,
      email,
      accessRole: 'PORTAL_USER',
      businessRole: 'CUSTOMER',
      tokenHash,
      invitedById: actor.id,
      expiresAt,
    } });
    await tx.auditEvent.create({ data: {
      organizationId: actor.organizationId,
      actorId: actor.id,
      action: 'CUSTOMER_PORTAL_INVITATION_CREATED',
      resource: 'OrganizationInvitation',
      resourceId: created.id,
      reason: 'Manual-share portal invitation created.',
      requestId: actor.requestId,
    } });
    return created;
  });

  return {
    ...invitationDto(invitation),
    invitationLink: new URL(`/customer/invitations/${token}`, frontendOrigin).toString(),
  };
}

export async function inspectPortalInvitation(prisma: PrismaClient, token: string, now = new Date()) {
  const invitation = await findUsableInvitation(prisma, token, now);
  return {
    customerName: invitation.customer!.name,
    email: invitation.email,
    expiresAt: invitation.expiresAt,
  };
}

export async function acceptPortalInvitation(
  prisma: PrismaClient,
  token: string,
  input: z.infer<typeof portalInvitationAcceptSchema>,
  requestId?: string,
  now = new Date(),
) {
  const invitation = await findUsableInvitation(prisma, token, now);
  const existing = await prisma.user.findUnique({ where: { email: invitation.email } });
  if (existing && (
    existing.organizationId !== invitation.organizationId
    || existing.customerId !== invitation.customerId
    || existing.role !== 'CUSTOMER'
    || existing.status === 'ACTIVE'
  )) throw unavailable();

  const passwordHash = await bcrypt.hash(input.password, 12);
  return prisma.$transaction(async (tx) => {
    const claimed = await tx.organizationInvitation.updateMany({
      where: { id: invitation.id, status: 'PENDING', expiresAt: { gt: now } },
      data: { status: 'ACCEPTED', acceptedAt: now },
    });
    if (claimed.count !== 1) throw unavailable();
    const user = existing
      ? await tx.user.update({ where: { id: existing.id }, data: { name: input.displayName, passwordHash, status: 'ACTIVE' } })
      : await tx.user.create({ data: {
        organizationId: invitation.organizationId,
        customerId: invitation.customerId!,
        email: invitation.email,
        name: input.displayName,
        passwordHash,
        status: 'ACTIVE',
        role: 'CUSTOMER',
        moduleAccess: [],
      } });
    await tx.organizationMembership.upsert({
      where: { organizationId_userId: { organizationId: invitation.organizationId, userId: user.id } },
      update: { accessRole: 'PORTAL_USER', businessRole: 'CUSTOMER', status: 'ACTIVE' },
      create: { organizationId: invitation.organizationId, userId: user.id, accessRole: 'PORTAL_USER', businessRole: 'CUSTOMER', status: 'ACTIVE' },
    });
    await tx.organizationInvitation.updateMany({
      where: { organizationId: invitation.organizationId, customerId: invitation.customerId, email: invitation.email, status: 'PENDING', id: { not: invitation.id } },
      data: { status: 'REVOKED', revokedAt: now },
    });
    await tx.auditEvent.create({ data: {
      organizationId: invitation.organizationId,
      actorId: user.id,
      action: 'CUSTOMER_PORTAL_INVITATION_ACCEPTED',
      resource: 'OrganizationInvitation',
      resourceId: invitation.id,
      reason: 'Customer portal account activated.',
      requestId,
    } });
    return user;
  });
}

export async function revokePortalInvitation(
  prisma: PrismaClient,
  actor: PortalInvitationActor,
  customerId: string,
  invitationId: string,
  now = new Date(),
) {
  if (!['MANAGER', 'ADMIN'].includes(actor.role)) throw new PortalInvitationError(403, 'FORBIDDEN', 'Manager or Administrator permission is required.');
  const invitation = await prisma.organizationInvitation.findFirst({
    where: { id: invitationId, customerId, organizationId: actor.organizationId },
    include: { customer: { include: { primarySalesTeam: { select: { managerId: true } } } } },
  });
  if (!invitation) throw new PortalInvitationError(404, 'NOT_FOUND', 'Invitation not found.');
  if (actor.role === 'MANAGER' && invitation.customer?.primarySalesTeam?.managerId !== actor.id) throw new PortalInvitationError(403, 'FORBIDDEN', 'Managers can revoke invitations only for teams they manage.');
  if (invitation.status !== 'PENDING') throw new PortalInvitationError(409, 'INVALID_STATE', 'Only a pending invitation can be revoked.');
  const updated = await prisma.$transaction(async (tx) => {
    const changed = await tx.organizationInvitation.update({ where: { id: invitation.id }, data: { status: 'REVOKED', revokedAt: now } });
    await tx.auditEvent.create({ data: {
      organizationId: actor.organizationId,
      actorId: actor.id,
      action: 'CUSTOMER_PORTAL_INVITATION_REVOKED',
      resource: 'OrganizationInvitation',
      resourceId: invitation.id,
      reason: 'Portal invitation revoked manually.',
      requestId: actor.requestId,
    } });
    return changed;
  });
  return invitationDto(updated);
}

export type PortalInvitationTransaction = Prisma.TransactionClient;
