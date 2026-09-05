import { Prisma, type ApprovalRoute } from '@prisma/client';

type DecimalValue = Prisma.Decimal | string | number;

export type GovernanceCalculation = {
  lines: Array<{ productId?: string; effectiveDiscount: number; excess: number; cadence: string }>;
  worstExcess: number;
  weightedExcess: number;
  aggregateDiscount: number;
  marginPercent: number;
  riskByCadence?: Record<string, { weightedExcess: number; aggregateDiscount: number; marginPercent: number }>;
};

export type GovernancePolicy = {
  id: string;
  tier: string;
  version: number;
  financeThreshold: DecimalValue;
  aggregateDiscountLimit: DecimalValue;
  minimumMarginPercent: DecimalValue;
};

export type RiskFlag = {
  scope: 'LINE' | 'AGGREGATE';
  code: string;
  message: string;
  productId?: string;
  cadence?: string;
  actual: number;
  threshold: number;
};

const number = (value: DecimalValue) => Number(value.toString());
const rounded = (value: number) => Number(value.toFixed(4));

export function evaluateRisk(calculation: GovernanceCalculation, policy: GovernancePolicy) {
  const financeThreshold = number(policy.financeThreshold);
  const aggregateDiscountLimit = number(policy.aggregateDiscountLimit);
  const minimumMarginPercent = number(policy.minimumMarginPercent);
  const flags: RiskFlag[] = [];

  for (const line of calculation.lines) {
    if (line.excess > 0) flags.push({
      scope: 'LINE', code: 'LINE_DISCOUNT_EXCESS', productId: line.productId, cadence: line.cadence,
      actual: rounded(line.excess), threshold: 0,
      message: `Effective discount exceeds the configured line ceiling by ${rounded(line.excess)} points.`,
    });
  }
  if (calculation.worstExcess > financeThreshold) flags.push({
    scope: 'AGGREGATE', code: 'WORST_EXCESS_FINANCE', actual: rounded(calculation.worstExcess), threshold: financeThreshold,
    message: `Worst line excess is above the configured Finance threshold of ${financeThreshold} points.`,
  });
  if (calculation.weightedExcess > financeThreshold) flags.push({
    scope: 'AGGREGATE', code: 'WEIGHTED_EXCESS_FINANCE', actual: rounded(calculation.weightedExcess), threshold: financeThreshold,
    message: `Value-weighted excess is above the configured Finance threshold of ${financeThreshold} points.`,
  });
  if (calculation.aggregateDiscount > aggregateDiscountLimit) flags.push({
    scope: 'AGGREGATE', code: 'AGGREGATE_DISCOUNT_FINANCE', actual: rounded(calculation.aggregateDiscount), threshold: aggregateDiscountLimit,
    message: `Aggregate discount is above the configured ${aggregateDiscountLimit}% ceiling.`,
  });
  if (calculation.marginPercent < minimumMarginPercent) flags.push({
    scope: 'AGGREGATE', code: 'LOW_MARGIN_FINANCE', actual: rounded(calculation.marginPercent), threshold: minimumMarginPercent,
    message: `Margin is below the configured ${minimumMarginPercent}% floor.`,
  });

  const hasDiscount = calculation.lines.some((line) => line.effectiveDiscount > 0);
  const needsFinance = flags.some((flag) => flag.code.endsWith('_FINANCE'));
  const route: ApprovalRoute = needsFinance ? 'MANAGER_FINANCE' : hasDiscount ? 'MANAGER' : 'NONE';
  const reasons = route === 'NONE'
    ? ['No discount or Finance-level margin exception was detected.']
    : [
        hasDiscount ? 'Any customer discount requires Sales Manager review.' : 'A Finance-level exception requires Sales Manager review first.',
        ...(needsFinance ? ['Finance review follows Sales Manager approval because a configured high-risk threshold was triggered.'] : []),
      ];

  return {
    route,
    flags,
    reasons,
    policy: {
      id: policy.id,
      tier: policy.tier,
      version: policy.version,
      financeThreshold,
      aggregateDiscountLimit,
      minimumMarginPercent,
    },
    components: {
      worstExcess: rounded(calculation.worstExcess),
      weightedExcess: rounded(calculation.weightedExcess),
      aggregateDiscount: rounded(calculation.aggregateDiscount),
      marginPercent: rounded(calculation.marginPercent),
      byCadence: calculation.riskByCadence ?? {},
    },
  };
}

