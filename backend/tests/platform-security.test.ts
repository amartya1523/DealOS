import { describe, expect, it, vi } from 'vitest';
import { canAccessOrganization, requirePlatformSuperAdmin, requireRole, selectActiveMembership } from '../src/authorization.js';
import { buildPrivilegedAuditData } from '../src/platform.js';
import { platformOwnerCredentialsMatch, readPlatformOwnerCredentials } from '../src/platform-owner.js';

function responseRecorder() {
  const result: { status?: number; body?: unknown } = {};
  const response = {
    status(code: number) { result.status = code; return this; },
    json(body: unknown) { result.body = body; return this; },
  };
  return { result, response };
}

describe('dedicated Platform Owner authorization boundary', () => {
  it('allows the independent Platform Owner actor to inspect any organization', () => {
    expect(canAccessOrganization({ actorType: 'PLATFORM_OWNER', membershipOrganizationIds: [] }, 'organization-b')).toBe(true);
  });

  it('keeps an Organization Admin inside assigned organizations', () => {
    const actor = { actorType: 'USER' as const, membershipOrganizationIds: ['organization-a'] };
    expect(canAccessOrganization(actor, 'organization-a')).toBe(true);
    expect(canAccessOrganization(actor, 'organization-b')).toBe(false);
  });

  it('accepts the configured owner credentials and rejects organization credentials', () => {
    const expected = { loginId: 'platform-owner', password: 'OwnerPassword-Long-2026!' };
    expect(platformOwnerCredentialsMatch(expected, expected)).toBe(true);
    expect(platformOwnerCredentialsMatch({ loginId: 'admin@organization.test', password: 'OrganizationPassword!' }, expected)).toBe(false);
  });

  it('requires a strong complete environment configuration', () => {
    expect(readPlatformOwnerCredentials({ PLATFORM_OWNER_LOGIN_ID: 'owner', PLATFORM_OWNER_PASSWORD: 'LongEnoughPassword!' })).toEqual({ loginId: 'owner', password: 'LongEnoughPassword!' });
    expect(readPlatformOwnerCredentials({ PLATFORM_OWNER_LOGIN_ID: 'owner', PLATFORM_OWNER_PASSWORD: 'short' })).toBeNull();
    expect(readPlatformOwnerCredentials({})).toBeNull();
  });

  it('admits only a Platform Owner session through the platform middleware', () => {
    const { response } = responseRecorder();
    const next = vi.fn();
    requirePlatformSuperAdmin({ auth: { actorType: 'PLATFORM_OWNER', platformSuperAdmin: true } } as never, response as never, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it.each(['REP', 'CUSTOMER'])('denies %s organization identities at the platform middleware', (role) => {
    const { result, response } = responseRecorder();
    const next = vi.fn();
    requirePlatformSuperAdmin({ auth: { actorType: 'USER', platformSuperAdmin: false }, user: { role } } as never, response as never, next);
    expect(next).not.toHaveBeenCalled();
    expect(result.status).toBe(403);
    expect(result.body).toMatchObject({ error: { code: 'PLATFORM_OWNER_REQUIRED' } });
  });

  it('does not let an Organization Admin reach the owner control boundary', () => {
    const { result, response } = responseRecorder();
    const next = vi.fn();
    requirePlatformSuperAdmin({ auth: { actorType: 'USER', platformSuperAdmin: false }, user: { role: 'ADMIN' } } as never, response as never, next);
    expect(next).not.toHaveBeenCalled();
    expect(result.body).toMatchObject({ error: { code: 'PLATFORM_OWNER_REQUIRED' } });
  });

  it('rejects a manipulated organization identifier without a matching membership', () => {
    const memberships = [{ organizationId: 'organization-a', status: 'ACTIVE', organization: { status: 'ACTIVE' } }];
    expect(selectActiveMembership(memberships as never, 'organization-b')).toBeNull();
  });

  it('prefers an operational organization over a suspended default membership', () => {
    const memberships = [
      { organizationId: 'suspended', status: 'ACTIVE', organization: { status: 'SUSPENDED' } },
      { organizationId: 'operational', status: 'ACTIVE', organization: { status: 'ACTIVE' } },
    ];
    expect(selectActiveMembership(memberships as never, null)).toMatchObject({ organizationId: 'operational' });
  });

  it('rejects writes while the Platform Owner is viewing an organization', () => {
    const { result, response } = responseRecorder();
    const next = vi.fn();
    requireRole('ADMIN')({ method: 'PATCH', auth: { actorType: 'PLATFORM_OWNER', organization: { status: 'ACTIVE' }, platformSuperAdmin: true, readOnlyView: true, effectiveUser: { role: 'ADMIN' } } } as never, response as never, next);
    expect(next).not.toHaveBeenCalled();
    expect(result.body).toMatchObject({ error: { code: 'VIEW_AS_READ_ONLY' } });
  });

  it('blocks organization users when their organization is suspended', () => {
    const { result, response } = responseRecorder();
    const next = vi.fn();
    requireRole('ADMIN')({ method: 'GET', auth: { actorType: 'USER', organization: { status: 'SUSPENDED' }, platformSuperAdmin: false, readOnlyView: false, effectiveUser: { role: 'ADMIN' } } } as never, response as never, next);
    expect(next).not.toHaveBeenCalled();
    expect(result.status).toBe(423);
  });

  it('blocks archived organizations while retaining their identity', () => {
    const { result, response } = responseRecorder();
    const next = vi.fn();
    const organization = { id: 'organization-a', status: 'ARCHIVED' };
    requireRole('ADMIN')({ method: 'GET', auth: { actorType: 'USER', organization, platformSuperAdmin: false, readOnlyView: false, effectiveUser: { role: 'ADMIN' } } } as never, response as never, next);
    expect(next).not.toHaveBeenCalled();
    expect(result.status).toBe(423);
    expect(organization.id).toBe('organization-a');
  });

  it('audits the environment identity as actor without a user foreign key', () => {
    const event = buildPrivilegedAuditData({
      requestId: 'request-1', ip: '127.0.0.1', get: (name: string) => name === 'user-agent' ? 'vitest' : undefined,
      auth: { actorType: 'PLATFORM_OWNER', platformActorId: 'platform-owner', realUser: { id: 'synthetic-owner' }, simulatedUserId: 'simulated-user', organization: { id: 'organization-a' } },
    } as never, { action: 'ORGANIZATION_SUSPENDED', affectedModel: 'Organization', recordId: 'organization-a', beforeValues: { status: 'ACTIVE' }, afterValues: { status: 'SUSPENDED' }, reason: 'Security test suspension.' });
    expect(event).toMatchObject({ actorId: null, platformActorId: 'platform-owner', simulatedUserId: 'simulated-user', organizationId: 'organization-a', requestId: 'request-1', result: 'SUCCESS' });
    expect(JSON.stringify(event)).not.toMatch(/password|token|cookie/i);
  });
});
