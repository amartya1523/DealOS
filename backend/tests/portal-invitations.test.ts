import { describe, expect, it } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { acceptPortalInvitation, assertCustomerCreationPortalAccess, inspectPortalInvitation, issuePortalInvitation, portalInvitationTokenHash, provisionCustomerPortalPassword, revokePortalInvitation } from '../src/portal-invitations.js';

const token = 'a'.repeat(64);
const now = new Date('2026-09-05T12:00:00.000Z');
const customerId = '11111111-1111-4111-8111-111111111111';
const actor = { id: '22222222-2222-4222-8222-222222222222', role: 'ADMIN', organizationId: 'org-1', requestId: 'request-1' };

describe('customer portal invitations', () => {
  it('allows only an Admin to provision required customer credentials during creation', () => {
    expect(assertCustomerCreationPortalAccess('ADMIN', 'buyer@example.com', 'SecurePassword12!')).toBe(true);
    expect(() => assertCustomerCreationPortalAccess('ADMIN', 'buyer@example.com', undefined)).toThrow(expect.objectContaining({ code: 'TEMPORARY_PASSWORD_REQUIRED' }));
    expect(() => assertCustomerCreationPortalAccess('ADMIN', null, 'SecurePassword12!')).toThrow(expect.objectContaining({ code: 'CUSTOMER_EMAIL_REQUIRED' }));
    expect(() => assertCustomerCreationPortalAccess('MANAGER', 'buyer@example.com', 'SecurePassword12!')).toThrow(expect.objectContaining({ status: 403, code: 'FORBIDDEN' }));
    expect(assertCustomerCreationPortalAccess('MANAGER', null, undefined)).toBe(false);
  });

  it('hashes an Admin-created temporary password and activates the customer identity', async () => {
    const { db, state } = fakeDb();
    const customer = { id: customerId, name: 'Acme Buyer', contactPerson: 'Buyer Person', email: ' Buyer@Example.com ' };
    const user = await (db as any).$transaction((tx: any) => provisionCustomerPortalPassword(tx, actor, customer, 'SecurePassword12!'));
    const bcrypt = await import('bcryptjs');
    expect(user).toMatchObject({ organizationId: 'org-1', customerId, email: 'buyer@example.com', role: 'CUSTOMER', status: 'ACTIVE' });
    expect(state.createdUser?.passwordHash).not.toBe('SecurePassword12!');
    expect(await bcrypt.compare('SecurePassword12!', String(state.createdUser?.passwordHash))).toBe(true);
    expect(state.audits).toContainEqual(expect.objectContaining({ action: 'CUSTOMER_PORTAL_PASSWORD_CREATED', resource: 'Customer', resourceId: customerId }));
  });

  it('requires an active primary representative before issuing a link', async () => {
    const { db } = fakeDb({ assigned: false });
    await expect(issuePortalInvitation(db, actor, customerId, 'http://localhost:5173', now)).rejects.toMatchObject({ status: 422, code: 'CONFIGURATION_REQUIRED' });
  });

  it('rejects a cross-organization customer lookup without creating an invitation', async () => {
    const { db, state } = fakeDb({ crossOrganization: true });
    await expect(issuePortalInvitation(db, actor, customerId, 'http://localhost:5173', now)).rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' });
    expect(state.createdInvitation).toBeNull();
  });

  it('returns the raw manual-share link once while storing only its hash', async () => {
    const { db, state } = fakeDb();
    const result = await issuePortalInvitation(db, actor, customerId, 'http://localhost:5173', now);
    const rawToken = result.invitationLink.split('/').at(-1)!;
    expect(result.invitationLink).toMatch(/^http:\/\/localhost:5173\/customer\/invitations\//);
    expect(state.createdInvitation?.tokenHash).toBe(portalInvitationTokenHash(rawToken));
    expect(state.createdInvitation?.tokenHash).not.toBe(rawToken);
    expect(state.audits).toContainEqual(expect.objectContaining({ action: 'CUSTOMER_PORTAL_INVITATION_CREATED' }));
  });

  it('rate limits repeated invitation creation per customer', async () => {
    const { db } = fakeDb({ recentCount: 5 });
    await expect(issuePortalInvitation(db, actor, customerId, 'http://localhost:5173', now)).rejects.toMatchObject({ status: 429, code: 'RATE_LIMITED', retryAfter: 3600 });
  });

  it('accepts a token once and links the portal user only to customerId', async () => {
    const { db, state } = fakeDb({ invitationToken: token });
    const user = await acceptPortalInvitation(db, token, { displayName: 'Customer User', password: 'SecurePassword12!' }, 'accept-request', now);
    expect(user).toMatchObject({ role: 'CUSTOMER', customerId });
    expect(state.createdUser).toMatchObject({ organizationId: 'org-1', customerId, role: 'CUSTOMER' });
    expect(state.createdUser).not.toHaveProperty('repId');
    expect(state.invitation.status).toBe('ACCEPTED');
    expect(state.invitation.acceptedAt).toEqual(now);
    await expect(acceptPortalInvitation(db, token, { displayName: 'Customer User', password: 'SecurePassword12!' }, 'retry', now)).rejects.toMatchObject({ status: 410, code: 'INVITATION_UNAVAILABLE' });
  });

  it('rejects expired and revoked tokens with the same non-leaking error', async () => {
    const expired = fakeDb({ invitationToken: token, expiresAt: new Date('2026-09-05T11:59:59.000Z') });
    const revoked = fakeDb({ invitationToken: token, status: 'REVOKED' });
    await expect(inspectPortalInvitation(expired.db, token, now)).rejects.toMatchObject({ status: 410, code: 'INVITATION_UNAVAILABLE', message: 'This invitation is invalid, expired, or no longer available.' });
    await expect(inspectPortalInvitation(revoked.db, token, now)).rejects.toMatchObject({ status: 410, code: 'INVITATION_UNAVAILABLE', message: 'This invitation is invalid, expired, or no longer available.' });
    expect(expired.state.invitation.status).toBe('EXPIRED');
  });

  it('revokes only an invitation belonging to the actor organization and customer', async () => {
    const { db, state } = fakeDb({ invitationToken: token });
    await revokePortalInvitation(db, actor, customerId, state.invitation.id, now);
    expect(state.invitation).toMatchObject({ status: 'REVOKED', revokedAt: now });
    const other = fakeDb({ invitationToken: token, crossOrganizationInvitation: true });
    await expect(revokePortalInvitation(other.db, actor, customerId, other.state.invitation.id, now)).rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' });
  });
});

type FakeOptions = {
  assigned?: boolean;
  crossOrganization?: boolean;
  crossOrganizationInvitation?: boolean;
  invitationToken?: string;
  expiresAt?: Date;
  status?: 'PENDING'|'ACCEPTED'|'EXPIRED'|'REVOKED';
  recentCount?: number;
};

function fakeDb(options: FakeOptions = {}) {
  const invitationToken = options.invitationToken ?? token;
  const invitation = {
    id: '33333333-3333-4333-8333-333333333333',
    organizationId: options.crossOrganizationInvitation ? 'org-2' : 'org-1',
    customerId,
    email: 'buyer@example.com',
    status: options.status ?? 'PENDING',
    tokenHash: portalInvitationTokenHash(invitationToken),
    accessRole: 'PORTAL_USER',
    businessRole: 'CUSTOMER',
    invitedById: actor.id,
    platformActorId: null,
    expiresAt: options.expiresAt ?? new Date('2026-09-12T12:00:00.000Z'),
    acceptedAt: null as Date|null,
    revokedAt: null as Date|null,
    createdAt: now,
    customer: { id: customerId, name: 'Acme Buyer', active: true, primarySalesTeam: { managerId: actor.id } },
  };
  const state = {
    invitation,
    createdInvitation: null as Record<string, unknown>|null,
    createdUser: null as Record<string, unknown>|null,
    audits: [] as Array<Record<string, unknown>>,
  };
  const organizationInvitation = {
    count: async () => options.recentCount ?? 0,
    findUnique: async ({ where }: any) => where.tokenHash === invitation.tokenHash ? invitation : null,
    findFirst: async ({ where }: any) => !options.crossOrganizationInvitation && where.id === invitation.id && where.customerId === customerId && where.organizationId === actor.organizationId ? invitation : null,
    create: async ({ data }: any) => {
      const created = { id: invitation.id, ...data, status: 'PENDING', acceptedAt: null, revokedAt: null, createdAt: now };
      state.createdInvitation = data;
      Object.assign(invitation, created);
      return created;
    },
    updateMany: async ({ where, data }: any) => {
      if (where.id && where.id !== invitation.id) return { count: 0 };
      if (where.status && invitation.status !== where.status) return { count: 0 };
      if (where.expiresAt?.gt && invitation.expiresAt <= where.expiresAt.gt) return { count: 0 };
      if (where.expiresAt?.lte && invitation.expiresAt > where.expiresAt.lte) return { count: 0 };
      Object.assign(invitation, data);
      return { count: 1 };
    },
    update: async ({ data }: any) => { Object.assign(invitation, data); return invitation; },
  };
  const tx = {
    organizationInvitation,
    user: {
      findUnique: async () => null,
      create: async ({ data }: any) => {
        state.createdUser = data;
        return { id: '44444444-4444-4444-8444-444444444444', ...data };
      },
      update: async ({ data }: any) => ({ id: '44444444-4444-4444-8444-444444444444', organizationId: 'org-1', customerId, email: invitation.email, role: 'CUSTOMER', ...data }),
    },
    organizationMembership: { upsert: async () => ({}) },
    session: { deleteMany: async () => ({ count: 0 }) },
    auditEvent: { create: async ({ data }: any) => { state.audits.push(data); return data; } },
  };
  const customer = {
    id: customerId,
    organizationId: 'org-1',
    name: 'Acme Buyer',
    email: invitation.email,
    active: true,
    primarySalesTeamId: options.assigned === false ? null : 'team-1',
    primarySalesTeam: options.assigned === false ? null : { id: 'team-1', managerId: actor.id },
    assignments: options.assigned === false ? [] : [{ id: 'assignment-1' }],
  };
  const db = {
    customer: { findFirst: async () => options.crossOrganization ? null : customer },
    user: { findFirst: async () => null, findUnique: async () => null },
    organizationInvitation,
    $transaction: async (callback: (client: typeof tx) => unknown) => callback(tx),
  } as unknown as PrismaClient;
  return { db, state };
}
