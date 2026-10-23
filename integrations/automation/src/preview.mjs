import {validateWorkflow,render,evaluate} from './engine.mjs';
import {queryKnowledge} from './core.mjs';

/**
 * Pure, bounded execution planner. It deliberately does NOT call the model,
 * open HTTP connections, request approvals, enqueue jobs, or persist a run.
 * Execution stops at the first nondeterministic or consequential step.
 */
export function previewWorkflow(db,tenantId,workflow,input={}){
 const spec=validateWorkflow(workflow.spec);
 const byId=new Map(spec.steps.map(step=>[step.id,step]));
 const outputs={},trace=[];
 let cursor=spec.start,stop=false;
 for(let count=0;cursor&&count<40;count++){
  const step=byId.get(cursor);
  if(!step)throw Error('Preview encountered missing step');
  if(['ai','agent_team','approval','http_get','http_post','subworkflow'].includes(step.type)){
   trace.push({step_id:step.id,type:step.type,status:'requires-live-run'});
   stop=true;break;
  }
  const scope={input,steps:outputs,approvals:{}};
  let result,next=step.next||null;
  switch(step.type){
   case 'template':result=render(step.template,scope);break;
   case 'knowledge':result=queryKnowledge(db,tenantId,render(step.query||step.prompt||'',scope));break;
   case 'branch':result=evaluate(step.condition,scope);next=result?step.yes:step.no;break;
   case 'end':result='finished';next=null;break;
   default:throw Error('Preview cannot safely simulate this step');
  }
  outputs[step.id]=result;
  trace.push({step_id:step.id,type:step.type,status:'previewed',next_step:next});
  if(JSON.stringify(outputs).length>50000)throw Error('Preview output is too large');
  cursor=next;
 }
 if(!stop&&cursor)throw Error('Preview step limit exceeded');
 return {mode:'safe-preview',workflow_id:workflow.id,trace,
  outputs,stopped_before_side_effect:stop,completed:!stop};
}
