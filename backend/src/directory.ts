import type { DirectoryJoinRequestStatus, Prisma, PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { createCustomerProfile, customerProfileSchema, generateCustomerTemporaryPassword } from './customers.js';
import { updateCustomerRelationshipsInTransaction } from './customer-relationships.js';

const RATE_WINDOW_MS = 60 * 60 * 1000;
const EMAIL_REQUEST_LIMIT = 5;
const IP_REQUEST_LIMIT = 20;
const ipAttempts = new Map<string, number[]>();

export const organizationProfileSchema = z.object({
  displayName: z.string().trim().min(2).max(120),
  shortDescription: z.string().trim().max(500).nullable().optional(),
  category: z.string().trim().max(80).nullable().optional(),
  isDiscoverable: z.boolean(),
}).strict();

export const directoryJoinRequestSchema = z.object({
  email: z.string().trim().email().transform((value) => value.toLowerCase()),
  companyName: z.string().trim().min(2).max(160),
  message: z.string().trim().min(5).max(2000),
}).strict();

export const directoryJoinListSchema = z.object({
  status: z.enum(['PENDING', 'APPROVED', 'DECLINED']).optional(),
}).strict();

export const approveDirectoryJoinRequestSchema = z.object({
  primarySalesTeamId: z.string().uuid(),
  primaryRepId: z.string().uuid(),
  collaboratorIds: z.array(z.string().uuid()).max(100).default([]),
  customerTier: z.string().trim().min(2).max(40),
  currency: z.string().trim().length(3),
}).strict();

export const declineDirectoryJoinRequestSchema = z.object({
  reason: z.string().trim().min(5).max(1000),
}).strict();

export type DirectoryActor = {
  id: string;
  role: string;
  organizationId: string;
  requestId: string;
};

export class DirectoryError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly retryAfter?: number,
  ) {
    super(message);
  }
}

const joinRequestInclude = {
  decidedBy: { select: { id: true, name: true } },
  resultingCustomer: { select: { id: true, name: true } },
} satisfies Prisma.DirectoryJoinRequestInclude;

function joinRequestDto(request: Prisma.DirectoryJoinRequestGetPayload<{ include: typeof joinRequestInclude }>) {
  return {
    id: request.id,
    email: request.email,
    companyName: request.companyName,
    message: request.message,
    status: request.status,
    decidedBy: request.decidedBy,
    decidedAt: request.decidedAt?.toISOString() ?? null,
    decisionReason: request.decisionReason,
    resultingCustomer: request.resultingCustomer,
    createdAt: request.createdAt.toISOString(),
    updatedAt: request.updatedAt.toISOString(),
  };
}

export async function listDirectoryBusinesses(prisma: PrismaClient) {
  const profiles = await prisma.organizationProfile.findMany({
    where: { isDiscoverable: true, organization: { status: 'ACTIVE' } },
    select: { organizationId: true, displayName: true, shortDescription: true, category: true },
    orderBy: [{ displayName: 'asc' }, { organizationId: 'asc' }],
    take: 200,
  });
  return {
    items: profiles.map((profile) => ({
      id: profile.organizationId,
      displayName: profile.displayName,
      shortDescription: profile.shortDescription,
      category: profile.category,
    })),
  };
}

function consumeIpAttempt(organizationId: string, ipAddress: string, now: Date) {
  const key = `${organizationId}:${ipAddress || 'unknown'}`;
  const cutoff = now.getTime() - RATE_WINDOW_MS;
  const recent = (ipAttempts.get(key) ?? []).filter((timestamp) => timestamp > cutoff);
  if (recent.length >= IP_REQUEST_LIMIT) {
    const retryAfter = Math.max(1, Math.ceil((recent[0]! + RATE_WINDOW_MS - now.getTime()) / 1000));
    throw new DirectoryError(429, 'RATE_LIMITED', 'Too many requests were submitted. Please try again later.', retryAfter);
  }
  recent.push(now.getTime());
  ipAttempts.set(key, recent);
}

