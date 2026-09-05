import { describe, expect, it } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { customerRecordScope, customerRelationshipSchema, updateCustomerRelationships } from '../src/customer-relationships.js';

const ids = {
  team: '11111111-1111-4111-8111-111111111111',
  primary: '22222222-2222-4222-8222-222222222222',
  collaborator: '33333333-3333-4333-8333-333333333333',
};

describe('customer account relationships', () => {
  it('strictly validates optimistic assignment input and requires a reason', () => {
    const valid={expectedVersion:3,primarySalesTeamId:ids.team,primaryRepId:ids.primary,collaboratorIds:[ids.collaborator],reason:'Account moved to enterprise sales'};
    expect(customerRelationshipSchema.parse(valid)).toEqual(valid);
    expect(customerRelationshipSchema.safeParse({...valid,reason:' '}).success).toBe(false);
    expect(customerRelationshipSchema.safeParse({...valid,organizationId:'attacker-org'}).success).toBe(false);
    expect(customerRelationshipSchema.safeParse({...valid,collaboratorIds:[ids.primary]}).success).toBe(false);
  });

  it('scopes representatives to active assignments and managers to managed or unresolved accounts', () => {
    expect(customerRecordScope({id:ids.primary,role:'REP'})).toEqual({assignments:{some:{userId:ids.primary,active:true}}});
    expect(customerRecordScope({id:ids.primary,role:'MANAGER'})).toEqual({OR:[{primarySalesTeamId:null},{primarySalesTeam:{is:{managerId:ids.primary}}}]});
    expect(customerRecordScope({id:ids.primary,role:'FINANCE'})).toEqual({});
    expect(customerRecordScope({id:ids.primary,role:'ADMIN'})).toEqual({});
  });

  it('rejects stale versions, cross-organization teams, portal users and out-of-team reps', async () => {
    await expect(updateCustomerRelationships(fakeDb({version:4}),actor,customerId,input)).rejects.toMatchObject({code:'STALE_VERSION',status:409});
    await expect(updateCustomerRelationships(fakeDb({team:null}),actor,customerId,input)).rejects.toMatchObject({code:'TEAM_NOT_AVAILABLE'});
    await expect(updateCustomerRelationships(fakeDb({candidateRole:'CUSTOMER'}),actor,customerId,input)).rejects.toMatchObject({code:'PORTAL_USER_NOT_REPRESENTATIVE'});
    await expect(updateCustomerRelationships(fakeDb({memberIds:[]}),actor,customerId,input)).rejects.toMatchObject({code:'REPRESENTATIVE_NOT_ON_TEAM'});
    await expect(updateCustomerRelationships(fakeDb({omitCandidate:true}),actor,customerId,input)).rejects.toMatchObject({code:'REPRESENTATIVE_NOT_ELIGIBLE'});
  });

  it('ends the prior primary, increments the version and writes before/after audit without touching quotations', async () => {
    const state:{ended:string[];created:Array<{userId:string;role:string}>;audits:unknown[];quoteTouches:number}={ended:[],created:[],audits:[],quoteTouches:0};
    const result=await updateCustomerRelationships(fakeDb({state}),actor,customerId,input);
    expect(state.ended).toEqual(['assignment-old']);
    expect(state.created).toEqual([{userId:ids.primary,role:'PRIMARY'},{userId:ids.collaborator,role:'COLLABORATOR'}]);
    expect(state.audits).toHaveLength(1);
    expect(state.quoteTouches).toBe(0);
    expect(result.relationship.assignmentVersion).toBe(2);
  });
});

const customerId='44444444-4444-4444-8444-444444444444';
const oldRep='55555555-5555-4555-8555-555555555555';
const actor={id:'66666666-6666-4666-8666-666666666666',role:'ADMIN',organizationId:'org-1',requestId:'request-1'};
const input={expectedVersion:1,primarySalesTeamId:ids.team,primaryRepId:ids.primary,collaboratorIds:[ids.collaborator],reason:'Territory ownership changed'};

function fakeDb(options:{version?:number;team?:object|null;candidateRole?:string;memberIds?:string[];omitCandidate?:boolean;state?:{ended:string[];created:Array<{userId:string;role:string}>;audits:unknown[];quoteTouches:number}}={}):PrismaClient {
  const state=options.state??{ended:[],created:[],audits:[],quoteTouches:0};
  const assignedAt=new Date('2026-09-01T00:00:00.000Z');
  const baseCustomer={id:customerId,organizationId:'org-1',primarySalesTeamId:ids.team,assignmentVersion:options.version??1,primarySalesTeam:{id:ids.team,name:'Enterprise'},assignments:[{id:'assignment-old',role:'PRIMARY',assignedAt,user:{id:oldRep,name:'Old Rep'}}]};
  const candidates=[{id:ids.primary,name:'Primary',role:options.candidateRole??'REP',status:'ACTIVE'},{id:ids.collaborator,name:'Collaborator',role:'REP',status:'ACTIVE'}].slice(options.omitCandidate?1:0);
  const team=options.team===null?null:options.team??{id:ids.team,name:'Enterprise',managerId:actor.id,members:(options.memberIds??[ids.primary,ids.collaborator]).map(userId=>({userId}))};
  const updated={...baseCustomer,assignmentVersion:2,assignments:[{id:'assignment-primary',role:'PRIMARY',assignedAt,user:{id:ids.primary,name:'Primary'}},{id:'assignment-collaborator',role:'COLLABORATOR',assignedAt,user:{id:ids.collaborator,name:'Collaborator'}}]};
  const tx={customer:{findFirst:async()=>baseCustomer,updateMany:async()=>({count:1}),findUniqueOrThrow:async()=>updated},salesTeam:{findFirst:async()=>team,count:async()=>1},user:{findMany:async()=>candidates},customerRepresentative:{update:async({where}:{where:{id:string}})=>{state.ended.push(where.id)},create:async({data}:{data:{userId:string;role:string}})=>{state.created.push({userId:data.userId,role:data.role})}},privilegedAudit:{create:async({data}:{data:unknown})=>{state.audits.push(data)}}};
  return {customer:{findFirst:async()=>baseCustomer},salesTeam:{findFirst:async()=>team,count:async()=>1},user:{findMany:async()=>candidates},quote:new Proxy({}, {get(){state.quoteTouches++;throw new Error('Quote writes are forbidden')}}),$transaction:async(callback:(value:typeof tx)=>unknown)=>callback(tx)} as unknown as PrismaClient;
}
