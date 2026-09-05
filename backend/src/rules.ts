import { Prisma } from '@prisma/client';

type DecimalValue = Prisma.Decimal | string | number;

export type QuoteLineInput = {
  productId?: string;
  quantity: number;
  unitPrice: DecimalValue;
  unitCost: DecimalValue;
  discount: DecimalValue;
  allowedDiscount: DecimalValue;
  taxRate?: DecimalValue;
  cadence?: string | null;
};

export type ReviewPolicy = {
  financeThreshold?: DecimalValue;
  minimumMarginPercent?: DecimalValue;
  aggregateDiscountLimit?: DecimalValue;
};

const money = (value: Prisma.Decimal) => value.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
const rate = (value: Prisma.Decimal) => value.toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP);
const asNumber = (value: Prisma.Decimal) => Number(value.toString());
const asMoney = (value: Prisma.Decimal) => asNumber(money(value));
const decimal = (value: DecimalValue) => new Prisma.Decimal(value);

export function calculateQuote(lines: QuoteLineInput[], orderDiscount: DecimalValue = 0, policy: ReviewPolicy = {}) {
  const hundred = decimal(100);
  const normalizedOrderDiscount = Prisma.Decimal.min(hundred, Prisma.Decimal.max(0, decimal(orderDiscount)));
  let subtotal = decimal(0);
  let taxTotal = decimal(0);
  let cost = decimal(0);
  let weightedExcessValue = decimal(0);
  let grossValue = decimal(0);
  let worstExcess = decimal(0);
  const cadenceBuckets = new Map<string, { subtotal: Prisma.Decimal; tax: Prisma.Decimal; cost: Prisma.Decimal; gross: Prisma.Decimal; weightedExcessValue: Prisma.Decimal; worstExcess: Prisma.Decimal }>();

  const calculatedLines = lines.map((line) => {
    const quantity = decimal(line.quantity);
    const unitPrice = decimal(line.unitPrice);
    const unitCost = decimal(line.unitCost);
    const lineDiscount = decimal(line.discount);
    const allowedDiscount = decimal(line.allowedDiscount);
    const lineTaxRate = decimal(line.taxRate ?? 0);
    const gross = quantity.mul(unitPrice);
    const effectiveDiscount = hundred.sub(hundred.sub(lineDiscount).mul(hundred.sub(normalizedOrderDiscount)).div(hundred));
    const net = money(gross.mul(hundred.sub(effectiveDiscount)).div(hundred));
    const tax = money(net.mul(lineTaxRate).div(hundred));
    const lineCost = money(quantity.mul(unitCost));
    const excess = Prisma.Decimal.max(0, effectiveDiscount.sub(allowedDiscount));
    const cadence = line.cadence?.trim() || 'One-time';
    const bucket = cadenceBuckets.get(cadence) ?? { subtotal: decimal(0), tax: decimal(0), cost: decimal(0), gross: decimal(0), weightedExcessValue: decimal(0), worstExcess: decimal(0) };
    bucket.subtotal = bucket.subtotal.add(net);
    bucket.tax = bucket.tax.add(tax);
    bucket.cost = bucket.cost.add(lineCost);
    bucket.gross = bucket.gross.add(gross);
    bucket.weightedExcessValue = bucket.weightedExcessValue.add(gross.mul(excess));
    bucket.worstExcess = Prisma.Decimal.max(bucket.worstExcess, excess);
    cadenceBuckets.set(cadence, bucket);
    subtotal = subtotal.add(net);
    taxTotal = taxTotal.add(tax);
    cost = cost.add(lineCost);
    grossValue = grossValue.add(gross);
    weightedExcessValue = weightedExcessValue.add(gross.mul(excess));
    worstExcess = Prisma.Decimal.max(worstExcess, excess);
    return {
      ...line,
      gross: asMoney(gross),
      net: asMoney(net),
      tax: asMoney(tax),
      lineCost: asMoney(lineCost),
      effectiveDiscount: asNumber(rate(effectiveDiscount)),
      excess: asNumber(rate(excess)),
      cadence,
    };
  });

  const weightedExcess = grossValue.isZero() ? decimal(0) : weightedExcessValue.div(grossValue);
  const margin = subtotal.sub(cost);
  const overallMarginPercent = subtotal.isZero() ? decimal(0) : margin.div(subtotal).mul(hundred);
  const financeThreshold = decimal(policy.financeThreshold ?? 5);
  const minimumMarginPercent = decimal(policy.minimumMarginPercent ?? 12);
  const aggregateDiscountLimit = decimal(policy.aggregateDiscountLimit ?? 20);
  const riskByCadence = Object.fromEntries([...cadenceBuckets.entries()].map(([cadence, bucket]) => {
    const bucketWeightedExcess = bucket.gross.isZero() ? decimal(0) : bucket.weightedExcessValue.div(bucket.gross);
    const aggregateDiscount = bucket.gross.isZero() ? decimal(0) : hundred.sub(bucket.subtotal.div(bucket.gross).mul(hundred));
    const bucketMargin = bucket.subtotal.sub(bucket.cost);
    const bucketMarginPercent = bucket.subtotal.isZero() ? decimal(0) : bucketMargin.div(bucket.subtotal).mul(hundred);
    return [cadence, {
      worstExcess: asNumber(rate(bucket.worstExcess)),
      weightedExcess: asNumber(rate(bucketWeightedExcess)),
      aggregateDiscount: asNumber(rate(aggregateDiscount)),
      marginPercent: asNumber(rate(bucketMarginPercent)),
    }];
  }));
  const comparableBuckets = Object.values(riskByCadence);
  const cadenceWeightedExcess = comparableBuckets.length ? Math.max(...comparableBuckets.map((bucket) => bucket.weightedExcess)) : 0;
  const aggregateDiscount = comparableBuckets.length ? Math.max(...comparableBuckets.map((bucket) => bucket.aggregateDiscount)) : 0;
  const marginPercent = comparableBuckets.length ? Math.min(...comparableBuckets.map((bucket) => bucket.marginPercent)) : asNumber(rate(overallMarginPercent));
  const hasDiscount = calculatedLines.some((line) => decimal(line.effectiveDiscount).gt(0));
  const needsFinance = worstExcess.gt(financeThreshold) || decimal(cadenceWeightedExcess).gt(financeThreshold) || decimal(aggregateDiscount).gt(aggregateDiscountLimit) || decimal(marginPercent).lt(minimumMarginPercent);
  const needsManager = hasDiscount || needsFinance;
  const totalsByCadence = Object.fromEntries([...cadenceBuckets.entries()].map(([cadence, bucket]) => [cadence, {
    subtotal: asMoney(bucket.subtotal),
    tax: asMoney(bucket.tax),
    total: asMoney(bucket.subtotal.add(bucket.tax)),
    cost: asMoney(bucket.cost),
    margin: asMoney(bucket.subtotal.sub(bucket.cost)),
  }]));

  return {
    lines: calculatedLines,
    subtotal: asMoney(subtotal),
    tax: asMoney(taxTotal),
    taxTotal: asMoney(taxTotal),
    total: asMoney(subtotal.add(taxTotal)),
    cost: asMoney(cost),
    margin: asMoney(margin),
    marginPercent,
    worstExcess: asNumber(rate(worstExcess)),
    weightedExcess: cadenceWeightedExcess,
    aggregateDiscount,
    riskByCadence,
    riskScore: Math.max(asNumber(rate(worstExcess)), cadenceWeightedExcess),
    needsManager,
    needsFinance,
    totalsByCadence,
  };
}