export async function createDirectoryJoinRequest(
  prisma: PrismaClient,
  organizationId: string,
  input: z.infer<typeof directoryJoinRequestSchema>,
  ipAddress: string,
  now = new Date(),
) {
  const profile = await prisma.organizationProfile.findFirst({
    where: { organizationId, isDiscoverable: true, organization: { status: 'ACTIVE' } },
    select: { organizationId: true },
  });
  if (!profile) throw new DirectoryError(404, 'NOT_FOUND', 'Business not found.');

  const pending = await prisma.directoryJoinRequest.findFirst({
    where: { organizationId, email: input.email, status: 'PENDING' },
    select: { id: true },
  });
  if (pending) throw new DirectoryError(409, 'PENDING_REQUEST_EXISTS', 'A pending request already exists for this email and business.');

  const cutoff = new Date(now.getTime() - RATE_WINDOW_MS);
  const recentEmailRequests = await prisma.directoryJoinRequest.count({
    where: { organizationId, email: input.email, createdAt: { gt: cutoff } },
  });
  if (recentEmailRequests >= EMAIL_REQUEST_LIMIT) {
    throw new DirectoryError(429, 'RATE_LIMITED', 'Too many requests were submitted for this email. Please try again later.', 3600);
  }
  consumeIpAttempt(organizationId, ipAddress, now);

  try {
    const request = await prisma.directoryJoinRequest.create({
      data: { organizationId, ...input },
      select: { id: true, status: true, createdAt: true },
    });
    return { id: request.id, status: request.status, createdAt: request.createdAt.toISOString() };
  } catch (error) {
    if (typeof error === 'object' && error && 'code' in error && error.code === 'P2002') {
      throw new DirectoryError(409, 'PENDING_REQUEST_EXISTS', 'A pending request already exists for this email and business.');
    }
    throw error;
  }
}

export async function getOrganizationDirectoryProfile(prisma: PrismaClient, actor: DirectoryActor) {
  if (actor.role !== 'ADMIN') throw new DirectoryError(403, 'FORBIDDEN', 'Administrator permission is required.');
  const organization = await prisma.organization.findUnique({
    where: { id: actor.organizationId },
    select: { name: true, directoryProfile: true },
  });
  if (!organization) throw new DirectoryError(404, 'NOT_FOUND', 'Organization not found.');
  return organization.directoryProfile ?? {
    organizationId: actor.organizationId,
    displayName: organization.name,
    shortDescription: null,
    category: null,
    isDiscoverable: false,
    updatedAt: null,
  };
}

export async function updateOrganizationDirectoryProfile(
  tx: Prisma.TransactionClient,
  actor: DirectoryActor,
  input: z.infer<typeof organizationProfileSchema>,
) {
  if (actor.role !== 'ADMIN') throw new DirectoryError(403, 'FORBIDDEN', 'Administrator permission is required.');
  const organization = await tx.organization.findUnique({ where: { id: actor.organizationId }, select: { id: true } });
  if (!organization) throw new DirectoryError(404, 'NOT_FOUND', 'Organization not found.');
  const profile = await tx.organizationProfile.upsert({
    where: { organizationId: actor.organizationId },
    update: input,
    create: { organizationId: actor.organizationId, ...input },
  });
  await tx.auditEvent.create({
    data: {
      organizationId: actor.organizationId,
      actorId: actor.id,
      action: 'ORGANIZATION_DIRECTORY_PROFILE_UPDATED',
      resource: 'OrganizationProfile',
      resourceId: actor.organizationId,
      reason: input.isDiscoverable ? 'Public directory listing enabled or updated.' : 'Public directory listing disabled or updated.',
      requestId: actor.requestId,
    },
  });
  return profile;
}

export async function listDirectoryJoinRequests(
  prisma: PrismaClient,
  actor: DirectoryActor,
  status?: DirectoryJoinRequestStatus,
) {
  if (!['MANAGER', 'ADMIN'].includes(actor.role)) throw new DirectoryError(403, 'FORBIDDEN', 'Manager or Administrator permission is required.');
  const requests = await prisma.directoryJoinRequest.findMany({
    where: { organizationId: actor.organizationId, ...(status ? { status } : {}) },
    include: joinRequestInclude,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 200,
  });
  return { items: requests.map(joinRequestDto) };
}

