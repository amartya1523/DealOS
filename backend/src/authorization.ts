import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { Organization, OrganizationMembership, Role, User } from '@prisma/client';
import { db } from './db.js';

export type SafeUser = Pick<User, 'id' | 'name' | 'email' | 'role' | 'customerId'>;
export type ActorType = 'USER' | 'PLATFORM_OWNER';

export type AuthorizationContext = {
  sessionId: string;
  actorType: ActorType;
  realUser: SafeUser;
  effectiveUser: SafeUser;
  organization: Organization | null;
  membership: OrganizationMembership | null;
  platformSuperAdmin: boolean;
  platformActorId: string | null;
  readOnlyView: boolean;
  simulatedUserId: string | null;
};

export type AuthRequest = Request & {
  auth?: AuthorizationContext;
  user?: SafeUser & { platformSuperAdmin: boolean };
  requestId?: string;
};

type SelectableMembership = Pick<OrganizationMembership, 'organizationId' | 'status'> & { organization: Pick<Organization, 'status'> };

export const userSessionCookieName = process.env.SESSION_COOKIE_NAME ?? 'dealos_session';
export const platformSessionCookieName = process.env.PLATFORM_OWNER_SESSION_COOKIE_NAME ?? 'dealos_platform_session';
export const csrfCookieName = 'dealos_csrf';
const allowedOrigin = process.env.FRONTEND_ORIGIN ?? 'http://localhost:5173';
export const hashToken = (token: string) => crypto.createHash('sha256').update(token).digest('hex');
export const parseCookies = (header = '') => Object.fromEntries(header.split(';').map((part) => part.trim().split('=').map(decodeURIComponent)).filter(([key]) => key));
const deny = (res: Response, status: number, code: string, message: string) => res.status(status).json({ success: false, error: { code, message } });

export function requestIdentity(req: AuthRequest, _res: Response, next: NextFunction) {
  req.requestId = crypto.randomUUID();
  next();
}

async function enforceCsrf(req: AuthRequest, res: Response, session: { csrfHash: string | null }, persistHash: (hash: string) => Promise<unknown>) {
  const cookies = parseCookies(req.headers.cookie);
  const safeMethod = ['GET', 'HEAD', 'OPTIONS'].includes(req.method);
  let csrfToken = cookies[csrfCookieName];
  if (safeMethod && (!csrfToken || !session.csrfHash || hashToken(csrfToken) !== session.csrfHash)) {
    csrfToken = crypto.randomBytes(32).toString('hex');
    await persistHash(hashToken(csrfToken));
    res.append('Set-Cookie', `${csrfCookieName}=${encodeURIComponent(csrfToken)}; SameSite=Strict; Path=/; Max-Age=14400${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`);
  }
  if (!safeMethod) {
    const headerToken = req.get('x-csrf-token');
    const requestOrigin = req.get('origin');
    if (!requestOrigin || requestOrigin !== allowedOrigin) return deny(res, 403, 'ORIGIN_DENIED', 'The request origin is not allowed.');
    if (!headerToken || !session.csrfHash || hashToken(headerToken) !== session.csrfHash || headerToken !== csrfToken) return deny(res, 403, 'CSRF_INVALID', 'Refresh the page and try again.');
  }
  return null;
}

function platformOwnerIdentity(loginId: string): SafeUser {
  return { id: `platform-owner:${hashToken(loginId).slice(0, 16)}`, name: 'Platform Owner', email: loginId, role: 'ADMIN', customerId: null };
}

export async function authenticate(req: AuthRequest, res: Response, next: NextFunction) {
  const cookies = parseCookies(req.headers.cookie);
  const platformToken = cookies[platformSessionCookieName];
  if (platformToken) {
    const session = await db.platformOwnerSession.findUnique({ where: { tokenHash: hashToken(platformToken) } });
    if (!session || session.expiresAt < new Date()) return deny(res, 401, 'PLATFORM_AUTH_REQUIRED', 'Sign in through the Platform Owner portal.');
    const csrfFailure = await enforceCsrf(req, res, session, (csrfHash) => db.platformOwnerSession.update({ where: { id: session.id }, data: { csrfHash } }));
    if (csrfFailure) return csrfFailure;

    const realUser = platformOwnerIdentity(session.loginId);
    let organization: Organization | null = null;
    let membership: OrganizationMembership | null = null;
    let effectiveUser = realUser;
    let simulatedUserId: string | null = null;
    if (session.viewAsOrganizationId) {
      organization = await db.organization.findUnique({ where: { id: session.viewAsOrganizationId } });
      if (!organization) return deny(res, 409, 'VIEW_CONTEXT_INVALID', 'The simulated organization no longer exists. Exit View As mode.');
      if (session.viewAsUserId) {
        const simulatedMembership = await db.organizationMembership.findFirst({ where: { organizationId: organization.id, userId: session.viewAsUserId, status: 'ACTIVE' }, include: { user: true } });
        if (!simulatedMembership || simulatedMembership.user.status !== 'ACTIVE') return deny(res, 409, 'VIEW_CONTEXT_INVALID', 'The simulated user is no longer active in this organization. Exit View As mode.');
        membership = simulatedMembership;
        effectiveUser = { ...simulatedMembership.user, role: simulatedMembership.businessRole };
        simulatedUserId = simulatedMembership.userId;
      }
    }
    req.auth = { sessionId: session.id, actorType: 'PLATFORM_OWNER', realUser, effectiveUser, organization, membership, platformSuperAdmin: true, platformActorId: session.loginId, readOnlyView: Boolean(session.viewAsOrganizationId), simulatedUserId };
    req.user = { ...effectiveUser, platformSuperAdmin: true };
    return next();
  }

  const token = cookies[userSessionCookieName];
  if (!token) return deny(res, 401, 'AUTH_REQUIRED', 'Please sign in to continue.');
  const session = await db.session.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: { include: { memberships: { include: { organization: true }, orderBy: { createdAt: 'asc' } } } } } });
  if (!session || session.user.status !== 'ACTIVE' || session.expiresAt < new Date()) return deny(res, 401, 'AUTH_REQUIRED', 'Your session has expired.');
  const csrfFailure = await enforceCsrf(req, res, session, (csrfHash) => db.session.update({ where: { id: session.id }, data: { csrfHash } }));
  if (csrfFailure) return csrfFailure;

  const requestedOrganizationId = typeof req.headers['x-organization-id'] === 'string' ? req.headers['x-organization-id'] : null;
  const membership = selectActiveMembership(session.user.memberships, requestedOrganizationId);
  if (requestedOrganizationId && !membership) return deny(res, 403, 'ORGANIZATION_ACCESS_DENIED', 'You are not a member of this organization.');
  const organization = membership?.organization ?? null;
  const realUser: SafeUser = session.user;
  const effectiveUser = membership ? { ...realUser, role: membership.businessRole } : realUser;
  req.auth = { sessionId: session.id, actorType: 'USER', realUser, effectiveUser, organization, membership, platformSuperAdmin: false, platformActorId: null, readOnlyView: false, simulatedUserId: null };
  req.user = { ...effectiveUser, platformSuperAdmin: false };
  return next();
}

