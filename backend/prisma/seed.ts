import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { PrismaClient, Role } from '@prisma/client';
import { calculateQuote } from '../src/rules.js';

const db = new PrismaClient();
const passwordHash = await bcrypt.hash('DealOS2026!', 12);
const organizationId = '00000000-0000-0000-0000-000000000001';
const northstarOrganizationId = '00000000-0000-0000-0000-000000000002';
const allModules = ['dashboard','quotations','approvals','fulfillment','subscriptions','invoices','health','reports','products','customers','policies'];
const json = (value: unknown) => JSON.parse(JSON.stringify(value));
const hash = (value: unknown) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

async function main() {
  await db.idempotencyRecord.deleteMany();
  await db.payment.deleteMany();
  await db.invoice.deleteMany();
  await db.subscription.deleteMany();
  await db.fulfillment.deleteMany();
  await db.orderLine.deleteMany();
  await db.order.deleteMany();
  await db.customerAcceptance.deleteMany();
  await db.approval.deleteMany();
  await db.negotiation.deleteMany();
  await db.quote.updateMany({ data: { currentRevisionId: null } });
  await db.quoteRevision.deleteMany();
  await db.quoteLine.deleteMany();
  await db.quote.deleteMany();
  await db.salesTeamMember.deleteMany();
  await db.salesTeam.deleteMany();
  await db.stockBalance.deleteMany();
  await db.warehouse.deleteMany();
  await db.product.deleteMany();
  await db.discountPolicy.deleteMany();
  await db.alert.deleteMany();
  await db.privilegedAudit.deleteMany();
  await db.auditEvent.deleteMany();
  await db.organizationInvitation.deleteMany();
  await db.platformOwnerSession.deleteMany();
  await db.session.deleteMany();
  await db.organizationMembership.deleteMany();
  await db.user.deleteMany();
  await db.customer.deleteMany();
  await db.organization.deleteMany();
  const [primaryOrganization, northstarOrganization] = await Promise.all([
    db.organization.create({ data: { id: organizationId, name: 'DealOS Demo', slug: 'dealos-demo' } }),
    db.organization.create({ data: { id: northstarOrganizationId, name: 'Northstar Distribution', slug: 'northstar-distribution' } }),
  ]);

  const [acme, beta, northstar, orion] = await Promise.all([
    db.customer.create({ data: { organizationId, name: 'Acme Corp', tier: 'Gold', currency: 'INR' } }),
    db.customer.create({ data: { organizationId, name: 'Beta Industries', tier: 'Silver', currency: 'INR' } }),
    db.customer.create({ data: { organizationId, name: 'Northstar Labs', tier: 'Bronze', currency: 'INR' } }),
    db.customer.create({ data: { organizationId: northstarOrganizationId, name: 'Orion Retail', tier: 'Enterprise', currency: 'INR' } }),
  ]);
  const users = await Promise.all([
    ['Aarav Mehta', 'rep@dealos.demo', Role.REP],
    ['Maya Shah', 'manager@dealos.demo', Role.MANAGER],
    ['Finn Rao', 'finance@dealos.demo', Role.FINANCE],
    ['Anika Bose', 'admin@dealos.demo', Role.ADMIN],
    ['Priya Nair', 'customer@dealos.demo', Role.CUSTOMER],
    ['Noah Kapoor', 'orgadmin@northstar.demo', Role.ADMIN],
    ['Ira Sen', 'rep@northstar.demo', Role.REP],
  ].map(([name, email, role], index) => db.user.create({ data: { organizationId: index < 5 ? organizationId : northstarOrganizationId, name: String(name), email: String(email), role: role as Role, moduleAccess: role === Role.CUSTOMER ? [] : allModules, customerId: role === Role.CUSTOMER ? acme.id : null, passwordHash, status: 'ACTIVE' } })));
  const rep = users[0]!;
  const organizationAdmin = users[3]!;
  const northstarAdmin = users[5]!;
  const northstarRep = users[6]!;

  const [enterpriseTeam, northstarTeam] = await Promise.all([
    db.salesTeam.create({ data: { organizationId, name: 'Enterprise Sales', managerId: users[1]!.id } }),
    db.salesTeam.create({ data: { organizationId: northstarOrganizationId, name: 'Distribution Sales', managerId: northstarAdmin.id } }),
  ]);
  await db.salesTeamMember.createMany({ data: [
    { teamId: enterpriseTeam.id, userId: rep.id },
    { teamId: enterpriseTeam.id, userId: users[1]!.id },
    { teamId: northstarTeam.id, userId: northstarRep.id },
    { teamId: northstarTeam.id, userId: northstarAdmin.id },
  ] });

  await Promise.all([
    ...users.slice(0, 5).map((user) => db.organizationMembership.create({ data: { organizationId: primaryOrganization.id, userId: user.id, accessRole: user.role === Role.ADMIN ? 'ORGANIZATION_ADMIN' : user.role === Role.CUSTOMER ? 'PORTAL_USER' : 'ORGANIZATION_MEMBER', businessRole: user.role } })),
    db.organizationMembership.create({ data: { organizationId: northstarOrganization.id, userId: northstarAdmin.id, accessRole: 'ORGANIZATION_ADMIN', businessRole: Role.ADMIN } }),
    db.organizationMembership.create({ data: { organizationId: northstarOrganization.id, userId: northstarRep.id, accessRole: 'ORGANIZATION_MEMBER', businessRole: Role.REP } }),
  ]);
  await db.organizationInvitation.create({ data: { organizationId: northstarOrganization.id, email: 'analyst@northstar.demo', accessRole: 'ORGANIZATION_MEMBER', businessRole: Role.FINANCE, tokenHash: 'demo-invitation-token-hash-not-a-credential', invitedById: organizationAdmin.id, expiresAt: new Date('2026-12-31') } });

  const [laptop, setup, care] = await Promise.all([
    db.product.create({ data: { organizationId, name: 'Latitude Pro 14', sku: 'HW-LP14', category: 'Hardware', description: 'Business laptop, 16 GB RAM and three-year support.', unit: 'Unit', price: 1200, cost: 820, taxRate: 18 } }),
    db.product.create({ data: { organizationId, name: 'Onsite Setup Service', sku: 'SV-SETUP', category: 'Services', description: 'Deployment, migration and team onboarding.', unit: 'Engagement', price: 400, cost: 250, taxRate: 18 } }),
    db.product.create({ data: { organizationId, name: 'Care Plan', sku: 'SUB-CARE', category: 'Subscriptions', description: 'Priority help desk and device monitoring.', unit: 'Seat', price: 40, cost: 12, taxRate: 18, recurring: true, cadence: 'Monthly' } }),
  ]);
  const northstarProduct = await db.product.create({ data: { organizationId: northstarOrganization.id, name: 'Northstar Edge Gateway', sku: 'NS-HW-EDGE', category: 'Hardware', description: 'Secure distribution edge appliance.', unit: 'Unit', price: 1800, cost: 1120, taxRate: 18 } });
  await Promise.all([
    db.discountPolicy.create({ data: { organizationId, tier: 'Bronze', maxDiscount: 5, hardwareLimit: 5, servicesLimit: 5, subscriptionLimit: 3, financeThreshold: 5 } }),
    db.discountPolicy.create({ data: { organizationId, tier: 'Silver', maxDiscount: 10, hardwareLimit: 10, servicesLimit: 8, subscriptionLimit: 6, financeThreshold: 5 } }),
    db.discountPolicy.create({ data: { organizationId, tier: 'Gold', maxDiscount: 15, hardwareLimit: 15, servicesLimit: 10, subscriptionLimit: 10, financeThreshold: 5 } }),
    db.discountPolicy.create({ data: { organizationId: northstarOrganization.id, tier: 'Enterprise', maxDiscount: 12, hardwareLimit: 12, servicesLimit: 8, subscriptionLimit: 8, financeThreshold: 4 } }),
  ]);
  const [mainWarehouse, eastDepot] = await Promise.all([
    db.warehouse.create({ data: { organizationId, name: 'Main Warehouse', priority: 1, shippingCost: 45 } }),
    db.warehouse.create({ data: { organizationId, name: 'East Depot', priority: 2, shippingCost: 28 } }),
  ]);
  await Promise.all([
    db.stockBalance.create({ data: { warehouseId: mainWarehouse.id, productId: laptop.id, onHand: 4, reserved: 0 } }),
    db.stockBalance.create({ data: { warehouseId: eastDepot.id, productId: laptop.id, onHand: 8, reserved: 0 } }),
  ]);

  const q102Lines = [
    { product: laptop, quantity: 2, discount: 12, allowedDiscount: 15, cadence: 'One-time' },
    { product: setup, quantity: 1, discount: 18, allowedDiscount: 10, cadence: 'One-time' },
    { product: care, quantity: 30, discount: 5, allowedDiscount: 10, cadence: 'Monthly' },
  ];
  const q102Calc = calculateQuote(q102Lines.map((line) => ({ quantity: line.quantity, unitPrice: line.product.price, unitCost: line.product.cost, discount: line.discount, allowedDiscount: line.allowedDiscount, taxRate: line.product.taxRate, cadence: line.cadence })), 0);
  const q102 = await db.quote.create({ data: { organizationId, number: 'Q-0102', customer: acme.name, customerId: acme.id, customerTier: acme.tier, ownerId: rep.id, teamId: enterpriseTeam.id, stage: 'PENDING_APPROVAL', total: q102Calc.total, taxTotal: q102Calc.taxTotal, totalsByCadence: json(q102Calc.totalsByCadence), margin: q102Calc.margin, riskScore: q102Calc.riskScore, lines: { create: q102Lines.map((line) => ({ productId: line.product.id, quantity: line.quantity, unitPrice: line.product.price, unitCost: line.product.cost, discount: line.discount, allowedDiscount: line.allowedDiscount })) } } });
  const q102Revision = await db.quoteRevision.create({ data: { quoteId: q102.id, revisionNumber: 1, state: 'SUBMITTED', currency: 'INR', validUntil: new Date('2026-10-05'), terms: 'Net 30. Prices include the governed commercial discounts shown.', orderDiscount: 0, subtotal: q102Calc.subtotal, taxTotal: q102Calc.taxTotal, total: q102Calc.total, margin: q102Calc.margin, riskScore: q102Calc.riskScore, totalsByCadence: json(q102Calc.totalsByCadence), linesSnapshot: json(q102Lines.map((line, index) => ({ ...q102Calc.lines[index], productId: line.product.id, name: line.product.name, sku: line.product.sku, category: line.product.category }))), policySnapshot: { tier: 'Gold', financeThreshold: '5.00' }, termsHash: hash({ quote: q102.id, calculation: q102Calc }), submittedById: rep.id } });
  await db.quote.update({ where: { id: q102.id }, data: { currentRevisionId: q102Revision.id } });
  await db.approval.createMany({ data: [
    { quoteId: q102.id, revisionId: q102Revision.id, cycle: 1, step: 'Sales Manager', sequence: 1, state: 'PENDING' },
    { quoteId: q102.id, revisionId: q102Revision.id, cycle: 1, step: 'Finance', sequence: 2, state: 'WAITING' },
  ] });

  for (const [number, customer, stage] of [['Q-0103', beta, 'DRAFT'], ['Q-0104', northstar, 'DRAFT']] as const) {
    const quote = await db.quote.create({ data: { organizationId, number, customer: customer.name, customerId: customer.id, customerTier: customer.tier, ownerId: rep.id, teamId: enterpriseTeam.id, stage } });
    const revision = await db.quoteRevision.create({ data: { quoteId: quote.id, revisionNumber: 1, state: 'DRAFT', orderDiscount: 0, subtotal: 0, taxTotal: 0, total: 0, margin: 0, riskScore: 0, totalsByCadence: {}, linesSnapshot: [], policySnapshot: {}, termsHash: hash({ quote: quote.id, nonce: number }) } });
    await db.quote.update({ where: { id: quote.id }, data: { currentRevisionId: revision.id } });
  }

  const northstarQuote = await db.quote.create({ data: { organizationId: northstarOrganization.id, number: 'NS-Q-0001', customer: orion.name, customerId: orion.id, customerTier: orion.tier, ownerId: northstarRep.id, teamId: northstarTeam.id, stage: 'PENDING_APPROVAL', total: 5400, margin: 2040, riskScore: 6, lines: { create: [{ productId: northstarProduct.id, quantity: 3, unitPrice: 1800, unitCost: 1120, discount: 0, allowedDiscount: 12 }] } } });
  const northstarRevision = await db.quoteRevision.create({ data: { quoteId: northstarQuote.id, revisionNumber: 1, state: 'SUBMITTED', orderDiscount: 0, subtotal: 5400, taxTotal: 972, total: 6372, margin: 2040, riskScore: 6, totalsByCadence: { 'One-time': { subtotal: 5400, tax: 972, total: 6372 } }, linesSnapshot: [{ productId: northstarProduct.id, quantity: 3, unitPrice: 1800 }], policySnapshot: { tier: 'Enterprise' }, termsHash: hash({ quote: northstarQuote.id, revision: 1 }), submittedById: northstarRep.id } });
  await db.quote.update({ where: { id: northstarQuote.id }, data: { currentRevisionId: northstarRevision.id } });
  await db.approval.create({ data: { quoteId: northstarQuote.id, revisionId: northstarRevision.id, cycle: 1, step: 'Sales Manager', sequence: 1, state: 'PENDING' } });

  await db.subscription.createMany({ data: [
    { organizationId, customer: acme.name, customerId: acme.id, productName: 'Care Plan', cadence: 'Monthly', amount: 1200, nextBillAt: new Date('2026-10-01') },
    { organizationId, customer: beta.name, customerId: beta.id, productName: 'Care Plan', cadence: 'Quarterly', amount: 960, nextBillAt: new Date('2026-11-01') },
  ] });
  await db.invoice.create({ data: { organizationId, number: 'INV-1042', quoteId: q102.id, customer: acme.name, customerId: acme.id, amount: 2520, paidAmount: 0, dueAt: new Date('2026-09-20'), lines: [{ description: 'Latitude Pro 14 × 2', amount: 2112 }, { description: 'Onsite Setup Service', amount: 328 }, { description: 'Tax adjustment', amount: 80 }] } });

  await db.alert.createMany({ data: [
    { organizationId, kind: 'STALLED', title: 'Q-0098 has been inactive for 9 days', detail: 'Owner: Aarav Mehta · Customer: Delta LLC', severity: 'High', resourceId: 'Q-0098' },
    { organizationId, kind: 'DISCOUNT_ANOMALY', title: 'Discount is 2.4× the rep baseline', detail: 'Q-0102 · Setup service discount is 18%', severity: 'High', resourceId: q102.id },
    { organizationId, kind: 'DELIVERY_SLIPPAGE', title: 'Promised delivery is at risk', detail: 'Northstar Labs · two units remain unallocated', severity: 'Medium', resourceId: 'Q-0104' },
  ] });
}

main().finally(() => db.$disconnect());