export function calculateAddOnContribution(line:QuoteLineInput,orderDiscount:DecimalValue=0,policy:ReviewPolicy={}) {
  const calculation=calculateQuote([line],orderDiscount,policy);
  return {netContribution:calculation.subtotal,marginContribution:calculation.margin,cadence:calculation.lines[0]?.cadence??'One-time'};
}

export function allocateStock(
  required: Array<{ productId: string; quantity: number }>,
  balances: Array<{ productId: string; warehouseId: string; warehouseName: string; priority: number; shippingCost: number; onHand: number; reserved: number }>,
) {
  const demand = new Map<string, number>();
  for (const item of required) demand.set(item.productId, (demand.get(item.productId) ?? 0) + item.quantity);
  const split: Array<{ productId: string; warehouseId: string; warehouseName: string; quantity: number }> = [];
  const backorders: Array<{ productId: string; quantity: number }> = [];
  const usedWarehouses = new Set<string>();
  for (const [productId, quantityRequired] of demand) {
    let remaining = quantityRequired;
    const candidates = balances
      .filter((balance) => balance.productId === productId && balance.onHand - balance.reserved > 0)
      .sort((a, b) => {
        const aUsed = usedWarehouses.has(a.warehouseId) ? 0 : 1;
        const bUsed = usedWarehouses.has(b.warehouseId) ? 0 : 1;
        if (aUsed !== bUsed) return aUsed - bUsed;
        const aAvailable = a.onHand - a.reserved;
        const bAvailable = b.onHand - b.reserved;
        const aCovers = aAvailable >= quantityRequired ? 0 : 1;
        const bCovers = bAvailable >= quantityRequired ? 0 : 1;
        if (aCovers !== bCovers) return aCovers - bCovers;
        if (aCovers === 0) return a.shippingCost - b.shippingCost || a.priority - b.priority || a.warehouseId.localeCompare(b.warehouseId);
        return bAvailable - aAvailable || a.shippingCost - b.shippingCost || a.priority - b.priority || a.warehouseId.localeCompare(b.warehouseId);
      });
    for (const balance of candidates) {
      if (!remaining) break;
      const quantity = Math.min(remaining, balance.onHand - balance.reserved);
      split.push({ productId, warehouseId: balance.warehouseId, warehouseName: balance.warehouseName, quantity });
      usedWarehouses.add(balance.warehouseId);
      remaining -= quantity;
    }
    if (remaining > 0) backorders.push({ productId, quantity: remaining });
  }
  return { split, backorders };
}