export function requirePlatformSuperAdmin(req: AuthRequest, res: Response, next: NextFunction) {
  if (req.auth?.actorType !== 'PLATFORM_OWNER' || !req.auth.platformSuperAdmin) return deny(res, 403, 'PLATFORM_OWNER_REQUIRED', 'Platform Owner authentication is required.');
  next();
}

export const requireRole = (...roles: Role[]) => (req: AuthRequest, res: Response, next: NextFunction) => {
  if (!req.auth?.organization) return deny(res, 409, 'ORGANIZATION_CONTEXT_REQUIRED', 'Choose an organization before accessing business operations.');
  if (req.auth.organization.status !== 'ACTIVE' && req.auth.actorType !== 'PLATFORM_OWNER') return deny(res, 423, 'ORGANIZATION_SUSPENDED', 'This organization is suspended. Business operations are unavailable.');
  if (req.auth.readOnlyView && req.method !== 'GET') return deny(res, 403, 'VIEW_AS_READ_ONLY', 'View As mode is read-only. Exit the simulated context to make changes.');
  if (!roles.includes(req.auth.effectiveUser.role)) return deny(res, 403, 'FORBIDDEN', 'You do not have permission to perform this action.');
  next();
};

export function requireWorkspace(req: AuthRequest, res: Response, next: NextFunction) {
  if (req.auth?.actorType === 'PLATFORM_OWNER' && !req.auth.organization) return next();
  if (!req.auth?.organization) return deny(res, 403, 'ORGANIZATION_ACCESS_DENIED', 'No active organization membership is available.');
  if (req.auth.organization.status !== 'ACTIVE' && req.auth.actorType !== 'PLATFORM_OWNER') return deny(res, 423, 'ORGANIZATION_SUSPENDED', 'This organization is suspended. Business operations are unavailable.');
  next();
}

export function organizationId(req: AuthRequest) {
  return req.auth?.organization?.id ?? null;
}

export function identityDto(req: AuthRequest) {
  const auth = req.auth!;
  return {
    id: auth.effectiveUser.id,
    realUserId: auth.realUser.id,
    actorType: auth.actorType,
    name: auth.effectiveUser.name,
    email: auth.effectiveUser.email,
    role: auth.effectiveUser.role,
    customerId: auth.effectiveUser.customerId,
    platformSuperAdmin: auth.actorType === 'PLATFORM_OWNER',
    organization: auth.organization ? { id: auth.organization.id, name: auth.organization.name, status: auth.organization.status } : null,
    viewContext: auth.readOnlyView ? { readOnly: true, organizationId: auth.organization?.id, organizationName: auth.organization?.name, simulatedUserId: auth.simulatedUserId, realActor: { id: auth.realUser.id, name: auth.realUser.name } } : null,
  };
}

export function canAccessOrganization(input: { actorType: ActorType; membershipOrganizationIds: string[] }, organizationIdToAccess: string) {
  return input.actorType === 'PLATFORM_OWNER' || input.membershipOrganizationIds.includes(organizationIdToAccess);
}

export function selectActiveMembership<T extends SelectableMembership>(memberships: T[], requestedOrganizationId: string | null): T | null {
  if (requestedOrganizationId) return memberships.find((item) => item.status === 'ACTIVE' && item.organizationId === requestedOrganizationId) ?? null;
  return memberships.find((item) => item.status === 'ACTIVE' && item.organization.status === 'ACTIVE') ?? memberships.find((item) => item.status === 'ACTIVE') ?? null;
}
