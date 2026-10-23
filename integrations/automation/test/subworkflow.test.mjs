import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../src/server.mjs';
import {claim,execute} from '../src/runner.mjs';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';

const uuid=()=>randomUUID();
const last={id:'finish',type:'end'};
const childSpec={start:'respond',steps:[{id:'respond',type:'template',template:'Child says {{input.task}}',next:'finish'},last]};
const parentSpec=childId=>({start:'delegate',steps:[{id:'delegate',type:'subworkflow',workflow_id:childId,input_map:{task:'{{input.request}}'},next:'return'},{id:'return',type:'template',template:'Parent received {{steps.delegate.output}}',next:'finish'},last]});
async function harness({dbPath=':memory:'}={}){
 const env={ALLOW_SIGNUP:'true',SESSION_COOKIE_SECURE:'false'};
 const app=createApp({dbPath,autoStart:false,env});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
 const origin='http://127.0.0.1:'+app.server.address().port;let cookie='';
 async function api(path,method='GET',body){
  const r=await fetch(origin+path,{method,headers:{origin,...(cookie?{cookie}:{}),...(body===undefined?{}:{'content-type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});
  if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];
  return {status:r.status,data:await r.json()};
 }
 const signup=email=>api('/api/auth/register','POST',{name:'Parent Child Test',email,password:'a long test password'});
 const close=async()=>{app.stop();await new Promise(r=>app.server.close(r));app.db.close();};
 return {app,env,api,signup,close};
}
async function save(h,name,spec){const r=await h.api('/api/workflows','POST',{name,spec});assert.equal(r.status,201,JSON.stringify(r.data));return r.data;}

test('parent workflow runs a reusable child, awaits its output and resumes without manual polling',async()=>{
 const h=await harness();try{
  await h.signup('calls@example.org');
  const child=await save(h,'Reusable customer response',childSpec);
  const parent=await save(h,'Dispatcher',parentSpec(child.id));
  const started=await h.api('/api/workflows/'+parent.id+'/run','POST',{input:{request:'fulfillment'}});
  const count=await h.app.tick();
  assert.ok(count>=3);
  const done=await h.api('/api/runs/'+started.data.id);
  assert.equal(done.data.status,'completed');
  assert.equal(done.data.state.steps.return,'Parent received Child says fulfillment');
  assert.equal(done.data.children.length,1);
  assert.equal(done.data.children[0].status,'completed');
  const logs=done.data.logs.map(x=>x.event);
  assert.ok(logs.includes('child_started'));
  assert.ok(logs.includes('run_completed'));
 }finally{await h.close();}
});

test('child execution survives process restart and completes the waiting parent',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'gv-child-'));
 const path=join(dir,'data.sqlite');
 let h=await harness({dbPath:path});
 try{
  await h.signup('restart@example.org');
  const child=await save(h,'Child',childSpec);
  const parent=await save(h,'Parent',parentSpec(child.id));
  const started=await h.api('/api/workflows/'+parent.id+'/run','POST',{input:{request:'restart'}});
  const claimed=claim(h.app.db,Date.now());
  await execute(h.app.db,claimed);
  const paused=await h.api('/api/runs/'+started.data.id);
  assert.equal(paused.data.status,'awaiting_child');
  assert.equal(paused.data.children.length,1);
  await h.close();
  h=await harness({dbPath:path});
  await h.app.tick();
  const completed=await h.api('/api/runs/'+started.data.id);
  // Reconnect the authorized existing owner session after restart.
  if(completed.status===401){
   const login=await h.api('/api/auth/login','POST',{email:'restart@example.org',password:'a long test password'});
   assert.equal(login.status,200);
  }
  const result=await h.api('/api/runs/'+started.data.id);
  assert.equal(result.data.status,'completed');
  assert.equal(result.data.state.steps.return,'Parent received Child says restart');
  assert.equal(result.data.children.length,1);
 }finally{await h.close();await rm(dir,{recursive:true,force:true});}
});

test('subworkflow references may not traverse tenants or recurse back to an ancestor',async()=>{
 const h=await harness();try{
  await h.signup('original@example.org');
  const first=await save(h,'Owner child',childSpec);
  await h.signup('other@example.org');
  const parent=await save(h,'Foreign child reference',parentSpec(first.id));
  const bad=await h.api('/api/workflows/'+parent.id+'/run','POST',{input:{request:'private'}});
  for(let i=0;i<3;i++)await h.app.tick(Date.now()+i*10000);
  const failed=await h.api('/api/runs/'+bad.data.id);
  assert.equal(failed.data.status,'failed');
  assert.equal(failed.data.children.length,0);
  assert.match(failed.data.error,/not found|not available/i);
  // A self-reference must fail before any child is ever enqueued.
  const selfSpec=parentSpec(parent.id);
  await h.api('/api/workflows/'+parent.id,'PATCH',{spec:selfSpec});
  const loop=await h.api('/api/workflows/'+parent.id+'/run','POST',{input:{}});
  for(let i=0;i<3;i++)await h.app.tick(Date.now()+30000+i*10000);
  const stopped=await h.api('/api/runs/'+loop.data.id);
  assert.equal(stopped.data.status,'failed');
  assert.equal(stopped.data.children.length,0);
  assert.match(stopped.data.error,/recurs/i);
 }finally{await h.close();}
});

test('cancelling a waiting parent prevents queued child action and keeps the audit history',async()=>{
 const h=await harness();try{
  await h.signup('cancel@example.org');
  const child=await save(h,'Child',childSpec);
  const parent=await save(h,'Parent',parentSpec(child.id));
  const start=await h.api('/api/workflows/'+parent.id+'/run','POST',{input:{request:'stop'}});
  const run=claim(h.app.db,Date.now());await execute(h.app.db,run);
  const before=await h.api('/api/runs/'+start.data.id);assert.equal(before.data.status,'awaiting_child');
  const cancel=await h.api('/api/runs/'+start.data.id+'/cancel','POST',{});
  assert.equal(cancel.status,200);
  await h.app.tick();
  const result=await h.api('/api/runs/'+start.data.id);
  assert.equal(result.data.status,'cancelled');
  assert.equal(result.data.children[0].status,'cancelled');
  assert.equal(result.data.children[0].id,before.data.children[0].id);
 }finally{await h.close();}
});

test('workflow validator rejects malformed subworkflow calls',async()=>{
 const {validateWorkflow}=await import('../src/engine.mjs');
 for(const step of [
  {type:'subworkflow',workflow_id:'not-a-uuid'},
  {type:'subworkflow',workflow_id:uuid(),input_map:{task:3}},
  {type:'subworkflow',workflow_id:uuid(),input_map:Object.fromEntries(Array.from({length:23},(_,i)=>['k'+i,'x']))}
 ]){
  assert.throws(()=>validateWorkflow({start:'call',steps:[{id:'call',...step,next:'finish'},last]}),/subworkflow|input/i);
 }
});

test('child workflow returns its last executed result, independent of specification ordering',async()=>{
 const h=await harness();try{
  await h.signup('ordering@example.org');
  const unordered={start:'first',steps:[
   {id:'second',type:'template',template:'Second {{steps.first}}',next:'finish'},
   {id:'first',type:'template',template:'First {{input.task}}',next:'second'},
   last]};
  const child=await save(h,'Unordered declaration',unordered);
  const parent=await save(h,'Caller',parentSpec(child.id));
  const start=await h.api('/api/workflows/'+parent.id+'/run','POST',{input:{request:'ready'}});
  await h.app.tick();
  const result=await h.api('/api/runs/'+start.data.id);
  assert.equal(result.data.status,'completed');
  assert.equal(result.data.state.steps.return,'Parent received Second First ready');
 }finally{await h.close();}
});

test('cancelling a parent also resolves pending descendant approvals',async()=>{
 const h=await harness();try{
  await h.signup('approval-cancel@example.org');
  const child=await save(h,'Approval child',{start:'review',steps:[{id:'review',type:'approval',message:'Approve child step?',next:'finish'},last]});
  const parent=await save(h,'Parent',parentSpec(child.id));
  const started=await h.api('/api/workflows/'+parent.id+'/run','POST',{input:{request:'test'}});
  await h.app.tick();
  const before=await h.api('/api/approvals');
  assert.equal(before.data.length,1);
  const cancelled=await h.api('/api/runs/'+started.data.id+'/cancel','POST',{});
  assert.equal(cancelled.status,200);
  assert.equal((await h.api('/api/approvals')).data.length,0,'cancelled descendants must not leave actionable pending approvals');
  const stale=await h.api('/api/approvals/'+before.data[0].id+'/approve','POST',{});
  assert.equal(stale.status,409);
 }finally{await h.close();}
});
