import bcrypt from 'bcryptjs';
import { PrismaClient, Role } from '@prisma/client';

const db = new PrismaClient();
const passwordHash = await bcrypt.hash('DealOS2026!', 12);
const organizationId = '00000000-0000-0000-0000-000000000001';
const allModules = ['dashboard','quotations','approvals','fulfillment','subscriptions','invoices','health','reports','products','policies'];

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
  await db.auditEvent.deleteMany();
  await db.session.deleteMany();
  await db.user.deleteMany();
  await db.organization.deleteMany({ where: { id: { not: organizationId } } });
  await db.organization.upsert({ where: { id: organizationId }, update: { name: 'DealOS Demo' }, create: { id: organizationId, name: 'DealOS Demo' } });

  const users = await Promise.all([
    ['Aarav Mehta', 'rep@dealos.demo', Role.REP],
    ['Maya Shah', 'manager@dealos.demo', Role.MANAGER],
    ['Finn Rao', 'finance@dealos.demo', Role.FINANCE],
    ['Anika Bose', 'admin@dealos.demo', Role.ADMIN],
    ['Priya Nair', 'customer@dealos.demo', Role.CUSTOMER],
  ].map(([name, email, role]) => db.user.create({ data: { organizationId, name: String(name), email: String(email), role: role as Role, moduleAccess: role === Role.CUSTOMER ? [] : allModules, customerId: role === Role.CUSTOMER ? 'Acme' : null, passwordHash, status: 'ACTIVE' } })));
  const rep = users[0]!;

  const [laptop, setup, care] = await Promise.all([
    db.product.create({ data: { organizationId, name: 'Latitude Pro 14', sku: 'HW-LP14', category: 'Hardware', description: 'Business laptop, 16 GB RAM and three-year support.', unit: 'Unit', price: 1200, cost: 820, taxRate: 18 } }),
    db.product.create({ data: { organizationId, name: 'Onsite Setup Service', sku: 'SV-SETUP', category: 'Services', description: 'Deployment, migration and team onboarding.', unit: 'Engagement', price: 400, cost: 250, taxRate: 18 } }),
    db.product.create({ data: { organizationId, name: 'Care Plan', sku: 'SUB-CARE', category: 'Subscriptions', description: 'Priority help desk and device monitoring.', unit: 'Seat', price: 40, cost: 12, taxRate: 18, recurring: true, cadence: 'Monthly' } }),
  ]);

  await Promise.all([
    db.discountPolicy.create({ data: { organizationId, tier: 'Bronze', maxDiscount: 5, hardwareLimit: 5, servicesLimit: 5, subscriptionLimit: 3, financeThreshold: 5 } }),
    db.discountPolicy.create({ data: { organizationId, tier: 'Silver', maxDiscount: 10, hardwareLimit: 10, servicesLimit: 8, subscriptionLimit: 6, financeThreshold: 5 } }),
    db.discountPolicy.create({ data: { organizationId, tier: 'Gold', maxDiscount: 15, hardwareLimit: 15, servicesLimit: 10, subscriptionLimit: 10, financeThreshold: 5 } }),
  ]);

  const [mainWarehouse, eastDepot] = await Promise.all([
    db.warehouse.create({ data: { organizationId, name: 'Main Warehouse', priority: 1, shippingCost: 45 } }),
    db.warehouse.create({ data: { organizationId, name: 'East Depot', priority: 2, shippingCost: 28 } }),
  ]);
  await Promise.all([
    db.stockBalance.create({ data: { warehouseId: mainWarehouse.id, productId: laptop.id, onHand: 4, reserved: 0 } }),
    db.stockBalance.create({ data: { warehouseId: eastDepot.id, productId: laptop.id, onHand: 8, reserved: 0 } }),
  ]);

  const calculation = { total: 3952, margin: 996, risk: 8 };
  const quote = await db.quote.create({
    data: {
      organizationId, number: 'Q-0102', customer: 'Acme Corp', customerTier: 'Gold', ownerId: rep.id,
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

  await db.quote.create({ data: { organizationId, number: 'Q-0103', customer: 'Beta Industries', customerTier: 'Silver', ownerId: rep.id, stage: 'DRAFT', total: 2400, margin: 760, riskScore: 0 } });
  await db.quote.create({ data: { organizationId, number: 'Q-0104', customer: 'Northstar Labs', customerTier: 'Bronze', ownerId: rep.id, stage: 'APPROVED', total: 1640, margin: 510, riskScore: 2 } });

  await db.subscription.create({ data: { organizationId, customer: 'Acme Corp', productName: 'Care Plan', cadence: 'Monthly', amount: 1200, nextBillAt: new Date('2026-10-01') } });
  await db.subscription.create({ data: { organizationId, customer: 'Beta Industries', productName: 'Care Plan', cadence: 'Quarterly', amount: 960, nextBillAt: new Date('2026-11-01') } });
  await db.invoice.create({ data: { organizationId, number: 'INV-1042', quoteId: quote.id, customer: 'Acme Corp', amount: 2520, paidAmount: 0, dueAt: new Date('2026-09-20'), lines: [{ description: 'Latitude Pro 14 × 2', amount: 2112 }, { description: 'Onsite Setup Service', amount: 328 }, { description: 'Tax adjustment', amount: 80 }] } });
  await db.alert.createMany({ data: [
    { organizationId, kind: 'STALLED', title: 'Q-0098 has been inactive for 9 days', detail: 'Owner: Aarav Mehta · Customer: Delta LLC', severity: 'High', resourceId: 'Q-0098' },
    { organizationId, kind: 'DISCOUNT_ANOMALY', title: 'Discount is 2.4× the rep baseline', detail: 'Q-0102 · Setup service discount is 18%', severity: 'High', resourceId: quote.id },
    { organizationId, kind: 'DELIVERY_SLIPPAGE', title: 'Promised delivery is at risk', detail: 'Northstar Labs · two units remain unallocated', severity: 'Medium', resourceId: 'Q-0104' },
  ] });
}

main().finally(() => db.$disconnect());
