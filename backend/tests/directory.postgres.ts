import '../src/env.js';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import {
  approveDirectoryJoinRequest,
  createDirectoryJoinRequest,
  declineDirectoryJoinRequest,
  DirectoryError,
  listDirectoryBusinesses,
  listDirectoryJoinRequests,
  resetDirectoryRateLimitsForTests,
} from '../src/directory.js';

const baseUrl = process.env.DATABASE_URL;
if (!baseUrl) throw new Error('DATABASE_URL is required for the PostgreSQL directory test.');
const schema = `directory_test_${crypto.randomBytes(8).toString('hex')}`;
if (!/^directory_test_[a-f0-9]{16}$/.test(schema)) throw new Error('Unsafe disposable schema name.');
const testUrl = new URL(baseUrl);
testUrl.searchParams.set('schema', schema);
const control = new PrismaClient({ datasources: { db: { url: baseUrl } } });
let client: PrismaClient | undefined;

async function main() {
  await control.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  const prismaCli = fileURLToPath(new URL('../node_modules/prisma/build/index.js', import.meta.url));
  execFileSync(process.execPath, [prismaCli, 'db', 'push', '--skip-generate', '--schema', 'prisma/schema.prisma'], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: testUrl.toString(), PRISMA_CLIENT_ENGINE_TYPE: 'binary' },
    stdio: 'pipe',
  });
  client = new PrismaClient({ datasources: { db: { url: testUrl.toString() } } });
  const db = client;
  resetDirectoryRateLimitsForTests();

  const organization = await db.organization.create({ data: { name: 'Visible supplier', slug: schema } });
  const hiddenOrganization = await db.organization.create({ data: { name: 'Hidden supplier', slug: `${schema}-hidden` } });
  const inactiveOrganization = await db.organization.create({ data: { name: 'Inactive supplier', slug: `${schema}-inactive`, status: 'SUSPENDED' } });
  await db.organizationProfile.createMany({ data: [
    { organizationId: organization.id, displayName: 'Visible Supplier', shortDescription: 'Commercial systems', category: 'Technology', isDiscoverable: true },
    { organizationId: hiddenOrganization.id, displayName: 'Hidden Supplier', shortDescription: 'Never public', category: 'Private', isDiscoverable: false },
    { organizationId: inactiveOrganization.id, displayName: 'Inactive Supplier', shortDescription: 'Never public', category: 'Inactive', isDiscoverable: true },
  ] });
  const directory = await listDirectoryBusinesses(db);
  assert.deepEqual(directory, { items: [{ id: organization.id, displayName: 'Visible Supplier', shortDescription: 'Commercial systems', category: 'Technology' }] });
  assert(!JSON.stringify(directory).includes('status'), 'the public directory must expose only allowlisted fields');

  const admin = await db.user.create({ data: { name: 'Admin', email: `${schema}-admin@example.invalid`, passwordHash: 'not-a-login', status: 'ACTIVE', role: 'ADMIN', organizationId: organization.id } });
  const rep = await db.user.create({ data: { name: 'Assigned Rep', email: `${schema}-rep@example.invalid`, passwordHash: 'not-a-login', status: 'ACTIVE', role: 'REP', organizationId: organization.id, moduleAccess: ['quotations'] } });
  const team = await db.salesTeam.create({ data: { organizationId: organization.id, name: 'Directory team', members: { create: { userId: rep.id } } } });
  const actor = { id: admin.id, role: 'ADMIN', organizationId: organization.id, requestId: 'directory-pg-test' };

  const requestInput = { email: `${schema}-buyer@example.invalid`, companyName: 'Directory Buyer', message: 'Please associate our company with this workspace.' };
  const submitted = await createDirectoryJoinRequest(db, organization.id, requestInput, '192.0.2.10');
  assert.equal(submitted.status, 'PENDING');
  assert.equal(await db.customer.count(), 0, 'public submission must not create a customer');
  assert.equal(await db.user.count({ where: { role: 'CUSTOMER' } }), 0, 'public submission must not create credentials');
  await assert.rejects(createDirectoryJoinRequest(db, organization.id, requestInput, '192.0.2.10'), (error:any) => error instanceof DirectoryError && error.code === 'PENDING_REQUEST_EXISTS');

  const approved = await db.$transaction((tx) => approveDirectoryJoinRequest(tx, actor, submitted.id, {
    primarySalesTeamId: team.id,
    primaryRepId: rep.id,
    collaboratorIds: [],
    customerTier: 'Gold',
    currency: 'INR',
  }));
  assert.equal(approved.request.status, 'APPROVED');
  assert.equal(approved.credentials.email, requestInput.email);
  assert.equal(approved.credentials.signInPath, '/customer/sign-in');
  const approvedRequest = await db.directoryJoinRequest.findUniqueOrThrow({ where: { id: submitted.id } });
  const customerId = approvedRequest.resultingCustomerId!;
  assert(customerId, 'approval must link the resulting customer');
  assert.equal(await db.customer.count({ where: { id: customerId, organizationId: organization.id, primarySalesTeamId: team.id } }), 1);
  assert.equal(await db.customerRepresentative.count({ where: { customerId, userId: rep.id, role: 'PRIMARY', active: true } }), 1);
  const portalUser = await db.user.findFirstOrThrow({ where: { customerId, role: 'CUSTOMER' } });
  assert(await bcrypt.compare(approved.credentials.password, portalUser.passwordHash), 'the one-time password must match only its bcrypt hash');
  assert.equal(await db.organizationMembership.count({ where: { organizationId: organization.id, userId: portalUser.id, accessRole: 'PORTAL_USER', status: 'ACTIVE' } }), 1);
  const persistedApproval = JSON.stringify({ approvedRequest, portalUser, audits: await db.auditEvent.findMany({ where: { organizationId: organization.id } }) });
  assert(!persistedApproval.includes(approved.credentials.password), 'the one-time password must not be persisted in readable form');

  // A signed-in but unassigned customer can request first. Approval reuses the
  // customer identity, assigns the seller's team, and only then creates a Lead.
  const existingCustomer = await db.customer.create({ data: { organizationId: organization.id, name: 'Existing Marketplace Buyer', email: `${schema}-existing@example.invalid`, tier: 'Bronze', currency: 'INR' } });
  const existingPortalUser = await db.user.create({ data: { organizationId: organization.id, customerId: existingCustomer.id, name: 'Existing Buyer', email: existingCustomer.email!, passwordHash: 'not-a-login', status: 'ACTIVE', role: 'CUSTOMER' } });
  await db.organizationMembership.create({ data: { organizationId: organization.id, userId: existingPortalUser.id, accessRole: 'PORTAL_USER', businessRole: 'CUSTOMER', status: 'ACTIVE' } });
  const offering = await db.product.create({ data: { organizationId: organization.id, name: 'Marketplace rollout', sku: `${schema}-marketplace`, category: 'Services', description: 'Implementation service', unit: 'Project', price: 1000, cost: 600, taxRate: 18, storeVisible: true } });
  const customerCountBeforeMarketplaceApproval = await db.customer.count();
  const marketplaceRequest = await createDirectoryJoinRequest(db, organization.id, {
    email: existingPortalUser.email,
    companyName: existingCustomer.name,
    contactName: existingPortalUser.name,
    message: 'Please prepare a quotation after assigning your sales team.',
    productId: offering.id,
    quantity: 2,
    marketplaceInterest: true,
  }, '192.0.2.13', new Date(), true);
  assert.equal(await db.portalRequest.count({ where: { customerId: existingCustomer.id } }), 0, 'the request must not enter quotation handling before assignment');
  const marketplaceApproval = await db.$transaction((tx) => approveDirectoryJoinRequest(tx, actor, marketplaceRequest.id, {
    primarySalesTeamId: team.id,
    primaryRepId: rep.id,
    collaboratorIds: [],
    customerTier: 'Gold',
    currency: 'INR',
  }));
  assert.equal(marketplaceApproval.request.resultingCustomer?.id, existingCustomer.id, 'approval must reuse the existing customer identity');
  assert.equal(await db.customer.count(), customerCountBeforeMarketplaceApproval, 'approval must not duplicate an existing customer');
  assert.equal(await db.customerRepresentative.count({ where: { customerId: existingCustomer.id, userId: rep.id, role: 'PRIMARY', active: true } }), 1);
  const routedRequest = await db.portalRequest.findFirstOrThrow({ where: { customerId: existingCustomer.id }, include: { resultingLead: true } });
  assert.equal(routedRequest.resultingLead?.assignedRepId, rep.id, 'the request must route to the representative only after assignment');

  const declineCustomerCount = await db.customer.count();
  const declineUserCount = await db.user.count();
  const declineRequest = await createDirectoryJoinRequest(db, organization.id, {
    email: `${schema}-decline@example.invalid`,
    companyName: 'Declined Buyer',
    message: 'Please review this association request.',
  }, '192.0.2.11');
  const declined = await db.$transaction((tx) => declineDirectoryJoinRequest(tx, actor, declineRequest.id, 'The supplied company details could not be verified.'));
  assert.equal(declined.status, 'DECLINED');
  assert.equal(await db.customer.count(), declineCustomerCount, 'decline must not create a customer');
  assert.equal(await db.user.count(), declineUserCount, 'decline must not create a portal identity');

  const otherAdmin = await db.user.create({ data: { name: 'Other Admin', email: `${schema}-other-admin@example.invalid`, passwordHash: 'not-a-login', status: 'ACTIVE', role: 'ADMIN', organizationId: hiddenOrganization.id } });
  await db.organizationProfile.update({ where: { organizationId: hiddenOrganization.id }, data: { isDiscoverable: true } });
  const otherRequest = await createDirectoryJoinRequest(db, hiddenOrganization.id, {
    email: `${schema}-other-buyer@example.invalid`,
    companyName: 'Other Tenant Buyer',
    message: 'This belongs only to the other tenant.',
  }, '192.0.2.12');
  await assert.rejects(
    db.$transaction((tx) => declineDirectoryJoinRequest(tx, actor, otherRequest.id, 'This actor must not see the request.')),
    (error:any) => error instanceof DirectoryError && error.code === 'NOT_FOUND',
  );
  assert.equal((await db.directoryJoinRequest.findUniqueOrThrow({ where: { id: otherRequest.id } })).status, 'PENDING');
  assert(otherAdmin.id, 'the other tenant fixture must remain valid');

  for (let attempt = 0; attempt < 2; attempt += 1) {
    execFileSync(process.execPath, ['--import', 'tsx', 'prisma/seed.ts'], {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: testUrl.toString(), PRISMA_CLIENT_ENGINE_TYPE: 'binary' },
      stdio: 'pipe',
    });
  }
  const seededDirectory = await listDirectoryBusinesses(db);
  assert.deepEqual(seededDirectory.items.map((item) => item.displayName), ['DealOS Demo Commerce', 'Northstar Distribution']);
  assert(seededDirectory.items.every((item) => Object.keys(item).sort().join(',') === 'category,displayName,id,shortDescription'), 'seeded public profiles must retain the exact allowlist');
  const seededAdmin = await db.user.findUniqueOrThrow({ where: { email: 'admin@dealos.demo' } });
  const seededActor = { id: seededAdmin.id, role: 'ADMIN', organizationId: seededAdmin.organizationId!, requestId: 'directory-seed-test' };
  const [pendingSeed, approvedSeed, declinedSeed] = await Promise.all([
    listDirectoryJoinRequests(db, seededActor, 'PENDING'),
    listDirectoryJoinRequests(db, seededActor, 'APPROVED'),
    listDirectoryJoinRequests(db, seededActor, 'DECLINED'),
  ]);
  assert.equal(pendingSeed.items.length, 1);
  assert.equal(pendingSeed.items[0]?.companyName, 'Atlas Field Operations');
  assert.equal(pendingSeed.items[0]?.decidedAt, null);
  assert.equal(pendingSeed.items[0]?.resultingCustomer, null);
  assert.equal(approvedSeed.items.length, 1);
  assert.equal(approvedSeed.items[0]?.companyName, 'Lumen Offices');
  assert.equal(approvedSeed.items[0]?.resultingCustomer?.name, 'Lumen Offices');
  const seededPortalUser = await db.user.findFirstOrThrow({ where: { customerId: approvedSeed.items[0]!.resultingCustomer!.id, role: 'CUSTOMER' }, include: { memberships: true } });
  assert(await bcrypt.compare('DealOS2026!', seededPortalUser.passwordHash));
  assert(seededPortalUser.memberships.some((membership) => membership.organizationId === seededActor.organizationId && membership.accessRole === 'PORTAL_USER' && membership.status === 'ACTIVE'));
  assert.equal(await db.customerRepresentative.count({ where: { customerId: approvedSeed.items[0]!.resultingCustomer!.id, role: 'PRIMARY', active: true } }), 1);
  assert.equal(declinedSeed.items.length, 1);
  assert.equal(declinedSeed.items[0]?.companyName, 'Stonebridge Procurement');
  assert.match(declinedSeed.items[0]?.decisionReason ?? '', /could not be verified/i);
  assert.equal(declinedSeed.items[0]?.resultingCustomer, null);
  assert.equal(await db.customer.count({ where: { email: 'join@stonebridge.demo' } }), 0);
  assert.equal(await db.auditEvent.count({ where: { resource: 'DirectoryJoinRequest', action: { in: ['DIRECTORY_JOIN_REQUEST_APPROVED', 'DIRECTORY_JOIN_REQUEST_DECLINED'] } } }), 2);
  const northstarAdmin = await db.user.findUniqueOrThrow({ where: { email: 'orgadmin@northstar.demo' } });
  const northstarRequests = await listDirectoryJoinRequests(db, { id: northstarAdmin.id, role: 'ADMIN', organizationId: northstarAdmin.organizationId!, requestId: 'directory-seed-tenant-test' });
  assert.equal(northstarRequests.items.length, 0, 'seeded request inboxes must remain tenant-isolated');

  console.log(JSON.stringify({ passed: 43, schema, checks: ['public allowlist', 'discoverability', 'inactive organization filtering', 'submit-only request', 'duplicate pending', 'atomic approval', 'shared assignment', 'portal membership', 'hashed one-time credential', 'request-before-assignment', 'existing customer reuse', 'post-assignment lead routing', 'decline isolation', 'cross-tenant isolation', 'repeatable seed reset', 'seeded public profiles', 'seeded pending case', 'seeded approved case', 'seeded customer login and assignment', 'seeded declined case', 'seeded decision audit', 'seeded tenant isolation'] }));
}

try {
  await main();
} finally {
  if (client) await client.$disconnect();
  await control.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await control.$disconnect();
}
