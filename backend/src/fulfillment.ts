import crypto from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { z } from 'zod';

type DbClient = Prisma.TransactionClient | PrismaClient;

export class FulfillmentError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly details?: unknown) {
    super(message);
  }
}

export const reserveStockSchema = z.object({
  mode: z.enum(['SUGGESTED', 'MANUAL']),
  stockFingerprint: z.string().length(64).optional(),
  split: z.array(z.object({
    orderLineId: z.string().uuid(),
    warehouseId: z.string().uuid(),
    quantity: z.number().int().positive().max(1_000_000),
  }).strict()).max(200),
  reason: z.string().trim().min(5).max(240).optional(),
}).strict().superRefine((value, ctx) => {
  if (value.mode === 'MANUAL' && !value.reason) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['reason'], message: 'A manual override reason is required.' });
  }
  if (value.mode === 'MANUAL' && value.split.length === 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['split'], message: 'A manual override must reserve at least one quantity.' });
  }
  if (value.mode === 'SUGGESTED' && !value.stockFingerprint) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['stockFingerprint'], message: 'Accept the current suggested split.' });
  }
  const keys = value.split.map((row) => `${row.orderLineId}:${row.warehouseId}`);
  if (new Set(keys).size !== keys.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['split'], message: 'Combine duplicate order-line and warehouse rows.' });
  }
});

export const receiveStockSchema = z.object({
  warehouseId: z.string().uuid(),
  productId: z.string().uuid(),
  quantity: z.number().int().positive().max(1_000_000),
  reference: z.string().trim().min(2).max(120).optional(),
  reason: z.string().trim().min(5).max(240),
}).strict();

export const consolidateSchema = z.object({
  reason: z.string().trim().min(5).max(240),
}).strict();

export type HardwareDemand = {
  orderLineId: string;
  productId: string;
  productName: string;
  quantity: number;
};

export type AvailableBalance = {
  id: string;
  productId: string;
  warehouseId: string;
  warehouseName: string;
  priority: number;
  shippingCost: number;
  onHand: number;
  reserved: number;
};

export type AllocationLine = HardwareDemand & {
  warehouseId: string;
  warehouseName: string;
  quantity: number;
};

const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const number = (value: unknown) => Number(value);
const snapshot = (value: unknown) => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const productName = (line: { snapshot: unknown; product?: { name: string } }) => String(snapshot(line.snapshot).name ?? line.product?.name ?? 'Hardware item');
const isHardware = (line: { recurring: boolean; snapshot: unknown }) => !line.recurring && String(snapshot(line.snapshot).category ?? '') === 'Hardware';

function hardwareDemand(lines: Array<{ id: string; productId: string; quantity: number; recurring: boolean; snapshot: unknown; product?: { name: string } }>) {
  return lines.filter(isHardware).map((line) => ({
    orderLineId: line.id,
    productId: line.productId,
    productName: productName(line),
    quantity: line.quantity,
  }));
}

export function availabilityFingerprint(balances: AvailableBalance[]) {
  return crypto.createHash('sha256').update(JSON.stringify(balances.map((balance) => ({
    id: balance.id,
    productId: balance.productId,
    warehouseId: balance.warehouseId,
    onHand: balance.onHand,
    reserved: balance.reserved,
    priority: balance.priority,
    shippingCost: balance.shippingCost,
  })).sort((left, right) => left.id.localeCompare(right.id)))).digest('hex');
}

