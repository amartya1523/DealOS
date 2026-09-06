import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import {
  Prisma,
  PrismaClient,
  Role,
  type Customer,
  type DiscountPolicy,
  type Invoice,
  type Order,
  type OrderLine,
  type PriceList,
  type Product,
  type ProductVariant,
  type Quote,
  type QuoteLine,
  type QuoteRevision,
  type SalesTeam,
  type Shipment,
  type StockBalance,
  type User,
  type Warehouse,
} from '@prisma/client';
import { evaluateRisk } from '../src/governance.js';
import { paymentWebhookKey } from '../src/payments.js';
import { calculateQuote } from '../src/rules.js';
import { roleModulePresets, workspaceModules } from '../src/access-policy.js';

const db = new PrismaClient();
const demoPassword = 'DealOS2026!';
const passwordHash = await bcrypt.hash(demoPassword, 12);
const primaryOrganizationId = '00000000-0000-0000-0000-000000000001';
const northstarOrganizationId = '00000000-0000-0000-0000-000000000002';
const seedStartedAt = new Date();

const roleModules: Record<Role, string[]> = {
  REP: roleModulePresets.REP,
  MANAGER: roleModulePresets.MANAGER,
  FINANCE: roleModulePresets.FINANCE,
  ADMIN: [...workspaceModules],
  CUSTOMER: [],
};

const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const number = (value: unknown) => Number(value ?? 0);
const money = (value: number) => Number(value.toFixed(2));
const digest = (value: unknown) => crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const atDay = (offset: number, hour = 10) => {
  const value = new Date(seedStartedAt);
  value.setUTCHours(hour, 0, 0, 0);
  value.setUTCDate(value.getUTCDate() + offset);
  return value;
};
const nextBillingDate = (from: Date, cadence: string) => {
  const months = cadence.toLowerCase() === 'quarterly' ? 3 : cadence.toLowerCase() === 'yearly' ? 12 : 1;
  const anchor = from.getUTCDate();
  const targetMonth = from.getUTCMonth() + months;
  const year = from.getUTCFullYear() + Math.floor(targetMonth / 12);
  const month = targetMonth % 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(anchor, lastDay), from.getUTCHours(), from.getUTCMinutes(), from.getUTCSeconds(), from.getUTCMilliseconds()));
};

// This is a disposable local-demo token, not a production credential. Reseeding restores it.
export const demoPortalInvitationToken = digest('DealOS Gamma Health portal invitation seed token');

type LineSpec = {
  product: Product;
  variant?: ProductVariant;
  quantity: number;
  unitPrice?: number;
  discount?: number;
  allowedDiscount?: number;
};

type PricedRevision = {
  quote: Quote;
  revision: QuoteRevision;
  policy: DiscountPolicy;
  calculation: ReturnType<typeof calculateQuote>;
  evaluation: ReturnType<typeof evaluateRisk>;
  snapshots: Array<Record<string, unknown>>;
};

type QuoteFixture = PricedRevision & {
  specs: LineSpec[];
  quoteLines: QuoteLine[];
  priceList?: PriceList;
};

type ConfirmedFixture = QuoteFixture & {
  order: Order;
  orderLines: OrderLine[];
};

function allowedDiscount(product: Product, policy: DiscountPolicy) {
  const value = product.category === 'Hardware'
    ? policy.hardwareLimit
    : product.category === 'Services'
      ? policy.servicesLimit
      : policy.subscriptionLimit;
  return Number(value.toString());
}

const lineUnitPrice = (spec: LineSpec) => money(spec.unitPrice ?? number(spec.product.price) + number(spec.variant?.priceDelta));
const lineUnitCost = (spec: LineSpec) => money(number(spec.product.cost) + number(spec.variant?.costDelta));

function priceRevision(specs: LineSpec[], orderDiscount: number, policy: DiscountPolicy, priceList?: PriceList) {
  const inputs = specs.map((spec) => ({
    productId: spec.product.id,
    quantity: spec.quantity,
    unitPrice: lineUnitPrice(spec),
    unitCost: lineUnitCost(spec),
    discount: spec.discount ?? 0,
    allowedDiscount: spec.allowedDiscount ?? allowedDiscount(spec.product, policy),
    taxRate: spec.product.taxRate,
    cadence: spec.product.recurring ? spec.product.cadence : 'One-time',
  }));
  const calculation = calculateQuote(inputs, orderDiscount, {
    financeThreshold: policy.financeThreshold,
    aggregateDiscountLimit: policy.aggregateDiscountLimit,
    minimumMarginPercent: policy.minimumMarginPercent,
  });
  const evaluation = evaluateRisk(calculation, policy);
  const snapshots = specs.map((spec, index) => {
    const priced = calculation.lines[index]!;
    return {
      productId: spec.product.id,
      variantId: spec.variant?.id ?? null,
      variantName: spec.variant?.name ?? null,
      variantSku: spec.variant?.sku ?? null,
      priceListId: priceList?.id ?? null,
      priceListName: priceList?.name ?? null,
      name: spec.product.name,
      sku: spec.product.sku,
      brand: spec.product.brand,
      category: spec.product.category,
      description: spec.product.description,
      quantity: spec.quantity,
      unitPrice: lineUnitPrice(spec).toFixed(2),
      unitCost: lineUnitCost(spec).toFixed(2),
      taxRate: spec.product.taxRate.toString(),
      cadence: spec.product.recurring ? spec.product.cadence : 'One-time',
      discount: spec.discount ?? 0,
      effectiveDiscount: priced.effectiveDiscount,
      allowedDiscount: spec.allowedDiscount ?? allowedDiscount(spec.product, policy),
      gross: priced.gross,
      net: priced.net,
      tax: priced.tax,
      lineCost: priced.lineCost,
      excess: priced.excess,
      orderDiscount,
    };
  });
  return { calculation, evaluation, snapshots };
}

async function resetApplicationData() {
  await db.notification.deleteMany();
  await db.passwordResetToken.deleteMany();
  await db.paymentWebhookEvent.deleteMany();
  await db.recommendationAction.deleteMany();
  await db.directoryJoinRequest.deleteMany();
  await db.organizationProfile.deleteMany();
  await db.idempotencyRecord.deleteMany();
  await db.creditNote.deleteMany();
  await db.billingPeriod.deleteMany();
  await db.invoiceNote.deleteMany();
  await db.payment.deleteMany({ where: { reversalOfId: { not: null } } });
  await db.payment.deleteMany();
  await db.invoice.deleteMany();
  await db.shipmentLine.deleteMany();
  await db.shipment.deleteMany();
  await db.subscriptionChange.deleteMany();
  await db.subscription.deleteMany();
  await db.stockMovement.deleteMany();
  await db.backorder.deleteMany();
  await db.reservation.deleteMany();
  await db.fulfillment.deleteMany();
  await db.orderLine.deleteMany();
  await db.order.deleteMany();
  await db.customerAcceptance.deleteMany();
  await db.approval.deleteMany();
  await db.approvalCase.deleteMany();
  await db.negotiation.deleteMany();
  await db.lead.deleteMany();
  await db.portalRequestLine.deleteMany();
  await db.portalRequest.deleteMany();
  await db.quote.updateMany({ data: { currentRevisionId: null } });
  await db.quoteRevision.deleteMany();
  await db.quoteLine.deleteMany();
  await db.quote.deleteMany();
  await db.alert.deleteMany();
  await db.auditEvent.deleteMany();
  await db.privilegedAudit.deleteMany();
  await db.organizationInvitation.deleteMany();
  await db.platformOwnerSession.deleteMany();
  await db.session.deleteMany();
  await db.customerRepresentative.deleteMany();
  await db.salesTeamMember.deleteMany();
  await db.salesTeam.deleteMany();
  await db.stockBalance.deleteMany();
  await db.warehouse.deleteMany();
  await db.priceListItem.deleteMany();
  await db.productVariant.deleteMany();
  await db.priceList.deleteMany();
  await db.product.deleteMany();
  await db.discountPolicy.deleteMany();
  await db.organizationMembership.deleteMany();
  await db.user.deleteMany();
  await db.customer.deleteMany();
  await db.organization.deleteMany();
}

async function createUser(input: {
  organizationId: string;
  name: string;
  email: string;
  role: Role;
  customerId?: string;
  status?: 'PENDING' | 'ACTIVE' | 'DISABLED';
}) {
  return db.user.create({ data: {
    organizationId: input.organizationId,
    name: input.name,
    email: input.email,
    passwordHash,
    role: input.role,
    moduleAccess: roleModules[input.role],
    customerId: input.customerId,
    status: input.status ?? 'ACTIVE',
  } });
}

async function createQuoteFixture(input: {
  organizationId: string;
  number: string;
  customer: Customer;
  owner: User;
  createdBy?: User;
  team: SalesTeam;
  policy: DiscountPolicy;
  priceList?: PriceList;
  specs: LineSpec[];
  orderDiscount?: number;
  stage: 'DRAFT' | 'PENDING_APPROVAL' | 'APPROVED' | 'NEGOTIATION' | 'CONFIRMED' | 'REJECTED';
  revisionState: 'DRAFT' | 'SUBMITTED' | 'SENT' | 'SUPERSEDED';
  revisionNumber?: number;
  version?: number;
  validUntil?: Date;
  promisedDeliveryAt?: Date;
  terms?: string;
  internalNote?: string;
  sentAt?: Date | null;
  lastActivity?: Date;
  createdAt?: Date;
}) : Promise<QuoteFixture> {
  const orderDiscount = input.orderDiscount ?? 0;
  const revisionNumber = input.revisionNumber ?? 1;
  const createdAt = input.createdAt ?? atDay(-3);
  const sentAt = input.revisionState === 'SENT' ? input.sentAt ?? atDay(-2) : null;
  const { calculation, evaluation, snapshots } = priceRevision(input.specs, orderDiscount, input.policy, input.priceList);
  const quote = await db.quote.create({ data: {
    organizationId: input.organizationId,
    number: input.number,
    customer: input.customer.name,
    customerId: input.customer.id,
    customerTier: input.customer.tier,
    ownerId: input.owner.id,
    createdById: (input.createdBy ?? input.owner).id,
    teamId: input.team.id,
    priceListId: input.priceList?.id,
    stage: input.stage,
    version: input.version ?? 1,
    orderDiscount,
    total: calculation.total,
    taxTotal: calculation.taxTotal,
    totalsByCadence: json(calculation.totalsByCadence),
    margin: calculation.margin,
    riskScore: calculation.riskScore,
    sentAt,
    lastActivity: input.lastActivity ?? createdAt,
    createdAt,
  } });
  const quoteLines: QuoteLine[] = [];
  for (const spec of input.specs) {
    quoteLines.push(await db.quoteLine.create({ data: {
      quoteId: quote.id,
      productId: spec.product.id,
      variantId: spec.variant?.id,
      quantity: spec.quantity,
      unitPrice: lineUnitPrice(spec),
      unitCost: lineUnitCost(spec),
      discount: spec.discount ?? 0,
      allowedDiscount: spec.allowedDiscount ?? allowedDiscount(spec.product, input.policy),
      createdAt,
    } }));
  }
  const revision = await db.quoteRevision.create({ data: {
    quoteId: quote.id,
    revisionNumber,
    state: input.revisionState,
    currency: input.customer.currency,
    validUntil: input.validUntil ?? atDay(30),
    promisedDeliveryAt: input.promisedDeliveryAt,
    terms: input.terms ?? `Net ${input.customer.paymentTerms}. Prices exclude future changes outside this revision.`,
    internalNote: input.internalNote,
    orderDiscount,
    subtotal: calculation.subtotal,
    taxTotal: calculation.taxTotal,
    total: calculation.total,
    margin: calculation.margin,
    riskScore: calculation.riskScore,
    totalsByCadence: json(calculation.totalsByCadence),
    linesSnapshot: json(snapshots),
    policySnapshot: json({ ...evaluation.policy, risk: evaluation.components }),
    termsHash: digest({ number: input.number, revisionNumber, snapshots, orderDiscount }),
    submittedById: input.revisionState === 'DRAFT' ? null : input.owner.id,
    sentAt,
    createdAt,
  } });
  await db.quote.update({ where: { id: quote.id }, data: { currentRevisionId: revision.id, lastActivity: input.lastActivity ?? createdAt } });
  return { quote, revision, quoteLines, specs: input.specs, priceList: input.priceList, policy: input.policy, calculation, evaluation, snapshots };
}

