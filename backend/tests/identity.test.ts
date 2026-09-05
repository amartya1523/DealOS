import { describe, it, expect, vi } from 'vitest';
const upsert=vi.fn(async (_input: {update: object; create: {role:string; status:string; passwordHash:string}}) => ({}));
vi.mock('../src/db.js',()=>({db:{user:{upsert}}}));
describe('public signup',()=>{
 it('rejects role injection, short passwords and blank names',async()=>{const {signupSchema}=await import('../src/identity.js');const valid={displayName:'Alex',email:'alex@example.com',password:'LongPassword12!'};expect(signupSchema.safeParse({...valid,role:'ADMIN'}).success).toBe(false);expect(signupSchema.safeParse({...valid,password:'short'}).success).toBe(false);expect(signupSchema.safeParse({...valid,displayName:'  '}).success).toBe(false);expect(signupSchema.parse({...valid,email:' ALEX@example.com '}).email).toBe('alex@example.com');});
 it('hashes passwords, creates pending users, and never overwrites an existing identity',async()=>{const {createPendingAccount}=await import('../src/identity.js');await createPendingAccount({displayName:'Alex',email:'alex@example.com',password:'LongPassword12!'});const data=upsert.mock.calls[0]![0];expect(data.update).toEqual({});expect(data.create).toMatchObject({role:'REP',status:'PENDING'});expect(data.create.passwordHash).not.toBe('LongPassword12!');const bcrypt=await import('bcryptjs');expect(await bcrypt.compare('LongPassword12!',data.create.passwordHash)).toBe(true);});
});
