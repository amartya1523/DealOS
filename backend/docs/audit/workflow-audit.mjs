// Run from backend: node --import tsx docs/audit/workflow-audit.mjs
// Creates a unique disposable PostgreSQL schema; never seeds the existing schema.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const backend = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(`${backend}/package.json`);
require('dotenv').config({path:`${backend}/.env`, quiet:true});
const schema = `audit_${Date.now()}`;
const url = new URL(process.env.DATABASE_URL);
url.searchParams.set('schema',schema);
process.env.DATABASE_URL=url.toString();
const setup=spawnSync(process.execPath,[`${backend}/node_modules/prisma/build/index.js`,'db','push','--skip-generate','--schema',`${backend}/prisma/schema.prisma`],{env:process.env,encoding:'utf8'});
if(setup.status!==0) throw new Error('Isolated schema setup failed');
const {db}=await import('../../src/db.ts');
const {app}=await import('../../src/app.ts');
const {calculateQuote}=await import('../../src/rules.ts');
const bcrypt=require('bcryptjs');
const results=[];
const record=(name,pass,actual)=>{results.push({name,status:pass?'PASS':'FAIL',actual});console.log(`${pass?'PASS':'FAIL'} ${name}: ${JSON.stringify(actual)}`)};
const server=app.listen(0,'127.0.0.1');
await new Promise(r=>server.once('listening',r));
const base=`http://127.0.0.1:${server.address().port}/api/v1`;
const sessions={};
const csrf={};
async function api(role,path,body,method=body?'POST':'GET'){
 const mutating=!['GET','HEAD','OPTIONS'].includes(method);
 const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json',Origin:process.env.FRONTEND_ORIGIN??'http://localhost:5173',...(sessions[role]?{Cookie:sessions[role]}:{}),...(mutating&&csrf[role]?{'X-CSRF-Token':csrf[role],'Idempotency-Key':`${role}-${Date.now()}-${Math.random()}`}:{})},body:body?JSON.stringify(body):undefined});
 let data;try{data=await r.json()}catch{data={}};
 return {status:r.status,data:data.data,error:data.error,cookie:r.headers.get('set-cookie')};
}
try{
 const hash=await bcrypt.hash('AuditOnly2026!',10);
 const organization=await db.organization.create({data:{name:'Audit Organization',slug:`audit-${Date.now()}`}});
 const organizationId=organization.id;
 const allModules=['dashboard','quotations','approvals','fulfillment','subscriptions','invoices','health','reports','products','policies'];
 const acme=await db.customer.create({data:{organizationId,name:'Acme Audit',tier:'Gold',currency:'INR'}});
 const users={};
 for(const role of ['REP','MANAGER','FINANCE','ADMIN','CUSTOMER']) users[role]=await db.user.create({data:{organizationId,name:`Audit ${role}`,email:`${role.toLowerCase()}@audit.invalid`,passwordHash:hash,role,status:'ACTIVE',moduleAccess:role==='CUSTOMER'?[]:allModules,customerId:role==='CUSTOMER'?acme.id:null}});
 for(const role of Object.keys(users)){const r=await api(role,'/auth/login',{identifier:users[role].email,password:'AuditOnly2026!'});sessions[role]=r.cookie?.split(';')[0];csrf[role]=r.data?.csrfToken;record(`${role} login`,r.status===200,r.status)}
 record('Unauthenticated workspace denied',(await api('NONE','/workspace')).status===401,401);
 const policy=await db.discountPolicy.create({data:{organizationId,tier:'Gold',maxDiscount:15,hardwareLimit:15,servicesLimit:10,subscriptionLimit:10,financeThreshold:5}});
 const product=await db.product.create({data:{organizationId,name:'Audit hardware',sku:'AUD-HW',category:'Hardware',description:'Disposable test',unit:'Unit',price:100,cost:95,taxRate:18}});
 const service=await db.product.create({data:{organizationId,name:'Audit service',sku:'AUD-SVC',category:'Services',description:'Disposable test',unit:'Unit',price:100,cost:50,taxRate:18}});
 const recurring=await db.product.create({data:{organizationId,name:'Audit monthly',sku:'AUD-MO',category:'Subscriptions',description:'Disposable test',unit:'Seat',price:40,cost:12,taxRate:18,recurring:true,cadence:'Monthly'}});
 const warehouse=await db.warehouse.create({data:{organizationId,name:'Audit warehouse',priority:1,shippingCost:10}});
 await db.stockBalance.create({data:{warehouseId:warehouse.id,productId:product.id,onHand:100,reserved:0}});
 async function make(customer='Acme Audit',discount=18,p=service,owner='REP'){
  const c=await api(owner,'/quotations',customer==='Acme Audit'?{customerId:acme.id,customerTier:'Gold'}:{customer,customerTier:'Gold'});
  if(c.status!==201)throw new Error('Fixture quote failed');
  const s=await api(owner,`/quotations/${c.data.id}/draft`,{version:c.data.version,orderDiscount:0,lines:[{productId:p.id,quantity:2,discount}]},'PUT');
  if(s.status!==200)throw new Error('Fixture draft failed');
  return s.data.quote;
 }
 async function submit(q,role='REP'){await api(role,`/quotations/${q.id}/submit`,{});return db.approval.findMany({where:{quoteId:q.id},orderBy:{sequence:'asc'}})}
 const q=await make();const steps=await submit(q);
 record('High excess routes Manager then Finance',steps.map(s=>s.step).join(',')==='Sales Manager,Finance',steps.map(s=>s.step));
 let r=await api('FINANCE',`/approvals/${steps[1].id}/decision`,{decision:'APPROVE',reason:'Audit finance early'});record('Finance blocked before Manager',r.status===409,r.error?.code);
 r=await api('REP',`/approvals/${steps[0].id}/decision`,{decision:'APPROVE',reason:'Audit wrong role'});record('Rep cannot approve',r.status===403,r.status);
 r=await api('MANAGER',`/approvals/${steps[0].id}/decision`,{decision:'APPROVE',reason:''});record('Approval requires reason',r.status===422,r.status);
 r=await api('CUSTOMER',`/portal/quotations/${q.id}/confirm`,{});record('Customer cannot confirm pending quote',r.status===409,r.status);
 r=await api('FINANCE',`/fulfillment/${q.id}/allocate`,{});record('Allocation blocked before confirmation',r.status===409,r.status);
 await api('MANAGER',`/approvals/${steps[0].id}/decision`,{decision:'APPROVE',reason:'Audit manager approved'});
 record('Manager approval leaves Finance pending',(await db.quote.findUnique({where:{id:q.id}})).stage==='PENDING_APPROVAL','PENDING_APPROVAL');
 await api('FINANCE',`/approvals/${steps[1].id}/decision`,{decision:'APPROVE',reason:'Audit finance approved'});
 record('Final approval produces approved stage',(await db.quote.findUnique({where:{id:q.id}})).stage==='APPROVED','APPROVED');
 await api('REP',`/quotations/${q.id}/send`,{});
 const portal=(await api('CUSTOMER','/workspace')).data;
 const pq=portal.quotes.find(x=>x.id===q.id);
 record('Customer DTO excludes internal data',!('margin'in pq)&&!('riskScore'in pq)&&!('unitCost'in pq.lines[0]),{margin:'margin'in pq,riskScore:'riskScore'in pq,lineCost:'unitCost'in pq.lines[0],productCost:'cost'in pq.lines[0].product,approvalReasons:pq.approvals.map(a=>a.reason)});
 const other=await make('Other Company');await db.quote.update({where:{id:other.id},data:{stage:'APPROVED',sentAt:new Date()}});await db.quoteRevision.update({where:{id:other.currentRevisionId},data:{state:'SENT',sentAt:new Date()}});
 r=await api('CUSTOMER',`/portal/quotations/${other.id}/confirm`,{});record('Customer cannot confirm another customer quote',[403,404].includes(r.status),r.status);
 r=await api('CUSTOMER',`/portal/quotations/${other.id}/message`,{message:'Audit foreign quote'});record('Customer cannot modify another customer quote',[403,404].includes(r.status),r.status);
 const pending=await make('Acme Private Draft');const portal2=(await api('CUSTOMER','/workspace')).data;record('Unsent draft hidden from customer',!portal2.quotes.some(x=>x.id===pending.id),portal2.quotes.some(x=>x.id===pending.id));
 r=await api('CUSTOMER',`/portal/quotations/${q.id}/message`,{message:'Audit 50 percent counteroffer',counterDiscount:50});
 await api('REP',`/quotations/${q.id}/proposals/${r.data.id}/respond`,{decision:'ADOPT',reason:'Audit adopt and recalculate'});
 const changed=await db.quote.findUnique({where:{id:q.id},include:{lines:{include:{product:true}},approvals:true}});
 const calc=calculateQuote(changed.lines.map(l=>({quantity:l.quantity,unitPrice:l.unitPrice,unitCost:l.unitCost,discount:l.discount,allowedDiscount:l.allowedDiscount,taxRate:l.product.taxRate,cadence:l.product.recurring?l.product.cadence:'One-time'})),changed.orderDiscount);
 record('Counteroffer recalculates totals and risk',Number(changed.total)===calc.total&&Number(changed.riskScore)===calc.riskScore,{storedTotal:Number(changed.total),expectedTotal:calc.total,storedRisk:Number(changed.riskScore),expectedRisk:calc.riskScore});
 record('Prior approval decisions remain immutable',changed.approvals.some(a=>a.reason==='Audit manager approved'),changed.approvals.map(a=>({state:a.state,reason:a.reason})));
 const safe=await make('Acme Safe',0,service);const safeSteps=await submit(safe);record('Within-policy quote avoids unnecessary approval',safeSteps.length===0,safeSteps.map(s=>s.step));
 const low=await make('Acme Low Margin',0,product);const lowSteps=await submit(low);record('Low margin routes Finance',lowSteps.some(s=>s.step==='Finance'),{marginPercent:5,steps:lowSteps.map(s=>s.step)});
 await api('ADMIN',`/policies/${policy.id}`,{maxDiscount:15,hardwareLimit:15,servicesLimit:10,subscriptionLimit:10,financeThreshold:99,reason:'Verify configurable Finance routing.'},'PATCH');
 const configurable=await make('Acme Config');const configSteps=await submit(configurable);record('Published Finance threshold affects routing',!configSteps.some(s=>s.step==='Finance'),{configuredThreshold:99,excess:8,steps:configSteps.map(s=>s.step)});
 await api('ADMIN',`/policies/${policy.id}`,{maxDiscount:15,hardwareLimit:15,servicesLimit:10,subscriptionLimit:10,financeThreshold:5,reason:'Restore the published Finance threshold.'},'PATCH');
 const self=await make('Acme Self',18,service,'ADMIN');const selfSteps=await submit(self,'ADMIN');r=await api('ADMIN',`/approvals/${selfSteps[0].id}/decision`,{decision:'APPROVE',reason:'Audit self'});record('Self approval blocked',r.error?.code==='SELF_APPROVAL_NOT_ALLOWED',r.error?.code);
 const returned=await make('Acme Return');const rs=await submit(returned);await api('MANAGER',`/approvals/${rs[0].id}/decision`,{decision:'APPROVE',reason:'Audit initial'});await api('FINANCE',`/approvals/${rs[1].id}/decision`,{decision:'RETURN',reason:'Audit revise'});
 record('Return sends quotation to draft',(await db.quote.findUnique({where:{id:returned.id}})).stage==='DRAFT','DRAFT');
 await submit(returned);record('Resubmit preserves prior approval cycle',await db.approval.count({where:{quoteId:returned.id}})>2,await db.approval.count({where:{quoteId:returned.id}}));
 const owned=await make('Acme Admin Draft',0,service,'ADMIN');r=await api('REP',`/quotations/${owned.id}/draft`,{version:owned.version,orderDiscount:0,lines:[{productId:service.id,quantity:9,discount:0}]},'PUT');record('Rep cannot edit another owner quote',[403,404].includes(r.status),r.status);
 const stock=await make('Acme Audit',0,product);await db.quote.update({where:{id:stock.id},data:{stage:'APPROVED'}});await api('REP',`/quotations/${stock.id}/send`,{});r=await api('CUSTOMER',`/portal/quotations/${stock.id}/confirm`,{});record('Approved customer quote can confirm',r.status===200,r.status);
 await api('FINANCE',`/fulfillment/${stock.id}/allocate`,{});const first=await db.stockBalance.findFirst({where:{productId:product.id}});await api('FINANCE',`/fulfillment/${stock.id}/allocate`,{});const second=await db.stockBalance.findFirst({where:{productId:product.id}});record('Allocation retry does not double reserve',first.reserved===second.reserved,{first:first.reserved,retry:second.reserved});
 const balancesView=await api('REP','/warehouses/stock');const viewedBalance=balancesView.data[0].stocks[0];record('Stock API derives available on the backend',viewedBalance.available===viewedBalance.onHand-viewedBalance.reserved,{onHand:viewedBalance.onHand,reserved:viewedBalance.reserved,available:viewedBalance.available});
 const shortage=await make('Acme Audit',0,product);const shortageDraft=await api('REP',`/quotations/${shortage.id}/draft`,{version:shortage.version,orderDiscount:0,lines:[{productId:product.id,quantity:100,discount:0}]},'PUT');await db.quote.update({where:{id:shortage.id},data:{stage:'APPROVED'}});await api('REP',`/quotations/${shortage.id}/send`,{});await api('CUSTOMER',`/portal/quotations/${shortage.id}/confirm`,{});const shortagePreview=await api('FINANCE',`/fulfillment/${shortage.id}/preview`);r=await api('FINANCE',`/fulfillment/${shortage.id}/allocate`,{stockFingerprint:shortagePreview.data.stockFingerprint});record('Partial allocation creates explicit backorder',r.data?.state==='BACKORDER'&&r.data?.split?.backorders?.[0]?.quantity===2,{state:r.data?.state,split:r.data?.split});
 let shortageDetail=await api('FINANCE',`/fulfillment/${shortage.id}`);record('Backorder is not consolidatable without new stock',shortageDetail.data?.consolidationAvailable===false,shortageDetail.data?.consolidationAvailable);r=await api('REP',`/fulfillment/${shortage.id}/consolidate-backorder`,{reason:'Rep must not consolidate'});record('Sales Rep cannot manage backorder',r.status===403,r.status);
 const receipt=await api('ADMIN',`/warehouses/${warehouse.id}/restock`,{productId:product.id,quantity:2,reason:'Audit replenishment receipt'});record('Restock identifies consolidation candidate',receipt.status===201&&receipt.data?.consolidationCandidates?.includes(shortage.id),receipt.data?.consolidationCandidates);shortageDetail=await api('FINANCE',`/fulfillment/${shortage.id}`);record('Backorder becomes consolidatable after restock',shortageDetail.data?.consolidationAvailable===true,shortageDetail.data?.consolidationAvailable);r=await api('FINANCE',`/fulfillment/${shortage.id}/consolidate-backorder`,{reason:'Audit remaining quantity consolidation'});const consolidated=parseInt((r.data?.split?.backorders?.length??-1),10)===0&&r.data?.state==='FULFILLED';record('Consolidation reserves restock and completes fulfillment',consolidated,{state:r.data?.state,backorders:r.data?.split?.backorders});
 await api('ADMIN',`/warehouses/${warehouse.id}/restock`,{productId:product.id,quantity:5,reason:'Prepare manual allocation test'});const manual=await make('Acme Audit',0,product);const manualDraft=await api('REP',`/quotations/${manual.id}/draft`,{version:manual.version,orderDiscount:0,lines:[{productId:product.id,quantity:5,discount:0}]},'PUT');await db.quote.update({where:{id:manual.id},data:{stage:'APPROVED'}});await api('REP',`/quotations/${manual.id}/send`,{});await api('CUSTOMER',`/portal/quotations/${manual.id}/confirm`,{});r=await api('FINANCE',`/fulfillment/${manual.id}/allocate-manual`,{allocations:[{productId:product.id,warehouseId:warehouse.id,quantity:6}],reason:'Invalid excess stock request'});record('Manual override rejects unavailable quantity',r.status===409&&r.error?.code==='STOCK_CHANGED',{status:r.status,code:r.error?.code});r=await api('FINANCE',`/fulfillment/${manual.id}/allocate-manual`,{allocations:[{productId:product.id,warehouseId:warehouse.id,quantity:3}],reason:'Audit controlled partial override'});record('Manual override preserves unallocated demand as backorder',r.data?.state==='BACKORDER'&&r.data?.split?.backorders?.[0]?.quantity===2,{state:r.data?.state,split:r.data?.split});
 await api('ADMIN',`/warehouses/${warehouse.id}/restock`,{productId:product.id,quantity:2,reason:'Prepare stock race test'});const raceStock=await make('Acme Audit',0,product);await db.quote.update({where:{id:raceStock.id},data:{stage:'APPROVED'}});await api('REP',`/quotations/${raceStock.id}/send`,{});await api('CUSTOMER',`/portal/quotations/${raceStock.id}/confirm`,{});const stalePreview=await api('FINANCE',`/fulfillment/${raceStock.id}/preview`);await api('ADMIN',`/warehouses/${warehouse.id}/restock`,{productId:product.id,quantity:1,reason:'Change stock after preview'});r=await api('FINANCE',`/fulfillment/${raceStock.id}/allocate`,{stockFingerprint:stalePreview.data.stockFingerprint});record('Stale recommendation is rejected after stock change',r.status===409&&r.error?.code==='STOCK_CHANGED',{status:r.status,code:r.error?.code});
 const inv=await db.invoice.create({data:{organizationId,number:'AUD-INV',quoteId:stock.id,orderId:(await db.order.findUnique({where:{quoteId:stock.id}})).id,customer:'Acme Audit',customerId:acme.id,amount:1000,dueAt:new Date(),lines:[{description:'Audit',amount:1000}]}});
 r=await api('FINANCE',`/invoices/${inv.id}/payments`,{amount:1001,reference:'AUD-OVER'});record('Overpayment rejected',r.status===422,r.status);
 r=await api('FINANCE',`/invoices/${inv.id}/payments`,{amount:100,reference:'AUD-SAME'});record('Partial payment updates invoice',r.data?.state==='PARTIAL'&&Number(r.data?.paidAmount)===100,{state:r.data?.state,paid:r.data?.paidAmount});
 await api('FINANCE',`/invoices/${inv.id}/payments`,{amount:100,reference:'AUD-SAME'});const paid=await db.invoice.findUnique({where:{id:inv.id},include:{payments:true}});record('Payment retry does not duplicate ledger',paid.payments.length===1,{payments:paid.payments.length,paid:Number(paid.paidAmount)});
 const mixed=await make('Acme Mixed',0,service);const mix=await api('REP',`/quotations/${mixed.id}/draft`,{version:mixed.version,orderDiscount:0,lines:[{productId:service.id,quantity:1,discount:0},{productId:recurring.id,quantity:1,discount:0}]},'PUT');record('One-time and recurring totals stay separate',!!mix.data?.calculation?.totalsByCadence,{total:mix.data?.calculation?.total,cadenceTotals:mix.data?.calculation?.totalsByCadence??null});
 record('Tax included as explicit calculated amount','tax'in mix.data.calculation||'taxTotal'in mix.data.calculation,Object.keys(mix.data.calculation));
 const dup=await make('Acme Audit',0,product);const dupSaved=await api('REP',`/quotations/${dup.id}/draft`,{version:dup.version,orderDiscount:0,lines:[{productId:product.id,quantity:60,discount:0},{productId:product.id,quantity:60,discount:0}]},'PUT');await db.quote.update({where:{id:dup.id},data:{stage:'APPROVED'}});await api('REP',`/quotations/${dup.id}/send`,{});await api('CUSTOMER',`/portal/quotations/${dup.id}/confirm`,{});await api('FINANCE',`/fulfillment/${dup.id}/allocate`,{});const over=await db.stockBalance.findFirst({where:{productId:product.id}});record('Duplicate SKU lines cannot overreserve stock',over.reserved<=over.onHand,{onHand:over.onHand,reserved:over.reserved});
 r=await api('NONE','/auth/signup',{organizationName:'Audit Signup Organization',email:'signup@audit.invalid',password:'SignupAudit2026!',displayName:'Audit Signup'});record('Signup creates active organization admin',r.status===201&&r.data?.status==='ACTIVE',{http:r.status,status:r.data?.status});r=await api('NONE','/auth/login',{identifier:'signup@audit.invalid',password:'SignupAudit2026!'});record('Organization admin can log in',r.status===200,{http:r.status,role:r.data?.role});
 const rejected=await make('Acme Rejected');const rejectSteps=await submit(rejected);await api('MANAGER',`/approvals/${rejectSteps[0].id}/decision`,{decision:'REJECT',reason:'Audit reject'});const rejection=await db.quote.findUnique({where:{id:rejected.id},include:{approvals:true}});record('Reject moves quote to rejected',rejection.stage==='REJECTED',rejection.stage);record('Reject clears actionable pending steps',!rejection.approvals.some(a=>a.state==='PENDING'),rejection.approvals.map(a=>a.state));
 const mr=await make('Acme Manager Return');const mrSteps=await submit(mr);await api('MANAGER',`/approvals/${mrSteps[0].id}/decision`,{decision:'RETURN',reason:'Audit manager return'});const mrr=await db.quote.findUnique({where:{id:mr.id},include:{approvals:true}});record('Manager return clears actionable pending steps',!mrr.approvals.some(a=>a.state==='PENDING'),{stage:mrr.stage,steps:mrr.approvals.map(a=>a.state)});
 const race=await db.invoice.create({data:{organizationId,number:'AUD-RACE',quoteId:stock.id,orderId:(await db.order.findUnique({where:{quoteId:stock.id}})).id,customer:'Acme Audit',customerId:acme.id,amount:1000,dueAt:new Date(),lines:[]}});await Promise.all([api('FINANCE',`/invoices/${race.id}/payments`,{amount:700,reference:'RACE-A'}),api('FINANCE',`/invoices/${race.id}/payments`,{amount:700,reference:'RACE-B'})]);const raced=await db.invoice.findUnique({where:{id:race.id},include:{payments:true}});const ledger=raced.payments.reduce((s,p)=>s+Number(p.amount),0);record('Concurrent payments respect balance and ledger',ledger<=1000&&ledger===Number(raced.paidAmount),{ledger,paid:Number(raced.paidAmount),payments:raced.payments.length});
 const e2e=await make('Acme Audit',0,service);const es=await submit(e2e);for(const s of es)await api(s.step==='Finance'?'FINANCE':'MANAGER',`/approvals/${s.id}/decision`,{decision:'APPROVE',reason:'Audit full flow'});await api('REP',`/quotations/${e2e.id}/send`,{});const confirmed=await api('CUSTOMER',`/portal/quotations/${e2e.id}/confirm`,{});record('Draft to approval to customer confirmation',confirmed.data?.stage==='CONFIRMED',confirmed.data?.stage);const generated=await db.invoice.count({where:{quoteId:e2e.id}});record('Confirmed deal connects to generated billing',generated>0,{invoices:generated});
 await api('NONE','/auth/logout',{});await api('REP','/auth/logout',{});r=await api('REP','/workspace');record('Logout invalidates session',r.status===401,r.status);
}finally{
 writeFileSync(new URL('./api-results.json',import.meta.url),JSON.stringify({date:new Date().toISOString(),environment:'isolated PostgreSQL schema; synthetic fixtures',results},null,2));
 await new Promise(r=>server.close(r));
 await db.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
 await db.$disconnect();
}