export function suggestAllocation(demand: HardwareDemand[], balances: AvailableBalance[]) {
  const shadowReserved = new Map(balances.map((balance) => [balance.id, balance.reserved]));
  const usedWarehouses = new Set<string>();
  const split: AllocationLine[] = [];
  const backorders: HardwareDemand[] = [];

  for (const item of demand) {
    let remaining = item.quantity;
    const candidates = balances.filter((balance) => balance.productId === item.productId && balance.onHand - (shadowReserved.get(balance.id) ?? balance.reserved) > 0).sort((left, right) => {
      const leftUsed = usedWarehouses.has(left.warehouseId) ? 0 : 1;
      const rightUsed = usedWarehouses.has(right.warehouseId) ? 0 : 1;
      if (leftUsed !== rightUsed) return leftUsed - rightUsed;
      const leftAvailable = left.onHand - (shadowReserved.get(left.id) ?? left.reserved);
      const rightAvailable = right.onHand - (shadowReserved.get(right.id) ?? right.reserved);
      const leftCovers = leftAvailable >= remaining ? 0 : 1;
      const rightCovers = rightAvailable >= remaining ? 0 : 1;
      if (leftCovers !== rightCovers) return leftCovers - rightCovers;
      if (leftCovers === 0) return left.shippingCost - right.shippingCost || left.priority - right.priority || left.warehouseId.localeCompare(right.warehouseId);
      return rightAvailable - leftAvailable || left.shippingCost - right.shippingCost || left.priority - right.priority || left.warehouseId.localeCompare(right.warehouseId);
    });
    for (const balance of candidates) {
      if (remaining === 0) break;
      const available = balance.onHand - (shadowReserved.get(balance.id) ?? balance.reserved);
      const quantity = Math.min(remaining, available);
      if (quantity <= 0) continue;
      split.push({ ...item, warehouseId: balance.warehouseId, warehouseName: balance.warehouseName, quantity });
      shadowReserved.set(balance.id, (shadowReserved.get(balance.id) ?? balance.reserved) + quantity);
      usedWarehouses.add(balance.warehouseId);
      remaining -= quantity;
    }
    if (remaining > 0) backorders.push({ ...item, quantity: remaining });
  }
  return { split, backorders };
}

function metrics(split: Array<{ warehouseId: string }>, balances: AvailableBalance[]) {
  const warehouses = [...new Set(split.map((row) => row.warehouseId))];
  return {
    shipmentCount: warehouses.length,
    estimatedCost: warehouses.reduce((sum, warehouseId) => sum + (balances.find((balance) => balance.warehouseId === warehouseId)?.shippingCost ?? 0), 0),
  };
}

function availabilityDto(balances: AvailableBalance[]) {
  return balances.map((balance) => ({
    stockBalanceId: balance.id,
    productId: balance.productId,
    warehouseId: balance.warehouseId,
    warehouseName: balance.warehouseName,
    onHand: balance.onHand,
    reserved: balance.reserved,
    available: balance.onHand - balance.reserved,
    priority: balance.priority,
    shippingCost: balance.shippingCost,
  }));
}

async function loadBalances(client: DbClient, organizationId: string, productIds: string[], lock = false) {
  const ids = await client.stockBalance.findMany({
    where: { productId: { in: productIds }, warehouse: { organizationId, active: true } },
    select: { id: true },
    orderBy: { id: 'asc' },
  });
  if (lock && ids.length) {
    await client.$queryRaw`SELECT "id" FROM "StockBalance" WHERE "id" IN (${Prisma.join(ids.map((item) => item.id))}) ORDER BY "id" FOR UPDATE`;
  }
  const records = await client.stockBalance.findMany({
    where: { id: { in: ids.map((item) => item.id) } },
    include: { warehouse: true },
    orderBy: { id: 'asc' },
  });
  return records.map((balance) => ({
    id: balance.id,
    productId: balance.productId,
    warehouseId: balance.warehouseId,
    warehouseName: balance.warehouse.name,
    priority: balance.warehouse.priority,
    shippingCost: number(balance.warehouse.shippingCost),
    onHand: balance.onHand,
    reserved: balance.reserved,
  }));
}

function canonicalSplit(split: Array<{ orderLineId: string; warehouseId: string; quantity: number }>) {
  return split.map((row) => ({ orderLineId: row.orderLineId, warehouseId: row.warehouseId, quantity: row.quantity })).sort((left, right) => `${left.orderLineId}:${left.warehouseId}`.localeCompare(`${right.orderLineId}:${right.warehouseId}`));
}

function sameSplit(left: Array<{ orderLineId: string; warehouseId: string; quantity: number }>, right: Array<{ orderLineId: string; warehouseId: string; quantity: number }>) {
  return JSON.stringify(canonicalSplit(left)) === JSON.stringify(canonicalSplit(right));
}

