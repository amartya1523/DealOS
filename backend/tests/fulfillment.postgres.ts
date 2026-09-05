import '../src/env.js';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { consolidateBackorder, FulfillmentError, previewSplit, receiveStock, reserveStock } from '../src/fulfillment.js';

const baseUrl = process.env.DATABASE_URL;
if (!baseUrl) throw new Error('DATABASE_URL is required for the PostgreSQL fulfillment test.');
const schema = `fulfillment_test_${crypto.randomBytes(8).toString('hex')}`;
if (!/^fulfillment_test_[a-f0-9]{16}$/.test(schema)) throw new Error('Unsafe disposable schema name.');
const testUrl = new URL(baseUrl);
testUrl.searchParams.set('schema', schema);
const control = new PrismaClient({ datasources: { db: { url: baseUrl } } });
let client: PrismaClient | undefined;

async function createOrder(db: PrismaClient, input: { organizationId: string; actorId: string; customerId: string; productId: string; quantity: number; suffix: string }) {
  const quote = await db.quote.create({ data: { organizationId: input.organizationId, number: `Q-PG-${input.suffix}`, customer: `Customer ${input.suffix}`, customerId: input.customerId, customerTier: 'Gold', ownerId: input.actorId, createdById: input.actorId, stage: 'CONFIRMED' } });
  const quoteLine = await db.quoteLine.create({ data: { quoteId: quote.id, productId: input.productId, quantity: input.quantity, unitPrice: 100, unitCost: 50, discount: 0, allowedDiscount: 10 } });
  const snapshot = { productId: input.productId, name: 'Concurrency hardware', sku: 'PG-HW', category: 'Hardware', quantity: input.quantity, unitPrice: '100', unitCost: '50', net: 100 * input.quantity, tax: 0, cadence: 'One-time' };
  const revision = await db.quoteRevision.create({ data: { quoteId: quote.id, revisionNumber: 1, state: 'SENT', currency: 'INR', orderDiscount: 0, subtotal: 100 * input.quantity, taxTotal: 0, total: 100 * input.quantity, margin: 50 * input.quantity, riskScore: 0, totalsByCadence: {}, linesSnapshot: [snapshot], policySnapshot: {}, termsHash: `terms-${input.suffix}`, sentAt: new Date() } });
  await db.quote.update({ where: { id: quote.id }, data: { currentRevisionId: revision.id, sentAt: new Date() } });
  const acceptance = await db.customerAcceptance.create({ data: { quoteId: quote.id, revisionId: revision.id, customerId: input.customerId, acceptedById: input.actorId, termsHash: `terms-${input.suffix}` } });
  return db.order.create({ data: { number: `SO-PG-${input.suffix}`, quoteId: quote.id, revisionId: revision.id, acceptanceId: acceptance.id, customerId: input.customerId, lines: { create: { quoteLineId: quoteLine.id, productId: input.productId, quantity: input.quantity, snapshot, recurring: false } } }, include: { lines: true } });
}

