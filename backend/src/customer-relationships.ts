import { Prisma, PrismaClient } from '@prisma/client';
import { z } from 'zod';

export const customerRelationshipSchema = z.object({
  expectedVersion: z.number().int().positive(),
  primarySalesTeamId: z.string().uuid(),
  primaryRepId: z.string().uuid(),
  collaboratorIds: z.array(z.string().uuid()).max(100).default([]),
  reason: z.string().trim().min(5).max(500),
}).strict().superRefine((value, context) => {
  if (value.collaboratorIds.includes(value.primaryRepId)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['collaboratorIds'], message: 'The primary representative cannot also be a collaborator.' });
  }
  if (new Set(value.collaboratorIds).size !== value.collaboratorIds.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['collaboratorIds'], message: 'Collaborators must be unique.' });
  }
});

export class CustomerRelationshipError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

export type CustomerRelationshipActor = {
  id: string;
  role: string;
  organizationId: string;
  requestId: string;
};

export function customerRecordScope(actor: Pick<CustomerRelationshipActor, 'id' | 'role'>): Prisma.CustomerWhereInput {
  if (actor.role === 'REP') return { assignments: { some: { userId: actor.id, active: true } } };
  if (actor.role === 'MANAGER') return { OR: [{ primarySalesTeamId: null }, { primarySalesTeam: { is: { managerId: actor.id } } }] };
  return {};
}

type RelationshipInput = z.infer<typeof customerRelationshipSchema>;

const representativeSelect = {
  id: true,
  role: true,
  assignedAt: true,
  user: { select: { id: true, name: true } },
} satisfies Prisma.CustomerRepresentativeSelect;

export const customerRelationshipInclude = {
  primarySalesTeam: { select: { id: true, name: true } },
  assignments: { where: { active: true }, select: representativeSelect, orderBy: { assignedAt: 'asc' as const } },
} satisfies Prisma.CustomerInclude;

export function customerRelationshipDto(customer: Prisma.CustomerGetPayload<{ include: typeof customerRelationshipInclude }>) {
  const primary = customer.assignments.find((assignment) => assignment.role === 'PRIMARY') ?? null;
  return {
    primaryTeam: customer.primarySalesTeam,
    primaryRepresentative: primary ? { ...primary.user, assignedAt: primary.assignedAt.toISOString() } : null,
    collaborators: customer.assignments
      .filter((assignment) => assignment.role === 'COLLABORATOR')
      .map((assignment) => ({ ...assignment.user, assignedAt: assignment.assignedAt.toISOString() })),
    assignmentVersion: customer.assignmentVersion,
  };
}

export async function updateCustomerRelationships(
  prisma: PrismaClient,
  actor: CustomerRelationshipActor,
  customerId: string,
  input: RelationshipInput,
) {
  return prisma.$transaction((tx) => updateCustomerRelationshipsInTransaction(tx, actor, customerId, input));
}