export function approvalStepsForRoute(route: ApprovalRoute) {
  if (route === 'NONE') return [];
  return [
    { step: 'Sales Manager', sequence: 1, state: 'PENDING' as const },
    ...(route === 'MANAGER_FINANCE' ? [{ step: 'Finance', sequence: 2, state: 'WAITING' as const }] : []),
  ];
}

export async function openCase(
  tx: Prisma.TransactionClient,
  input: { quoteId: string; revisionId: string; policyId: string; cycle: number; submittedById: string; evaluation: ReturnType<typeof evaluateRisk> },
) {
  const steps = approvalStepsForRoute(input.evaluation.route);
  return tx.approvalCase.create({
    data: {
      quoteId: input.quoteId,
      revisionId: input.revisionId,
      policyId: input.policyId,
      cycle: input.cycle,
      state: steps.length ? 'PENDING' : 'APPROVED',
      route: input.evaluation.route,
      riskSnapshot: JSON.parse(JSON.stringify(input.evaluation)) as Prisma.InputJsonValue,
      submittedById: input.submittedById,
      completedAt: steps.length ? null : new Date(),
      steps: { create: steps.map((step) => ({ quoteId: input.quoteId, revisionId: input.revisionId, cycle: input.cycle, ...step })) },
    },
    include: { steps: { orderBy: { sequence: 'asc' } } },
  });
}

export class GovernanceError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

export function validateDecisionContext(input:{expectedVersion:number;caseVersion:number;caseState:string;step:{step:string;state:string}|undefined;actor:{id:string;role:string};submittedById:string;ownerId:string;managerId:string|null}) {
  if (input.caseVersion !== input.expectedVersion) throw new GovernanceError(409, 'STALE_VERSION', 'Refresh this approval case before deciding.');
  if (input.caseState !== 'PENDING') throw new GovernanceError(409, 'INVALID_STATE', 'This approval case is no longer pending.');
  if (!input.step || input.step.state !== 'PENDING') throw new GovernanceError(409, 'APPROVAL_STEP_BLOCKED', 'The next approval step is not available.');
  if (input.step.step === 'Sales Manager' && (input.actor.role !== 'MANAGER' || input.managerId !== input.actor.id)) throw new GovernanceError(403, 'FORBIDDEN', 'This Sales Manager step belongs to another team.');
  if (input.step.step === 'Finance' && input.actor.role !== 'FINANCE') throw new GovernanceError(403, 'FORBIDDEN', 'Finance must complete this step.');
  if (input.submittedById === input.actor.id || input.ownerId === input.actor.id) throw new GovernanceError(409, 'SELF_APPROVAL_NOT_ALLOWED', 'The submitter cannot approve their own quotation.');
}

