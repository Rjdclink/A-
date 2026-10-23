import {first,all,run,id,now,enqueue,logEvent,parse} from './core.mjs';
import {render} from './engine.mjs';

const TERMINAL=new Set(['completed','failed','cancelled','rejected']);
const ACTIVE=['queued','running','awaiting_approval','awaiting_child'];
const MAX_DEPTH=4;

function assertNoRecursiveCall(db,parent,childWorkflowId){
 let ancestor=parent;
 for(let depth=0;depth<MAX_DEPTH;depth++){
  if(ancestor.workflow_id===childWorkflowId)throw Error('Recursive subworkflow calls are not allowed');
  const edge=first(db,'SELECT parent_run_id FROM child_runs WHERE child_run_id=?',ancestor.id);
  if(!edge)return;
  ancestor=first(db,'SELECT id,workflow_id FROM runs WHERE id=?',edge.parent_run_id);
  if(!ancestor)throw Error('Subworkflow ancestor is missing');
 }
 throw Error('Maximum subworkflow nesting depth reached');
}

function childInput(step,context){
 if(step.input_map===undefined)return context.input;
 const result={};
 for(const [key,template] of Object.entries(step.input_map))result[key]=render(template,context);
 if(JSON.stringify(result).length>20000)throw Error('Subworkflow input exceeds limit');
 return result;
}

function latestUsefulOutput(db,child){
 const state=parse(child.state,{steps:{}});
 const outputs=state.steps||{};
 // Steps are checkpointed in actual execution order. Graph declaration order
 // may differ from the path taken, especially after a branch.
 const executed=Object.entries(outputs).filter(([,value])=>value!=='finished'&&value!=='approved');
 return executed.length?executed.at(-1)[1]:null;
}

/**
 * Starts a child at most once per parent run/step, atomically recording its
 * linkage and pausing the parent. A resumed parent reads the same child ID.
 */
export function executeSubworkflow(db,execution,step,context,stamp=now()){
 const link=first(db,'SELECT child_run_id FROM child_runs WHERE parent_run_id=? AND parent_step_id=?',execution.id,step.id);
 if(link){
  const child=first(db,'SELECT * FROM runs WHERE id=? AND tenant_id=?',link.child_run_id,execution.tenant_id);
  if(!child)throw Error('Subworkflow result not found');
  if(child.status==='completed')return {waiting:false,result:{id:child.id,status:'completed',output:latestUsefulOutput(db,child)}};
  if(TERMINAL.has(child.status))throw Error('Subworkflow '+child.status+'; check child activity before retrying');
  run(db,"UPDATE runs SET status='awaiting_child',cursor=?,updated_at=? WHERE id=? AND status='running'",step.id,stamp,execution.id);
  return {waiting:true,childId:child.id};
 }
 const wf=first(db,'SELECT * FROM workflows WHERE id=? AND tenant_id=? AND enabled=1',step.workflow_id,execution.tenant_id);
 if(!wf)throw Error('Subworkflow not found or not available');
 assertNoRecursiveCall(db,execution,wf.id);
 const payload=childInput(step,context);
 let child;
 db.exec('BEGIN IMMEDIATE');
 try{
  const existing=first(db,'SELECT child_run_id FROM child_runs WHERE parent_run_id=? AND parent_step_id=?',execution.id,step.id);
  if(existing)throw Error('Concurrent subworkflow start requires retry');
  child=enqueue(db,wf,payload,stamp);
  run(db,'INSERT INTO child_runs(parent_run_id,parent_step_id,child_run_id,created_at) VALUES (?,?,?,?)',execution.id,step.id,child.id,stamp);
  const paused=run(db,"UPDATE runs SET status='awaiting_child',cursor=?,updated_at=? WHERE id=? AND status='running'",step.id,stamp,execution.id);
  if(!paused.changes)throw Error('Parent run is no longer active');
  logEvent(db,execution,step.id,'child_started',{child_run_id:child.id,workflow_id:wf.id});
  db.exec('COMMIT');
 }catch(error){db.exec('ROLLBACK');throw error;}
 return {waiting:true,childId:child.id};
}

/** Queue waiting parents when their registered child is terminal. */
export function resumeFinishedChildren(db,stamp=now()){
 const parents=all(db,`SELECT DISTINCT p.id
 FROM runs p JOIN child_runs link ON link.parent_run_id=p.id AND link.parent_step_id=p.cursor
 JOIN runs c ON c.id=link.child_run_id
 WHERE p.status='awaiting_child' AND c.status IN ('completed','failed','cancelled','rejected')
 LIMIT 40`);
 let resumed=0;
 for(const parent of parents){
  const updated=run(db,"UPDATE runs SET status='queued',available_at=?,updated_at=? WHERE id=? AND status='awaiting_child'",stamp,stamp,parent.id);
  resumed+=updated.changes;
 }
 return resumed;
}

/** Default parent-close behavior: cancel all active descendants in one TX. */
export function cancelDescendants(db,parentRunId,stamp=now()){
 const seen=new Set([parentRunId]),pending=[parentRunId];let cancelled=0;
 while(pending.length){
  const parent=pending.shift();
  for(const link of all(db,'SELECT child_run_id FROM child_runs WHERE parent_run_id=?',parent)){
   if(seen.has(link.child_run_id))continue;
   seen.add(link.child_run_id);pending.push(link.child_run_id);
   const item=run(db,"UPDATE runs SET status='cancelled',updated_at=?,leased_at=NULL WHERE id=? AND status IN ('queued','running','awaiting_approval','awaiting_child')",stamp,link.child_run_id);
   cancelled+=item.changes;
   if(item.changes)run(db,"UPDATE approvals SET status='rejected',actor='system:parent-cancelled',resolved_at=? WHERE run_id=? AND status='pending'",stamp,link.child_run_id);
  }
  if(seen.size>100)throw Error('Subworkflow cancellation graph exceeds safety limit');
 }
 return cancelled;
}
