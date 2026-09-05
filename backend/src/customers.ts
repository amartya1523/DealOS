import crypto from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { customerTemporaryPasswordSchema, provisionCustomerPortalPassword } from './portal-invitations.js';

export const customerProfileSchema = z.object({
  name: z.string().trim().min(2).max(160),
  tier: z.string().trim().min(2).max(40).default('Gold'),
  currency: z.string().trim().length(3).default('INR'),
  customerType: z.string().trim().min(2).max(80).default('Business / Company'),
  region: z.string().trim().min(2).max(80).default('India'),
  contactPerson: z.string().trim().max(120).optional().nullable(),
  email: z.string().trim().email().transform((value) => value.toLowerCase()).optional().nullable(),
  phone: z.string().trim().max(32).optional().nullable(),
  countryCode: z.string().trim().min(1).max(8).default('+91'),
  gstin: z.string().trim().max(15).optional().nullable(),
  billingAddress: z.string().trim().max(1000).optional().nullable(),
  shippingAddress: z.string().trim().max(1000).optional().nullable(),
  paymentTerms: z.number().int().min(0).max(180).default(7),
  active: z.boolean().default(true),
}).strict();

export const customerCreationSchema = customerProfileSchema.extend({
  temporaryPassword: customerTemporaryPasswordSchema.optional(),
}).strict();

export type CustomerProfileInput = z.infer<typeof customerProfileSchema>;

export type CustomerCreationActor = {
  id: string;
  organizationId: string;
  requestId?: string;
};

export class CustomerProfileError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

export function generateCustomerTemporaryPassword() {
  return `Deal-${crypto.randomBytes(9).toString('base64url')}!`;
}

export async function createCustomerProfile(
  tx: Prisma.TransactionClient,
  actor: CustomerCreationActor,
  profile: CustomerProfileInput,
  options: {
    temporaryPassword?: string;
    auditAction?: string;
    auditReason?: string;
  } = {},
) {
  const duplicateName = await tx.customer.findFirst({
    where: { organizationId: actor.organizationId, name: { equals: profile.name, mode: 'insensitive' } },
    select: { id: true },
  });
  if (duplicateName) {
    throw new CustomerProfileError(409, 'CUSTOMER_EXISTS', 'A customer with this name already exists in this workspace.');
  }
  if (profile.email) {
    const duplicate = await tx.customer.findFirst({
      where: {
        organizationId: actor.organizationId,
        email: { equals: profile.email, mode: 'insensitive' },
      },
      select: { id: true },
    });
    if (duplicate) {
      throw new CustomerProfileError(409, 'CUSTOMER_EMAIL_EXISTS', 'This customer email is already used in this workspace.');
    }
  }

  const customer = await tx.customer.create({
    data: {
      organizationId: actor.organizationId,
      ...profile,
      currency: profile.currency.toUpperCase(),
    },
  });
  await tx.auditEvent.create({
    data: {
      organizationId: actor.organizationId,
      actorId: actor.id,
      action: options.auditAction ?? 'CUSTOMER_CREATED',
      resource: 'Customer',
      resourceId: customer.id,
      reason: options.auditReason,
      requestId: actor.requestId,
    },
  });
  if (options.temporaryPassword) {
    await provisionCustomerPortalPassword(tx, actor, customer, options.temporaryPassword);
  }
  return customer;
}
