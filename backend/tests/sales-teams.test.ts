import { describe, expect, it } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { createSalesTeam, salesTeamMutationSchema, updateSalesTeam } from '../src/sales-teams.js';

const ids = {
  actor: '11111111-1111-4111-8111-111111111111',
  team: '22222222-2222-4222-8222-222222222222',
  manager: '33333333-3333-4333-8333-333333333333',
  rep1: '44444444-4444-4444-8444-444444444444',
  rep2: '55555555-5555-4555-8555-555555555555',
};
const actor={id:ids.actor,role:'ADMIN',organizationId:'org-1',requestId:'request-1'};
const input={name:'West Region Sales',managerId:ids.manager,memberIds:[ids.rep1,ids.rep2]};

describe('sales team management',()=>{
  it('requires a unique selection with at least one representative',()=>{
    expect(salesTeamMutationSchema.parse(input)).toEqual(input);
    expect(salesTeamMutationSchema.safeParse({...input,memberIds:[]}).success).toBe(false);
    expect(salesTeamMutationSchema.safeParse({...input,memberIds:[ids.rep1,ids.rep1]}).success).toBe(false);
  });

  it('creates one team containing the manager and multiple representatives',async()=>{
    const state=teamDbState();
    const result=await createSalesTeam(fakeDb(state),actor,input);
    expect(result.memberIds).toEqual([ids.rep1,ids.rep2]);
    expect(state.createdMembers).toEqual([ids.rep1,ids.rep2,ids.manager]);
    expect(state.audits).toHaveLength(1);
  });

  it('updates membership together and blocks removal of an assigned representative',async()=>{
    const state=teamDbState();
    await updateSalesTeam(fakeDb(state),actor,ids.team,input);
    expect(state.deletedMemberships).toBe(1);
    expect(state.createdMembers).toEqual([ids.rep1,ids.rep2,ids.manager]);

    const blocked=teamDbState();blocked.relationship={user:{name:'Aarav'},customer:{name:'Acme'}};
    await expect(updateSalesTeam(fakeDb(blocked),actor,ids.team,{...input,memberIds:[ids.rep2]})).rejects.toMatchObject({code:'REPRESENTATIVE_IN_USE',status:409});
    expect(blocked.deletedMemberships).toBe(0);
  });
});

type State={createdMembers:string[];deletedMemberships:number;audits:unknown[];relationship:null|{user:{name:string};customer:{name:string}}};
const teamDbState=():State=>({createdMembers:[],deletedMemberships:0,audits:[],relationship:null});

function fakeDb(state:State):PrismaClient {
  const tx={
    user:{
      findMany:async({where}:{where:{id:{in:string[]}}})=>where.id.in.map(id=>({id})),
      findFirst:async()=>({id:ids.manager}),
    },
    salesTeam:{
      findFirst:async({where}:{where:{id?:unknown}})=>typeof where.id==='string'?{id:ids.team,name:'Existing Sales'}:null,
      create:async({data}:{data:{name:string;managerId:string|null;members:{create:Array<{userId:string}>}}})=>{state.createdMembers=data.members.create.map(item=>item.userId);return{id:ids.team,name:data.name,managerId:data.managerId}},
      update:async()=>({id:ids.team}),
    },
    customerRepresentative:{findFirst:async()=>state.relationship},
    quote:{findFirst:async()=>null},
    salesTeamMember:{
      deleteMany:async()=>{state.deletedMemberships+=1;return{count:3}},
      createMany:async({data}:{data:Array<{userId:string}>})=>{state.createdMembers=data.map(item=>item.userId);return{count:data.length}},
    },
    auditEvent:{create:async({data}:{data:unknown})=>{state.audits.push(data);return data}},
  };
  return {$transaction:async(callback:(value:typeof tx)=>unknown)=>callback(tx)} as unknown as PrismaClient;
}
