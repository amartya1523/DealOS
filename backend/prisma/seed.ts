import bcrypt from 'bcryptjs';
import { PrismaClient, Role } from '@prisma/client';

const db = new PrismaClient();
const passwordHash = await bcrypt.hash('DealOS2026!', 12);

async function main() {
  await db.payment.deleteMany();
  await db.invoice.deleteMany();
  await db.fulfillment.deleteMany();
  await db.approval.deleteMany();
  await db.negotiation.deleteMany();
  await db.quoteLine.deleteMany();
  await db.quote.deleteMany();
  await db.stockBalance.deleteMany();
  await db.warehouse.deleteMany();
  await db.product.deleteMany();
  await db.discountPolicy.deleteMany();
  await db.subscription.deleteMany();
  await db.alert.deleteMany();
  await db.privilegedAudit.deleteMany();
  await db.auditEvent.deleteMany();
  await db.organizationInvitation.deleteMany();
  await db.platformOwnerSession.deleteMany();
  await db.session.deleteMany();
  await db.organizationMembership.deleteMany();
  await db.user.deleteMany();
  await db.organization.deleteMany();

  const [primaryOrganization, northstarOrganization] = await Promise.all([
    db.organization.create({ data: { name: 'Acme Revenue Operations', slug: 'acme-revenue' } }),
    db.organization.create({ data: { name: 'Northstar Distribution', slug: 'northstar-distribution' } }),
  ]);

  const users = await Promise.all([
    ['Aarav Mehta', 'rep@dealos.demo', Role.REP],
    ['Maya Shah', 'manager@dealos.demo', Role.MANAGER],
    ['Finn Rao', 'finance@dealos.demo', Role.FINANCE],
    ['Anika Bose', 'admin@dealos.demo', Role.ADMIN],
    ['Priya Nair', 'customer@dealos.demo', Role.CUSTOMER],
    ['Noah Kapoor', 'orgadmin@northstar.demo', Role.ADMIN],
    ['Ira Sen', 'rep@northstar.demo', Role.REP],
  ].map(([name, email, role]) => db.user.create({ data: { name: String(name), email: String(email), role: role as Role, customerId: role === Role.CUSTOMER ? 'Acme' : null, passwordHash, status: 'ACTIVE' } })));
  const rep = users[0]!;
  const organizationAdmin = users[3]!;
  const northstarAdmin = users[5]!;
  const northstarRep = users[6]!;

  await Promise.all([
    ...users.slice(0, 5).map((user) => db.organizationMembership.create({ data: { organizationId: primaryOrganization.id, userId: user.id, accessRole: user.role === Role.ADMIN ? 'ORGANIZATION_ADMIN' : user.role === Role.CUSTOMER ? 'PORTAL_USER' : 'ORGANIZATION_MEMBER', businessRole: user.role } })),
    db.organizationMembership.create({ data: { organizationId: northstarOrganization.id, userId: northstarAdmin.id, accessRole: 'ORGANIZATION_ADMIN', businessRole: Role.ADMIN } }),
    db.organizationMembership.create({ data: { organizationId: northstarOrganization.id, userId: northstarRep.id, accessRole: 'ORGANIZATION_MEMBER', businessRole: Role.REP } }),
  ]);
  await db.organizationInvitation.create({ data: { organizationId: northstarOrganization.id, email: 'analyst@northstar.demo', accessRole: 'ORGANIZATION_MEMBER', businessRole: Role.FINANCE, tokenHash: 'demo-invitation-token-hash-not-a-credential', invitedById: organizationAdmin.id, expiresAt: new Date('2026-12-31') } });

  const [laptop, setup, care] = await Promise.all([
    db.product.create({ data: { organizationId: primaryOrganization.id, name: 'Latitude Pro 14', sku: 'HW-LP14', category: 'Hardware', description: 'Business laptop, 16 GB RAM and three-year support.', unit: 'Unit', price: 1200, cost: 820, taxRate: 18 } }),
    db.product.create({ data: { organizationId: primaryOrganization.id, name: 'Onsite Setup Service', sku: 'SV-SETUP', category: 'Services', description: 'Deployment, migration and team onboarding.', unit: 'Engagement', price: 400, cost: 250, taxRate: 18 } }),
    db.product.create({ data: { organizationId: primaryOrganization.id, name: 'Care Plan', sku: 'SUB-CARE', category: 'Subscriptions', description: 'Priority help desk and device monitoring.', unit: 'Seat', price: 40, cost: 12, taxRate: 18, recurring: true, cadence: 'Monthly' } }),
  ]);

  const northstarProduct = await db.product.create({ data: { organizationId: northstarOrganization.id, name: 'Northstar Edge Gateway', sku: 'NS-HW-EDGE', category: 'Hardware', description: 'Secure distribution edge appliance.', unit: 'Unit', price: 1800, cost: 1120, taxRate: 18 } });

  await Promise.all([
    db.discountPolicy.create({ data: { organizationId: primaryOrganization.id, tier: 'Bronze', maxDiscount: 5, hardwareLimit: 5, servicesLimit: 5, subscriptionLimit: 3, financeThreshold: 5 } }),
    db.discountPolicy.create({ data: { organizationId: primaryOrganization.id, tier: 'Silver', maxDiscount: 10, hardwareLimit: 10, servicesLimit: 8, subscriptionLimit: 6, financeThreshold: 5 } }),
    db.discountPolicy.create({ data: { organizationId: primaryOrganization.id, tier: 'Gold', maxDiscount: 15, hardwareLimit: 15, servicesLimit: 10, subscriptionLimit: 10, financeThreshold: 5 } }),
    db.discountPolicy.create({ data: { organizationId: northstarOrganization.id, tier: 'Enterprise', maxDiscount: 12, hardwareLimit: 12, servicesLimit: 8, subscriptionLimit: 8, financeThreshold: 4 } }),
  ]);

  const [mainWarehouse, eastDepot] = await Promise.all([
    db.warehouse.create({ data: { organizationId: primaryOrganization.id, name: 'Main Warehouse', priority: 1, shippingCost: 45 } }),
    db.warehouse.create({ data: { organizationId: primaryOrganization.id, name: 'East Depot', priority: 2, shippingCost: 28 } }),
  ]);
  await Promise.all([
    db.stockBalance.create({ data: { warehouseId: mainWarehouse.id, productId: laptop.id, onHand: 4, reserved: 0 } }),
    db.stockBalance.create({ data: { warehouseId: eastDepot.id, productId: laptop.id, onHand: 8, reserved: 0 } }),
  ]);

  const calculation = { total: 3952, margin: 996, risk: 8 };
  const quote = await db.quote.create({
    data: {
      organizationId: primaryOrganization.id, number: 'Q-0102', customer: 'Acme Corp', customerTier: 'Gold', ownerId: rep.id,
      stage: 'PENDING_APPROVAL', total: calculation.total, margin: calculation.margin, riskScore: calculation.risk,
      orderDiscount: 0,
      lines: { create: [
        { productId: laptop.id, quantity: 2, unitPrice: 1200, unitCost: 820, discount: 12, allowedDiscount: 15 },
        { productId: setup.id, quantity: 1, unitPrice: 400, unitCost: 250, discount: 18, allowedDiscount: 10 },
        { productId: care.id, quantity: 30, unitPrice: 40, unitCost: 12, discount: 5, allowedDiscount: 10 },
      ] },
      approvals: { create: [
        { step: 'Sales Manager', sequence: 1 },
        { step: 'Finance', sequence: 2 },
      ] },
    }, include: { lines: true },
  });

  await db.quote.create({ data: { organizationId: primaryOrganization.id, number: 'Q-0103', customer: 'Beta Industries', customerTier: 'Silver', ownerId: rep.id, stage: 'DRAFT', total: 2400, margin: 760, riskScore: 0 } });
  await db.quote.create({ data: { organizationId: primaryOrganization.id, number: 'Q-0104', customer: 'Northstar Labs', customerTier: 'Bronze', ownerId: rep.id, stage: 'APPROVED', total: 1640, margin: 510, riskScore: 2 } });
  await db.quote.create({ data: { organizationId: northstarOrganization.id, number: 'NS-Q-0001', customer: 'Orion Retail', customerTier: 'Enterprise', ownerId: northstarRep.id, stage: 'PENDING_APPROVAL', total: 5400, margin: 2040, riskScore: 6, lines: { create: [{ productId: northstarProduct.id, quantity: 3, unitPrice: 1800, unitCost: 1120, discount: 0, allowedDiscount: 12 }] }, approvals: { create: [{ step: 'Sales Manager', sequence: 1 }] } } });

  await db.subscription.create({ data: { organizationId: primaryOrganization.id, customer: 'Acme Corp', productName: 'Care Plan', cadence: 'Monthly', amount: 1200, nextBillAt: new Date('2026-10-01') } });
  await db.subscription.create({ data: { organizationId: primaryOrganization.id, customer: 'Beta Industries', productName: 'Care Plan', cadence: 'Quarterly', amount: 960, nextBillAt: new Date('2026-11-01') } });
  await db.invoice.create({ data: { organizationId: primaryOrganization.id, number: 'INV-1042', quoteId: quote.id, customer: 'Acme Corp', amount: 2520, paidAmount: 0, dueAt: new Date('2026-09-20'), lines: [{ description: 'Latitude Pro 14 × 2', amount: 2112 }, { description: 'Onsite Setup Service', amount: 328 }, { description: 'Tax adjustment', amount: 80 }] } });
  await db.alert.createMany({ data: [
    { organizationId: primaryOrganization.id, kind: 'STALLED', title: 'Q-0098 has been inactive for 9 days', detail: 'Owner: Aarav Mehta · Customer: Delta LLC', severity: 'High', resourceId: 'Q-0098' },
    { organizationId: primaryOrganization.id, kind: 'DISCOUNT_ANOMALY', title: 'Discount is 2.4× the rep baseline', detail: 'Q-0102 · Setup service discount is 18%', severity: 'High', resourceId: quote.id },
    { organizationId: primaryOrganization.id, kind: 'DELIVERY_SLIPPAGE', title: 'Promised delivery is at risk', detail: 'Northstar Labs · two units remain unallocated', severity: 'Medium', resourceId: 'Q-0104' },
  ] });
}

main().finally(() => db.$disconnect());
