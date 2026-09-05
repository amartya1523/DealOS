import { describe, expect, it } from 'vitest';
import bcrypt from 'bcryptjs';
import type { PrismaClient } from '@prisma/client';
import { approveDirectoryJoinRequest, createDirectoryJoinRequest, declineDirectoryJoinRequest, DirectoryError, listDirectoryBusinesses, resetDirectoryRateLimitsForTests } from '../src/directory.js';

const organizationId = '11111111-1111-4111-8111-111111111111';
const requestId = '22222222-2222-4222-8222-222222222222';
const customerId = '33333333-3333-4333-8333-333333333333';
const actor = { id:'44444444-4444-4444-8444-444444444444', role:'ADMIN', organizationId, requestId:'request-1' };
const repId = '55555555-5555-4555-8555-555555555555';
const teamId = '66666666-6666-4666-8666-666666666666';
const now = new Date('2026-09-06T10:00:00.000Z');

describe('public business directory', () => {
  it('queries only discoverable active profiles and returns an allowlisted projection', async () => {
    let where: unknown;
    const prisma = { organizationProfile:{ findMany:async(input:any)=>{where=input.where;return [{organizationId,displayName:'Visible Co',shortDescription:'Safe public text',category:'Services',internalSecret:'never return'}]} } } as unknown as PrismaClient;
    await expect(listDirectoryBusinesses(prisma)).resolves.toEqual({items:[{id:organizationId,displayName:'Visible Co',shortDescription:'Safe public text',category:'Services'}]});
    expect(where).toEqual({isDiscoverable:true,organization:{status:'ACTIVE'}});
  });

  it('rejects a second pending request for the same normalized email and business', async () => {
    resetDirectoryRateLimitsForTests();
    const prisma = {organizationProfile:{findFirst:async()=>({organizationId})},directoryJoinRequest:{findFirst:async()=>({id:requestId}),count:async()=>0,create:async()=>{throw new Error('must not create')}}} as unknown as PrismaClient;
    await expect(createDirectoryJoinRequest(prisma,organizationId,{email:'buyer@example.com',companyName:'Buyer Co',message:'Please add our company.'},'127.0.0.1',now)).rejects.toMatchObject({status:409,code:'PENDING_REQUEST_EXISTS'});
  });

  it('does not accept join requests for hidden or inactive organizations', async () => {
    const prisma = {organizationProfile:{findFirst:async()=>null}} as unknown as PrismaClient;
    await expect(createDirectoryJoinRequest(prisma,organizationId,{email:'buyer@example.com',companyName:'Buyer Co',message:'Please add our company.'},'127.0.0.1',now)).rejects.toMatchObject({status:404,code:'NOT_FOUND'});
  });
});

describe('directory join review', () => {
  it('approves through the shared customer and relationship paths and exposes the raw password once', async () => {
    const {tx,state}=approvalTransaction();
    const result=await approveDirectoryJoinRequest(tx as any,actor,requestId,{primarySalesTeamId:teamId,primaryRepId:repId,collaboratorIds:[],customerTier:'Gold',currency:'INR'});
    expect(state.customers).toHaveLength(1);
    expect(state.assignments).toEqual([{customerId,userId:repId,role:'PRIMARY',assignedById:actor.id,assignedAt:expect.any(Date)}]);
    expect(state.users).toHaveLength(1);
    expect(state.memberships).toHaveLength(1);
    expect(state.directory.status).toBe('APPROVED');
    expect(state.directory.resultingCustomerId).toBe(customerId);
    expect(result.credentials.email).toBe('buyer@example.com');
    expect(result.credentials.password.length).toBeGreaterThanOrEqual(12);
    expect(await bcrypt.compare(result.credentials.password,String(state.users[0]?.passwordHash))).toBe(true);
    expect(JSON.stringify(state)).not.toContain(result.credentials.password);
  });

  it('uses the shared relationship validation for an ineligible representative', async () => {
    const {tx,state}=approvalTransaction({repOnTeam:false});
    await expect(approveDirectoryJoinRequest(tx as any,actor,requestId,{primarySalesTeamId:teamId,primaryRepId:repId,collaboratorIds:[],customerTier:'Gold',currency:'INR'})).rejects.toMatchObject({code:'REPRESENTATIVE_NOT_ON_TEAM'});
    expect(state.directory.status).toBe('PENDING');
  });

  it('declines with a retained reason and creates no customer or credential', async () => {
    const {tx,state}=approvalTransaction();
    const result=await declineDirectoryJoinRequest(tx as any,actor,requestId,'Outside our current service area.');
    expect(result.status).toBe('DECLINED');
    expect(state.directory.decisionReason).toBe('Outside our current service area.');
    expect(state.customers).toHaveLength(0);
    expect(state.users).toHaveLength(0);
  });

  it('returns a scoped miss for a cross-organization decision', async () => {
    const {tx}=approvalTransaction({crossOrganization:true});
    await expect(declineDirectoryJoinRequest(tx as any,actor,requestId,'Not in this organization.')).rejects.toBeInstanceOf(DirectoryError);
    await expect(declineDirectoryJoinRequest(tx as any,actor,requestId,'Not in this organization.')).rejects.toMatchObject({status:404,code:'NOT_FOUND'});
  });
});