function validateManualSplit(demand: HardwareDemand[], requested: Array<{ orderLineId: string; warehouseId: string; quantity: number }>, balances: AvailableBalance[]) {
  const lineMap = new Map(demand.map((item) => [item.orderLineId, item]));
  const balanceMap = new Map(balances.map((balance) => [`${balance.productId}:${balance.warehouseId}`, balance]));
  const allocatedByLine = new Map<string, number>();
  const allocatedByBalance = new Map<string, number>();
  const split: AllocationLine[] = [];
  for (const row of requested) {
    const item = lineMap.get(row.orderLineId);
    if (!item) throw new FulfillmentError(422, 'INVALID_ALLOCATION', 'The manual split contains an order line that is not tracked hardware.');
    const balance = balanceMap.get(`${item.productId}:${row.warehouseId}`);
    if (!balance) throw new FulfillmentError(422, 'INVALID_ALLOCATION', 'One or more selected warehouse balances do not exist.');
    const lineTotal = (allocatedByLine.get(item.orderLineId) ?? 0) + row.quantity;
    if (lineTotal > item.quantity) throw new FulfillmentError(422, 'INVALID_ALLOCATION', 'The manual split exceeds the ordered quantity.');
    const balanceTotal = (allocatedByBalance.get(balance.id) ?? 0) + row.quantity;
    if (balanceTotal > balance.onHand - balance.reserved) {
      throw new FulfillmentError(409, 'STOCK_CHANGED', 'Warehouse stock changed. Refresh the fulfillment preview.', { availability: availabilityDto(balances) });
    }
    allocatedByLine.set(item.orderLineId, lineTotal);
    allocatedByBalance.set(balance.id, balanceTotal);
    split.push({ ...item, warehouseId: balance.warehouseId, warehouseName: balance.warehouseName, quantity: row.quantity });
  }
  return {
    split,
    backorders: demand.map((item) => ({ ...item, quantity: item.quantity - (allocatedByLine.get(item.orderLineId) ?? 0) })).filter((item) => item.quantity > 0),
  };
}

function replayBody(value: Prisma.JsonValue) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new FulfillmentError(409, 'IDEMPOTENCY_CONFLICT', 'The stored fulfillment response is invalid.');
  return value as Record<string, unknown>;
}

function requestHash(value: unknown) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

