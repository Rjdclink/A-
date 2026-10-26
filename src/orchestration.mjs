import {randomUUID} from 'node:crypto';
import {first,all,run,enqueue,now} from '../integrations/automation/src/core.mjs';
const EVENTS=new Set(['recovery.analysis','growth.agent_plan','commerce.visit','commerce.cart','commerce.checkout','commerce.purchase','commerce.lead','support.ticket_created','support.handoff_required','support.ticket_updated','support.agent_replied','support.lead_captured','support.appointment_requested','support.customer_replied','support.booking_confirmed','support.booking_cancelled']);
function fault(message,status=400){const e=Error(message);e.status=status;throw e;}
export function createOrchestration(ledgerDb,growthDb){
 ledgerDb.exec("CREATE TABLE IF NOT EXISTS growth_workflow_links(workspace TEXT NOT NULL,id TEXT NOT NULL,event TEXT NOT NULL,workflow_id TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 1,created_at INTEGER NOT NULL,PRIMARY KEY(workspace,id),UNIQUE(workspace,event,workflow_id));");
 const one=(sql,...args)=>ledgerDb.prepare(sql).get(...args);
 const many=(sql,...args)=>ledgerDb.prepare(sql).all(...args);
 const update=(sql,...args)=>ledgerDb.prepare(sql).run(...args);
 async function emit(workspace,event,data={}){
  if(!EVENTS.has(event))return 0;
  let total=0;
  for(const link of many('SELECT workflow_id FROM growth_workflow_links WHERE workspace=? AND event=? AND enabled=1 LIMIT 25',workspace,event)){
   const flow=first(growthDb,'SELECT * FROM workflows WHERE id=? AND tenant_id=? AND enabled=1 AND allow_external=0',link.workflow_id,'aplus:'+workspace);
   if(!flow)continue;
   // Never copy customer identities or raw scraped HTML into agent prompts.
   const safeData=event.startsWith('support.')?{ticket:{
    id:data?.ticket?.id,status:data?.ticket?.status,priority:data?.ticket?.priority,channel:data?.ticket?.channel
   }}:data;
   enqueue(growthDb,flow,{...safeData,source_event:event,triggered_at:new Date(now()).toISOString()});
   total++;
  }
  return total;
 }
 function handle(workspace,path,method,payload={}){
  if(path==='links'&&method==='GET')return {status:200,data:{links:many('SELECT * FROM growth_workflow_links WHERE workspace=? ORDER BY created_at DESC',workspace)}};
  if(path==='links'&&method==='POST'){
   if(!EVENTS.has(payload.event)||typeof payload.workflow_id!=='string'||!(/^[a-f0-9-]{36}$/i).test(payload.workflow_id))fault('Choose a supported event and workflow');
   if(payload.enabled!==undefined&&typeof payload.enabled!=='boolean')fault('enabled must be true or false');
   const flow=first(growthDb,'SELECT * FROM workflows WHERE id=? AND tenant_id=?',payload.workflow_id,'aplus:'+workspace);
   if(!flow)fault('Workflow not found',404);
   if(flow.allow_external)fault('Unattended triggers require a workflow without external actions',409);
   if(one('SELECT COUNT(*) AS n FROM growth_workflow_links WHERE workspace=?',workspace).n>=25)fault('At most 25 workflow links per workspace',429);
   if(one('SELECT id FROM growth_workflow_links WHERE workspace=? AND event=? AND workflow_id=?',workspace,payload.event,payload.workflow_id))fault('This event is already linked to that workflow',409);
   const id=randomUUID();
   update('INSERT INTO growth_workflow_links VALUES (?,?,?,?,?,?)',workspace,id,payload.event,payload.workflow_id,Number(payload.enabled!==false),now());
   return {status:201,data:{link:one('SELECT * FROM growth_workflow_links WHERE workspace=? AND id=?',workspace,id)}};
  }
  const found=path.match(/^links\/([0-9a-f-]{36})$/i);
  if(found&&method==='DELETE'){
   if(!update('DELETE FROM growth_workflow_links WHERE workspace=? AND id=?',workspace,found[1]).changes)fault('Link not found',404);
   return {status:200,data:{deleted:true}};
  }
  fault('Not found',404);
 }
 function erase(workspace){update('DELETE FROM growth_workflow_links WHERE workspace=?',workspace);}
 return {handle,emit,erase};
}