function approvalTransaction(options:{repOnTeam?:boolean;crossOrganization?:boolean}={}) {
  const state={
    customers:[] as any[],users:[] as any[],memberships:[] as any[],assignments:[] as any[],audits:[] as any[],privilegedAudits:[] as any[],
    directory:{id:requestId,organizationId,email:'buyer@example.com',companyName:'Buyer Co',message:'Please configure our buying account.',status:'PENDING',decidedById:null,decidedAt:null,decisionReason:null,resultingCustomerId:null,createdAt:now,updatedAt:now,decidedBy:null,resultingCustomer:null} as any,
  };
  let currentCustomer:any=null;
  const tx={
    $queryRaw:async()=>[],
    directoryJoinRequest:{
      findFirst:async()=>options.crossOrganization?null:state.directory,
      update:async({data}:any)=>{Object.assign(state.directory,data,{updatedAt:now,decidedBy:{id:actor.id,name:'Admin'},resultingCustomer:data.resultingCustomerId?{id:customerId,name:'Buyer Co'}:null});return state.directory},
    },
    customer:{
      findFirst:async({where}:any)=>where.email?null:currentCustomer,
      create:async({data}:any)=>{currentCustomer={id:customerId,assignmentVersion:1,primarySalesTeamId:null,primarySalesTeam:null,assignments:[],createdAt:now,updatedAt:now,...data};state.customers.push(data);return currentCustomer},
      updateMany:async()=>{currentCustomer.primarySalesTeamId=teamId;currentCustomer.assignmentVersion=2;return{count:1}},
      findUniqueOrThrow:async()=>({...currentCustomer,primarySalesTeam:{id:teamId,name:'Enterprise'},assignments:[{id:'assignment-1',role:'PRIMARY',assignedAt:now,user:{id:repId,name:'Representative'}}]}),
    },
    salesTeam:{findFirst:async()=>({id:teamId,name:'Enterprise',managerId:actor.id,members:options.repOnTeam===false?[]:[{userId:repId}]}),count:async()=>1},
    user:{
      findUnique:async()=>null,
      findMany:async()=>[{id:repId,name:'Representative',role:'REP',status:'ACTIVE'}],
      create:async({data}:any)=>{state.users.push(data);return{id:'77777777-7777-4777-8777-777777777777',...data}},
    },
    organizationMembership:{upsert:async({create}:any)=>{state.memberships.push(create);return create}},
    session:{deleteMany:async()=>({count:0})},
    customerRepresentative:{create:async({data}:any)=>{state.assignments.push(data);return data},update:async()=>({})},
    auditEvent:{create:async({data}:any)=>{state.audits.push(data);return data}},
    privilegedAudit:{create:async({data}:any)=>{state.privilegedAudits.push(data);return data}},
  };
  return{tx,state};
}
