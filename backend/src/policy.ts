import { z } from 'zod';

const percentage = z.number().min(0).max(100);

export const discountPolicyUpdateSchema = z.object({
  maxDiscount: percentage,
  hardwareLimit: percentage,
  servicesLimit: percentage,
  subscriptionLimit: percentage,
  financeThreshold: percentage,
  reason: z.string().trim().min(5).max(240),
}).strict().superRefine((values, context) => {
  for (const [field, value] of [
    ['hardwareLimit', values.hardwareLimit],
    ['servicesLimit', values.servicesLimit],
    ['subscriptionLimit', values.subscriptionLimit],
  ] as const) {
    if (value > values.maxDiscount) {
      context.addIssue({
        code: 'custom',
        path: [field],
        message: 'Category ceilings cannot exceed the overall tier ceiling.',
      });
    }
  }
});
