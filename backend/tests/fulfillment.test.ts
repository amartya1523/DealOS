import { describe, expect, it } from 'vitest';
import { availabilityFingerprint, reserveStockSchema, suggestAllocation, type AvailableBalance } from '../src/fulfillment.js';

const demand = [{ orderLineId: 'line-1', productId: 'product-1', productName: 'Edge gateway', quantity: 6 }];
const balances: AvailableBalance[] = [
  { id: 'balance-a', productId: 'product-1', warehouseId: 'warehouse-a', warehouseName: 'Central', priority: 2, shippingCost: 80, onHand: 10, reserved: 5 },
  { id: 'balance-b', productId: 'product-1', warehouseId: 'warehouse-b', warehouseName: 'South', priority: 1, shippingCost: 120, onHand: 3, reserved: 0 },
];

describe('hardware fulfillment rules', () => {
  it('uses on-hand minus existing reservations and reports the resulting shortage', () => {
    const result = suggestAllocation(demand, balances);
    expect(result.split.reduce((sum, row) => sum + row.quantity, 0)).toBe(6);
    expect(result.split.find((row) => row.warehouseId === 'warehouse-a')?.quantity).toBe(5);
    expect(result.split.find((row) => row.warehouseId === 'warehouse-b')?.quantity).toBe(1);
    expect(result.backorders).toEqual([]);
  });

  it('prefers one lower-cost warehouse when it can cover the line', () => {
    const result = suggestAllocation(demand, [
      { ...balances[0]!, onHand: 12, reserved: 0 },
      { ...balances[1]!, onHand: 12, reserved: 0 },
    ]);
    expect(result.split).toEqual([{ ...demand[0], warehouseId: 'warehouse-a', warehouseName: 'Central', quantity: 6 }]);
  });

  it('requires a manual override reason at the Zod boundary', () => {
    const withoutReason = reserveStockSchema.safeParse({ mode: 'MANUAL', split: [{ orderLineId: '11111111-1111-4111-8111-111111111111', warehouseId: '22222222-2222-4222-8222-222222222222', quantity: 1 }] });
    expect(withoutReason.success).toBe(false);
    expect(withoutReason.error?.flatten().fieldErrors.reason).toContain('A manual override reason is required.');
  });

  it('fingerprints reservations as well as on-hand stock', () => {
    expect(availabilityFingerprint(balances)).not.toBe(availabilityFingerprint([{ ...balances[0]!, reserved: 4 }, balances[1]!]));
  });
});
