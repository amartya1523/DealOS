import { describe, expect, it } from 'vitest';
import { discountPolicyUpdateSchema } from '../src/policy.js';

describe('discount policy updates', () => {
  const validPolicy = {
    maxDiscount: 15,
    hardwareLimit: 15,
    servicesLimit: 10,
    subscriptionLimit: 8,
    financeThreshold: 5,
    reason: '  Margin protection review.  ',
  };

  it('accepts all editable ceilings and trims the audit reason', () => {
    const result = discountPolicyUpdateSchema.parse(validPolicy);
    expect(result).toEqual({ ...validPolicy, reason: 'Margin protection review.' });
  });

  it('rejects a category ceiling above the overall tier ceiling', () => {
    const result = discountPolicyUpdateSchema.safeParse({ ...validPolicy, servicesLimit: 16 });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors.servicesLimit).toContain('Category ceilings cannot exceed the overall tier ceiling.');
  });

  it('requires a complete policy and a meaningful change reason', () => {
    expect(discountPolicyUpdateSchema.safeParse({ maxDiscount: 15, financeThreshold: 5 }).success).toBe(false);
    expect(discountPolicyUpdateSchema.safeParse({ ...validPolicy, reason: 'no' }).success).toBe(false);
    expect(discountPolicyUpdateSchema.safeParse({ ...validPolicy, hardwareLimit: 101 }).success).toBe(false);
  });
});
