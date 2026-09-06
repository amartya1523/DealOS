import { Prisma, type PrismaClient } from '@prisma/client';
import { z } from 'zod';

export const salesTeamMutationSchema = z.object({
  name: z.string().trim().min(2).max(120),
  managerId: z.string().uuid().nullable().default(null),
  memberIds: z.array(z.string().uuid()).min(1).max(200),
}).strict().superRefine((value, context) => {
  if (new Set(value.memberIds).size !== value.memberIds.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['memberIds'], message: 'Select each sales representative only once.' });
  }
});

export class SalesTeamError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

export type SalesTeamActor = {
  id: string;
  role: string;
  organizationId: string;
  requestId?: string;
};

type SalesTeamInput = z.infer<typeof salesTeamMutationSchema>;

async function eligibleMembership(tx: Prisma.TransactionClient, actor: SalesTeamActor, input: SalesTeamInput) {
  if (actor.role !== 'ADMIN') throw new SalesTeamError(403, 'FORBIDDEN', 'Administrator permission is required.');
  const representatives = await tx.user.findMany({
    where: { id: { in: input.memberIds }, organizationId: actor.organizationId, status: 'ACTIVE', role: 'REP' },
    select: { id: true },
  });
  if (representatives.length !== input.memberIds.length) {
    throw new SalesTeamError(422, 'REPRESENTATIVE_NOT_ELIGIBLE', 'Every team member must be an active sales representative in this organization.');
  }
  const manager = input.managerId ? await tx.user.findFirst({
    where: { id: input.managerId, organizationId: actor.organizationId, status: 'ACTIVE', role: { in: ['MANAGER', 'ADMIN'] } },
    select: { id: true },
  }) : null;
  if (input.managerId && !manager) throw new SalesTeamError(422, 'MANAGER_NOT_ELIGIBLE', 'Select an active Manager or Administrator from this organization.');
  return [...new Set([...input.memberIds, ...(manager ? [manager.id] : [])])];
}

async function uniqueName(tx: Prisma.TransactionClient, actor: SalesTeamActor, name: string, excludeId?: string) {
  const duplicate = await tx.salesTeam.findFirst({
    where: { organizationId: actor.organizationId, name: { equals: name, mode: 'insensitive' }, ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: { id: true },
  });
  if (duplicate) throw new SalesTeamError(409, 'DUPLICATE_TEAM', 'A sales team with this name already exists.');
}

export async function createSalesTeam(prisma: PrismaClient, actor: SalesTeamActor, input: SalesTeamInput) {
  return prisma.$transaction(async (tx) => {
    const membershipIds = await eligibleMembership(tx, actor, input);
    await uniqueName(tx, actor, input.name);
    const team = await tx.salesTeam.create({
      data: {
        organizationId: actor.organizationId,
        name: input.name,
        managerId: input.managerId,
        members: { create: membershipIds.map((userId) => ({ userId })) },
      },
    });
    await tx.auditEvent.create({ data: {
      organizationId: actor.organizationId,
      actorId: actor.id,
      action: 'SALES_TEAM_CREATED',
      resource: 'SalesTeam',
      resourceId: team.id,
      reason: `${input.name} created with ${input.memberIds.length} sales representative${input.memberIds.length === 1 ? '' : 's'}.`,
      requestId: actor.requestId,
    } });
    return { id: team.id, name: team.name, managerId: team.managerId, memberIds: input.memberIds };
  });
}

export async function updateSalesTeam(prisma: PrismaClient, actor: SalesTeamActor, teamId: string, input: SalesTeamInput) {
  return prisma.$transaction(async (tx) => {
    if (actor.role !== 'ADMIN') throw new SalesTeamError(403, 'FORBIDDEN', 'Administrator permission is required.');
    const team = await tx.salesTeam.findFirst({ where: { id: teamId, organizationId: actor.organizationId }, select: { id: true, name: true } });
    if (!team) throw new SalesTeamError(404, 'NOT_FOUND', 'Sales team not found.');
    const membershipIds = await eligibleMembership(tx, actor, input);
    await uniqueName(tx, actor, input.name, team.id);

    const removedRelationship = await tx.customerRepresentative.findFirst({
      where: {
        active: true,
        userId: { notIn: input.memberIds },
        customer: { is: { organizationId: actor.organizationId, primarySalesTeamId: team.id } },
      },
      select: { user: { select: { name: true } }, customer: { select: { name: true } } },
    });
    if (removedRelationship) {
      throw new SalesTeamError(409, 'REPRESENTATIVE_IN_USE', `${removedRelationship.user.name} is still assigned to ${removedRelationship.customer.name}. Reassign that customer before removing the representative.`);
    }
    const activeDeal = await tx.quote.findFirst({
      where: { organizationId: actor.organizationId, teamId: team.id, ownerId: { notIn: input.memberIds }, stage: { notIn: ['CONFIRMED', 'REJECTED'] } },
      select: { number: true },
    });
    if (activeDeal) throw new SalesTeamError(409, 'REPRESENTATIVE_IN_USE', `Reassign ${activeDeal.number} before removing its owner from this team.`);

    await tx.salesTeam.update({ where: { id: team.id }, data: { name: input.name, managerId: input.managerId } });
    await tx.salesTeamMember.deleteMany({ where: { teamId: team.id } });
    await tx.salesTeamMember.createMany({ data: membershipIds.map((userId) => ({ teamId: team.id, userId })) });
    await tx.auditEvent.create({ data: {
      organizationId: actor.organizationId,
      actorId: actor.id,
      action: 'SALES_TEAM_UPDATED',
      resource: 'SalesTeam',
      resourceId: team.id,
      reason: `${team.name} updated to ${input.memberIds.length} sales representative${input.memberIds.length === 1 ? '' : 's'}.`,
      requestId: actor.requestId,
    } });
    return { id: team.id, name: input.name, managerId: input.managerId, memberIds: input.memberIds };
  });
}