export async function decideStep(
  tx: Prisma.TransactionClient,
  input: { caseId: string; expectedVersion: number; actor: { id: string; role: string; organizationId: string }; decision: 'APPROVE' | 'RETURN' | 'REJECT'; reason: string },
) {
  await tx.$queryRaw`SELECT "id" FROM "ApprovalCase" WHERE "id" = ${input.caseId} FOR UPDATE`;
  const approvalCase = await tx.approvalCase.findUnique({
    where: { id: input.caseId },
    include: { quote: { include: { team: { select: { managerId: true } } } }, revision: true, steps: { orderBy: { sequence: 'asc' } } },
  });
  if (!approvalCase || approvalCase.quote.organizationId !== input.actor.organizationId) throw new GovernanceError(404, 'NOT_FOUND', 'Approval case not found.');
  const step = approvalCase.steps.find((candidate) => candidate.state === 'PENDING');
  validateDecisionContext({expectedVersion:input.expectedVersion,caseVersion:approvalCase.version,caseState:approvalCase.state,step,actor:input.actor,submittedById:approvalCase.submittedById,ownerId:approvalCase.quote.ownerId,managerId:approvalCase.quote.team?.managerId??null});
  if (!step) throw new GovernanceError(409, 'APPROVAL_STEP_BLOCKED', 'The next approval step is not available.');

  const stepState = input.decision === 'APPROVE' ? 'APPROVED' : input.decision === 'RETURN' ? 'RETURNED' : 'REJECTED';
  await tx.approval.update({ where: { id: step.id }, data: { state: stepState, reviewerId: input.actor.id, reason: input.reason, decidedAt: new Date() } });

  let caseState: 'PENDING' | 'APPROVED' | 'RETURNED' | 'REJECTED' = 'PENDING';
  if (input.decision === 'APPROVE') {
    const next = approvalCase.steps.find((candidate) => candidate.state === 'WAITING');
    if (next) await tx.approval.update({ where: { id: next.id }, data: { state: 'PENDING' } });
    else {
      caseState = 'APPROVED';
      await tx.quote.update({ where: { id: approvalCase.quoteId }, data: { stage: 'APPROVED', version: { increment: 1 }, lastActivity: new Date() } });
    }
  } else {
    caseState = input.decision === 'RETURN' ? 'RETURNED' : 'REJECTED';
    await tx.approval.updateMany({ where: { caseId: approvalCase.id, id: { not: step.id }, state: { in: ['PENDING', 'WAITING'] } }, data: { state: 'SUPERSEDED' } });
    if (caseState === 'REJECTED') await tx.quote.update({ where: { id: approvalCase.quoteId }, data: { stage: 'REJECTED', version: { increment: 1 }, lastActivity: new Date() } });
  }
  const updatedCase = await tx.approvalCase.update({
    where: { id: approvalCase.id },
    data: { state: caseState, version: { increment: 1 }, completedAt: caseState === 'PENDING' ? null : new Date() },
    include: { steps: { include: { reviewer: { select: { id: true, name: true } } }, orderBy: { sequence: 'asc' } } },
  });
  return { approvalCase: updatedCase, sourceRevision: approvalCase.revision, returned: caseState === 'RETURNED' };
}

export async function createReturnedDraft(
  tx: Prisma.TransactionClient,
  input: { caseId:string; quoteId:string; termsHash:string; sourceRevision:any },
) {
  const source=input.sourceRevision;
  const latest=await tx.quoteRevision.findFirst({where:{quoteId:input.quoteId},orderBy:{revisionNumber:'desc'}});
  await tx.quoteRevision.update({where:{id:source.id},data:{state:'SUPERSEDED'}});
  const revision=await tx.quoteRevision.create({data:{
    quoteId:input.quoteId,revisionNumber:(latest?.revisionNumber??source.revisionNumber)+1,state:'DRAFT',currency:source.currency,
    validUntil:source.validUntil,promisedDeliveryAt:source.promisedDeliveryAt,terms:source.terms,orderDiscount:source.orderDiscount,
    subtotal:source.subtotal,taxTotal:source.taxTotal,total:source.total,margin:source.margin,riskScore:source.riskScore,
    totalsByCadence:source.totalsByCadence as Prisma.InputJsonValue,linesSnapshot:source.linesSnapshot as Prisma.InputJsonValue,
    policySnapshot:source.policySnapshot as Prisma.InputJsonValue,termsHash:input.termsHash,
  }});
  await tx.quote.update({where:{id:input.quoteId},data:{stage:'DRAFT',currentRevisionId:revision.id,sentAt:null,version:{increment:1},lastActivity:new Date()}});
  return revision;
}