async function main() {
  await control.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  const prismaCli = fileURLToPath(new URL('../node_modules/prisma/build/index.js', import.meta.url));
  execFileSync(process.execPath, [prismaCli, 'db', 'push', '--skip-generate', '--schema', 'prisma/schema.prisma'], { cwd: process.cwd(), env: { ...process.env, DATABASE_URL: testUrl.toString() }, stdio: 'pipe' });
  client = new PrismaClient({ datasources: { db: { url: testUrl.toString() } } });
  const db = client;
  const organization = await db.organization.create({ data: { name: 'Fulfillment PostgreSQL Test', slug: schema } });
  const actor = await db.user.create({ data: { name: 'Operations Admin', email: `${schema}@example.invalid`, passwordHash: 'not-a-login', status: 'ACTIVE', role: 'ADMIN', organizationId: organization.id, moduleAccess: ['fulfillment'] } });
  const customer = await db.customer.create({ data: { organizationId: organization.id, name: 'Test buyer', tier: 'Gold' } });
  const product = await db.product.create({ data: { organizationId: organization.id, name: 'Concurrency hardware', sku: `PG-${schema}`, category: 'Hardware', description: 'Disposable integration test product', unit: 'unit', price: 100, cost: 50, taxRate: 0 } });
  const warehouse = await db.warehouse.create({ data: { organizationId: organization.id, name: 'Race warehouse', priority: 1, shippingCost: 25 } });
  await db.stockBalance.create({ data: { warehouseId: warehouse.id, productId: product.id, onHand: 5, reserved: 0 } });

  const firstOrder = await createOrder(db, { organizationId: organization.id, actorId: actor.id, customerId: customer.id, productId: product.id, quantity: 4, suffix: 'RACE-A' });
  const secondOrder = await createOrder(db, { organizationId: organization.id, actorId: actor.id, customerId: customer.id, productId: product.id, quantity: 4, suffix: 'RACE-B' });
  const firstPreview: any = await previewSplit(db, { organizationId: organization.id, orderId: firstOrder.id });
  const secondPreview: any = await previewSplit(db, { organizationId: organization.id, orderId: secondOrder.id });
  assert.equal(firstPreview.availability[0]?.available, 5, 'preview must expose onHand - reserved');
  const reservationInput = (orderId: string, preview: any, key: string) => ({ organizationId: organization.id, actorId: actor.id, orderId, idempotencyKey: key, mode: 'SUGGESTED' as const, stockFingerprint: preview.stockFingerprint, split: preview.split.split.map((row: any) => ({ orderLineId: row.orderLineId, warehouseId: row.warehouseId, quantity: row.quantity })) });
  const firstInput = reservationInput(firstOrder.id, firstPreview, 'pg-race-reservation-0001');
  const secondInput = reservationInput(secondOrder.id, secondPreview, 'pg-race-reservation-0002');
  const race = await Promise.allSettled([
    db.$transaction((tx) => reserveStock(tx, firstInput)),
    db.$transaction((tx) => reserveStock(tx, secondInput)),
  ]);
  if (race.every((result) => result.status === 'rejected')) console.error(race.map((result) => result.status === 'rejected' ? { name: result.reason?.name, code: result.reason?.code, message: result.reason?.message } : result));
  assert.equal(race.filter((result) => result.status === 'fulfilled').length, 1, 'exactly one competing reservation must succeed');
  const rejected = race.find((result): result is PromiseRejectedResult => result.status === 'rejected');
  assert(rejected?.reason instanceof FulfillmentError && rejected.reason.code === 'STOCK_CHANGED', 'loser must receive STOCK_CHANGED');
  const stockChangedDetails = rejected.reason.details as { availability?: Array<{ available: number }> };
  assert.equal(stockChangedDetails.availability?.[0]?.available, 1, 'STOCK_CHANGED must include fresh availability');
  assert.equal((await db.stockBalance.findUniqueOrThrow({ where: { warehouseId_productId: { warehouseId: warehouse.id, productId: product.id } } })).reserved, 4, 'race must never over-reserve');
  const winningInput = race[0]?.status === 'fulfilled' ? firstInput : secondInput;
  assert.equal((await db.order.findUniqueOrThrow({ where: { id: winningInput.orderId } })).state, 'FULFILLED', 'full reservation must set FULFILLED');
  const retry = await db.$transaction((tx) => reserveStock(tx, winningInput));
  assert.equal(retry.replayed, true, 'same-key retry must replay');
  assert.equal((await db.stockBalance.findUniqueOrThrow({ where: { warehouseId_productId: { warehouseId: warehouse.id, productId: product.id } } })).reserved, 4, 'retry must not double-reserve');

  const rollbackProduct = await db.product.create({ data: { organizationId: organization.id, name: 'Rollback hardware', sku: `ROLLBACK-${schema}`, category: 'Hardware', description: 'Rollback test', unit: 'unit', price: 10, cost: 5, taxRate: 0 } });
  const rollbackWarehouseA = await db.warehouse.create({ data: { organizationId: organization.id, name: 'Rollback A', priority: 1, shippingCost: 10 } });
  const rollbackWarehouseB = await db.warehouse.create({ data: { organizationId: organization.id, name: 'Rollback B', priority: 2, shippingCost: 20 } });
  await db.stockBalance.createMany({ data: [{ warehouseId: rollbackWarehouseA.id, productId: rollbackProduct.id, onHand: 3 }, { warehouseId: rollbackWarehouseB.id, productId: rollbackProduct.id, onHand: 3 }] });
  const rollbackOrder = await createOrder(db, { organizationId: organization.id, actorId: actor.id, customerId: customer.id, productId: rollbackProduct.id, quantity: 6, suffix: 'ROLLBACK' });
  const rollbackPreview: any = await previewSplit(db, { organizationId: organization.id, orderId: rollbackOrder.id });
  await db.$executeRawUnsafe(`CREATE FUNCTION "${schema}"."fail_second_reservation"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."stockBalanceId" = '${(await db.stockBalance.findUniqueOrThrow({ where: { warehouseId_productId: { warehouseId: rollbackWarehouseB.id, productId: rollbackProduct.id } } })).id}' THEN RAISE EXCEPTION 'forced reservation failure'; END IF; RETURN NEW; END $$`);
  await db.$executeRawUnsafe(`CREATE TRIGGER "force_reservation_failure" BEFORE INSERT ON "${schema}"."Reservation" FOR EACH ROW EXECUTE FUNCTION "${schema}"."fail_second_reservation"()`);
  await assert.rejects(db.$transaction((tx) => reserveStock(tx, reservationInput(rollbackOrder.id, rollbackPreview, 'pg-rollback-reservation'))));
  const rollbackBalances = await db.stockBalance.findMany({ where: { productId: rollbackProduct.id } });
  assert.deepEqual(rollbackBalances.map((balance) => balance.reserved).sort(), [0, 0], 'forced mid-transaction failure must roll back every balance');
  assert.equal(await db.fulfillment.count({ where: { orderId: rollbackOrder.id } }), 0, 'forced failure must not persist fulfillment');
  await db.$executeRawUnsafe(`DROP TRIGGER "force_reservation_failure" ON "${schema}"."Reservation"`);
  await db.$executeRawUnsafe(`DROP FUNCTION "${schema}"."fail_second_reservation"()`);
  const manualResult: any = await db.$transaction((tx) => reserveStock(tx, { organizationId: organization.id, actorId: actor.id, orderId: rollbackOrder.id, idempotencyKey: 'pg-manual-reservation', mode: 'MANUAL', split: rollbackPreview.split.split.map((row: any) => ({ orderLineId: row.orderLineId, warehouseId: row.warehouseId, quantity: row.quantity })), reason: 'Use both regional warehouses for this order.' }));
  assert.equal(manualResult.overridden, true, 'manual reservation must be marked as overridden');
  assert.equal((await db.auditEvent.findFirstOrThrow({ where: { resource: 'Order', resourceId: rollbackOrder.id, action: 'STOCK_ALLOCATION_OVERRIDDEN' } })).reason, 'Use both regional warehouses for this order.', 'manual reason must be retained in audit');

  const partialProduct = await db.product.create({ data: { organizationId: organization.id, name: 'Backorder hardware', sku: `BACKORDER-${schema}`, category: 'Hardware', description: 'Backorder test', unit: 'unit', price: 20, cost: 8, taxRate: 0 } });
  const partialWarehouse = await db.warehouse.create({ data: { organizationId: organization.id, name: 'Backorder warehouse', priority: 1, shippingCost: 15 } });
  await db.stockBalance.create({ data: { warehouseId: partialWarehouse.id, productId: partialProduct.id, onHand: 2 } });
  const partialOrder = await createOrder(db, { organizationId: organization.id, actorId: actor.id, customerId: customer.id, productId: partialProduct.id, quantity: 5, suffix: 'PARTIAL' });
  const partialPreview: any = await previewSplit(db, { organizationId: organization.id, orderId: partialOrder.id });
  await db.$transaction((tx) => reserveStock(tx, reservationInput(partialOrder.id, partialPreview, 'pg-partial-reservation')));
  assert.equal((await db.order.findUniqueOrThrow({ where: { id: partialOrder.id } })).state, 'PARTIALLY_FULFILLED');
  assert.equal((await db.backorder.findUniqueOrThrow({ where: { orderLineId: partialOrder.lines[0]!.id } })).remainingQuantity, 3);
  const receipt: any = await db.$transaction((tx) => receiveStock(tx, { organizationId: organization.id, actorId: actor.id, orderId: partialOrder.id, idempotencyKey: 'pg-receipt-consolidate', warehouseId: partialWarehouse.id, productId: partialProduct.id, quantity: 3, reference: 'GRN-1', reason: 'Cover the outstanding backorder.' }));
  assert.equal(receipt.consolidated, true);
  assert.equal((await db.order.findUniqueOrThrow({ where: { id: partialOrder.id } })).state, 'FULFILLED');
  assert.equal((await db.backorder.findUniqueOrThrow({ where: { orderLineId: partialOrder.lines[0]!.id } })).remainingQuantity, 0);
  assert.equal((await db.stockMovement.count({ where: { orderId: partialOrder.id, kind: 'RECEIPT' } })), 1, 'receipt must be a persisted movement');

  const concurrentOrder = await createOrder(db, { organizationId: organization.id, actorId: actor.id, customerId: customer.id, productId: partialProduct.id, quantity: 4, suffix: 'CONSOLIDATE-RACE' });
  const concurrentPreview: any = await previewSplit(db, { organizationId: organization.id, orderId: concurrentOrder.id });
  await db.$transaction((tx) => reserveStock(tx, reservationInput(concurrentOrder.id, concurrentPreview, 'pg-empty-partial-reservation')));
  const beforeConcurrent = (await db.stockBalance.findUniqueOrThrow({ where: { warehouseId_productId: { warehouseId: partialWarehouse.id, productId: partialProduct.id } } })).reserved;
  await Promise.allSettled([
    db.$transaction((tx) => receiveStock(tx, { organizationId: organization.id, actorId: actor.id, orderId: concurrentOrder.id, idempotencyKey: 'pg-concurrent-receipt', warehouseId: partialWarehouse.id, productId: partialProduct.id, quantity: 4, reference: 'GRN-2', reason: 'Concurrent consolidation test receipt.' })),
    db.$transaction((tx) => consolidateBackorder(tx, { organizationId: organization.id, actorId: actor.id, orderId: concurrentOrder.id, idempotencyKey: 'pg-concurrent-consolidate', reason: 'Concurrent consolidation test.' })),
  ]);
  const afterConcurrent = await db.stockBalance.findUniqueOrThrow({ where: { warehouseId_productId: { warehouseId: partialWarehouse.id, productId: partialProduct.id } } });
  assert.equal(afterConcurrent.reserved - beforeConcurrent, 4, 'receipt/consolidation race must reserve the backorder once');
  assert(afterConcurrent.reserved <= afterConcurrent.onHand, 'reserved must remain at or below on-hand');
  assert.equal((await db.order.findUniqueOrThrow({ where: { id: concurrentOrder.id } })).state, 'FULFILLED');

  process.env.DATABASE_URL = testUrl.toString();
  const sessionToken = crypto.randomBytes(32).toString('hex');
  await db.session.create({ data: { userId: actor.id, tokenHash: crypto.createHash('sha256').update(sessionToken).digest('hex'), expiresAt: new Date(Date.now() + 60_000) } });
  const csrf = crypto.createHash('sha256').update(`dealos-csrf:${sessionToken}`).digest('hex');
  const { app } = await import('../src/app.js');
  const { db: appDb } = await import('../src/db.js');
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Fulfillment API test server did not bind.');
    const base = `http://127.0.0.1:${address.port}/api/v1`;
    const headers = { Cookie: `dealos_session=${sessionToken}`, Origin: process.env.FRONTEND_ORIGIN ?? 'http://localhost:5173', 'X-CSRF-Token': csrf, 'Content-Type': 'application/json', 'Idempotency-Key': 'pg-api-route-check-0001' };
    const warehousesResponse = await fetch(`${base}/warehouses`, { headers });
    assert.equal(warehousesResponse.status, 200, 'canonical warehouse route must be live');
    const previewResponse = await fetch(`${base}/fulfillment/${rollbackOrder.id}/preview`, { headers });
    assert.equal(previewResponse.status, 200, 'canonical order preview route must be live');
    const invalidManual = await fetch(`${base}/fulfillment/${rollbackOrder.id}/reserve`, { method: 'POST', headers, body: JSON.stringify({ mode: 'MANUAL', split: [{ orderLineId: rollbackOrder.lines[0]!.id, warehouseId: rollbackWarehouseA.id, quantity: 1 }] }) });
    assert.equal(invalidManual.status, 422, 'manual override without reason must fail at the HTTP validation boundary');
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await appDb.$disconnect();
  }

  console.log(JSON.stringify({ passed: 20, schema, checks: ['live availability', 'concurrent reservation', 'fresh STOCK_CHANGED', 'retry idempotency', 'multi-warehouse rollback', 'manual reservation', 'manual audit reason', 'persisted backorder', 'receipt movement', 'automatic consolidation', 'concurrent consolidation', 'warehouse API', 'order preview API', 'manual reason API validation'] }));
}

try {
  await main();
} finally {
  if (client) await client.$disconnect();
  await control.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await control.$disconnect();
}
