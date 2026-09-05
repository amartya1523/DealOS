export type QuoteLineInput = {
  quantity: number;
  unitPrice: number;
  unitCost: number;
  discount: number;
  allowedDiscount: number;
};

export function calculateQuote(lines: QuoteLineInput[], orderDiscount = 0) {
  const normalizedOrderDiscount = Math.min(100, Math.max(0, orderDiscount));
  let total = 0;
  let cost = 0;
  let weightedExcessValue = 0;
  let grossValue = 0;
  let worstExcess = 0;

  const calculatedLines = lines.map((line) => {
    const gross = line.quantity * line.unitPrice;
    const effectiveDiscount = 100 - ((100 - line.discount) * (100 - normalizedOrderDiscount)) / 100;
    const net = gross * (1 - effectiveDiscount / 100);
    const lineCost = line.quantity * line.unitCost;
    const excess = Math.max(0, effectiveDiscount - line.allowedDiscount);
    total += net;
    cost += lineCost;
    grossValue += gross;
    weightedExcessValue += gross * excess;
    worstExcess = Math.max(worstExcess, excess);
    return { ...line, gross, net, lineCost, effectiveDiscount, excess };
  });

  const weightedExcess = grossValue ? weightedExcessValue / grossValue : 0;
  const margin = total - cost;
  const marginPercent = total ? (margin / total) * 100 : 0;
  const needsManager = worstExcess > 0 || weightedExcess > 0;
  const needsFinance = worstExcess > 5 || weightedExcess > 3 || marginPercent < 12;

  return {
    lines: calculatedLines,
    total: round(total),
    cost: round(cost),
    margin: round(margin),
    marginPercent: round(marginPercent),
    worstExcess: round(worstExcess),
    weightedExcess: round(weightedExcess),
    riskScore: round(Math.max(worstExcess, weightedExcess)),
    needsManager,
    needsFinance,
  };
}

export function allocateStock(
  required: Array<{ productId: string; quantity: number }>,
  balances: Array<{ productId: string; warehouseId: string; warehouseName: string; priority: number; shippingCost: number; onHand: number; reserved: number }>,
) {
  const split: Array<{ productId: string; warehouseId: string; warehouseName: string; quantity: number }> = [];
  const backorders: Array<{ productId: string; quantity: number }> = [];
  for (const item of required) {
    let remaining = item.quantity;
    const candidates = balances
      .filter((balance) => balance.productId === item.productId && balance.onHand - balance.reserved > 0)
      .sort((a, b) => a.priority - b.priority || a.shippingCost - b.shippingCost || a.warehouseId.localeCompare(b.warehouseId));
    for (const balance of candidates) {
      if (!remaining) break;
      const quantity = Math.min(remaining, balance.onHand - balance.reserved);
      split.push({ productId: item.productId, warehouseId: balance.warehouseId, warehouseName: balance.warehouseName, quantity });
      remaining -= quantity;
    }
    if (remaining > 0) backorders.push({ productId: item.productId, quantity: remaining });
  }
  return { split, backorders };
}

const round = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
