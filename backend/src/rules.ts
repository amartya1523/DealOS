import { Prisma } from '@prisma/client';

type DecimalValue = Prisma.Decimal | string | number;

export type QuoteLineInput = {
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
  const cadenceBuckets = new Map<string, { subtotal: Prisma.Decimal; tax: Prisma.Decimal; cost: Prisma.Decimal }>();

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
    const bucket = cadenceBuckets.get(cadence) ?? { subtotal: decimal(0), tax: decimal(0), cost: decimal(0) };
    bucket.subtotal = bucket.subtotal.add(net);
    bucket.tax = bucket.tax.add(tax);
    bucket.cost = bucket.cost.add(lineCost);
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
  const marginPercent = subtotal.isZero() ? decimal(0) : margin.div(subtotal).mul(hundred);
  const financeThreshold = decimal(policy.financeThreshold ?? 5);
  const minimumMarginPercent = decimal(policy.minimumMarginPercent ?? 12);
  const needsManager = worstExcess.gt(0) || weightedExcess.gt(0);
  const needsFinance = worstExcess.gt(financeThreshold) || weightedExcess.gt(financeThreshold) || marginPercent.lt(minimumMarginPercent);
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
    marginPercent: asNumber(rate(marginPercent)),
    worstExcess: asNumber(rate(worstExcess)),
    weightedExcess: asNumber(rate(weightedExcess)),
    riskScore: asNumber(rate(Prisma.Decimal.max(worstExcess, weightedExcess))),
    needsManager,
    needsFinance,
    totalsByCadence,
  };
}

export function allocateStock(
  required: Array<{ productId: string; quantity: number }>,
  balances: Array<{ productId: string; warehouseId: string; warehouseName: string; priority: number; shippingCost: number; onHand: number; reserved: number }>,
) {
  const demand = new Map<string, number>();
  for (const item of required) demand.set(item.productId, (demand.get(item.productId) ?? 0) + item.quantity);
  const split: Array<{ productId: string; warehouseId: string; warehouseName: string; quantity: number }> = [];
  const backorders: Array<{ productId: string; quantity: number }> = [];
  for (const [productId, quantityRequired] of demand) {
    let remaining = quantityRequired;
    const candidates = balances
      .filter((balance) => balance.productId === productId && balance.onHand - balance.reserved > 0)
      .sort((a, b) => a.priority - b.priority || a.shippingCost - b.shippingCost || a.warehouseId.localeCompare(b.warehouseId));
    for (const balance of candidates) {
      if (!remaining) break;
      const quantity = Math.min(remaining, balance.onHand - balance.reserved);
      split.push({ productId, warehouseId: balance.warehouseId, warehouseName: balance.warehouseName, quantity });
      remaining -= quantity;
    }
    if (remaining > 0) backorders.push({ productId, quantity: remaining });
  }
  return { split, backorders };
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
