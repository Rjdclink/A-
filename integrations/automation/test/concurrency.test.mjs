import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../src/server.mjs';

async function scenario(responseFactory){
 let begin; const entered=new Promise(resolve=>{begin=resolve});
 let finish;const result=new Promise((resolve,reject)=>{finish={resolve,reject}});
 const app=createApp({dbPath:':memory:',autoStart:false,env:{ALLOW_SIGNUP:'true',SESSION_COOKIE_SECURE:'false'},aiFetch:async()=>{begin();return result}});
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
 const base=`http://127.0.0.1:${app.server.address().port}`;let cookie='';
 async function call(path,method='GET',body){
  const r=await fetch(base+path,{method,headers:{origin:base,...(cookie?{cookie}:{}),...(body===undefined?{}:{'content-type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});
  if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];
  return {status:r.status,data:await r.json()};
 }
 try{
  await call('/api/auth/register','POST',{name:'Cancellation Test',email:'cancel@example.com',password:'secure password for tests'});
  const flow={start:'ai',steps:[{id:'ai',type:'ai',prompt:'{{input.text}}',next:'send'},{id:'send',type:'template',template:'sent: {{steps.ai}}',next:'done'},{id:'done',type:'end'}]};
  const workflow=await call('/api/workflows','POST',{name:'Slow AI worker',spec:flow});
  const queued=await call(`/api/workflows/${workflow.data.id}/run`,'POST',{input:{text:'test'}});
  const executing=app.tick();await entered;
  const cancelled=await call(`/api/runs/${queued.data.id}/cancel`,'POST',{});
  assert.equal(cancelled.status,200);
  responseFactory(finish);
  await executing;
  const run=await call(`/api/runs/${queued.data.id}`);
  assert.equal(run.data.status,'cancelled','in-flight job must not restart after cancellation');
  assert.equal(run.data.state.steps.send,undefined,'no downstream work is allowed after cancellation');
  return run;
 }finally{app.stop();await new Promise(resolve=>app.server.close(resolve));app.db.close();}
}

test('cancelling during a slow AI request does not resume downstream actions',async()=>{
 const r=await scenario(f=>f.resolve(new Response(JSON.stringify({choices:[{message:{content:'draft'}}]}),{status:200})));
 assert.equal(r.data.state.steps.ai,undefined,'cancelled response should not overwrite the saved checkpoint');
});

test('failure of an in-flight cancelled task never requeues it',async()=>{
 await scenario(f=>f.reject(Error('provider unavailable')));
});
