import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../src/server.mjs';
import {validateWorkflow} from '../src/engine.mjs';
const graph={start:'a',steps:[{id:'a',type:'template',template:'{{input.text}}',next:'b'},{id:'b',type:'end'}]};
async function h({aiFetch}={}){
 const app=createApp({dbPath:':memory:',autoStart:false,env:{ALLOW_SIGNUP:'true',SESSION_COOKIE_SECURE:'false'},aiFetch});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.server.address().port;let cookie='';
 async function request(path,method='GET',payload,headers={}){
  const response=await fetch(base+path,{method,headers:{origin:base,...(payload===undefined?{}:{'content-type':'application/json'}),...(cookie?{cookie}:{}),...headers},body:payload===undefined?undefined:JSON.stringify(payload)});const ck=response.headers.get('set-cookie');if(ck)cookie=ck.split(';')[0];return {status:response.status,data:await response.json()};
 }
 await request('/api/auth/register','POST',{email:'test@example.net',name:'Test workspace',password:'secure testing phrase 2026'});
 return {app,request,done:async()=>{app.stop();await new Promise(r=>app.server.close(r));app.db.close();}};
}

test('bad JSON workflow returns an actionable rejection without saving',async()=>{const t=await h();try{
 const res=await t.request('/api/workflows','POST',{name:'Invalid workflow',spec:{start:'a',steps:[{id:'a',type:'unknown'}]}});
 assert.equal(res.status,400);assert.match(res.data.error,/Unsupported step/);
 assert.equal((await t.request('/api/workflows')).data.length,0);
}finally{await t.done();}});

test('consequential workflow editing is refused while an approval is pending',async()=>{const t=await h();try{
 const spec={start:'approve',steps:[{id:'approve',type:'approval',message:'Please approve',next:'end'},{id:'end',type:'end'}]};
 const w=await t.request('/api/workflows','POST',{name:'Approval workflow',spec});
 const r=await t.request(`/api/workflows/${w.data.id}/run`,'POST',{input:{}});await t.app.tick();
 assert.equal((await t.request(`/api/runs/${r.data.id}`)).data.status,'awaiting_approval');
 const updated=await t.request(`/api/workflows/${w.data.id}`,'PATCH',{spec:graph});
 assert.equal(updated.status,409);
}finally{await t.done();}});

test('failed AI invocations retry and eventually settle in a failed terminal state',async()=>{
 const t=await h({aiFetch:async()=>{throw Error('Provider unavailable');}});try{
 const spec={start:'ai',steps:[{id:'ai',type:'ai',prompt:'{{input.text}}',next:'end'},{id:'end',type:'end'}]};
 const w=await t.request('/api/workflows','POST',{name:'AI failures',spec});const r=await t.request(`/api/workflows/${w.data.id}/run`,'POST',{input:{text:'Test'}});
 const start=Date.now();await t.app.tick(start);await t.app.tick(start+10000);await t.app.tick(start+20000);
 const result=await t.request(`/api/runs/${r.data.id}`);
 assert.equal(result.data.status,'failed');assert.equal(result.data.attempts,3);assert.match(result.data.error,/Provider unavailable/);
}finally{await t.done();}
});

test('rejecting an approval terminates the run without continuing',async()=>{const t=await h();try{
 const spec={start:'approval',steps:[{id:'approval',type:'approval',message:'Approve?',next:'finish'},{id:'finish',type:'template',template:'should not run'}]};
 const wf=await t.request('/api/workflows','POST',{name:'Protected',spec});const r=await t.request(`/api/workflows/${wf.data.id}/run`,'POST',{input:{}});
 await t.app.tick();const approvals=(await t.request('/api/approvals')).data;
 await t.request('/api/approvals/'+approvals[0].id+'/reject','POST',{});await t.app.tick();
 const finished=await t.request('/api/runs/'+r.data.id);assert.equal(finished.data.status,'rejected');assert.equal(finished.data.state.steps.finish,undefined);
}finally{await t.done();}});

test('workflow specs cannot bypass graph validation with unreachable nodes',()=>{
 assert.throws(()=>validateWorkflow({start:'a',steps:[{id:'a',type:'end'},{id:'unused',type:'end'}]}),/unreachable/);
});
