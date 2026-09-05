import '../src/env.js';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import {
  convertLead,
  dismissLead,
  dismissLeadSchema,
  getLead,
  listLeads,
  listPortalRequests,
  PortalRequestError,
  PORTAL_REQUESTS_PER_HOUR,
  submitPortalRequest,
  updateRfqHandlingMode,
} from '../src/portal-requests.js';

const baseUrl = process.env.DATABASE_URL;
if (!baseUrl) throw new Error('DATABASE_URL is required for the PostgreSQL portal-request test.');
const schema = `portal_request_test_${crypto.randomBytes(8).toString('hex')}`;
if (!/^portal_request_test_[a-f0-9]{16}$/.test(schema)) throw new Error('Unsafe disposable schema name.');
const testUrl = new URL(baseUrl);
testUrl.searchParams.set('schema', schema);
const control = new PrismaClient({ datasources: { db: { url: baseUrl } } });
let client: PrismaClient | undefined;

const key = (suffix:string) => `portal-request-test-${suffix}`;

async function main() {
  await control.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  const prismaCli = fileURLToPath(new URL('../node_modules/prisma/build/index.js', import.meta.url));
  execFileSync(process.execPath, [prismaCli, 'db', 'push', '--skip-generate', '--schema', 'prisma/schema.prisma'], { cwd: process.cwd(), env: { ...process.env, DATABASE_URL: testUrl.toString(), PRISMA_CLIENT_ENGINE_TYPE: 'binary' }, stdio: 'pipe' });
  client = new PrismaClient({ datasources: { db: { url: testUrl.toString() } } });
  const db = client;

  const organization = await db.organization.create({ data: { name: 'Portal request test', slug: schema, rfqHandlingMode: 'LEAD_FIRST' } });
  const otherOrganization = await db.organization.create({ data: { name: 'Other tenant', slug: `${schema}-other` } });
  const admin = await db.user.create({ data: { name: 'Admin', email: `${schema}-admin@example.invalid`, passwordHash: 'not-a-login', status: 'ACTIVE', role: 'ADMIN', organizationId: organization.id } });
  const manager = await db.user.create({ data: { name: 'Manager', email: `${schema}-manager@example.invalid`, passwordHash: 'not-a-login', status: 'ACTIVE', role: 'MANAGER', organizationId: organization.id, moduleAccess: ['quotations'] } });
  const rep = await db.user.create({ data: { name: 'Assigned Rep', email: `${schema}-rep@example.invalid`, passwordHash: 'not-a-login', status: 'ACTIVE', role: 'REP', organizationId: organization.id, moduleAccess: ['quotations'] } });
  const otherRep = await db.user.create({ data: { name: 'Other Rep', email: `${schema}-other-rep@example.invalid`, passwordHash: 'not-a-login', status: 'ACTIVE', role: 'REP', organizationId: organization.id, moduleAccess: ['quotations'] } });
  const team = await db.salesTeam.create({ data: { organizationId: organization.id, name: 'Assigned team', managerId: manager.id, members: { create: { userId: rep.id } } } });
  const customer = await db.customer.create({ data: { organizationId: organization.id, name: 'Portal buyer', tier: 'Gold', primarySalesTeamId: team.id } });
  const portalUser = await db.user.create({ data: { name: 'Portal buyer', email: `${schema}-customer@example.invalid`, passwordHash: 'not-a-login', status: 'ACTIVE', role: 'CUSTOMER', organizationId: organization.id, customerId: customer.id } });
  const assignment = await db.customerRepresentative.create({ data: { customerId: customer.id, userId: rep.id, role: 'PRIMARY', assignedById: admin.id } });
  await db.discountPolicy.create({ data: { organizationId: organization.id, tier: 'Gold', maxDiscount: 20, hardwareLimit: 10, servicesLimit: 15, subscriptionLimit: 10, financeThreshold: 15 } });
  const product = await db.product.create({ data: { organizationId: organization.id, name: 'Active product', sku: `ACTIVE-${schema}`, category: 'Hardware', description: 'A valid request item', unit: 'unit', price: 100, cost: 60, taxRate: 18, active: true, storeVisible: true } });
  const inactiveProduct = await db.product.create({ data: { organizationId: organization.id, name: 'Inactive product', sku: `INACTIVE-${schema}`, category: 'Hardware', description: 'Must degrade', unit: 'unit', price: 50, cost: 20, taxRate: 18, active: false } });
  const crossTenantProduct = await db.product.create({ data: { organizationId: otherOrganization.id, name: 'Other tenant product', sku: `OTHER-${schema}`, category: 'Hardware', description: 'Must not resolve', unit: 'unit', price: 999, cost: 1, taxRate: 0 } });
  const actor = { id: portalUser.id, role: 'CUSTOMER', organizationId: organization.id, customerId: customer.id, requestId: 'portal-request-test' };

  // A stale/inactive assignment is rejected even though the portal identity already exists.
  await db.customerRepresentative.update({ where: { id: assignment.id }, data: { active: false, endedAt: new Date() } });
  await assert.rejects(db.$transaction((tx) => submitPortalRequest(tx, actor, { requirementsText: 'Need a current account representative', preferredDeliveryDate: null, lines: [], idempotencyKey: key('stale') })), (error:any) => error instanceof PortalRequestError && error.code === 'CONFIGURATION_REQUIRED');
  assert.equal(await db.portalRequest.count(), 0, 'configuration rejection must not persist an orphan request');
  await db.customerRepresentative.update({ where: { id: assignment.id }, data: { active: true, endedAt: null } });

  // Invalid, inactive, and cross-tenant product IDs degrade without aborting the request.
  const leadSubmission = await db.$transaction((tx) => submitPortalRequest(tx, actor, {
    requirementsText: 'Need replacements and a compatible service plan',
    preferredDeliveryDate: '2026-10-15',
    lines: [
      { productId: crossTenantProduct.id, freeTextDescription: 'Equivalent local model', quantity: 2 },
      { productId: inactiveProduct.id, freeTextDescription: 'Legacy replacement', quantity: 1 },
      { productId: 'not-a-product-id', freeTextDescription: 'Custom installation', quantity: 1.5 },
    ],
    idempotencyKey: key('lead'),
  }));
  assert.equal(leadSubmission.handlingMode, 'LEAD_FIRST');
  const storedLeadRequest = await db.portalRequest.findUniqueOrThrow({ where: { id: leadSubmission.id as string }, include: { lines: true, resultingLead: true } });
  assert.equal(storedLeadRequest.lines.length, 3);
  assert(storedLeadRequest.lines.every((line) => line.productId === null && line.degraded), 'unavailable product references must be removed and marked degraded');
  const leadId = storedLeadRequest.resultingLeadId!;
  const visibleLead:any = await getLead(db, { id: rep.id, role: 'REP', organizationId: organization.id }, leadId);
  assert(visibleLead.request.lines.every((line:any) => line.degraded), 'the assigned rep must see degradation warnings');
  await assert.rejects(getLead(db, { id: otherRep.id, role: 'REP', organizationId: organization.id }, leadId), (error:any) => error instanceof PortalRequestError && error.code === 'NOT_FOUND');
  assert.equal((await listLeads(db, { id: manager.id, role: 'MANAGER', organizationId: organization.id }, 'NEW')).items.length, 1, 'the team manager must see the Lead');

  // Conversion is idempotent and never invents priced lines from free text.
  const quoteCountBeforeConvert = await db.quote.count();
  const converted = await db.$transaction((tx) => convertLead(tx, { id: rep.id, role: 'REP', organizationId: organization.id, requestId: 'convert-1' }, leadId));
  const replayedConversion = await db.$transaction((tx) => convertLead(tx, { id: rep.id, role: 'REP', organizationId: organization.id, requestId: 'convert-2' }, leadId));
  assert.equal(converted.replayed, false);
  assert.equal(replayedConversion.replayed, true);
  assert.equal(replayedConversion.quotation?.id, converted.quotation.id);
  assert.equal(await db.quote.count(), quoteCountBeforeConvert + 1, 'converting the same Lead twice must create one Draft');
  assert.equal(await db.quoteLine.count({ where: { quoteId: converted.quotation.id } }), 0, 'free-text/degraded lines must not become priced lines');

  assert.equal(dismissLeadSchema.safeParse({}).success, false, 'dismissal without a reason must be rejected');
  assert.equal(dismissLeadSchema.safeParse({ reason: '   ' }).success, false, 'blank dismissal reasons must be rejected');

  // Customer-safe history is scoped to the current identity and omits internal state.
  const history:any = await listPortalRequests(db, actor);
  const serializedHistory = JSON.stringify(history);
  assert(!serializedHistory.includes(rep.id), 'customer history must not expose owner IDs');
  assert(!serializedHistory.includes('dismissReason'), 'customer history must not expose internal dismissal fields');
  assert(!serializedHistory.includes('resultingQuotationId'), 'customer history must not expose private Draft links');
  assert(!serializedHistory.includes(crossTenantProduct.name), 'cross-tenant product details must not leak through a degraded line');

  // A separate portal identity cannot read the first customer's request history.
  const secondCustomer = await db.customer.create({ data: { organizationId: organization.id, name: 'Second portal buyer', tier: 'Gold', primarySalesTeamId: team.id } });
  const secondPortalUser = await db.user.create({ data: { name: 'Second portal buyer', email: `${schema}-customer-2@example.invalid`, passwordHash: 'not-a-login', status: 'ACTIVE', role: 'CUSTOMER', organizationId: organization.id, customerId: secondCustomer.id } });
  await db.customerRepresentative.create({ data: { customerId: secondCustomer.id, userId: rep.id, role: 'PRIMARY', assignedById: admin.id } });
  const secondActor = { id: secondPortalUser.id, role: 'CUSTOMER', organizationId: organization.id, customerId: secondCustomer.id, requestId: 'portal-request-test-2' };
  assert.equal((await listPortalRequests(db, secondActor)).items.length, 0, 'portal history must be customer- and submitter-scoped');

  // Rate limiting returns an explicit retryable error and does not silently drop input.
  const existing = await db.portalRequest.count({ where: { customerId: customer.id, submittedByUserId: portalUser.id, createdAt: { gte: new Date(Date.now() - 3_600_000) } } });
  for (let index=existing; index<PORTAL_REQUESTS_PER_HOUR; index++) await db.portalRequest.create({ data: { organizationId: organization.id, customerId: customer.id, submittedByUserId: portalUser.id, requirementsText: `Rate-limit fixture ${index}` } });
  await assert.rejects(db.$transaction((tx) => submitPortalRequest(tx, actor, { requirementsText: 'This request exceeds the explicit limit', preferredDeliveryDate: null, lines: [], idempotencyKey: key('limited') })), (error:any) => error instanceof PortalRequestError && error.code === 'RATE_LIMITED' && error.status === 429 && Number(error.retryAfter) > 0);

  // Only Admin can change the setting, and a real change is audited.
  await assert.rejects(db.$transaction((tx) => updateRfqHandlingMode(tx, { id: rep.id, role: 'REP', organizationId: organization.id }, 'DIRECT_DRAFT')), (error:any) => error instanceof PortalRequestError && error.code === 'FORBIDDEN');
  const setting = await db.$transaction((tx) => updateRfqHandlingMode(tx, { id: admin.id, role: 'ADMIN', organizationId: organization.id, requestId: 'setting-change' }, 'DIRECT_DRAFT', 'Use direct drafts for configured catalog buyers.'));
  assert.deepEqual(setting, { mode: 'DIRECT_DRAFT', changed: true });
  const settingAudit = await db.auditEvent.findFirstOrThrow({ where: { organizationId: organization.id, action: 'RFQ_HANDLING_MODE_CHANGED' } });
  assert.match(settingAudit.reason ?? '', /LEAD_FIRST -> DIRECT_DRAFT/);

  // Direct mode creates one Draft per idempotent request and prices only valid catalog lines.
  const directInput = {
    requirementsText: 'Please quote a catalog item plus custom setup',
    preferredDeliveryDate: '2026-11-01',
    lines: [{ productId: product.id, quantity: 3 }, { freeTextDescription: 'On-site custom setup', quantity: 1 }],
    idempotencyKey: key('direct'),
  };
  const directQuoteCount = await db.quote.count();
  const direct = await db.$transaction((tx) => submitPortalRequest(tx, secondActor, directInput));
  const directReplay = await db.$transaction((tx) => submitPortalRequest(tx, secondActor, directInput));
  assert.equal(direct.handlingMode, 'DIRECT_DRAFT');
  assert.equal(directReplay.replayed, true);
  assert.equal(await db.quote.count(), directQuoteCount + 1, 'an idempotent direct request must create exactly one Draft');
  const directRequest = await db.portalRequest.findUniqueOrThrow({ where: { id: direct.id as string }, include: { resultingQuotation: { include: { lines: true, currentRevision: true } } } });
  assert.equal(directRequest.resultingQuotation?.stage, 'DRAFT');
  assert.equal(directRequest.resultingQuotation?.ownerId, rep.id);
  assert.equal(directRequest.resultingQuotation?.teamId, team.id);
  assert.equal(directRequest.resultingQuotation?.lines.length, 1, 'the free-text-only line must not become a fabricated priced line');
  assert.match(directRequest.resultingQuotation?.currentRevision?.internalNote ?? '', /On-site custom setup/);

  // Dismissal retains the Lead and its internal reason while the portal sees only Declined.
  await db.organization.update({ where: { id: organization.id }, data: { rfqHandlingMode: 'LEAD_FIRST' } });
  const thirdCustomer = await db.customer.create({ data: { organizationId: organization.id, name: 'Dismissal buyer', tier: 'Gold', primarySalesTeamId: team.id } });
  const thirdPortalUser = await db.user.create({ data: { name: 'Dismissal buyer', email: `${schema}-customer-3@example.invalid`, passwordHash: 'not-a-login', status: 'ACTIVE', role: 'CUSTOMER', organizationId: organization.id, customerId: thirdCustomer.id } });
  await db.customerRepresentative.create({ data: { customerId: thirdCustomer.id, userId: rep.id, role: 'PRIMARY', assignedById: admin.id } });
  const thirdActor = { id: thirdPortalUser.id, role: 'CUSTOMER', organizationId: organization.id, customerId: thirdCustomer.id };
  const dismissSubmission = await db.$transaction((tx) => submitPortalRequest(tx, thirdActor, { requirementsText: 'Need a one-off unsupported service', preferredDeliveryDate: null, lines: [], idempotencyKey: key('dismiss') }));
  const dismissRequest = await db.portalRequest.findUniqueOrThrow({ where: { id: dismissSubmission.id as string } });
  const internalReason = 'Service is outside the supported catalog.';
  await db.$transaction((tx) => dismissLead(tx, { id: rep.id, role: 'REP', organizationId: organization.id }, dismissRequest.resultingLeadId!, internalReason));
  const retainedLead = await db.lead.findUniqueOrThrow({ where: { id: dismissRequest.resultingLeadId! } });
  assert.equal(retainedLead.status, 'DISMISSED');
  assert.equal(retainedLead.dismissReason, internalReason);
  const customerDismissed:any = (await listPortalRequests(db, thirdActor)).items[0];
  assert.equal(customerDismissed.status, 'DECLINED');
  assert(!JSON.stringify(customerDismissed).includes(internalReason), 'the customer must not receive the internal dismiss reason');

  console.log(JSON.stringify({ passed: 24, schema, checks: ['assignment revalidation', 'cross-tenant degradation', 'rep degradation context', 'lead scope', 'manager scope', 'conversion idempotency', 'no fabricated priced lines', 'dismiss reason validation', 'customer-safe DTO', 'portal history scope', 'rate limit', 'admin setting role gate', 'setting audit', 'direct draft idempotency', 'assigned ownership', 'internal free-text note', 'safe declined status'] }));
}

try {
  await main();
} finally {
  if (client) await client.$disconnect();
  await control.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await control.$disconnect();
}