async function createHistoricalRevision(input: {
  fixture: QuoteFixture;
  revisionNumber: number;
  state: 'SUBMITTED' | 'SENT' | 'SUPERSEDED';
  specs: LineSpec[];
  orderDiscount?: number;
  sentAt?: Date;
  createdAt: Date;
  terms?: string;
}): Promise<PricedRevision> {
  const orderDiscount = input.orderDiscount ?? 0;
  const { calculation, evaluation, snapshots } = priceRevision(input.specs, orderDiscount, input.fixture.policy, input.fixture.priceList);
  const revision = await db.quoteRevision.create({ data: {
    quoteId: input.fixture.quote.id,
    revisionNumber: input.revisionNumber,
    state: input.state,
    currency: input.fixture.revision.currency,
    validUntil: atDay(30),
    terms: input.terms ?? input.fixture.revision.terms,
    orderDiscount,
    subtotal: calculation.subtotal,
    taxTotal: calculation.taxTotal,
    total: calculation.total,
    margin: calculation.margin,
    riskScore: calculation.riskScore,
    totalsByCadence: json(calculation.totalsByCadence),
    linesSnapshot: json(snapshots),
    policySnapshot: json({ ...evaluation.policy, risk: evaluation.components }),
    termsHash: digest({ number: input.fixture.quote.number, revisionNumber: input.revisionNumber, snapshots, orderDiscount, historical: true }),
    submittedById: input.fixture.quote.ownerId,
    sentAt: input.sentAt,
    createdAt: input.createdAt,
  } });
  return { quote: input.fixture.quote, revision, policy: input.fixture.policy, calculation, evaluation, snapshots };
}

async function createApprovalCase(input: {
  priced: PricedRevision;
  state: 'PENDING' | 'APPROVED' | 'RETURNED' | 'REJECTED' | 'SUPERSEDED';
  manager: User;
  finance: User;
  managerState?: 'WAITING' | 'PENDING' | 'APPROVED' | 'RETURNED' | 'REJECTED' | 'SUPERSEDED';
  financeState?: 'WAITING' | 'PENDING' | 'APPROVED' | 'RETURNED' | 'REJECTED' | 'SUPERSEDED';
  cycle?: number;
  reason?: string;
}) {
  const route = input.priced.evaluation.route;
  const cycle = input.cycle ?? 1;
  const managerState = input.managerState ?? (input.state === 'PENDING' ? 'PENDING' : input.state === 'APPROVED' ? 'APPROVED' : input.state === 'RETURNED' ? 'RETURNED' : input.state === 'REJECTED' ? 'REJECTED' : 'SUPERSEDED');
  const financeState = input.financeState ?? (input.state === 'PENDING' ? 'WAITING' : input.state === 'APPROVED' ? 'APPROVED' : 'SUPERSEDED');
  const decidedStates = new Set(['APPROVED', 'RETURNED', 'REJECTED']);
  const version = 1 + Number(decidedStates.has(managerState)) + Number(decidedStates.has(financeState));
  const approvalCase = await db.approvalCase.create({ data: {
    quoteId: input.priced.quote.id,
    revisionId: input.priced.revision.id,
    policyId: input.priced.policy.id,
    cycle,
    state: input.state,
    route,
    version,
    riskSnapshot: json(input.priced.evaluation),
    submittedById: input.priced.quote.ownerId,
    completedAt: input.state === 'PENDING' ? null : atDay(-1),
    createdAt: input.priced.revision.createdAt,
  } });
  if (route !== 'NONE') {
    await db.approval.create({ data: {
      quoteId: input.priced.quote.id,
      revisionId: input.priced.revision.id,
      caseId: approvalCase.id,
      cycle,
      step: 'Sales Manager',
      sequence: 1,
      state: managerState,
      reviewerId: decidedStates.has(managerState) ? input.manager.id : null,
      reason: decidedStates.has(managerState) ? input.reason ?? 'Seeded usability scenario decision.' : null,
      decidedAt: decidedStates.has(managerState) ? atDay(-1, 11) : null,
      createdAt: input.priced.revision.createdAt,
    } });
  }
  if (route === 'MANAGER_FINANCE') {
    await db.approval.create({ data: {
      quoteId: input.priced.quote.id,
      revisionId: input.priced.revision.id,
      caseId: approvalCase.id,
      cycle,
      step: 'Finance',
      sequence: 2,
      state: financeState,
      reviewerId: decidedStates.has(financeState) ? input.finance.id : null,
      reason: decidedStates.has(financeState) ? input.reason ?? 'Seeded usability scenario decision.' : null,
      decidedAt: decidedStates.has(financeState) ? atDay(-1, 12) : null,
      createdAt: input.priced.revision.createdAt,
    } });
  }
  return approvalCase;
}

async function createConfirmedFixture(input: {
  organizationId: string;
  number: string;
  customer: Customer;
  customerUser: User;
  owner: User;
  team: SalesTeam;
  policy: DiscountPolicy;
  priceList?: PriceList;
  specs: LineSpec[];
  manager: User;
  finance: User;
  orderState: 'CONFIRMED' | 'PARTIALLY_ALLOCATED' | 'ALLOCATED';
  createdAt: Date;
  promisedDeliveryAt?: Date;
}) : Promise<ConfirmedFixture> {
  const fixture = await createQuoteFixture({
    organizationId: input.organizationId,
    number: input.number,
    customer: input.customer,
    owner: input.owner,
    team: input.team,
    policy: input.policy,
    priceList: input.priceList,
    specs: input.specs,
    stage: 'CONFIRMED',
    revisionState: 'SENT',
    version: 5,
    sentAt: new Date(input.createdAt.getTime() - 86_400_000),
    createdAt: input.createdAt,
    lastActivity: input.createdAt,
    promisedDeliveryAt: input.promisedDeliveryAt,
  });
  await createApprovalCase({ priced: fixture, state: 'APPROVED', manager: input.manager, finance: input.finance });
  const acceptance = await db.customerAcceptance.create({ data: {
    quoteId: fixture.quote.id,
    revisionId: fixture.revision.id,
    customerId: input.customer.id,
    acceptedById: input.customerUser.id,
    termsHash: fixture.revision.termsHash,
    acceptedAt: input.createdAt,
  } });
  const order = await db.order.create({ data: {
    number: `SO-${input.number.replace(/^Q-/, '')}`,
    quoteId: fixture.quote.id,
    revisionId: fixture.revision.id,
    acceptanceId: acceptance.id,
    customerId: input.customer.id,
    state: input.orderState,
    currency: input.customer.currency,
    createdAt: input.createdAt,
  } });
  const orderLines: OrderLine[] = [];
  for (let index = 0; index < fixture.specs.length; index += 1) {
    const spec = fixture.specs[index]!;
    orderLines.push(await db.orderLine.create({ data: {
      orderId: order.id,
      quoteLineId: fixture.quoteLines[index]!.id,
      productId: spec.product.id,
      quantity: spec.quantity,
      snapshot: json(fixture.snapshots[index]),
      recurring: spec.product.recurring,
      cadence: spec.product.recurring ? spec.product.cadence : null,
      createdAt: input.createdAt,
    } }));
  }
  return { ...fixture, order, orderLines };
}

async function createInvoice(input: {
  fixture: ConfirmedFixture;
  state: 'UNPAID' | 'PARTIAL' | 'PAID' | 'REVERSED';
  dueAt: Date;
  finance: User;
  lineIndexes?: number[];
  billingKey?: string;
  shipment?: Shipment;
  paymentProvider?: 'MANUAL' | 'RAZORPAY';
  customerUser?: User;
  dueDateRequest?: boolean;
}): Promise<Invoice> {
  const selectedSnapshots = input.fixture.snapshots.filter((_, index) => !input.lineIndexes || input.lineIndexes.includes(index));
  if (selectedSnapshots.length === 0) throw new Error(`Invoice ${input.fixture.order.number} has no selected lines.`);
  const total = money(selectedSnapshots.reduce((sum, snapshot) => sum + number(snapshot.net) + number(snapshot.tax), 0));
  const partialAmount = money(total * 0.35);
  const reversedAmount = money(total * 0.25);
  const paidAmount = input.state === 'PAID' ? total : input.state === 'PARTIAL' ? partialAmount : 0;
  const invoiceState = input.state === 'PAID' ? 'PAID' : input.state === 'PARTIAL' ? 'PARTIAL' : 'UNPAID';
  const invoice = await db.invoice.create({ data: {
    organizationId: input.fixture.quote.organizationId,
    number: `INV-${input.fixture.order.number.replace(/^SO-/, '')}`,
    billingKey: input.billingKey ?? (input.shipment ? `SHIPMENT:${input.shipment.id}` : `SEED_CONFIRMATION:${input.fixture.order.id}`),
    quoteId: input.fixture.quote.id,
    orderId: input.fixture.order.id,
    shipmentId: input.shipment?.id,
    customer: input.fixture.quote.customer,
    customerId: input.fixture.quote.customerId,
    currency: input.fixture.revision.currency,
    amount: total,
    paidAmount,
    state: invoiceState,
    dueAt: input.dueAt,
    version: input.state === 'REVERSED' ? 3 : input.state === 'UNPAID' ? 1 : 2,
    lines: json(selectedSnapshots.map((snapshot) => ({
      description: String(snapshot.name ?? 'Order charge'),
      productId: String(snapshot.productId),
      variantId: snapshot.variantId ? String(snapshot.variantId) : null,
      variantName: snapshot.variantName ? String(snapshot.variantName) : null,
      cadence: String(snapshot.cadence ?? 'One-time'),
      quantity: number(snapshot.quantity),
      unitPrice: number(snapshot.unitPrice),
      discount: number(snapshot.discount),
      net: number(snapshot.net),
      tax: number(snapshot.tax),
      amount: money(number(snapshot.net) + number(snapshot.tax)),
      ...(input.shipment ? { shipmentNumber: input.shipment.number } : {}),
    }))),
    createdAt: input.shipment?.shippedAt ?? input.fixture.order.createdAt,
  } });
  if (input.state === 'PARTIAL' || input.state === 'PAID') {
    const razorpay = input.paymentProvider === 'RAZORPAY';
    await db.payment.create({ data: {
      organizationId: input.fixture.quote.organizationId,
      invoiceId: invoice.id,
      amount: paidAmount,
      currency: input.fixture.revision.currency,
      reference: razorpay ? `pay_seed_${invoice.number.toLowerCase().replaceAll('-', '_')}` : `UTR-${invoice.number}-${input.state}`,
      provider: razorpay ? 'RAZORPAY' : 'MANUAL',
      status: 'SUCCESS',
      razorpayOrderId: razorpay ? `order_seed_${invoice.number.toLowerCase().replaceAll('-', '_')}` : null,
      razorpayPaymentId: razorpay ? `pay_seed_${invoice.number.toLowerCase().replaceAll('-', '_')}` : null,
      razorpaySignature: razorpay ? digest(`seed-checkout:${invoice.id}`) : null,
      verifiedAt: atDay(-2, 12),
      paidAt: atDay(-2, 12),
      createdAt: atDay(-2, 12),
    } });
  }
  if (input.state === 'REVERSED') {
    const original = await db.payment.create({ data: { organizationId: input.fixture.quote.organizationId, invoiceId: invoice.id, amount: reversedAmount, currency: input.fixture.revision.currency, reference: `UTR-${invoice.number}-ORIGINAL`, provider: 'MANUAL', status: 'SUCCESS', verifiedAt: atDay(-4, 12), paidAt: atDay(-4, 12), createdAt: atDay(-4, 12) } });
    await db.payment.create({ data: { organizationId: input.fixture.quote.organizationId, invoiceId: invoice.id, amount: reversedAmount, currency: input.fixture.revision.currency, reference: `REV-${invoice.number}`, provider: 'MANUAL', status: 'SUCCESS', verifiedAt: atDay(-3, 12), paidAt: atDay(-3, 12), reversalOfId: original.id, reason: 'Duplicate bank posting corrected in the seed scenario.', createdAt: atDay(-3, 12) } });
  }
  if (input.dueDateRequest && input.customerUser) {
    await db.invoiceNote.create({ data: { invoiceId: invoice.id, customerId: input.fixture.quote.customerId, authorId: input.customerUser.id, kind: 'DUE_DATE_CHANGE_REQUEST', requestedDueAt: atDay(14), message: 'Please align payment with our next procurement settlement run.', createdAt: atDay(-1, 9) } });
  }
  await db.auditEvent.create({ data: { organizationId: input.fixture.quote.organizationId, actorId: input.finance.id, action: input.shipment ? 'ORDER_SHIPPED_AND_INVOICED' : 'INVOICE_ISSUED_ON_CONFIRMATION', resource: input.shipment ? 'Shipment' : 'Invoice', resourceId: input.shipment?.id ?? invoice.id, revisionId: input.fixture.revision.id, requestId: `seed-${invoice.number.toLowerCase()}`, reason: input.shipment ? `${input.shipment.number}; ${input.shipment.carrier}; ${input.shipment.trackingNumber}; invoice ${invoice.number}` : `Seeded ${input.state.toLowerCase()} invoice scenario.`, createdAt: input.shipment?.shippedAt ?? input.fixture.order.createdAt } });
  return invoice;
}

