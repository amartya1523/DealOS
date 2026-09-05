import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { User } from '@prisma/client';
import { OAuth2Client } from 'google-auth-library';
import { z } from 'zod';
import { db } from './db.js';

const googleClient = new OAuth2Client();

export const signupSchema = z.object({
  organizationName: z.string().trim().min(2).max(120),
  displayName: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(254).transform(value => value.toLowerCase()),
  password: z.string().min(12).max(128),
}).strict();

export const googleSignupSchema = z.object({
  credential: z.string().trim().min(1).max(8192),
  organizationName: z.string().trim().min(2).max(120),
}).strict();

export type GoogleSignupProfile = {
  subject: string;
  displayName: string;
  email: string;
};

const organizationSlug = (name: string) => `${name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'organization'}-${crypto.randomBytes(4).toString('hex')}`;

async function createAdminOrganization(input: { organizationName: string; displayName: string; email: string; passwordHash: string; googleSubject?: string }) {
  return db.$transaction(async (tx) => {
    const organization = await tx.organization.create({ data: { name: input.organizationName, slug: organizationSlug(input.organizationName) } });
    const user = await tx.user.create({ data: {
      organizationId: organization.id,
      email: input.email,
      name: input.displayName,
      passwordHash: input.passwordHash,
      googleSubject: input.googleSubject,
      status: 'ACTIVE',
      role: 'ADMIN',
      moduleAccess: [],
    } });
    await tx.organizationMembership.create({ data: { organizationId: organization.id, userId: user.id, accessRole: 'ORGANIZATION_ADMIN', businessRole: 'ADMIN' } });
    return { ...organization, users: [user] };
  });
}

export async function createOrganizationAdmin(input: z.infer<typeof signupSchema>) {
  const passwordHash = await bcrypt.hash(input.password, 12);
  const existing = await db.user.findUnique({ where: { email: input.email } });
  if (existing) return null;
  return createAdminOrganization({ organizationName: input.organizationName, displayName: input.displayName, email: input.email, passwordHash });
}

export async function verifyGoogleSignupCredential(credential: string, clientIds: string | string[]): Promise<GoogleSignupProfile> {
  const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: clientIds });
  const payload = ticket.getPayload();
  if (!payload?.sub || !payload.email || payload.email_verified !== true) {
    throw new Error('Google did not return a verified email address.');
  }
  return {
    subject: payload.sub,
    displayName: payload.name?.trim() || payload.email.split('@')[0]!,
    email: payload.email.trim().toLowerCase(),
  };
}

export async function createGoogleOrganizationAdmin(profile: GoogleSignupProfile, organizationName: string) {
  const existing = await db.user.findUnique({ where: { email: profile.email } });
  if (existing) return null;
  const passwordHash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 12);
  return createAdminOrganization({ organizationName, displayName: profile.displayName, email: profile.email, passwordHash, googleSubject: profile.subject });
}

export async function findOrLinkGoogleLoginUser(profile: GoogleSignupProfile): Promise<User | null> {
  const linkedUser = await db.user.findUnique({ where: { googleSubject: profile.subject } });
  if (linkedUser) return linkedUser.organizationId && linkedUser.status === 'ACTIVE' ? linkedUser : null;

  const emailUser = await db.user.findUnique({ where: { email: profile.email } });
  if (!emailUser?.organizationId || emailUser.status !== 'ACTIVE' || emailUser.googleSubject) return null;

  try {
    return await db.user.update({ where: { id: emailUser.id }, data: { googleSubject: profile.subject } });
  } catch {
    const concurrentlyLinkedUser = await db.user.findUnique({ where: { googleSubject: profile.subject } });
    return concurrentlyLinkedUser?.organizationId && concurrentlyLinkedUser.status === 'ACTIVE' ? concurrentlyLinkedUser : null;
  }
}

export async function acceptCustomerGoogleInvitation(profile: GoogleSignupProfile): Promise<User | null> {
  const linkedUser = await db.user.findUnique({ where: { googleSubject: profile.subject } });
  if (linkedUser) return linkedUser.role === 'CUSTOMER' && linkedUser.organizationId && linkedUser.customerId && linkedUser.status === 'ACTIVE' ? linkedUser : null;

  const invitation = await db.organizationInvitation.findFirst({
    where: { email: profile.email, status: 'PENDING', customerId: { not: null }, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
  });
  const emailUser = await db.user.findUnique({ where: { email: profile.email } });
  if (emailUser?.googleSubject && emailUser.googleSubject !== profile.subject) return null;

  // A sent quotation or an issued invoice is itself evidence that this email was
  // granted customer-portal access. This also recovers access when an invitation
  // expired or was never accepted, without exposing unshared draft quotations.
  const eligibleCustomers = invitation ? [] : await db.customer.findMany({
    where: {
      email: { equals: profile.email, mode: 'insensitive' },
      active: true,
      OR: [
        { quotes: { some: { sentAt: { not: null } } } },
        { invoices: { some: {} } },
      ],
    },
    select: { id: true, organizationId: true },
    take: 2,
  });
  const documentCustomer = eligibleCustomers.length === 1 ? eligibleCustomers[0]! : null;
  const organizationId = invitation?.organizationId ?? documentCustomer?.organizationId;
  const customerId = invitation?.customerId ?? documentCustomer?.id;
  if (!organizationId || !customerId) return null;
  if (emailUser && (emailUser.role !== 'CUSTOMER' || emailUser.organizationId !== organizationId || emailUser.customerId !== customerId)) return null;

  const passwordHash = emailUser ? undefined : await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 12);
  return db.$transaction(async (tx) => {
    const user = emailUser
      ? await tx.user.update({ where: { id: emailUser.id }, data: { googleSubject: profile.subject, status: 'ACTIVE', name: profile.displayName } })
      : await tx.user.create({ data: { organizationId, customerId, email: profile.email, name: profile.displayName, passwordHash: passwordHash!, googleSubject: profile.subject, status: 'ACTIVE', role: 'CUSTOMER', moduleAccess: [] } });
    await tx.organizationMembership.upsert({
      where: { organizationId_userId: { organizationId, userId: user.id } },
      update: { accessRole: 'PORTAL_USER', businessRole: 'CUSTOMER', status: 'ACTIVE' },
      create: { organizationId, userId: user.id, accessRole: 'PORTAL_USER', businessRole: 'CUSTOMER', status: 'ACTIVE' },
    });
    await tx.organizationInvitation.updateMany({ where: { email: profile.email, organizationId, customerId, status: 'PENDING' }, data: { status: 'ACCEPTED' } });
    return user;
  });
}
