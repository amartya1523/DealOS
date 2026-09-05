import { describe, expect, it } from 'vitest';
import { allocateStock, calculateQuote } from '../src/rules.js';

describe('quotation governance', () => {
  it('routes an 18% service discount over a 10% limit to finance', () => {
    const result = calculateQuote([{ quantity: 1, unitPrice: 400, unitCost: 250, discount: 18, allowedDiscount: 10 }]);
    expect(result.worstExcess).toBe(8);
    expect(result.needsManager).toBe(true);
    expect(result.needsFinance).toBe(true);
  });

  it('composes line and order discounts sequentially', () => {
    const result = calculateQuote([{ quantity: 1, unitPrice: 100, unitCost: 50, discount: 10, allowedDiscount: 20 }], 10);
    expect(result.lines[0]?.effectiveDiscount).toBe(19);
    expect(result.total).toBe(81);
  });
});
describe('warehouse allocation', () => {
  it('uses prioritized stock and surfaces a backorder', () => {
    const result = allocateStock([{ productId: 'p1', quantity: 9 }], [
      { productId: 'p1', warehouseId: 'w1', warehouseName: 'Main', priority: 1, shippingCost: 20, onHand: 5, reserved: 1 },
      { productId: 'p1', warehouseId: 'w2', warehouseName: 'East', priority: 2, shippingCost: 15, onHand: 3, reserved: 0 },
    ]);
    expect(result.split.map((row) => row.quantity)).toEqual([4, 3]);
    expect(result.backorders).toEqual([{ productId: 'p1', quantity: 2 }]);
  });
});