async function lockScopedPendingRequest(tx: Prisma.TransactionClient, actor: DirectoryActor, requestId: string) {
  await tx.$queryRaw`SELECT "id" FROM "DirectoryJoinRequest" WHERE "id" = ${requestId} FOR UPDATE`;
  const request = await tx.directoryJoinRequest.findFirst({
    where: { id: requestId, organizationId: actor.organizationId },
    include: joinRequestInclude,
  });
  if (!request) throw new DirectoryError(404, 'NOT_FOUND', 'Join request not found.');
  if (request.status !== 'PENDING') throw new DirectoryError(409, 'INVALID_STATE', 'This join request has already been decided.');
  return request;
}

export async function approveDirectoryJoinRequest(
  tx: Prisma.TransactionClient,
  actor: DirectoryActor,
  requestId: string,
  input: z.infer<typeof approveDirectoryJoinRequestSchema>,
) {
  if (!['MANAGER', 'ADMIN'].includes(actor.role)) throw new DirectoryError(403, 'FORBIDDEN', 'Manager or Administrator permission is required.');
  const request = await lockScopedPendingRequest(tx, actor, requestId);
  const temporaryPassword = generateCustomerTemporaryPassword();
  const profile = customerProfileSchema.parse({
    name: request.companyName,
    email: request.email,
    tier: input.customerTier,
    currency: input.currency,
    active: true,
  });
  const customer = await createCustomerProfile(tx, actor, profile, {
    temporaryPassword,
    auditAction: 'DIRECTORY_JOIN_CUSTOMER_CREATED',
    auditReason: `Approved directory request ${request.id}`,
  });
  await updateCustomerRelationshipsInTransaction(tx, actor, customer.id, {
    expectedVersion: customer.assignmentVersion,
    primarySalesTeamId: input.primarySalesTeamId,
    primaryRepId: input.primaryRepId,
    collaboratorIds: input.collaboratorIds,
    reason: `Approved directory join request ${request.id}`,
  });
  const decidedAt = new Date();
  const updated = await tx.directoryJoinRequest.update({
    where: { id: request.id },
    data: {
      status: 'APPROVED',
      decidedById: actor.id,
      decidedAt,
      resultingCustomerId: customer.id,
    },
    include: joinRequestInclude,
  });
  await tx.auditEvent.create({
    data: {
      organizationId: actor.organizationId,
      actorId: actor.id,
      action: 'DIRECTORY_JOIN_REQUEST_APPROVED',
      resource: 'DirectoryJoinRequest',
      resourceId: request.id,
      reason: customer.id,
      requestId: actor.requestId,
    },
  });
  return {
    request: joinRequestDto(updated),
    credentials: { email: request.email, password: temporaryPassword, signInPath: '/customer/sign-in' },
  };
}

export async function declineDirectoryJoinRequest(
  tx: Prisma.TransactionClient,
  actor: DirectoryActor,
  requestId: string,
  reason: string,
) {
  if (!['MANAGER', 'ADMIN'].includes(actor.role)) throw new DirectoryError(403, 'FORBIDDEN', 'Manager or Administrator permission is required.');
  const request = await lockScopedPendingRequest(tx, actor, requestId);
  const updated = await tx.directoryJoinRequest.update({
    where: { id: request.id },
    data: { status: 'DECLINED', decidedById: actor.id, decidedAt: new Date(), decisionReason: reason },
    include: joinRequestInclude,
  });
  await tx.auditEvent.create({
    data: {
      organizationId: actor.organizationId,
      actorId: actor.id,
      action: 'DIRECTORY_JOIN_REQUEST_DECLINED',
      resource: 'DirectoryJoinRequest',
      resourceId: request.id,
      reason,
      requestId: actor.requestId,
    },
  });
  return joinRequestDto(updated);
}

export function resetDirectoryRateLimitsForTests() {
  ipAttempts.clear();
}