export async function updateCustomerRelationshipsInTransaction(
  tx: Prisma.TransactionClient,
  actor: CustomerRelationshipActor,
  customerId: string,
  input: RelationshipInput,
) {
  if (!['MANAGER', 'ADMIN'].includes(actor.role)) throw new CustomerRelationshipError(403, 'FORBIDDEN', 'Manager or Administrator permission is required.');

  const customer = await tx.customer.findFirst({
    where: { id: customerId, organizationId: actor.organizationId },
    include: customerRelationshipInclude,
  });
  if (!customer) throw new CustomerRelationshipError(404, 'NOT_FOUND', 'Customer not found.');
  if (customer.assignmentVersion !== input.expectedVersion) throw new CustomerRelationshipError(409, 'STALE_VERSION', 'The customer assignment changed. Refresh before saving.');

  const team = await tx.salesTeam.findFirst({
    where: { id: input.primarySalesTeamId, organizationId: actor.organizationId },
    include: { members: { select: { userId: true } } },
  });
  if (!team) throw new CustomerRelationshipError(422, 'TEAM_NOT_AVAILABLE', 'Select a sales team from this organization.');
  if (actor.role === 'MANAGER' && team.managerId !== actor.id) throw new CustomerRelationshipError(403, 'FORBIDDEN', 'Managers can assign accounts only to teams they manage.');
  if (actor.role === 'MANAGER' && customer.primarySalesTeamId) {
    const managesCurrent = await tx.salesTeam.count({ where: { id: customer.primarySalesTeamId, organizationId: actor.organizationId, managerId: actor.id } });
    if (!managesCurrent) throw new CustomerRelationshipError(403, 'FORBIDDEN', 'Managers can reassign only accounts belonging to their own team.');
  }

  const candidateIds = [input.primaryRepId, ...input.collaboratorIds];
  const candidates = await tx.user.findMany({
    where: { id: { in: candidateIds }, organizationId: actor.organizationId },
    select: { id: true, name: true, role: true, status: true },
  });
  const portalCandidate = candidates.find((candidate) => candidate.role === 'CUSTOMER');
  if (portalCandidate) throw new CustomerRelationshipError(422, 'PORTAL_USER_NOT_REPRESENTATIVE', 'Customer portal users cannot represent an account.');
  if (candidates.length !== candidateIds.length || candidates.some((candidate) => candidate.role !== 'REP' || candidate.status !== 'ACTIVE')) {
    throw new CustomerRelationshipError(422, 'REPRESENTATIVE_NOT_ELIGIBLE', 'Every representative must be an active Rep in this organization.');
  }
  const teamMemberIds = new Set(team.members.map((member) => member.userId));
  if (!candidateIds.every((id) => teamMemberIds.has(id))) throw new CustomerRelationshipError(422, 'REPRESENTATIVE_NOT_ON_TEAM', 'Every representative must belong to the selected sales team.');

  const desired = new Map<string, 'PRIMARY' | 'COLLABORATOR'>([[input.primaryRepId, 'PRIMARY']]);
  for (const collaboratorId of input.collaboratorIds) desired.set(collaboratorId, 'COLLABORATOR');
  const now = new Date();
  const beforeValues = {
    primarySalesTeamId: customer.primarySalesTeamId,
    assignmentVersion: customer.assignmentVersion,
    assignments: customer.assignments.map((assignment) => ({ userId: assignment.user.id, role: assignment.role, assignedAt: assignment.assignedAt.toISOString() })),
  };

  const won = await tx.customer.updateMany({
    where: { id: customer.id, organizationId: actor.organizationId, assignmentVersion: input.expectedVersion },
    data: { primarySalesTeamId: team.id, assignmentVersion: { increment: 1 } },
  });
  if (won.count !== 1) throw new CustomerRelationshipError(409, 'STALE_VERSION', 'The customer assignment changed. Refresh before saving.');

  for (const assignment of customer.assignments) {
    if (desired.get(assignment.user.id) !== assignment.role) {
      await tx.customerRepresentative.update({ where: { id: assignment.id }, data: { active: false, endedAt: now } });
    }
  }
  for (const [userId, role] of desired) {
    const unchanged = customer.assignments.some((assignment) => assignment.user.id === userId && assignment.role === role);
    if (!unchanged) await tx.customerRepresentative.create({ data: { customerId: customer.id, userId, role, assignedById: actor.id, assignedAt: now } });
  }

  const updated = await tx.customer.findUniqueOrThrow({ where: { id: customer.id }, include: customerRelationshipInclude });
  const relationship = customerRelationshipDto(updated);
  await tx.privilegedAudit.create({ data: {
    actorId: actor.id,
    organizationId: actor.organizationId,
    action: 'CUSTOMER_RELATIONSHIPS_UPDATED',
    affectedModel: 'Customer',
    recordId: customer.id,
    beforeValues: beforeValues as Prisma.InputJsonValue,
    afterValues: relationship as unknown as Prisma.InputJsonValue,
    reason: input.reason,
    requestId: actor.requestId,
    result: 'SUCCESS',
  } });
  return { customer: updated, relationship };
}