async function createSubscription(input: {
  fixture: ConfirmedFixture;
  product: Product;
  admin: User;
  scenario: 'ACTIVE_WITH_HISTORY' | 'PAUSED' | 'CANCELLED';
}) {
  const index = input.fixture.specs.findIndex((spec) => spec.product.id === input.product.id);
  if (index < 0) throw new Error(`Recurring product ${input.product.sku} is not present on ${input.fixture.quote.number}.`);
  const orderLine = input.fixture.orderLines[index]!;
  const snapshot = input.fixture.snapshots[index]!;
  const originalAmount = money(number(snapshot.net) + number(snapshot.tax));
  const changedAmount = money(Math.max(1, originalAmount - 250));
  const amountChangedAt = new Date(input.fixture.order.createdAt.getTime() + 14 * 86_400_000);
  const state = input.scenario === 'PAUSED' ? 'PAUSED' : input.scenario === 'CANCELLED' ? 'CANCELLED' : 'ACTIVE';
  const subscription = await db.subscription.create({ data: {
    organizationId: input.fixture.quote.organizationId,
    customer: input.fixture.quote.customer,
    customerId: input.fixture.quote.customerId,
    quoteId: input.fixture.quote.id,
    orderId: input.fixture.order.id,
    orderLineId: orderLine.id,
    productId: input.product.id,
    productName: input.product.name,
    cadence: input.product.cadence!,
    amount: input.scenario === 'ACTIVE_WITH_HISTORY' ? changedAmount : originalAmount,
    nextBillAt: nextBillingDate(input.fixture.order.createdAt, input.product.cadence!),
    state,
    version: input.scenario === 'ACTIVE_WITH_HISTORY' ? 4 : 2,
    cancelledAt: input.scenario === 'CANCELLED' ? atDay(-1) : null,
    createdAt: input.fixture.order.createdAt,
  } });
  if (input.scenario === 'ACTIVE_WITH_HISTORY') {
    await db.subscriptionChange.createMany({ data: [
      { subscriptionId: subscription.id, actorId: input.admin.id, kind: 'PRORATED', previousAmount: originalAmount, newAmount: changedAmount, previousState: 'ACTIVE', newState: 'ACTIVE', effectiveAt: amountChangedAt, reason: 'Apply a mid-cycle loyalty adjustment and issue the unused-service credit.', createdAt: amountChangedAt },
      { subscriptionId: subscription.id, actorId: input.admin.id, kind: 'AMOUNT_CHANGED', previousAmount: originalAmount, newAmount: changedAmount, previousState: 'ACTIVE', newState: 'ACTIVE', effectiveAt: amountChangedAt, reason: 'Apply a recurring loyalty adjustment.', createdAt: amountChangedAt },
      { subscriptionId: subscription.id, actorId: input.admin.id, kind: 'PAUSED', previousAmount: changedAmount, newAmount: changedAmount, previousState: 'ACTIVE', newState: 'PAUSED', effectiveAt: atDay(-2), reason: 'Customer requested a temporary service hold.', createdAt: atDay(-2) },
      { subscriptionId: subscription.id, actorId: input.admin.id, kind: 'RESUMED', previousAmount: changedAmount, newAmount: changedAmount, previousState: 'PAUSED', newState: 'ACTIVE', effectiveAt: atDay(-1), reason: 'Customer confirmed service should resume.', createdAt: atDay(-1) },
    ] });
  } else {
    await db.subscriptionChange.create({ data: { subscriptionId: subscription.id, actorId: input.admin.id, kind: input.scenario === 'PAUSED' ? 'PAUSED' : 'CANCELLED', previousAmount: originalAmount, newAmount: originalAmount, previousState: 'ACTIVE', newState: state, effectiveAt: atDay(-1), reason: input.scenario === 'PAUSED' ? 'Pause requested for the next billing period.' : 'Customer will not renew after the current period.', createdAt: atDay(-1) } });
  }
  return subscription;
}

async function createSeedOrganizations() {
  const primary = await db.organization.create({ data: { id: primaryOrganizationId, name: 'DealOS Demo', slug: 'dealos-demo', rfqHandlingMode: 'LEAD_FIRST' } });
  const northstar = await db.organization.create({ data: { id: northstarOrganizationId, name: 'Northstar Distribution', slug: 'northstar-distribution', rfqHandlingMode: 'DIRECT_DRAFT' } });
  await db.organizationProfile.createMany({ data: [
    { organizationId: primary.id, displayName: 'DealOS Demo Commerce', shortDescription: 'Business technology, services, and recurring support for growing teams.', category: 'Technology services', isDiscoverable: true },
    { organizationId: northstar.id, displayName: 'Northstar Distribution', shortDescription: 'Secure distribution infrastructure and regional rollout support.', category: 'Distribution technology', isDiscoverable: true },
  ] });
  await db.directoryJoinRequest.create({ data: {
    organizationId: primary.id,
    email: 'partnership@atlas.demo',
    companyName: 'Atlas Field Operations',
    message: 'We would like to join your customer network and discuss a managed device rollout.',
    createdAt: atDay(-1),
  } });
  return { primary, northstar };
}

async function validateSeed() {
  const [
    organizations,
    directoryProfiles,
    directoryPending,
    directoryApproved,
    directoryDeclined,
    quotes,
    orders,
    invoices,
    subscriptions,
    fulfillments,
    portalRequests,
    leads,
    productVariants,
    priceLists,
    priceListItems,
    shipments,
    shipmentLines,
    billingPeriods,
    creditNotes,
    notifications,
    paymentWebhookEvents,
    recommendationActions,
    passwordResetTokens,
  ] = await Promise.all([
    db.organization.count(),
    db.organizationProfile.count({ where: { isDiscoverable: true } }),
    db.directoryJoinRequest.count({ where: { status: 'PENDING' } }),
    db.directoryJoinRequest.count({ where: { status: 'APPROVED' } }),
    db.directoryJoinRequest.count({ where: { status: 'DECLINED' } }),
    db.quote.count(), db.order.count(), db.invoice.count(), db.subscription.count(), db.fulfillment.count(), db.portalRequest.count(), db.lead.count(),
    db.productVariant.count(), db.priceList.count(), db.priceListItem.count(), db.shipment.count(), db.shipmentLine.count(), db.billingPeriod.count(), db.creditNote.count(), db.notification.count(), db.paymentWebhookEvent.count(), db.recommendationAction.count(), db.passwordResetToken.count(),
  ]);
  const expected = { organizations: 2, directoryProfiles: 2, directoryPending: 1, directoryApproved: 1, directoryDeclined: 1, quotes: 20, orders: 6, invoices: 5, subscriptions: 3, fulfillments: 2, portalRequests: 4, leads: 3, productVariants: 5, priceLists: 3, priceListItems: 12, shipments: 1, shipmentLines: 1, billingPeriods: 3, creditNotes: 1, notifications: 5, paymentWebhookEvents: 1, recommendationActions: 2, passwordResetTokens: 0 };
  const actual = { organizations, directoryProfiles, directoryPending, directoryApproved, directoryDeclined, quotes, orders, invoices, subscriptions, fulfillments, portalRequests, leads, productVariants, priceLists, priceListItems, shipments, shipmentLines, billingPeriods, creditNotes, notifications, paymentWebhookEvents, recommendationActions, passwordResetTokens };
  for (const [key, value] of Object.entries(expected)) {
    if (actual[key as keyof typeof actual] !== value) throw new Error(`Seed validation failed: expected ${value} ${key}, found ${actual[key as keyof typeof actual]}.`);
  }
  const scenarioNumbers = ['Q-0101', 'Q-0102', 'Q-0103', 'Q-0104', 'Q-0105', 'Q-0106', 'Q-0107', 'Q-0108', 'Q-0109', 'Q-0110', 'Q-0111', 'Q-0201', 'Q-0202', 'Q-0203', 'Q-0204', 'Q-0205', 'Q-0206', 'Q-0301', 'NS-Q-0001', 'NS-Q-0002'];
  const scenarioRows = await db.quote.findMany({
    where: { number: { in: scenarioNumbers } },
    include: {
      currentRevision: true,
      priceList: true,
      lines: { include: { variant: true } },
      approvalCases: { include: { steps: { orderBy: { sequence: 'asc' } } }, orderBy: { cycle: 'desc' } },
      negotiation: true,
      order: { include: { fulfillment: true, invoices: true, subscriptions: true, shipments: { include: { lines: true, invoices: true } } } },
    },
  });
  if (scenarioRows.length !== scenarioNumbers.length) throw new Error('Seed validation failed: one or more named quotation scenarios are missing.');
  const scenarios = new Map(scenarioRows.map((quote) => [quote.number, quote]));
  const assertScenario = (number: string, condition: boolean, expectation: string) => {
    if (!condition) throw new Error(`Seed validation failed: ${number} must ${expectation}.`);
  };
  const q0102 = scenarios.get('Q-0102')!;
  assertScenario('Q-0102', q0102.stage === 'PENDING_APPROVAL' && q0102.approvalCases[0]?.route === 'MANAGER_FINANCE', 'await Manager then Finance approval');
  assertScenario('Q-0102', q0102.approvalCases[0]?.steps.map((step) => step.state).join(',') === 'PENDING,WAITING', 'start with Manager pending and Finance waiting');
  assertScenario('Q-0102', q0102.priceList?.name === 'Gold Contract Pricing' && q0102.lines.some((line) => line.variant?.sku === 'HW-LP14-32-1TB'), 'use a governed price list and product variant');
  assertScenario('Q-0103', scenarios.get('Q-0103')?.approvalCases[0]?.route === 'MANAGER', 'exercise the Manager-only route');
  const q0104 = scenarios.get('Q-0104')!;
  assertScenario('Q-0104', q0104.approvalCases[0]?.steps.map((step) => step.state).join(',') === 'APPROVED,PENDING', 'retain the Manager-to-Finance handoff');
  assertScenario('Q-0105', scenarios.get('Q-0105')?.stage === 'APPROVED' && scenarios.get('Q-0105')?.currentRevision?.state === 'SUBMITTED', 'be approved but unsent');
  assertScenario('Q-0106', scenarios.get('Q-0106')?.currentRevision?.state === 'SENT' && scenarios.get('Q-0106')?.negotiation.some((item) => item.kind === 'COMMENT') === true, 'contain a sent customer question');
  assertScenario('Q-0107', scenarios.get('Q-0107')?.stage === 'NEGOTIATION' && scenarios.get('Q-0107')?.negotiation.some((item) => item.state === 'OPEN') === true, 'contain an open customer proposal');
  assertScenario('Q-0108', scenarios.get('Q-0108')?.currentRevision?.revisionNumber === 2 && scenarios.get('Q-0108')?.approvalCases.some((item) => item.state === 'RETURNED') === true, 'retain a returned first cycle and current revision 2');
  assertScenario('Q-0109', scenarios.get('Q-0109')?.stage === 'REJECTED', 'represent a rejected terminal outcome');
  assertScenario('Q-0111', scenarios.get('Q-0111')?.currentRevision?.revisionNumber === 2 && scenarios.get('Q-0111')?.negotiation.some((item) => item.state === 'ADOPTED') === true, 'retain an adopted counteroffer and replacement Draft');
  const q0201 = scenarios.get('Q-0201')!;
  assertScenario('Q-0201', q0201.order?.state === 'CONFIRMED' && q0201.order.invoices.length === 0, 'keep unshipped hardware out of billing');
  const q0202 = scenarios.get('Q-0202')!;
  assertScenario('Q-0202', q0202.order?.state === 'PARTIALLY_ALLOCATED' && q0202.order.fulfillment?.state === 'BACKORDER', 'represent partial allocation with a backorder');
  assertScenario('Q-0202', q0202.order?.invoices[0]?.state === 'PARTIAL' && q0202.order.subscriptions[0]?.state === 'ACTIVE', 'link partial billing and an active subscription');
  const q0203 = scenarios.get('Q-0203')!;
  assertScenario('Q-0203', q0203.order?.state === 'SHIPPED' && q0203.order.fulfillment?.state === 'FULFILLED', 'represent a completed stock-backed shipment');
  assertScenario('Q-0203', q0203.order?.shipments[0]?.state === 'SHIPPED' && q0203.order.shipments[0]?.lines[0]?.quantity === 12 && q0203.order.shipments[0]?.invoices[0]?.shipmentId === q0203.order.shipments[0]?.id, 'link shipment lines to the generated invoice');
  assertScenario('NS-Q-0002', scenarios.get('NS-Q-0002')?.stage === 'DRAFT', 'represent the Direct-Draft intake result');
  const creditedInvoice = await db.invoice.findUnique({ where: { number: 'INV-0202' }, include: { billingPeriod: { include: { subscription: true } }, credits: true } });
  if (!creditedInvoice?.billingPeriod || number(creditedInvoice.billingPeriod.proration) >= 0 || creditedInvoice.credits.length !== 1) throw new Error('Seed validation failed: INV-0202 must demonstrate invoiced recurring proration with one credit note.');
  if (creditedInvoice.billingPeriod.subscription.state !== 'ACTIVE' || creditedInvoice.billingPeriod.subscription.nextBillAt > seedStartedAt) throw new Error('Seed validation failed: the active Care Plan must be due for the recurring-billing demo action.');
  const acmeWithPricing = await db.customer.findUnique({ where: { id: q0102.customerId }, include: { defaultPriceList: true } });
  if (acmeWithPricing?.defaultPriceList?.id !== q0102.priceListId) throw new Error('Seed validation failed: Acme must default to the Gold price list used by Q-0102.');
  const razorpayPayment = await db.payment.findFirst({ where: { invoice: { number: 'INV-0203' }, provider: 'RAZORPAY', status: 'SUCCESS' } });
  const webhook = await db.paymentWebhookEvent.findFirst({ where: { organizationId: primaryOrganizationId, eventType: 'payment.captured' } });
  if (!razorpayPayment?.razorpayPaymentId || !webhook?.eventKey.includes(razorpayPayment.razorpayPaymentId)) throw new Error('Seed validation failed: the captured Razorpay payment and processed webhook are not linked.');
  const balances = await db.stockBalance.findMany({ select: { id: true, reserved: true } });
  const reservationTotals = await db.reservation.groupBy({ by: ['stockBalanceId'], _sum: { quantity: true } });
  const totalsByBalance = new Map(reservationTotals.map((item) => [item.stockBalanceId, item._sum.quantity ?? 0]));
  for (const balance of balances) {
    if (balance.reserved !== (totalsByBalance.get(balance.id) ?? 0)) throw new Error(`Seed validation failed: reserved stock does not reconcile for ${balance.id}.`);
  }
  const invoiceRows = await db.invoice.findMany({ include: { payments: true } });
  for (const invoice of invoiceRows) {
    const ledger = invoice.payments.reduce((sum, payment) => sum + (payment.reversalOfId ? -1 : 1) * Number(payment.amount.toString()), 0);
    if (money(ledger) !== money(Number(invoice.paidAmount.toString()))) throw new Error(`Seed validation failed: ${invoice.number} payment ledger does not reconcile.`);
  }
  const pendingInvitation = await db.organizationInvitation.findUnique({ where: { tokenHash: digest(demoPortalInvitationToken) } });
  if (!pendingInvitation || pendingInvitation.status !== 'PENDING') throw new Error('Seed validation failed: the reusable Gamma Health invitation is missing.');
  const pendingDirectoryRequest = await db.directoryJoinRequest.findFirst({ where: { status: 'PENDING', companyName: 'Atlas Field Operations' } });
  if (!pendingDirectoryRequest || pendingDirectoryRequest.decidedAt || pendingDirectoryRequest.resultingCustomerId) throw new Error('Seed validation failed: the actionable Atlas directory request is missing or already decided.');
  const approvedDirectoryRequest = await db.directoryJoinRequest.findFirst({ where: { status: 'APPROVED', companyName: 'Lumen Offices' }, include: { resultingCustomer: { include: { users: { include: { memberships: true } }, assignments: true } } } });
  const approvedCustomer = approvedDirectoryRequest?.resultingCustomer;
  if (!approvedCustomer || approvedCustomer.assignments.filter((assignment) => assignment.active && assignment.role === 'PRIMARY').length !== 1 || !approvedCustomer.users.some((user) => user.role === 'CUSTOMER' && user.status === 'ACTIVE' && user.memberships.some((membership) => membership.organizationId === approvedCustomer.organizationId && membership.accessRole === 'PORTAL_USER' && membership.status === 'ACTIVE'))) {
    throw new Error('Seed validation failed: approved Lumen directory request does not have a complete customer, primary assignment, and portal identity.');
  }
  const declinedDirectoryRequest = await db.directoryJoinRequest.findFirst({ where: { status: 'DECLINED', companyName: 'Stonebridge Procurement' } });
  if (!declinedDirectoryRequest?.decisionReason || declinedDirectoryRequest.resultingCustomerId) throw new Error('Seed validation failed: declined Stonebridge directory request is missing its terminal reason or references a customer.');
  return actual;
}

