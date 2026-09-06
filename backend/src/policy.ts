import { z } from 'zod';

const percentage = z.number().min(0).max(100);

export const discountPolicyUpdateSchema = z.object({
  maxDiscount: percentage,
  hardwareLimit: percentage,
  servicesLimit: percentage,
  subscriptionLimit: percentage,
  financeThreshold: percentage,
  aggregateDiscountLimit: percentage,
  minimumMarginPercent: z.number().min(-100).max(100),
  approvalSequence:z.array(z.enum(['Sales Manager','Finance'])).length(2).refine(values=>new Set(values).size===2,'Approval sequence must include Sales Manager and Finance exactly once.').optional(),
  managerReviewerId:z.string().uuid().nullable().optional(),
  financeReviewerId:z.string().uuid().nullable().optional(),
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
