import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../src/server.mjs';

async function harness(){
 const app=createApp({dbPath:':memory:',autoStart:false,env:{ALLOW_SIGNUP:'true',SESSION_COOKIE_SECURE:'false'}});
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+app.server.address().port;
 let cookie='';
 const request=async(path,method='GET',body)=>{
  const r=await fetch(base+path,{method,headers:{origin:base,...(body===undefined?{}:{'content-type':'application/json'}),...(cookie?{cookie}:{})},body:body===undefined?undefined:JSON.stringify(body)});
  if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];
  return {status:r.status,data:await r.json()};
 };
 const signup=async(email)=>request('/api/auth/register','POST',{name:'Private Workspace',email,password:'a long test password'});
 const close=async()=>{app.stop();await new Promise(r=>app.server.close(r));app.db.close();};
 return {app,request,signup,close};
}
const spec=(text)=>({start:'start',steps:[{id:'start',type:'template',template:text,next:'done'},{id:'done',type:'end'}]});

test('saving and editing an automation produces durable historical revisions and restores a prior version',async()=>{
 const h=await harness();try{
  assert.equal((await h.signup('first@example.com')).status,201);
  const created=await h.request('/api/workflows','POST',{name:'Greeting',spec:spec('Version one {{input.name}}'),trigger:{type:'manual'}});
  assert.equal(created.status,201);
  const id=created.data.id;
  const first=await h.request('/api/workflows/'+id+'/revisions');
  assert.equal(first.status,200,'history must be available to the owner');
  assert.deepEqual(first.data.map(x=>x.revision),[1]);
  const changed=await h.request('/api/workflows/'+id,'PATCH',{name:'Greeting revised',spec:spec('Version two {{input.name}}')});
  assert.equal(changed.status,200);
  const listed=await h.request('/api/workflows/'+id+'/revisions');
  assert.deepEqual(listed.data.map(x=>x.revision),[2,1]);
  const old=await h.request('/api/workflows/'+id+'/revisions/1');
  assert.equal(old.data.spec.steps[0].template,'Version one {{input.name}}');
  const recovered=await h.request('/api/workflows/'+id+'/revisions/1/restore','POST',{});
  assert.equal(recovered.status,200);
  assert.equal(recovered.data.spec.steps[0].template,'Version one {{input.name}}');
  assert.equal(recovered.data.name,'Greeting');
  assert.deepEqual((await h.request('/api/workflows/'+id+'/revisions')).data.map(x=>x.revision),[3,2,1]);
  const started=await h.request('/api/workflows/'+id+'/run','POST',{input:{name:'Ada'}});
  await h.app.tick();
  const result=await h.request('/api/runs/'+started.data.id);
  assert.equal(result.data.state.steps.start,'Version one Ada');
 }finally{await h.close();}
});

test('idempotent edits do not create revisions and active jobs block restoration',async()=>{
 const h=await harness();try{
  await h.signup('active@example.com');
  const created=await h.request('/api/workflows','POST',{name:'First automation',spec:spec('Original')});
  const id=created.data.id;
  const same=await h.request('/api/workflows/'+id,'PATCH',{name:'First automation'});
  assert.equal(same.status,200);
  assert.equal((await h.request('/api/workflows/'+id+'/revisions')).data.length,1);
  await h.request('/api/workflows/'+id,'PATCH',{spec:spec('Updated')});
  const queued=await h.request('/api/workflows/'+id+'/run','POST',{input:{}});
  assert.equal(queued.status,202);
  const refused=await h.request('/api/workflows/'+id+'/revisions/1/restore','POST',{});
  assert.equal(refused.status,409);
  assert.equal((await h.request('/api/workflows/'+id+'/revisions')).data.length,2);
  await h.app.tick();
  const restored=await h.request('/api/workflows/'+id+'/revisions/1/restore','POST',{});
  assert.equal(restored.status,200);
 }finally{await h.close();}
});

test('history cannot be read or restored by a different workspace owner',async()=>{
 const h=await harness();try{
  await h.signup('one@example.com');
  const created=await h.request('/api/workflows','POST',{name:'Owner flow',spec:spec('Private data')});
  await h.signup('two@example.com');
  assert.equal((await h.request('/api/workflows/'+created.data.id+'/revisions')).status,404);
  assert.equal((await h.request('/api/workflows/'+created.data.id+'/revisions/1')).status,404);
  assert.equal((await h.request('/api/workflows/'+created.data.id+'/revisions/1/restore','POST',{})).status,404);
 }finally{await h.close();}
});