async function main() {
  await resetApplicationData();
  const organizations = await createSeedOrganizations();

  const [acme, beta, northstarLabs, gamma, lumen, orion] = await Promise.all([
    db.customer.create({ data: { organizationId: primaryOrganizationId, name: 'Acme Corp', tier: 'Gold', currency: 'INR', contactPerson: 'Priya Nair', email: 'customer@dealos.demo', phone: '9876500101', gstin: '29ABCDE1234F1Z5', billingAddress: '12 Residency Road, Bengaluru, Karnataka 560025', shippingAddress: 'Acme Technology Park, Whitefield, Bengaluru 560066', paymentTerms: 30 } }),
    db.customer.create({ data: { organizationId: primaryOrganizationId, name: 'Beta Industries', tier: 'Silver', currency: 'INR', contactPerson: 'Kabir Singh', email: 'buyer@beta.demo', phone: '9876500102', gstin: '27ABCDE5678G1Z2', billingAddress: '18 MIDC Road, Pune, Maharashtra 411019', shippingAddress: 'Beta Plant 2, Chakan, Maharashtra 410501', paymentTerms: 14 } }),
    db.customer.create({ data: { organizationId: primaryOrganizationId, name: 'Northstar Labs', tier: 'Bronze', currency: 'INR', contactPerson: 'Rhea Iyer', email: 'procurement@northstarlabs.demo', phone: '9876500103', billingAddress: '5 Knowledge Park, Hyderabad, Telangana 500081', shippingAddress: 'Same as billing', paymentTerms: 7 } }),
    db.customer.create({ data: { organizationId: primaryOrganizationId, name: 'Gamma Health', tier: 'Gold', currency: 'INR', contactPerson: 'Dr. Veer Rao', email: 'procurement@gamma.demo', phone: '9876500104', billingAddress: '44 Hospital Avenue, Chennai, Tamil Nadu 600006', shippingAddress: 'Gamma Central Stores, Chennai 600010', paymentTerms: 45 } }),
    db.customer.create({ data: { organizationId: primaryOrganizationId, name: 'Lumen Offices', tier: 'Silver', currency: 'INR', contactPerson: 'Sana Kapoor', email: 'customer@lumen.demo', phone: '9876500105', billingAddress: '17 Business Bay, Gurugram, Haryana 122002', shippingAddress: 'Lumen Operations Centre, Gurugram, Haryana 122016', paymentTerms: 14 } }),
    db.customer.create({ data: { organizationId: northstarOrganizationId, name: 'Orion Retail', tier: 'Enterprise', currency: 'INR', contactPerson: 'Tara Menon', email: 'buyer@orion.demo', phone: '9876500201', billingAddress: '9 Market Square, Kochi, Kerala 682016', shippingAddress: 'Orion DC, Kalamassery, Kerala 683104', paymentTerms: 30 } }),
  ]);

  const [rep, collaborator, manager, finance, admin, acmeCustomer, betaCustomer, lumenCustomer, pendingUser, northstarRep, northstarManager, northstarAdmin, orionCustomer] = await Promise.all([
    createUser({ organizationId: primaryOrganizationId, name: 'Aarav Mehta', email: 'rep@dealos.demo', role: Role.REP }),
    createUser({ organizationId: primaryOrganizationId, name: 'Leena Verma', email: 'collaborator@dealos.demo', role: Role.REP }),
    createUser({ organizationId: primaryOrganizationId, name: 'Maya Shah', email: 'manager@dealos.demo', role: Role.MANAGER }),
    createUser({ organizationId: primaryOrganizationId, name: 'Finn Rao', email: 'finance@dealos.demo', role: Role.FINANCE }),
    createUser({ organizationId: primaryOrganizationId, name: 'Anika Bose', email: 'admin@dealos.demo', role: Role.ADMIN }),
    createUser({ organizationId: primaryOrganizationId, name: 'Priya Nair', email: 'customer@dealos.demo', role: Role.CUSTOMER, customerId: acme.id }),
    createUser({ organizationId: primaryOrganizationId, name: 'Kabir Singh', email: 'buyer@beta.demo', role: Role.CUSTOMER, customerId: beta.id }),
    createUser({ organizationId: primaryOrganizationId, name: 'Sana Kapoor', email: 'customer@lumen.demo', role: Role.CUSTOMER, customerId: lumen.id }),
    createUser({ organizationId: primaryOrganizationId, name: 'Pending Teammate', email: 'pending@dealos.demo', role: Role.REP, status: 'PENDING' }),
    createUser({ organizationId: northstarOrganizationId, name: 'Ira Sen', email: 'rep@northstar.demo', role: Role.REP }),
    createUser({ organizationId: northstarOrganizationId, name: 'Dev Malhotra', email: 'manager@northstar.demo', role: Role.MANAGER }),
    createUser({ organizationId: northstarOrganizationId, name: 'Noah Kapoor', email: 'orgadmin@northstar.demo', role: Role.ADMIN }),
    createUser({ organizationId: northstarOrganizationId, name: 'Tara Menon', email: 'buyer@orion.demo', role: Role.CUSTOMER, customerId: orion.id }),
  ]);

  const [enterpriseTeam, northstarTeam] = await Promise.all([
    db.salesTeam.create({ data: { organizationId: primaryOrganizationId, name: 'Enterprise Sales', managerId: manager.id } }),
    db.salesTeam.create({ data: { organizationId: northstarOrganizationId, name: 'Distribution Sales', managerId: northstarManager.id } }),
  ]);
  await db.salesTeamMember.createMany({ data: [
    { teamId: enterpriseTeam.id, userId: rep.id }, { teamId: enterpriseTeam.id, userId: collaborator.id }, { teamId: enterpriseTeam.id, userId: manager.id },
    { teamId: northstarTeam.id, userId: northstarRep.id }, { teamId: northstarTeam.id, userId: northstarManager.id },
  ] });
  await db.customer.updateMany({ where: { id: { in: [acme.id, beta.id, northstarLabs.id, gamma.id, lumen.id] } }, data: { primarySalesTeamId: enterpriseTeam.id, assignmentVersion: 2 } });
  await db.customer.update({ where: { id: orion.id }, data: { primarySalesTeamId: northstarTeam.id, assignmentVersion: 2 } });
  await db.customerRepresentative.createMany({ data: [
    ...[acme, beta, northstarLabs, gamma, lumen].map((customer) => ({ customerId: customer.id, userId: rep.id, role: 'PRIMARY' as const, assignedById: admin.id, assignedAt: atDay(-60) })),
    { customerId: acme.id, userId: collaborator.id, role: 'COLLABORATOR', assignedById: admin.id, assignedAt: atDay(-45) },
    { customerId: gamma.id, userId: collaborator.id, role: 'COLLABORATOR', assignedById: admin.id, assignedAt: atDay(-30) },
    { customerId: orion.id, userId: northstarRep.id, role: 'PRIMARY', assignedById: northstarAdmin.id, assignedAt: atDay(-60) },
  ] });

  const allUsers = [rep, collaborator, manager, finance, admin, acmeCustomer, betaCustomer, lumenCustomer, pendingUser, northstarRep, northstarManager, northstarAdmin, orionCustomer];
  await Promise.all(allUsers.map((user) => db.organizationMembership.create({ data: { organizationId: user.organizationId!, userId: user.id, accessRole: user.role === Role.ADMIN ? 'ORGANIZATION_ADMIN' : user.role === Role.CUSTOMER ? 'PORTAL_USER' : 'ORGANIZATION_MEMBER', businessRole: user.role } })));
  const [approvedDirectoryRequest, declinedDirectoryRequest] = await Promise.all([
    db.directoryJoinRequest.create({ data: {
      organizationId: primaryOrganizationId,
      email: lumenCustomer.email,
      companyName: lumen.name,
      message: 'We need a managed workplace technology supplier for our expanding offices.',
      status: 'APPROVED',
      decidedById: admin.id,
      decidedAt: atDay(-40),
      resultingCustomerId: lumen.id,
      createdAt: atDay(-42),
    } }),
    db.directoryJoinRequest.create({ data: {
      organizationId: primaryOrganizationId,
      email: 'join@stonebridge.demo',
      companyName: 'Stonebridge Procurement',
      message: 'We would like access to purchase from your organization.',
      status: 'DECLINED',
      decidedById: admin.id,
      decidedAt: atDay(-3),
      decisionReason: 'The submitted business details could not be verified.',
      createdAt: atDay(-5),
    } }),
  ]);
  await db.privilegedAudit.create({ data: {
    actorId: admin.id,
    organizationId: primaryOrganizationId,
    action: 'CUSTOMER_RELATIONSHIPS_UPDATED',
    affectedModel: 'Customer',
    recordId: lumen.id,
    beforeValues: json({ primarySalesTeamId: null, assignmentVersion: 1, assignments: [] }),
    afterValues: json({ primaryTeam: { id: enterpriseTeam.id, name: enterpriseTeam.name }, primaryRepresentative: { id: rep.id, name: rep.name }, collaborators: [], assignmentVersion: 2 }),
    reason: `Approved directory join request ${approvedDirectoryRequest.id}`,
    requestId: 'seed-directory-lumen-approve',
    result: 'SUCCESS',
    createdAt: atDay(-40),
  } });
  await db.organizationInvitation.createMany({ data: [
    { organizationId: primaryOrganizationId, customerId: acme.id, email: acmeCustomer.email, accessRole: 'PORTAL_USER', businessRole: 'CUSTOMER', status: 'ACCEPTED', tokenHash: digest('accepted-acme-invite'), invitedById: admin.id, expiresAt: atDay(20), acceptedAt: atDay(-40), createdAt: atDay(-45) },
    { organizationId: primaryOrganizationId, customerId: beta.id, email: betaCustomer.email, accessRole: 'PORTAL_USER', businessRole: 'CUSTOMER', status: 'ACCEPTED', tokenHash: digest('accepted-beta-invite'), invitedById: manager.id, expiresAt: atDay(20), acceptedAt: atDay(-25), createdAt: atDay(-30) },
    { organizationId: primaryOrganizationId, customerId: gamma.id, email: gamma.email!, accessRole: 'PORTAL_USER', businessRole: 'CUSTOMER', status: 'PENDING', tokenHash: digest(demoPortalInvitationToken), invitedById: admin.id, expiresAt: atDay(7), createdAt: atDay(0) },
    { organizationId: primaryOrganizationId, customerId: beta.id, email: 'old-buyer@beta.demo', accessRole: 'PORTAL_USER', businessRole: 'CUSTOMER', status: 'REVOKED', tokenHash: digest('revoked-beta-invite'), invitedById: manager.id, expiresAt: atDay(2), revokedAt: atDay(-5), createdAt: atDay(-10) },
    { organizationId: primaryOrganizationId, customerId: northstarLabs.id, email: northstarLabs.email!, accessRole: 'PORTAL_USER', businessRole: 'CUSTOMER', status: 'EXPIRED', tokenHash: digest('expired-northstar-labs-invite'), invitedById: admin.id, expiresAt: atDay(-1), createdAt: atDay(-10) },
    { organizationId: northstarOrganizationId, customerId: orion.id, email: orionCustomer.email, accessRole: 'PORTAL_USER', businessRole: 'CUSTOMER', status: 'ACCEPTED', tokenHash: digest('accepted-orion-invite'), invitedById: northstarAdmin.id, expiresAt: atDay(20), acceptedAt: atDay(-20), createdAt: atDay(-25) },
  ] });

  const [laptop, docking, tablet, setup, care, compliance, warranty, northstarGateway] = await Promise.all([
    db.product.create({ data: { organizationId: primaryOrganizationId, name: 'Latitude Pro 14', sku: 'HW-LP14', brand: 'Dell', category: 'Hardware', description: 'Business laptop with 16 GB RAM and three-year support.', unit: 'Unit', price: 85000, cost: 62000, taxRate: 18, featured: true } }),
    db.product.create({ data: { organizationId: primaryOrganizationId, name: 'USB-C Docking Station', sku: 'HW-DOCK', brand: 'Dell', category: 'Hardware', description: 'Dual-display USB-C docking station.', unit: 'Unit', price: 14000, cost: 9000, taxRate: 18 } }),
    db.product.create({ data: { organizationId: primaryOrganizationId, name: 'Rugged Field Tablet', sku: 'HW-TABLET', brand: 'Samsung', category: 'Hardware', description: 'Ruggedized tablet for warehouse and field teams.', unit: 'Unit', price: 48000, cost: 34000, taxRate: 18, featured: true } }),
    db.product.create({ data: { organizationId: primaryOrganizationId, name: 'Onsite Setup Service', sku: 'SV-SETUP', brand: 'DealOS Services', category: 'Services', description: 'Deployment, migration, and team onboarding.', unit: 'Engagement', price: 25000, cost: 16000, taxRate: 18 } }),
    db.product.create({ data: { organizationId: primaryOrganizationId, name: 'Care Plan', sku: 'SUB-CARE', brand: 'DealOS Services', category: 'Subscriptions', description: 'Priority help desk and device monitoring.', unit: 'Seat', price: 1800, cost: 650, taxRate: 18, recurring: true, cadence: 'Monthly' } }),
    db.product.create({ data: { organizationId: primaryOrganizationId, name: 'Compliance Review', sku: 'SUB-COMPLY', brand: 'DealOS Services', category: 'Subscriptions', description: 'Quarterly security and compliance review.', unit: 'Account', price: 12500, cost: 5000, taxRate: 18, recurring: true, cadence: 'Quarterly' } }),
    db.product.create({ data: { organizationId: primaryOrganizationId, name: 'Extended Warranty', sku: 'SUB-WARRANTY', brand: 'DealOS Services', category: 'Subscriptions', description: 'Annual extended hardware protection.', unit: 'Account', price: 22000, cost: 7000, taxRate: 18, recurring: true, cadence: 'Yearly' } }),
    db.product.create({ data: { organizationId: northstarOrganizationId, name: 'Northstar Edge Gateway', sku: 'NS-HW-EDGE', brand: 'Northstar', category: 'Hardware', description: 'Secure distribution edge appliance.', unit: 'Unit', price: 180000, cost: 112000, taxRate: 18 } }),
  ]);

  const [laptopPerformance, laptopMobility, dockingThunderbolt, tablet5g, gatewayHa] = await Promise.all([
    db.productVariant.create({ data: { organizationId: primaryOrganizationId, productId: laptop.id, name: '32 GB / 1 TB', sku: 'HW-LP14-32-1TB', attributes: json({ memory: '32 GB', storage: '1 TB SSD', finish: 'Graphite' }), priceDelta: 22000, costDelta: 15000 } }),
    db.productVariant.create({ data: { organizationId: primaryOrganizationId, productId: laptop.id, name: '16 GB / 512 GB Ultralight', sku: 'HW-LP14-16-512-UL', attributes: json({ memory: '16 GB', storage: '512 GB SSD', chassis: 'Ultralight' }), priceDelta: 8000, costDelta: 5000 } }),
    db.productVariant.create({ data: { organizationId: primaryOrganizationId, productId: docking.id, name: 'Thunderbolt 4', sku: 'HW-DOCK-TB4', attributes: json({ connector: 'Thunderbolt 4', displays: 3, powerDelivery: '130 W' }), priceDelta: 4500, costDelta: 2800 } }),
    db.productVariant.create({ data: { organizationId: primaryOrganizationId, productId: tablet.id, name: '5G / 256 GB', sku: 'HW-TABLET-5G-256', attributes: json({ connectivity: '5G', storage: '256 GB', ingressProtection: 'IP68' }), priceDelta: 9000, costDelta: 6000 } }),
    db.productVariant.create({ data: { organizationId: northstarOrganizationId, productId: northstarGateway.id, name: 'High Availability Pair', sku: 'NS-HW-EDGE-HA', attributes: json({ deployment: 'Active/passive pair', support: '24x7' }), priceDelta: 52000, costDelta: 34000 } }),
  ]);

  const [goldPriceList, silverPriceList, enterprisePriceList] = await Promise.all([
    db.priceList.create({ data: {
      organizationId: primaryOrganizationId,
      name: 'Gold Contract Pricing',
      customerTier: 'Gold',
      currency: 'INR',
      effectiveFrom: atDay(-90),
      effectiveTo: atDay(180),
      items: { create: [
        { productId: laptop.id, unitPrice: 82000 },
        { productId: laptop.id, variantId: laptopPerformance.id, unitPrice: 101500 },
        { productId: docking.id, unitPrice: 13250 },
        { productId: docking.id, variantId: dockingThunderbolt.id, unitPrice: 17250 },
        { productId: setup.id, unitPrice: 23500 },
        { productId: care.id, unitPrice: 1650 },
      ] },
    } }),
    db.priceList.create({ data: {
      organizationId: primaryOrganizationId,
      name: 'Silver Business Pricing',
      customerTier: 'Silver',
      currency: 'INR',
      effectiveFrom: atDay(-90),
      items: { create: [
        { productId: tablet.id, unitPrice: 47000 },
        { productId: tablet.id, variantId: tablet5g.id, unitPrice: 55500 },
        { productId: docking.id, unitPrice: 13750 },
        { productId: setup.id, unitPrice: 24500 },
      ] },
    } }),
    db.priceList.create({ data: {
      organizationId: northstarOrganizationId,
      name: 'Enterprise Distribution Pricing',
      customerTier: 'Enterprise',
      currency: 'INR',
      effectiveFrom: atDay(-120),
      items: { create: [
        { productId: northstarGateway.id, unitPrice: 172000 },
        { productId: northstarGateway.id, variantId: gatewayHa.id, unitPrice: 218000 },
      ] },
    } }),
  ]);
  await Promise.all([
    db.customer.update({ where: { id: acme.id }, data: { defaultPriceListId: goldPriceList.id } }),
    db.customer.update({ where: { id: beta.id }, data: { defaultPriceListId: silverPriceList.id } }),
    db.customer.update({ where: { id: orion.id }, data: { defaultPriceListId: enterprisePriceList.id } }),
  ]);

  const [bronzePolicy, silverPolicy, goldPolicy, enterprisePolicy] = await Promise.all([
    db.discountPolicy.create({ data: { organizationId: primaryOrganizationId, tier: 'Bronze', maxDiscount: 5, hardwareLimit: 5, servicesLimit: 5, subscriptionLimit: 3, financeThreshold: 5, aggregateDiscountLimit: 12, minimumMarginPercent: 12, version: 3 } }),
    db.discountPolicy.create({ data: { organizationId: primaryOrganizationId, tier: 'Silver', maxDiscount: 10, hardwareLimit: 10, servicesLimit: 8, subscriptionLimit: 6, financeThreshold: 5, aggregateDiscountLimit: 15, minimumMarginPercent: 12, version: 3 } }),
    db.discountPolicy.create({ data: { organizationId: primaryOrganizationId, tier: 'Gold', maxDiscount: 15, hardwareLimit: 15, servicesLimit: 10, subscriptionLimit: 10, financeThreshold: 5, aggregateDiscountLimit: 20, minimumMarginPercent: 12, version: 3 } }),
    db.discountPolicy.create({ data: { organizationId: northstarOrganizationId, tier: 'Enterprise', maxDiscount: 12, hardwareLimit: 12, servicesLimit: 8, subscriptionLimit: 8, financeThreshold: 4, aggregateDiscountLimit: 18, minimumMarginPercent: 12, version: 2 } }),
  ]);

  const [mainWarehouse, eastDepot, southHub, northstarWarehouse] = await Promise.all([
    db.warehouse.create({ data: { organizationId: primaryOrganizationId, name: 'Main Warehouse', priority: 1, shippingCost: 4500 } }),
    db.warehouse.create({ data: { organizationId: primaryOrganizationId, name: 'East Depot', priority: 2, shippingCost: 2800 } }),
    db.warehouse.create({ data: { organizationId: primaryOrganizationId, name: 'South Hub', priority: 3, shippingCost: 3200 } }),
    db.warehouse.create({ data: { organizationId: northstarOrganizationId, name: 'Northstar Central', priority: 1, shippingCost: 5500 } }),
  ]);
  const stock = new Map<string, StockBalance>();
  const addStock = async (warehouse: Warehouse, product: Product, onHand: number, reserved: number, minAlertLevel = 0) => {
    const balance = await db.stockBalance.create({ data: { warehouseId: warehouse.id, productId: product.id, onHand, reserved, minAlertLevel } });
    stock.set(`${warehouse.id}:${product.id}`, balance);
    return balance;
  };
  await Promise.all([
    addStock(mainWarehouse, laptop, 7, 7, 3), addStock(eastDepot, laptop, 4, 4, 2), addStock(southHub, laptop, 0, 0, 2),
    addStock(mainWarehouse, docking, 40, 7, 10), addStock(eastDepot, docking, 15, 5, 5), addStock(southHub, docking, 10, 0, 3),
    addStock(mainWarehouse, tablet, 3, 0, 2), addStock(eastDepot, tablet, 8, 0, 3), addStock(southHub, tablet, 3, 0, 2),
    addStock(northstarWarehouse, northstarGateway, 20, 0, 5),
  ]);

  const q0101 = await createQuoteFixture({ organizationId: primaryOrganizationId, number: 'Q-0101', customer: beta, owner: rep, team: enterpriseTeam, policy: silverPolicy, priceList: silverPriceList, specs: [{ product: docking, quantity: 2, unitPrice: 13750 }, { product: setup, quantity: 1, unitPrice: 24500 }], stage: 'DRAFT', revisionState: 'DRAFT', lastActivity: atDay(-10), createdAt: atDay(-12), internalNote: 'Requirements captured from an external sales call.' });
  const q0102 = await createQuoteFixture({ organizationId: primaryOrganizationId, number: 'Q-0102', customer: acme, owner: rep, team: enterpriseTeam, policy: goldPolicy, priceList: goldPriceList, specs: [{ product: laptop, variant: laptopPerformance, quantity: 2, unitPrice: 101500, discount: 12 }, { product: setup, quantity: 1, unitPrice: 23500, discount: 18 }, { product: care, quantity: 30, unitPrice: 1650, discount: 5 }], stage: 'PENDING_APPROVAL', revisionState: 'SUBMITTED', createdAt: atDay(-2), lastActivity: atDay(-1) });
  await createApprovalCase({ priced: q0102, state: 'PENDING', manager, finance });
  const q0103 = await createQuoteFixture({ organizationId: primaryOrganizationId, number: 'Q-0103', customer: beta, owner: rep, team: enterpriseTeam, policy: silverPolicy, specs: [{ product: docking, quantity: 5, discount: 5 }, { product: setup, quantity: 1, discount: 5 }], stage: 'PENDING_APPROVAL', revisionState: 'SUBMITTED', createdAt: atDay(-2) });
  await createApprovalCase({ priced: q0103, state: 'PENDING', manager, finance });
  const q0104 = await createQuoteFixture({ organizationId: primaryOrganizationId, number: 'Q-0104', customer: acme, owner: rep, team: enterpriseTeam, policy: goldPolicy, specs: [{ product: tablet, quantity: 4, discount: 18 }, { product: setup, quantity: 2, discount: 18 }], stage: 'PENDING_APPROVAL', revisionState: 'SUBMITTED', createdAt: atDay(-3) });
  await createApprovalCase({ priced: q0104, state: 'PENDING', manager, finance, managerState: 'APPROVED', financeState: 'PENDING', reason: 'Commercial rationale accepted; Finance to verify the margin exception.' });
  const q0105 = await createQuoteFixture({ organizationId: primaryOrganizationId, number: 'Q-0105', customer: acme, owner: rep, team: enterpriseTeam, policy: goldPolicy, specs: [{ product: laptop, quantity: 3 }, { product: care, quantity: 3 }], stage: 'APPROVED', revisionState: 'SUBMITTED', createdAt: atDay(-3) });
  await createApprovalCase({ priced: q0105, state: 'APPROVED', manager, finance });
  const q0106 = await createQuoteFixture({ organizationId: primaryOrganizationId, number: 'Q-0106', customer: acme, owner: rep, team: enterpriseTeam, policy: goldPolicy, specs: [{ product: docking, quantity: 4, discount: 3 }, { product: setup, quantity: 1 }], stage: 'APPROVED', revisionState: 'SENT', createdAt: atDay(-4), lastActivity: atDay(-2) });
  await createApprovalCase({ priced: q0106, state: 'APPROVED', manager, finance, reason: 'Small relationship discount approved.' });
  await db.negotiation.create({ data: { quoteId: q0106.quote.id, revisionId: q0106.revision.id, kind: 'COMMENT', state: 'OPEN', author: acmeCustomer.name, message: 'Can the delivery team arrive before 10 AM?', messageType: 'QUESTION', requestedDeliveryAt: atDay(8, 9), createdAt: atDay(-1) } });
  const q0107 = await createQuoteFixture({ organizationId: primaryOrganizationId, number: 'Q-0107', customer: acme, owner: rep, team: enterpriseTeam, policy: goldPolicy, specs: [{ product: laptop, quantity: 5, discount: 5 }, { product: care, quantity: 5, discount: 5 }], stage: 'NEGOTIATION', revisionState: 'SENT', createdAt: atDay(-5), lastActivity: atDay(-1) });
  await createApprovalCase({ priced: q0107, state: 'APPROVED', manager, finance, reason: 'Discount remains commercially healthy.' });
  await db.negotiation.create({ data: { quoteId: q0107.quote.id, revisionId: q0107.revision.id, kind: 'PROPOSAL', state: 'OPEN', author: acmeCustomer.name, message: 'We can sign this week if the overall discount is 12%.', messageType: 'COUNTER_DISCOUNT', counterDiscount: 12, requestedDeliveryAt: atDay(12), createdAt: atDay(-1) } });
  const q0108 = await createQuoteFixture({ organizationId: primaryOrganizationId, number: 'Q-0108', customer: beta, owner: rep, team: enterpriseTeam, policy: silverPolicy, specs: [{ product: docking, quantity: 3, discount: 4 }, { product: setup, quantity: 1, discount: 6 }], stage: 'DRAFT', revisionState: 'DRAFT', revisionNumber: 2, version: 4, createdAt: atDay(-1), internalNote: 'Returned by Manager; revise service scope and discount.' });
  const q0108Old = await createHistoricalRevision({ fixture: q0108, revisionNumber: 1, state: 'SUPERSEDED', specs: [{ product: docking, quantity: 3, discount: 4 }, { product: setup, quantity: 1, discount: 16 }], createdAt: atDay(-5) });
  await createApprovalCase({ priced: q0108Old, state: 'RETURNED', manager, finance, managerState: 'RETURNED', financeState: 'SUPERSEDED', reason: 'Clarify implementation scope before accepting this discount.' });
  const q0109 = await createQuoteFixture({ organizationId: primaryOrganizationId, number: 'Q-0109', customer: northstarLabs, owner: rep, team: enterpriseTeam, policy: bronzePolicy, specs: [{ product: tablet, quantity: 6, discount: 12 }], stage: 'REJECTED', revisionState: 'SUBMITTED', createdAt: atDay(-6) });
  await createApprovalCase({ priced: q0109, state: 'REJECTED', manager, finance, managerState: 'REJECTED', financeState: 'SUPERSEDED', reason: 'The requested discount is outside the approved commercial envelope.' });
  const q0110 = await createQuoteFixture({ organizationId: primaryOrganizationId, number: 'Q-0110', customer: acme, owner: rep, team: enterpriseTeam, policy: goldPolicy, specs: [{ product: setup, quantity: 2, discount: 5 }], stage: 'APPROVED', revisionState: 'SENT', createdAt: atDay(-5), lastActivity: atDay(-1) });
  await createApprovalCase({ priced: q0110, state: 'APPROVED', manager, finance });
  await db.negotiation.create({ data: { quoteId: q0110.quote.id, revisionId: q0110.revision.id, kind: 'PROPOSAL', state: 'DECLINED', author: acmeCustomer.name, message: 'Please reduce the order by another 20%.', messageType: 'COUNTER_DISCOUNT', counterDiscount: 25, respondedById: rep.id, responseReason: 'The existing approved terms are our best offer.', respondedAt: atDay(-1, 12), createdAt: atDay(-2) } });
  const q0111 = await createQuoteFixture({ organizationId: primaryOrganizationId, number: 'Q-0111', customer: acme, owner: rep, team: enterpriseTeam, policy: goldPolicy, specs: [{ product: docking, quantity: 8, discount: 8 }, { product: care, quantity: 8, discount: 8 }], stage: 'DRAFT', revisionState: 'DRAFT', revisionNumber: 2, version: 5, createdAt: atDay(-1), internalNote: 'Customer counteroffer adopted; this revision must be resubmitted.' });
  const q0111Old = await createHistoricalRevision({ fixture: q0111, revisionNumber: 1, state: 'SUPERSEDED', specs: [{ product: docking, quantity: 8, discount: 2 }, { product: care, quantity: 8, discount: 2 }], sentAt: atDay(-4), createdAt: atDay(-6) });
  await createApprovalCase({ priced: q0111Old, state: 'APPROVED', manager, finance, reason: 'Original sent terms approved.' });
  await db.negotiation.create({ data: { quoteId: q0111.quote.id, revisionId: q0111Old.revision.id, kind: 'PROPOSAL', state: 'ADOPTED', author: acmeCustomer.name, message: 'Increase the discount to 8% and we will proceed.', messageType: 'COUNTER_DISCOUNT', counterDiscount: 8, respondedById: rep.id, responseReason: 'Adopted for a revised approval cycle.', respondedAt: atDay(-1), adoptedRevisionId: q0111.revision.id, createdAt: atDay(-2) } });

  const q0201 = await createConfirmedFixture({ organizationId: primaryOrganizationId, number: 'Q-0201', customer: beta, customerUser: betaCustomer, owner: rep, team: enterpriseTeam, policy: silverPolicy, priceList: silverPriceList, specs: [{ product: tablet, variant: tablet5g, quantity: 12, unitPrice: 55500 }], manager, finance, orderState: 'CONFIRMED', createdAt: atDay(-6), promisedDeliveryAt: atDay(-2) });
  const q0202 = await createConfirmedFixture({ organizationId: primaryOrganizationId, number: 'Q-0202', customer: acme, customerUser: acmeCustomer, owner: rep, team: enterpriseTeam, policy: goldPolicy, priceList: goldPriceList, specs: [{ product: laptop, variant: laptopPerformance, quantity: 14, unitPrice: 101500 }, { product: setup, quantity: 1, unitPrice: 23500 }, { product: care, quantity: 14, unitPrice: 1650 }], manager, finance, orderState: 'PARTIALLY_ALLOCATED', createdAt: atDay(-42), promisedDeliveryAt: atDay(5) });
  const q0203 = await createConfirmedFixture({ organizationId: primaryOrganizationId, number: 'Q-0203', customer: acme, customerUser: acmeCustomer, owner: rep, team: enterpriseTeam, policy: goldPolicy, priceList: goldPriceList, specs: [{ product: docking, variant: dockingThunderbolt, quantity: 12, unitPrice: 17250 }], manager, finance, orderState: 'ALLOCATED', createdAt: atDay(-20), promisedDeliveryAt: atDay(3) });
  const q0204 = await createConfirmedFixture({ organizationId: primaryOrganizationId, number: 'Q-0204', customer: beta, customerUser: betaCustomer, owner: rep, team: enterpriseTeam, policy: silverPolicy, specs: [{ product: compliance, quantity: 1 }, { product: setup, quantity: 1 }], manager, finance, orderState: 'CONFIRMED', createdAt: atDay(-8) });
  const q0205 = await createConfirmedFixture({ organizationId: primaryOrganizationId, number: 'Q-0205', customer: beta, customerUser: betaCustomer, owner: rep, team: enterpriseTeam, policy: silverPolicy, specs: [{ product: warranty, quantity: 1 }], manager, finance, orderState: 'CONFIRMED', createdAt: atDay(-15) });
  const q0206 = await createConfirmedFixture({ organizationId: primaryOrganizationId, number: 'Q-0206', customer: acme, customerUser: acmeCustomer, owner: rep, team: enterpriseTeam, policy: goldPolicy, specs: [{ product: setup, quantity: 2 }], manager, finance, orderState: 'CONFIRMED', createdAt: atDay(-10) });

  const partialFulfillment = await db.fulfillment.create({ data: { quoteId: q0202.quote.id, orderId: q0202.order.id, state: 'BACKORDER', split: json({ split: [
    { orderLineId: q0202.orderLines[0]!.id, productId: laptop.id, warehouseId: mainWarehouse.id, warehouseName: mainWarehouse.name, quantity: 7 },
    { orderLineId: q0202.orderLines[0]!.id, productId: laptop.id, warehouseId: eastDepot.id, warehouseName: eastDepot.name, quantity: 4 },
  ], backorders: [{ orderLineId: q0202.orderLines[0]!.id, productId: laptop.id, productName: laptop.name, quantity: 3 }] }), estimatedCost: Number(mainWarehouse.shippingCost) + Number(eastDepot.shippingCost), shipmentCount: 2, version: 2, overridden: true, reason: 'Keep the East Depot stock on the customer\'s preferred route.' } });
  await db.reservation.createMany({ data: [
    { fulfillmentId: partialFulfillment.id, orderId: q0202.order.id, orderLineId: q0202.orderLines[0]!.id, stockBalanceId: stock.get(`${mainWarehouse.id}:${laptop.id}`)!.id, quantity: 7, source: 'CONSOLIDATION' },
    { fulfillmentId: partialFulfillment.id, orderId: q0202.order.id, orderLineId: q0202.orderLines[0]!.id, stockBalanceId: stock.get(`${eastDepot.id}:${laptop.id}`)!.id, quantity: 4, source: 'MANUAL' },
  ] });
  await db.backorder.create({ data: { fulfillmentId: partialFulfillment.id, orderId: q0202.order.id, orderLineId: q0202.orderLines[0]!.id, productId: laptop.id, productName: laptop.name, originalQuantity: 5, remainingQuantity: 3, state: 'OPEN', createdAt: atDay(-11) } });
  await db.stockMovement.create({ data: { organizationId: primaryOrganizationId, stockBalanceId: stock.get(`${mainWarehouse.id}:${laptop.id}`)!.id, orderId: q0202.order.id, productId: laptop.id, kind: 'RECEIPT', quantityDelta: 2, reference: 'GRN-SEED-0202', reason: 'Two backordered laptops arrived and were automatically reserved.', actorId: finance.id, createdAt: atDay(-2) } });
  const fullFulfillment = await db.fulfillment.create({ data: { quoteId: q0203.quote.id, orderId: q0203.order.id, state: 'ALLOCATED', split: json({ split: [
    { orderLineId: q0203.orderLines[0]!.id, productId: docking.id, warehouseId: mainWarehouse.id, warehouseName: mainWarehouse.name, quantity: 7 },
    { orderLineId: q0203.orderLines[0]!.id, productId: docking.id, warehouseId: eastDepot.id, warehouseName: eastDepot.name, quantity: 5 },
  ], backorders: [] }), estimatedCost: Number(mainWarehouse.shippingCost) + Number(eastDepot.shippingCost), shipmentCount: 2, overridden: false } });
  await db.reservation.createMany({ data: [
    { fulfillmentId: fullFulfillment.id, orderId: q0203.order.id, orderLineId: q0203.orderLines[0]!.id, stockBalanceId: stock.get(`${mainWarehouse.id}:${docking.id}`)!.id, quantity: 7, source: 'SUGGESTED' },
    { fulfillmentId: fullFulfillment.id, orderId: q0203.order.id, orderLineId: q0203.orderLines[0]!.id, stockBalanceId: stock.get(`${eastDepot.id}:${docking.id}`)!.id, quantity: 5, source: 'SUGGESTED' },
  ] });

  const shippedAt = atDay(-7, 14);
  const shipment0203 = await db.$transaction(async (tx) => {
    const shipment = await tx.shipment.create({ data: {
      organizationId: primaryOrganizationId,
      orderId: q0203.order.id,
      number: 'SHP-0203-01',
      state: 'SHIPPED',
      carrier: 'Blue Dart',
      trackingNumber: 'BD-DEMO-0203-01',
      shippedAt,
      createdAt: shippedAt,
      lines: { create: [{ orderLineId: q0203.orderLines[0]!.id, quantity: 12, createdAt: shippedAt }] },
    } });
    const mainDocking = stock.get(`${mainWarehouse.id}:${docking.id}`)!;
    const eastDocking = stock.get(`${eastDepot.id}:${docking.id}`)!;
    await tx.stockBalance.update({ where: { id: mainDocking.id }, data: { onHand: { decrement: 7 }, reserved: { decrement: 7 } } });
    await tx.stockBalance.update({ where: { id: eastDocking.id }, data: { onHand: { decrement: 5 }, reserved: { decrement: 5 } } });
    await tx.stockMovement.createMany({ data: [
      { organizationId: primaryOrganizationId, stockBalanceId: mainDocking.id, orderId: q0203.order.id, productId: docking.id, kind: 'SHIPMENT', quantityDelta: -7, reference: shipment.number, reason: `Dispatched via ${shipment.carrier} (${shipment.trackingNumber}).`, actorId: finance.id, createdAt: shippedAt },
      { organizationId: primaryOrganizationId, stockBalanceId: eastDocking.id, orderId: q0203.order.id, productId: docking.id, kind: 'SHIPMENT', quantityDelta: -5, reference: shipment.number, reason: `Dispatched via ${shipment.carrier} (${shipment.trackingNumber}).`, actorId: finance.id, createdAt: shippedAt },
    ] });
    await tx.reservation.deleteMany({ where: { orderId: q0203.order.id } });
    await tx.fulfillment.update({ where: { id: fullFulfillment.id }, data: { state: 'FULFILLED', version: { increment: 1 } } });
    await tx.order.update({ where: { id: q0203.order.id }, data: { state: 'SHIPPED' } });
    return shipment;
  });

  const [subscription0202, subscription0204, subscription0205] = await Promise.all([
    createSubscription({ fixture: q0202, product: care, admin, scenario: 'ACTIVE_WITH_HISTORY' }),
    createSubscription({ fixture: q0204, product: compliance, admin, scenario: 'PAUSED' }),
    createSubscription({ fixture: q0205, product: warranty, admin, scenario: 'CANCELLED' }),
  ]);

  const invoice0202 = await createInvoice({ fixture: q0202, state: 'PARTIAL', dueAt: atDay(-2), finance, lineIndexes: [2], billingKey: `SUBSCRIPTION:${subscription0202.id}:${q0202.order.createdAt.toISOString()}`, customerUser: acmeCustomer, dueDateRequest: true });
  const invoice0203 = await createInvoice({ fixture: q0203, state: 'PAID', dueAt: atDay(23), finance, shipment: shipment0203, paymentProvider: 'RAZORPAY' });
  const invoice0204 = await createInvoice({ fixture: q0204, state: 'UNPAID', dueAt: atDay(6), finance, lineIndexes: [0], billingKey: `SUBSCRIPTION:${subscription0204.id}:${q0204.order.createdAt.toISOString()}` });
  const invoice0205 = await createInvoice({ fixture: q0205, state: 'PAID', dueAt: atDay(2), finance, lineIndexes: [0], billingKey: `SUBSCRIPTION:${subscription0205.id}:${q0205.order.createdAt.toISOString()}` });
  const invoice0206 = await createInvoice({ fixture: q0206, state: 'REVERSED', dueAt: atDay(-1), finance });

  const originalCareAmount = money(number(q0202.snapshots[2]!.net) + number(q0202.snapshots[2]!.tax));
  const periodStart0202 = q0202.order.createdAt;
  const periodEnd0202 = subscription0202.nextBillAt;
  const adjustmentAt = new Date(periodStart0202.getTime() + 14 * 86_400_000);
  const remainingShare = Math.max(0, periodEnd0202.getTime() - adjustmentAt.getTime()) / Math.max(1, periodEnd0202.getTime() - periodStart0202.getTime());
  const loyaltyCredit = money((originalCareAmount - number(subscription0202.amount)) * remainingShare);
  await Promise.all([
    db.billingPeriod.create({ data: { organizationId: primaryOrganizationId, subscriptionId: subscription0202.id, periodStart: periodStart0202, periodEnd: periodEnd0202, amount: originalCareAmount, proration: -loyaltyCredit, state: 'INVOICED', invoiceId: invoice0202.id, createdAt: periodStart0202 } }),
    db.billingPeriod.create({ data: { organizationId: primaryOrganizationId, subscriptionId: subscription0204.id, periodStart: q0204.order.createdAt, periodEnd: subscription0204.nextBillAt, amount: subscription0204.amount, state: 'INVOICED', invoiceId: invoice0204.id, createdAt: q0204.order.createdAt } }),
    db.billingPeriod.create({ data: { organizationId: primaryOrganizationId, subscriptionId: subscription0205.id, periodStart: q0205.order.createdAt, periodEnd: subscription0205.nextBillAt, amount: subscription0205.amount, state: 'INVOICED', invoiceId: invoice0205.id, createdAt: q0205.order.createdAt } }),
  ]);
  await db.creditNote.create({ data: { organizationId: primaryOrganizationId, invoiceId: invoice0202.id, number: 'CR-0202-LOYALTY', amount: loyaltyCredit, reason: 'Mid-cycle loyalty adjustment for unused Care Plan service.', createdAt: adjustmentAt } });
  await db.invoice.update({ where: { id: invoice0202.id }, data: { amount: { decrement: loyaltyCredit }, version: { increment: 1 } } });

  const razorpayPayment = await db.payment.findFirstOrThrow({ where: { invoiceId: invoice0203.id, provider: 'RAZORPAY', status: 'SUCCESS' } });
  const webhookPayload = { event: 'payment.captured', payload: { payment: { entity: { id: razorpayPayment.razorpayPaymentId, order_id: razorpayPayment.razorpayOrderId, amount: Math.round(number(razorpayPayment.amount) * 100), currency: razorpayPayment.currency, status: 'captured' } } } };
  const webhookRawBody = Buffer.from(JSON.stringify(webhookPayload));
  const webhookEventId = `seed-payment-captured-${razorpayPayment.razorpayPaymentId}`;
  await db.paymentWebhookEvent.create({ data: { organizationId: primaryOrganizationId, eventKey: paymentWebhookKey(webhookRawBody, webhookEventId), eventType: 'payment.captured', payloadHash: digest(webhookRawBody.toString('base64')), processedAt: atDay(-2, 12), createdAt: atDay(-2, 12) } });

  const convertedRequest = await db.portalRequest.create({ data: { organizationId: primaryOrganizationId, customerId: beta.id, submittedByUserId: betaCustomer.id, requirementsText: 'Please quote docking stations and onsite setup for our Pune expansion.', preferredDeliveryDate: atDay(20), status: 'NEW', createdAt: atDay(-6), lines: { create: [{ productId: docking.id, freeTextDescription: docking.name, quantity: 6 }, { productId: setup.id, freeTextDescription: setup.name, quantity: 1 }] } } });
  const q0301 = await createQuoteFixture({ organizationId: primaryOrganizationId, number: 'Q-0301', customer: beta, owner: rep, createdBy: rep, team: enterpriseTeam, policy: silverPolicy, priceList: silverPriceList, specs: [{ product: docking, quantity: 6, unitPrice: 13750 }, { product: setup, quantity: 1, unitPrice: 24500 }], stage: 'DRAFT', revisionState: 'DRAFT', createdAt: atDay(-5), internalNote: `Created from portal request ${convertedRequest.id}.` });
  const convertedLead = await db.lead.create({ data: { organizationId: primaryOrganizationId, customerId: beta.id, portalRequestId: convertedRequest.id, assignedRepId: rep.id, status: 'CONVERTED', requirementsSummary: convertedRequest.requirementsText, convertedQuotationId: q0301.quote.id, createdAt: atDay(-6) } });
  await db.portalRequest.update({ where: { id: convertedRequest.id }, data: { status: 'PROCESSED', resultingLeadId: convertedLead.id, resultingQuotationId: q0301.quote.id, processedAt: atDay(-5), processedById: rep.id } });
  const newRequest = await db.portalRequest.create({ data: { organizationId: primaryOrganizationId, customerId: acme.id, submittedByUserId: acmeCustomer.id, requirementsText: 'We need five field laptops plus a migration plan for a new project team.', preferredDeliveryDate: atDay(25), status: 'NEW', createdAt: atDay(-1), lines: { create: [{ productId: laptop.id, freeTextDescription: laptop.name, quantity: 5 }, { freeTextDescription: 'Data migration and onboarding plan', quantity: 1 }] } } });
  const newLead = await db.lead.create({ data: { organizationId: primaryOrganizationId, customerId: acme.id, portalRequestId: newRequest.id, assignedRepId: rep.id, status: 'NEW', requirementsSummary: newRequest.requirementsText, createdAt: atDay(-1) } });
  await db.portalRequest.update({ where: { id: newRequest.id }, data: { resultingLeadId: newLead.id } });
  const dismissedRequest = await db.portalRequest.create({ data: { organizationId: primaryOrganizationId, customerId: acme.id, submittedByUserId: acmeCustomer.id, requirementsText: 'Please source a discontinued third-party device that is outside your catalog.', status: 'NEW', createdAt: atDay(-8), lines: { create: [{ freeTextDescription: 'Discontinued third-party handheld model X', quantity: 20, degraded: true, degradedReason: 'No active organization catalog product matched the request.' }] } } });
  const dismissedLead = await db.lead.create({ data: { organizationId: primaryOrganizationId, customerId: acme.id, portalRequestId: dismissedRequest.id, assignedRepId: rep.id, status: 'DISMISSED', requirementsSummary: dismissedRequest.requirementsText, dismissReason: 'Requested item is unavailable and no approved substitute exists.', createdAt: atDay(-8) } });
  await db.portalRequest.update({ where: { id: dismissedRequest.id }, data: { status: 'DISMISSED', resultingLeadId: dismissedLead.id, processedAt: atDay(-7), processedById: rep.id } });
  const directRequest = await db.portalRequest.create({ data: { organizationId: northstarOrganizationId, customerId: orion.id, submittedByUserId: orionCustomer.id, requirementsText: 'Quote three edge gateways for the new regional stores.', preferredDeliveryDate: atDay(18), status: 'NEW', createdAt: atDay(-2), lines: { create: [{ productId: northstarGateway.id, freeTextDescription: northstarGateway.name, quantity: 3 }] } } });
  const nsQ0002 = await createQuoteFixture({ organizationId: northstarOrganizationId, number: 'NS-Q-0002', customer: orion, owner: northstarRep, team: northstarTeam, policy: enterprisePolicy, priceList: enterprisePriceList, specs: [{ product: northstarGateway, quantity: 3, unitPrice: 172000 }], stage: 'DRAFT', revisionState: 'DRAFT', createdAt: atDay(-2), internalNote: `Direct Draft from portal request ${directRequest.id}.` });
  await db.portalRequest.update({ where: { id: directRequest.id }, data: { status: 'PROCESSED', resultingQuotationId: nsQ0002.quote.id, processedAt: atDay(-2, 11), processedById: northstarRep.id } });
  const nsQ0001 = await createQuoteFixture({ organizationId: northstarOrganizationId, number: 'NS-Q-0001', customer: orion, owner: northstarRep, team: northstarTeam, policy: enterprisePolicy, priceList: enterprisePriceList, specs: [{ product: northstarGateway, variant: gatewayHa, quantity: 4, unitPrice: 218000, discount: 4 }], stage: 'PENDING_APPROVAL', revisionState: 'SUBMITTED', createdAt: atDay(-1) });
  await createApprovalCase({ priced: nsQ0001, state: 'PENDING', manager: northstarManager, finance, managerState: 'PENDING' });

  await db.recommendationAction.createMany({ data: [
    { quoteId: q0101.quote.id, productId: care.id, actorId: rep.id, action: 'DISMISSED', reason: 'Keep this first conversation focused on deployment hardware and setup.', createdAt: atDay(-9) },
    { quoteId: q0111.quote.id, productId: care.id, actorId: rep.id, action: 'ACCEPTED', reason: 'Customer accepted proactive device monitoring with the docking-station rollout.', createdAt: atDay(-2) },
  ] });

  await db.alert.createMany({ data: [
    { organizationId: primaryOrganizationId, kind: 'STALLED', title: 'Q-0101 has stalled', detail: 'No persisted deal activity for 10 days.', severity: 'medium', resourceId: q0101.quote.id, evaluationKey: `${primaryOrganizationId}:${q0101.quote.id}:STALLED`, lastEvaluatedAt: atDay(0), createdAt: atDay(0) },
    { organizationId: primaryOrganizationId, kind: 'DISCOUNT_ANOMALY', title: 'Q-0102 exceeds discount policy', detail: `The current immutable revision has a persisted discount-risk score of ${q0102.calculation.riskScore.toFixed(2)}.`, severity: 'high', resourceId: q0102.quote.id, evaluationKey: `${primaryOrganizationId}:${q0102.quote.id}:DISCOUNT_ANOMALY`, lastEvaluatedAt: atDay(0), createdAt: atDay(0) },
    { organizationId: primaryOrganizationId, kind: 'DELIVERY_SLIPPAGE', title: 'Q-0201 missed its promised delivery date', detail: 'The promised date has passed and stock allocation is still pending.', severity: 'high', resourceId: q0201.quote.id, evaluationKey: `${primaryOrganizationId}:${q0201.quote.id}:DELIVERY_SLIPPAGE`, lastEvaluatedAt: atDay(0), createdAt: atDay(0) },
    { organizationId: primaryOrganizationId, kind: 'DISCOUNT_ANOMALY', title: 'Rejected exception retained for audit', detail: 'Q-0109 was rejected after review.', severity: 'medium', resourceId: q0109.quote.id, resolved: true, resolvedAt: atDay(-4), createdAt: atDay(-6) },
    { organizationId: primaryOrganizationId, kind: 'PORTAL_REQUEST', title: 'New quote request from Acme Corp', detail: 'Review the customer requirements and qualify the Lead.', severity: 'medium', resourceId: newRequest.id, resourceType: 'PORTAL_REQUEST', recipientId: rep.id, createdAt: atDay(-1) },
  ] });

  await db.notification.createMany({ data: [
    { organizationId: primaryOrganizationId, recipientId: rep.id, title: 'Q-0101 needs attention', body: 'This draft has had no activity for ten days. Review requirements or close the opportunity.', resourceType: 'Quote', resourceId: q0101.quote.id, dedupeKey: 'seed:q0101:stalled:rep', createdAt: atDay(0, 8) },
    { organizationId: primaryOrganizationId, recipientId: manager.id, title: 'Approval required for Q-0102', body: 'The Gold customer quote exceeds the governed service-discount threshold.', resourceType: 'Quote', resourceId: q0102.quote.id, dedupeKey: 'seed:q0102:approval:manager', createdAt: atDay(0, 9) },
    { organizationId: primaryOrganizationId, recipientId: finance.id, title: 'INV-0202 is partially paid', body: 'A due-date request and a mid-cycle loyalty credit are ready for Finance review.', resourceType: 'Invoice', resourceId: invoice0202.id, dedupeKey: 'seed:inv0202:finance', createdAt: atDay(0, 9) },
    { organizationId: primaryOrganizationId, recipientId: admin.id, title: 'Gold contract pricing is active', body: 'The price list includes governed base and product-variant prices through the current demo period.', resourceType: 'Product', resourceId: laptop.id, state: 'READ', readAt: atDay(-1, 15), dedupeKey: 'seed:gold-price-list:admin', createdAt: atDay(-2, 15) },
    { organizationId: primaryOrganizationId, recipientId: rep.id, title: 'SHP-0203-01 delivered to billing', body: 'The Blue Dart shipment generated INV-0203 and its Razorpay payment was verified.', resourceType: 'Invoice', resourceId: invoice0203.id, dedupeKey: 'seed:shipment0203:rep', createdAt: atDay(-2, 13) },
  ] });

  await db.auditEvent.createMany({ data: [
    { organizationId: primaryOrganizationId, actorId: admin.id, action: 'DIRECTORY_JOIN_CUSTOMER_CREATED', resource: 'Customer', resourceId: lumen.id, reason: `Approved directory request ${approvedDirectoryRequest.id}`, requestId: 'seed-directory-lumen-approve', createdAt: atDay(-40) },
    { organizationId: primaryOrganizationId, actorId: admin.id, action: 'CUSTOMER_PORTAL_PASSWORD_CREATED', resource: 'Customer', resourceId: lumen.id, reason: lumenCustomer.email, requestId: 'seed-directory-lumen-approve', createdAt: atDay(-40) },
    { organizationId: primaryOrganizationId, actorId: admin.id, action: 'DIRECTORY_JOIN_REQUEST_APPROVED', resource: 'DirectoryJoinRequest', resourceId: approvedDirectoryRequest.id, reason: lumen.id, requestId: 'seed-directory-lumen-approve', createdAt: atDay(-40) },
    { organizationId: primaryOrganizationId, actorId: admin.id, action: 'DIRECTORY_JOIN_REQUEST_DECLINED', resource: 'DirectoryJoinRequest', resourceId: declinedDirectoryRequest.id, reason: declinedDirectoryRequest.decisionReason!, requestId: 'seed-directory-stonebridge-decline', createdAt: atDay(-3) },
    { organizationId: primaryOrganizationId, actorId: admin.id, action: 'CUSTOMER_RELATIONSHIP_UPDATED', resource: 'Customer', resourceId: acme.id, reason: 'Assigned Enterprise Sales and primary representative.', requestId: 'seed-customer-assignment', createdAt: atDay(-60) },
    { organizationId: primaryOrganizationId, actorId: rep.id, action: 'QUOTE_SUBMITTED', resource: 'Quote', resourceId: q0102.quote.id, revisionId: q0102.revision.id, reason: 'Customer scope and pricing are ready for governance review.', requestId: 'seed-q0102-submit', createdAt: atDay(-1) },
    { organizationId: primaryOrganizationId, actorId: manager.id, action: 'APPROVAL_APPROVED', resource: 'Quote', resourceId: q0104.quote.id, revisionId: q0104.revision.id, reason: 'Manager approved; Finance review remains.', requestId: 'seed-q0104-manager', createdAt: atDay(-1) },
    { organizationId: primaryOrganizationId, actorId: rep.id, action: 'QUOTE_SENT', resource: 'Quote', resourceId: q0106.quote.id, revisionId: q0106.revision.id, reason: 'Sent the approved revision to the customer portal.', requestId: 'seed-q0106-send', createdAt: atDay(-2) },
    { organizationId: primaryOrganizationId, actorId: acmeCustomer.id, action: 'CUSTOMER_PROPOSAL_CREATED', resource: 'Quote', resourceId: q0107.quote.id, revisionId: q0107.revision.id, reason: 'Customer proposed a 12% order discount.', requestId: 'seed-q0107-counter', createdAt: atDay(-1) },
    { organizationId: primaryOrganizationId, actorId: rep.id, action: 'CUSTOMER_PROPOSAL_ADOPTED', resource: 'Quote', resourceId: q0111.quote.id, revisionId: q0111.revision.id, reason: 'Created a new Draft and cleared the previous send boundary.', requestId: 'seed-q0111-adopt', createdAt: atDay(-1) },
    { organizationId: primaryOrganizationId, actorId: rep.id, action: 'RECOMMENDATION_DISMISSED', resource: 'Quote', resourceId: q0101.quote.id, revisionId: q0101.revision.id, reason: `${care.name}: Keep the first conversation focused on deployment.`, requestId: 'seed-q0101-recommendation', createdAt: atDay(-9) },
    { organizationId: primaryOrganizationId, actorId: rep.id, action: 'RECOMMENDATION_ACCEPTED', resource: 'Quote', resourceId: q0111.quote.id, revisionId: q0111.revision.id, reason: `${care.name}: Added proactive monitoring to the rollout.`, requestId: 'seed-q0111-recommendation', createdAt: atDay(-2) },
    { organizationId: primaryOrganizationId, actorId: acmeCustomer.id, action: 'QUOTATION_ACCEPTED', resource: 'Order', resourceId: q0202.order.id, revisionId: q0202.revision.id, reason: 'Accepted exact approved and sent revision.', requestId: 'seed-q0202-accept', createdAt: q0202.order.createdAt },
    { organizationId: primaryOrganizationId, actorId: finance.id, action: 'STOCK_ALLOCATION_OVERRIDDEN', resource: 'Order', resourceId: q0202.order.id, revisionId: q0202.revision.id, reason: 'Keep the East Depot stock on the customer preferred route.', requestId: 'seed-q0202-allocation', createdAt: atDay(-11) },
    { organizationId: primaryOrganizationId, actorId: finance.id, action: 'STOCK_RECEIVED', resource: 'Order', resourceId: q0202.order.id, revisionId: q0202.revision.id, reason: 'GRN-SEED-0202 added two units and consolidated the backorder.', requestId: 'seed-q0202-receipt', createdAt: atDay(-2) },
    { organizationId: primaryOrganizationId, actorId: acmeCustomer.id, action: 'CUSTOMER_REQUESTED_DUE_DATE_CHANGE', resource: 'Invoice', resourceId: invoice0202.id, reason: 'Requested alignment with procurement settlement run.', requestId: 'seed-inv0202-due-request', createdAt: atDay(-1) },
    { organizationId: primaryOrganizationId, actorId: rep.id, action: 'PORTAL_REQUEST_CONVERTED', resource: 'PortalRequest', resourceId: convertedRequest.id, revisionId: q0301.revision.id, reason: 'Qualified the request into a private quotation Draft.', requestId: 'seed-rfq-convert', createdAt: atDay(-5) },
    { organizationId: northstarOrganizationId, actorId: northstarRep.id, action: 'PORTAL_REQUEST_DIRECT_DRAFT_CREATED', resource: 'PortalRequest', resourceId: directRequest.id, revisionId: nsQ0002.revision.id, reason: 'Organization is configured for Direct Draft.', requestId: 'seed-rfq-direct', createdAt: atDay(-2) },
  ] });

  const totals = await validateSeed();
  console.log(`DealOS full-cycle seed complete: ${totals.quotes} quotations, ${totals.orders} orders, ${totals.invoices} invoices, and ${totals.portalRequests} portal requests.`);
  console.log('Directory seed: 2 discoverable profiles; Atlas pending, Lumen approved, and Stonebridge declined.');
  console.log(`Demo users share password: ${demoPassword}`);
  console.log(`Reusable Gamma Health invitation: http://localhost:5173/customer/invitations/${demoPortalInvitationToken}`);
  console.log(`Organizations: ${organizations.primary.name} (Lead-first) and ${organizations.northstar.name} (Direct Draft).`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