export class FulfillmentRuleError extends Error {
  constructor(readonly code: 'INVALID_ALLOCATION' | 'INSUFFICIENT_STOCK', message: string) { super(message); }
}

export function manualAllocation(
  required: Array<{ productId: string; quantity: number }>,
  requested: Array<{ productId: string; warehouseId: string; quantity: number }>,
  balances: Array<{ productId: string; warehouseId: string; warehouseName: string; priority: number; shippingCost: number; onHand: number; reserved: number }>,
) {
  const demand = new Map<string, number>();
  for (const item of required) demand.set(item.productId, (demand.get(item.productId) ?? 0) + item.quantity);
  const keys = new Set<string>();
  const allocated = new Map<string, number>();
  const split = requested.map((row) => {
    const key = `${row.productId}:${row.warehouseId}`;
    if (keys.has(key)) throw new FulfillmentRuleError('INVALID_ALLOCATION', 'Combine duplicate product and warehouse rows.');
    keys.add(key);
    if (!Number.isInteger(row.quantity) || row.quantity <= 0 || !demand.has(row.productId)) throw new FulfillmentRuleError('INVALID_ALLOCATION', 'Manual allocation contains an invalid order item or quantity.');
    const balance = balances.find((item) => item.productId === row.productId && item.warehouseId === row.warehouseId);
    if (!balance) throw new FulfillmentRuleError('INVALID_ALLOCATION', 'One or more warehouse stock rows do not exist.');
    if (row.quantity > balance.onHand - balance.reserved) throw new FulfillmentRuleError('INSUFFICIENT_STOCK', `${balance.warehouseName} no longer has enough available stock.`);
    const next = (allocated.get(row.productId) ?? 0) + row.quantity;
    if (next > (demand.get(row.productId) ?? 0)) throw new FulfillmentRuleError('INVALID_ALLOCATION', 'Manual allocation exceeds ordered quantity.');
    allocated.set(row.productId, next);
    return { ...row, warehouseName: balance.warehouseName };
  });
  const backorders = [...demand.entries()].map(([productId, quantity]) => ({ productId, quantity: quantity - (allocated.get(productId) ?? 0) })).filter((row) => row.quantity > 0);
  return { split, backorders };
}

export function allocationMetrics(
  split: Array<{ warehouseId: string }>,
  balances: Array<{ warehouseId: string; shippingCost: number }>,
) {
  const warehouseIds = [...new Set(split.map((row) => row.warehouseId))];
  return {
    shipmentCount: warehouseIds.length,
    estimatedCost: warehouseIds.reduce((sum, warehouseId) => sum + (balances.find((row) => row.warehouseId === warehouseId)?.shippingCost ?? 0), 0),
  };
}

export function billingSchedule(firstBillAt: Date, cadence: string, count = 3) {
  const intervalMonths = cadence.toLowerCase() === 'quarterly' ? 3 : cadence.toLowerCase() === 'yearly' ? 12 : 1;
  const anchor = firstBillAt.getUTCDate();
  return Array.from({ length: count }, (_, index) => {
    const targetMonth = firstBillAt.getUTCMonth() + intervalMonths * index;
    const year = firstBillAt.getUTCFullYear() + Math.floor(targetMonth / 12);
    const month = ((targetMonth % 12) + 12) % 12;
    const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    return new Date(Date.UTC(year, month, Math.min(anchor, lastDay), firstBillAt.getUTCHours(), firstBillAt.getUTCMinutes(), firstBillAt.getUTCSeconds(), firstBillAt.getUTCMilliseconds()));
  });
}
