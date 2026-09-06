import './env.js';
import { app } from './app.js';
import { db } from './db.js';
import { evaluateAlerts } from './deal-health.js';
import { runRecurringBilling } from './billing.js';

const port = Number(process.env.PORT ?? 4000);
const server = app.listen(port, () => console.log(`DealOS API ready at http://localhost:${port}`));
const schedulerInterval=Math.max(30_000,Number(process.env.SCHEDULER_INTERVAL_MS??60_000));
let schedulerRunning=false;
async function runScheduler(){
  if(schedulerRunning)return;schedulerRunning=true;
  try{
    const organizations=await db.organization.findMany({where:{status:'ACTIVE'},select:{id:true,users:{where:{role:'ADMIN',status:'ACTIVE'},select:{id:true},take:1}}});
    for(const organization of organizations){
      const actorId=organization.users[0]?.id;if(!actorId)continue;
      await db.$transaction(async tx=>{await evaluateAlerts(tx,organization.id,{});await runRecurringBilling(tx,{organizationId:organization.id,actorId,now:new Date()})});
    }
  }catch(error){console.error(JSON.stringify({level:'error',component:'scheduler',error:error instanceof Error?error.message:'UnknownError'}))}finally{schedulerRunning=false}
}
const scheduler=setInterval(()=>void runScheduler(),schedulerInterval);scheduler.unref();void runScheduler();

async function shutdown() {
  clearInterval(scheduler);
  server.close(async () => {
    await db.$disconnect();
    process.exit(0);
});
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