async function fulfillmentView(client: DbClient, orderId: string) {
  const order = await client.order.findUnique({
    where: { id: orderId },
    include: {
      lines: { include: { product: { select: { name: true } }, shipmentLines: { include: { shipment: true } } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
      fulfillment: {
        include: {
          reservations: { include: { orderLine: true, stockBalance: { include: { warehouse: true } } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
          backorders: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
        },
      },
    },
  });
  if (!order?.fulfillment) throw new FulfillmentError(409, 'SPLIT_PENDING', 'Generate and accept a warehouse split first.');
  const demand = hardwareDemand(order.lines);
  const openBackorders = order.fulfillment.backorders.filter((item) => item.state === 'OPEN' && item.remainingQuantity > 0);
  const productIds = [...new Set(openBackorders.map((item) => item.productId))];
  const balances = productIds.length ? await loadBalances(client, order.quoteId ? (await client.quote.findUniqueOrThrow({ where: { id: order.quoteId }, select: { organizationId: true } })).organizationId : '', productIds) : [];
  const split = order.fulfillment.reservations.map((reservation) => ({
    reservationId: reservation.id,
    orderLineId: reservation.orderLineId,
    productId: reservation.orderLine.productId,
    warehouseId: reservation.stockBalance.warehouseId,
    warehouseName: reservation.stockBalance.warehouse.name,
    quantity: reservation.quantity,
  }));
  const backorders = openBackorders.map((item) => ({
    backorderId: item.id,
    orderLineId: item.orderLineId,
    productId: item.productId,
    productName: item.productName,
    quantity: item.remainingQuantity,
  }));
  const reservedByLine = new Map<string, number>();
  for (const reservation of order.fulfillment.reservations) reservedByLine.set(reservation.orderLineId, (reservedByLine.get(reservation.orderLineId) ?? 0) + reservation.quantity);
  const shippedByLine = new Map(order.lines.map((line) => [line.id, line.shipmentLines.filter((item) => item.shipment.state === 'SHIPPED').reduce((sum, item) => sum + item.quantity, 0)]));
  return {
    id: order.fulfillment.id,
    orderId: order.id,
    orderNumber: order.number,
    orderState: order.state,
    state: order.fulfillment.state,
    version: order.fulfillment.version,
    overridden: order.fulfillment.overridden,
    reason: order.fulfillment.reason,
    split: { split, backorders },
    items: demand.map((item) => ({
      orderLineId: item.orderLineId,
      productId: item.productId,
      productName: item.productName,
      orderedQuantity: item.quantity,
      reservedQuantity: reservedByLine.get(item.orderLineId) ?? 0,
      fulfilledQuantity: shippedByLine.get(item.orderLineId) ?? 0,
      shippedQuantity: shippedByLine.get(item.orderLineId) ?? 0,
      backorderedQuantity: backorders.find((backorder) => backorder.orderLineId === item.orderLineId)?.quantity ?? 0,
    })),
    estimatedCost: order.fulfillment.estimatedCost.toString(),
    shipmentCount: order.fulfillment.shipmentCount,
    consolidationAvailable: backorders.some((backorder) => balances.some((balance) => balance.productId === backorder.productId && balance.onHand - balance.reserved > 0)),
    physicalDispatchImplemented: true,
    statusMeaning: 'ALLOCATED means stock is reserved; SHIPPED means stock left the warehouse and its invoice was issued.',
    updatedAt: order.fulfillment.updatedAt,
  };
}

export async function previewSplit(client: DbClient, input: { organizationId: string; orderId: string; quoteScope?: Prisma.QuoteWhereInput }) {
  const order = await client.order.findFirst({
    where: { id: input.orderId, quote: { is: { organizationId: input.organizationId, ...(input.quoteScope ?? {}) } } },
    include: { lines: { include: { product: { select: { name: true } } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }, fulfillment: true },
  });
  if (!order) throw new FulfillmentError(404, 'NOT_FOUND', 'Confirmed order not found.');
  if (order.fulfillment) return fulfillmentView(client, order.id);
  if (order.state !== 'CONFIRMED') throw new FulfillmentError(409, 'INVALID_STATE', 'Only an unallocated confirmed order can be previewed.');
  const demand = hardwareDemand(order.lines);
  if (!demand.length) throw new FulfillmentError(422, 'NO_HARDWARE_DEMAND', 'This order has no hardware lines to reserve.');
  const balances = await loadBalances(client, input.organizationId, [...new Set(demand.map((item) => item.productId))]);
  const allocation = suggestAllocation(demand, balances);
  const allocationMetrics = metrics(allocation.split, balances);
  return {
    orderId: order.id,
    orderNumber: order.number,
    orderState: order.state,
    state: allocation.backorders.length ? 'BACKORDER' : 'SPLIT_PENDING',
    version: 0,
    split: { split: allocation.split, backorders: allocation.backorders },
    items: demand.map((item) => ({
      orderLineId: item.orderLineId,
      productId: item.productId,
      productName: item.productName,
      orderedQuantity: item.quantity,
      reservedQuantity: allocation.split.filter((row) => row.orderLineId === item.orderLineId).reduce((sum, row) => sum + row.quantity, 0),
      fulfilledQuantity: allocation.split.filter((row) => row.orderLineId === item.orderLineId).reduce((sum, row) => sum + row.quantity, 0),
      backorderedQuantity: allocation.backorders.find((row) => row.orderLineId === item.orderLineId)?.quantity ?? 0,
    })),
    availability: availabilityDto(balances),
    estimatedCost: allocationMetrics.estimatedCost.toFixed(2),
    shipmentCount: allocationMetrics.shipmentCount,
    stockFingerprint: availabilityFingerprint(balances),
    preview: true,
    physicalDispatchImplemented: true,
    statusMeaning: 'ALLOCATED means all hardware is reserved. Shipping is a separate audited transition.',
  };
}

type ReserveInput = z.infer<typeof reserveStockSchema> & {
  organizationId: string;
  actorId: string;
  orderId: string;
  idempotencyKey: string;
  requestId?: string;
};

export async function reserveStock(tx: Prisma.TransactionClient, input: ReserveInput) {
  const operation = 'FULFILLMENT_RESERVE';
  const payload = { mode: input.mode, stockFingerprint: input.stockFingerprint ?? null, split: canonicalSplit(input.split), reason: input.reason ?? null };
  const fingerprint = requestHash(payload);
  const key = { actorId_operation_resourceKey_key: { actorId: input.actorId, operation, resourceKey: input.orderId, key: input.idempotencyKey } };
  const replay = await tx.idempotencyRecord.findUnique({ where: key });
  if (replay) {
    if (replay.payloadHash !== fingerprint) throw new FulfillmentError(409, 'IDEMPOTENCY_CONFLICT', 'This idempotency key was already used with a different allocation.');
    return { ...replayBody(replay.responseBody), replayed: true };
  }

  await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${input.orderId} FOR UPDATE`;
  const lockedReplay = await tx.idempotencyRecord.findUnique({ where: key });
  if (lockedReplay) {
    if (lockedReplay.payloadHash !== fingerprint) throw new FulfillmentError(409, 'IDEMPOTENCY_CONFLICT', 'This idempotency key was already used with a different allocation.');
    return { ...replayBody(lockedReplay.responseBody), replayed: true };
  }
  const order = await tx.order.findFirst({
    where: { id: input.orderId, quote: { is: { organizationId: input.organizationId } } },
    include: { quote: { select: { id: true } }, lines: { include: { product: { select: { name: true } } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }, fulfillment: true },
  });
  if (!order) throw new FulfillmentError(404, 'NOT_FOUND', 'Confirmed order not found.');
  if (order.fulfillment) {
    const body = await fulfillmentView(tx, order.id);
    await tx.idempotencyRecord.create({ data: { actorId: input.actorId, operation, resourceKey: order.id, key: input.idempotencyKey, payloadHash: fingerprint, responseStatus: 200, responseBody: json(body) } });
    return { ...body, replayed: true };
  }
  if (order.state !== 'CONFIRMED') throw new FulfillmentError(409, 'INVALID_STATE', 'Only an unallocated confirmed order can reserve stock.');
  const demand = hardwareDemand(order.lines);
  if (!demand.length) throw new FulfillmentError(422, 'NO_HARDWARE_DEMAND', 'This order has no hardware lines to reserve.');
  const balances = await loadBalances(tx, input.organizationId, [...new Set(demand.map((item) => item.productId))], true);
  if (input.stockFingerprint && input.stockFingerprint !== availabilityFingerprint(balances)) {
    throw new FulfillmentError(409, 'STOCK_CHANGED', 'Warehouse stock changed after this preview. Refresh before reserving.', { availability: availabilityDto(balances) });
  }
  const suggested = suggestAllocation(demand, balances);
  let allocation;
  if (input.mode === 'SUGGESTED') {
    if (!sameSplit(input.split, suggested.split)) throw new FulfillmentError(422, 'INVALID_ALLOCATION', 'The submitted suggested split differs from the current server recommendation. Use Manual with a reason to override it.');
    allocation = suggested;
  } else {
    allocation = validateManualSplit(demand, input.split, balances);
  }

  for (const row of allocation.split) {
    const balance = balances.find((item) => item.productId === row.productId && item.warehouseId === row.warehouseId)!;
    const changed = await tx.stockBalance.updateMany({
      where: { id: balance.id, reserved: { lte: balance.onHand - row.quantity } },
      data: { reserved: { increment: row.quantity } },
    });
    if (changed.count !== 1) throw new FulfillmentError(409, 'STOCK_CHANGED', 'Warehouse stock changed while reserving. No reservation was committed.', { availability: availabilityDto(await loadBalances(tx, input.organizationId, [...new Set(demand.map((item) => item.productId))])) });
    balance.reserved += row.quantity;
  }
  const allocationMetrics = metrics(allocation.split, balances);
  const fulfilled = allocation.backorders.length === 0;
  const fulfillment = await tx.fulfillment.create({
    data: {
      quoteId: order.quote.id,
      orderId: order.id,
      state: fulfilled ? 'ALLOCATED' : 'BACKORDER',
      split: json({ split: allocation.split, backorders: allocation.backorders }),
      estimatedCost: allocationMetrics.estimatedCost,
      shipmentCount: allocationMetrics.shipmentCount,
      overridden: input.mode === 'MANUAL',
      reason: input.mode === 'MANUAL' ? input.reason : null,
    },
  });
  if (allocation.split.length) {
    await tx.reservation.createMany({ data: allocation.split.map((row) => ({
      fulfillmentId: fulfillment.id,
      orderId: order.id,
      orderLineId: row.orderLineId,
      stockBalanceId: balances.find((balance) => balance.productId === row.productId && balance.warehouseId === row.warehouseId)!.id,
      quantity: row.quantity,
      source: input.mode,
    })) });
  }
  if (allocation.backorders.length) {
    await tx.backorder.createMany({ data: allocation.backorders.map((item) => ({
      fulfillmentId: fulfillment.id,
      orderId: order.id,
      orderLineId: item.orderLineId,
      productId: item.productId,
      productName: item.productName,
      originalQuantity: item.quantity,
      remainingQuantity: item.quantity,
      state: 'OPEN',
    })) });
  }
  await tx.order.update({ where: { id: order.id }, data: { state: fulfilled ? 'ALLOCATED' : 'PARTIALLY_ALLOCATED' } });
  await tx.auditEvent.create({ data: { organizationId: input.organizationId, actorId: input.actorId, action: input.mode === 'MANUAL' ? 'STOCK_ALLOCATION_OVERRIDDEN' : 'STOCK_RESERVED', resource: 'Order', resourceId: order.id, revisionId: order.revisionId, reason: input.mode === 'MANUAL' ? input.reason : 'Suggested allocation accepted.', requestId: input.requestId } });
  const body = await fulfillmentView(tx, order.id);
  await tx.idempotencyRecord.create({ data: { actorId: input.actorId, operation, resourceKey: order.id, key: input.idempotencyKey, payloadHash: fingerprint, responseStatus: 201, responseBody: json(body) } });
  return { ...body, replayed: false };
}

async function refreshFulfillment(tx: Prisma.TransactionClient, orderId: string) {
  const fulfillment = await tx.fulfillment.findUniqueOrThrow({ where: { orderId }, include: {
    reservations: { include: { orderLine: true, stockBalance: { include: { warehouse: true } } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
    backorders: { where: { state: 'OPEN' }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
  } });
  const split = fulfillment.reservations.map((reservation) => ({ orderLineId: reservation.orderLineId, productId: reservation.orderLine.productId, warehouseId: reservation.stockBalance.warehouseId, warehouseName: reservation.stockBalance.warehouse.name, quantity: reservation.quantity }));
  const backorders = fulfillment.backorders.map((item) => ({ backorderId: item.id, orderLineId: item.orderLineId, productId: item.productId, productName: item.productName, quantity: item.remainingQuantity }));
  const used = [...new Set(split.map((row) => row.warehouseId))];
  const warehouses = await tx.warehouse.findMany({ where: { id: { in: used } } });
  const estimatedCost = warehouses.reduce((sum, warehouse) => sum + number(warehouse.shippingCost), 0);
  const complete = backorders.length === 0;
  await tx.fulfillment.update({ where: { id: fulfillment.id }, data: { split: json({ split, backorders }), state: complete ? 'ALLOCATED' : 'BACKORDER', shipmentCount: used.length, estimatedCost, version: { increment: 1 } } });
  await tx.order.update({ where: { id: orderId }, data: { state: complete ? 'ALLOCATED' : 'PARTIALLY_ALLOCATED' } });
}

async function consolidateLocked(tx: Prisma.TransactionClient, input: { organizationId: string; actorId: string; orderId: string; reason: string; requestId?: string; requireAllocation: boolean }) {
  const order = await tx.order.findFirst({ where: { id: input.orderId, quote: { is: { organizationId: input.organizationId } } }, include: { fulfillment: true } });
  if (!order?.fulfillment) throw new FulfillmentError(404, 'NOT_FOUND', 'Fulfillment order not found.');
  const open = await tx.backorder.findMany({ where: { orderId: order.id, state: 'OPEN' }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  if (!open.length) {
    if (input.requireAllocation) throw new FulfillmentError(409, 'ALREADY_FULFILLED', 'This order has no remaining backorder.');
    return { allocated: false, view: await fulfillmentView(tx, order.id) };
  }
  const demand = open.map((item) => ({ orderLineId: item.orderLineId, productId: item.productId, productName: item.productName, quantity: item.remainingQuantity }));
  const balances = await loadBalances(tx, input.organizationId, [...new Set(open.map((item) => item.productId))], true);
  const allocation = suggestAllocation(demand, balances);
  if (!allocation.split.length) {
    if (input.requireAllocation) throw new FulfillmentError(409, 'STOCK_CHANGED', 'No stock is currently available for this backorder.', { availability: availabilityDto(balances) });
    return { allocated: false, view: await fulfillmentView(tx, order.id) };
  }
  for (const row of allocation.split) {
    const balance = balances.find((item) => item.productId === row.productId && item.warehouseId === row.warehouseId)!;
    const changed = await tx.stockBalance.updateMany({ where: { id: balance.id, reserved: { lte: balance.onHand - row.quantity } }, data: { reserved: { increment: row.quantity } } });
    if (changed.count !== 1) throw new FulfillmentError(409, 'STOCK_CHANGED', 'Stock changed during consolidation. No new reservation was committed.', { availability: availabilityDto(await loadBalances(tx, input.organizationId, [...new Set(open.map((item) => item.productId))])) });
    balance.reserved += row.quantity;
    await tx.reservation.upsert({
      where: { orderLineId_stockBalanceId: { orderLineId: row.orderLineId, stockBalanceId: balance.id } },
      create: { fulfillmentId: order.fulfillment.id, orderId: order.id, orderLineId: row.orderLineId, stockBalanceId: balance.id, quantity: row.quantity, source: 'CONSOLIDATION' },
      update: { quantity: { increment: row.quantity }, source: 'CONSOLIDATION' },
    });
    const remaining = allocation.backorders.find((item) => item.orderLineId === row.orderLineId)?.quantity ?? 0;
    await tx.backorder.update({ where: { orderLineId: row.orderLineId }, data: { remainingQuantity: remaining, state: remaining === 0 ? 'FULFILLED' : 'OPEN', fulfilledAt: remaining === 0 ? new Date() : null } });
  }
  await refreshFulfillment(tx, order.id);
  await tx.auditEvent.create({ data: { organizationId: input.organizationId, actorId: input.actorId, action: 'BACKORDER_CONSOLIDATED', resource: 'Order', resourceId: order.id, revisionId: order.revisionId, reason: input.reason, requestId: input.requestId } });
  return { allocated: true, view: await fulfillmentView(tx, order.id) };
}

export async function consolidateBackorder(tx: Prisma.TransactionClient, input: { organizationId: string; actorId: string; orderId: string; reason: string; idempotencyKey: string; requestId?: string }) {
  const operation = 'FULFILLMENT_CONSOLIDATE';
  const fingerprint = requestHash({ reason: input.reason });
  const key = { actorId_operation_resourceKey_key: { actorId: input.actorId, operation, resourceKey: input.orderId, key: input.idempotencyKey } };
  const replay = await tx.idempotencyRecord.findUnique({ where: key });
  if (replay) {
    if (replay.payloadHash !== fingerprint) throw new FulfillmentError(409, 'IDEMPOTENCY_CONFLICT', 'This idempotency key was already used for a different consolidation.');
    return { ...replayBody(replay.responseBody), replayed: true };
  }
  await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${input.orderId} FOR UPDATE`;
  const lockedReplay = await tx.idempotencyRecord.findUnique({ where: key });
  if (lockedReplay) {
    if (lockedReplay.payloadHash !== fingerprint) throw new FulfillmentError(409, 'IDEMPOTENCY_CONFLICT', 'This idempotency key was already used for a different consolidation.');
    return { ...replayBody(lockedReplay.responseBody), replayed: true };
  }
  const result = await consolidateLocked(tx, { ...input, requireAllocation: true });
  const body = result.view;
  await tx.idempotencyRecord.create({ data: { actorId: input.actorId, operation, resourceKey: input.orderId, key: input.idempotencyKey, payloadHash: fingerprint, responseStatus: 200, responseBody: json(body) } });
  return { ...body, replayed: false };
}

export async function receiveStock(tx: Prisma.TransactionClient, input: z.infer<typeof receiveStockSchema> & { organizationId: string; actorId: string; orderId: string; idempotencyKey: string; requestId?: string }) {
  const operation = 'FULFILLMENT_RECEIVE';
  const payload = { warehouseId: input.warehouseId, productId: input.productId, quantity: input.quantity, reference: input.reference ?? null, reason: input.reason };
  const fingerprint = requestHash(payload);
  const key = { actorId_operation_resourceKey_key: { actorId: input.actorId, operation, resourceKey: input.orderId, key: input.idempotencyKey } };
  const replay = await tx.idempotencyRecord.findUnique({ where: key });
  if (replay) {
    if (replay.payloadHash !== fingerprint) throw new FulfillmentError(409, 'IDEMPOTENCY_CONFLICT', 'This idempotency key was already used for a different receipt.');
    return { ...replayBody(replay.responseBody), replayed: true };
  }
  await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${input.orderId} FOR UPDATE`;
  const lockedReplay = await tx.idempotencyRecord.findUnique({ where: key });
  if (lockedReplay) {
    if (lockedReplay.payloadHash !== fingerprint) throw new FulfillmentError(409, 'IDEMPOTENCY_CONFLICT', 'This idempotency key was already used for a different receipt.');
    return { ...replayBody(lockedReplay.responseBody), replayed: true };
  }
  const order = await tx.order.findFirst({ where: { id: input.orderId, quote: { is: { organizationId: input.organizationId } } }, include: { fulfillment: true } });
  if (!order) throw new FulfillmentError(404, 'NOT_FOUND', 'Confirmed order not found.');
  const warehouse = await tx.warehouse.findFirst({ where: { id: input.warehouseId, organizationId: input.organizationId, active: true } });
  const product = await tx.product.findFirst({ where: { id: input.productId, organizationId: input.organizationId, category: 'Hardware' } });
  if (!warehouse || !product) throw new FulfillmentError(404, 'NOT_FOUND', 'Active warehouse or hardware product not found.');
  await tx.$queryRaw`SELECT "id" FROM "Warehouse" WHERE "id" = ${warehouse.id} FOR UPDATE`;
  const outstandingProducts = order.fulfillment
    ? await tx.backorder.findMany({ where: { orderId: order.id, state: 'OPEN' }, select: { productId: true } })
    : [];
  await loadBalances(tx, input.organizationId, [...new Set([input.productId, ...outstandingProducts.map((item) => item.productId)])], true);
  const current = await tx.stockBalance.findUnique({ where: { warehouseId_productId: { warehouseId: warehouse.id, productId: product.id } } });
  const balance = current
    ? await tx.stockBalance.update({ where: { id: current.id }, data: { onHand: { increment: input.quantity } } })
    : await tx.stockBalance.create({ data: { warehouseId: warehouse.id, productId: product.id, onHand: input.quantity, reserved: 0 } });
  const movement = await tx.stockMovement.create({ data: { organizationId: input.organizationId, stockBalanceId: balance.id, orderId: order.id, productId: product.id, kind: 'RECEIPT', quantityDelta: input.quantity, reference: input.reference, reason: input.reason, actorId: input.actorId } });
  await tx.auditEvent.create({ data: { organizationId: input.organizationId, actorId: input.actorId, action: 'STOCK_RECEIVED', resource: 'StockMovement', resourceId: movement.id, reason: `${input.reason} (+${input.quantity})`, requestId: input.requestId } });
  const consolidated = order.fulfillment
    ? await consolidateLocked(tx, { organizationId: input.organizationId, actorId: input.actorId, orderId: order.id, reason: `Receipt ${input.reference ?? movement.id}: ${input.reason}`, requestId: input.requestId, requireAllocation: false })
    : null;
  const body = {
    movement: { id: movement.id, kind: movement.kind, quantityDelta: movement.quantityDelta, reference: movement.reference, reason: movement.reason, createdAt: movement.createdAt },
    balance: { id: balance.id, warehouseId: balance.warehouseId, productId: balance.productId, onHand: balance.onHand, reserved: balance.reserved, available: balance.onHand - balance.reserved },
    consolidated: consolidated?.allocated ?? false,
    fulfillment: consolidated?.view ?? null,
  };
  await tx.idempotencyRecord.create({ data: { actorId: input.actorId, operation, resourceKey: input.orderId, key: input.idempotencyKey, payloadHash: fingerprint, responseStatus: 201, responseBody: json(body) } });
  return { ...body, replayed: false };
}
