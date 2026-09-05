import { describe, expect, it } from 'vitest';
import { allocateStock, allocationMetrics, billingSchedule, calculateAddOnContribution, calculateQuote, manualAllocation } from '../src/rules.js';

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

  it('keeps cadence totals separate and calculates tax with decimal rounding', () => {
    const result = calculateQuote([
      { quantity: 1, unitPrice: '100.00', unitCost: '50.00', discount: 0, allowedDiscount: 10, taxRate: '18.00', cadence: 'One-time' },
      { quantity: 1, unitPrice: '40.00', unitCost: '12.00', discount: 0, allowedDiscount: 10, taxRate: '18.00', cadence: 'Monthly' },
    ]);
    expect(result.taxTotal).toBe(25.2);
    expect(result.totalsByCadence).toEqual({
      'One-time': { subtotal: 100, tax: 18, total: 118, cost: 50, margin: 50 },
      Monthly: { subtotal: 40, tax: 7.2, total: 47.2, cost: 12, margin: 28 },
    });
  });

  it('uses the published finance threshold and still routes low margin', () => {
    const excess = calculateQuote([{ quantity: 1, unitPrice: 100, unitCost: 50, discount: 18, allowedDiscount: 10 }], 0, { financeThreshold: 99 });
    const lowMargin = calculateQuote([{ quantity: 1, unitPrice: 100, unitCost: 95, discount: 0, allowedDiscount: 10 }], 0, { financeThreshold: 99 });
    expect(excess.needsManager).toBe(true);
    expect(excess.needsFinance).toBe(false);
    expect(lowMargin.needsManager).toBe(true);
    expect(lowMargin.needsFinance).toBe(true);
  });

  it('uses the quotation calculator as the single source for add-on margin contribution',()=>{
    const line={quantity:1,unitPrice:400,unitCost:250,discount:0,allowedDiscount:10,taxRate:18,cadence:'One-time'};
    const quote=calculateQuote([line],5);
    expect(calculateAddOnContribution(line,5)).toEqual({netContribution:quote.subtotal,marginContribution:quote.margin,cadence:'One-time'});
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

  it('aggregates duplicate product demand before allocating', () => {
    const result = allocateStock([{ productId: 'p1', quantity: 60 }, { productId: 'p1', quantity: 60 }], [
      { productId: 'p1', warehouseId: 'w1', warehouseName: 'Main', priority: 1, shippingCost: 20, onHand: 100, reserved: 0 },
    ]);
    expect(result.split).toEqual([{ productId: 'p1', warehouseId: 'w1', warehouseName: 'Main', quantity: 100 }]);
    expect(result.backorders).toEqual([{ productId: 'p1', quantity: 20 }]);
  });

  it('uses one warehouse when it can cover the full demand', () => {
    const result = allocateStock([{ productId: 'p1', quantity: 8 }], [
      { productId: 'p1', warehouseId: 'w1', warehouseName: 'Main', priority: 1, shippingCost: 5, onHand: 3, reserved: 0 },
      { productId: 'p1', warehouseId: 'w2', warehouseName: 'East', priority: 2, shippingCost: 20, onHand: 10, reserved: 0 },
    ]);
    expect(result.split).toEqual([{ productId: 'p1', warehouseId: 'w2', warehouseName: 'East', quantity: 8 }]);
    expect(result.backorders).toEqual([]);
  });

  it('reuses a selected warehouse across products to avoid an unnecessary shipment', () => {
    const result = allocateStock([{ productId: 'p1', quantity: 4 }, { productId: 'p2', quantity: 3 }], [
      { productId: 'p1', warehouseId: 'w1', warehouseName: 'Main', priority: 1, shippingCost: 10, onHand: 4, reserved: 0 },
      { productId: 'p2', warehouseId: 'w1', warehouseName: 'Main', priority: 1, shippingCost: 10, onHand: 3, reserved: 0 },
      { productId: 'p2', warehouseId: 'w2', warehouseName: 'East', priority: 2, shippingCost: 5, onHand: 3, reserved: 0 },
    ]);
    expect(new Set(result.split.map((row) => row.warehouseId))).toEqual(new Set(['w1']));
  });

  it('validates manual overrides and keeps every missing unit as backorder', () => {
    const balances = [{ productId: 'p1', warehouseId: 'w1', warehouseName: 'Main', priority: 1, shippingCost: 20, onHand: 6, reserved: 1 }];
    expect(manualAllocation([{ productId: 'p1', quantity: 8 }], [{ productId: 'p1', warehouseId: 'w1', quantity: 5 }], balances)).toEqual({
      split: [{ productId: 'p1', warehouseId: 'w1', warehouseName: 'Main', quantity: 5 }],
      backorders: [{ productId: 'p1', quantity: 3 }],
    });
    expect(() => manualAllocation([{ productId: 'p1', quantity: 8 }], [{ productId: 'p1', warehouseId: 'w1', quantity: 6 }], balances)).toThrow(/enough available stock/);
  });

  it('calculates shipment count and cost once per selected warehouse', () => {
    expect(allocationMetrics([{ warehouseId: 'w1' }, { warehouseId: 'w1' }, { warehouseId: 'w2' }], [{ warehouseId: 'w1', shippingCost: 45 }, { warehouseId: 'w2', shippingCost: 28 }])).toEqual({ shipmentCount: 2, estimatedCost: 73 });
  });
});

describe('billing calendar', () => {
  it('advances quarterly schedules by three months and preserves the anchor', () => {
    expect(billingSchedule(new Date('2026-11-01T00:00:00.000Z'), 'Quarterly').map((value) => value.toISOString())).toEqual([
      '2026-11-01T00:00:00.000Z',
      '2027-02-01T00:00:00.000Z',
      '2027-05-01T00:00:00.000Z',
    ]);
  });
});
