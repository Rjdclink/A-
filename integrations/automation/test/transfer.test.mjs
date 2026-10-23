import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../src/server.mjs';

async function harness(){
 const app=createApp({dbPath:':memory:',autoStart:false,env:{ALLOW_SIGNUP:'true',SESSION_COOKIE_SECURE:'false'}});
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+app.server.address().port;let cookie='';
 const request=async(path,method='GET',body)=>{
  const r=await fetch(base+path,{method,headers:{origin:base,...(cookie?{cookie}:{}),...(body===undefined?{}:{'content-type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});
  if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];
  return {status:r.status,data:await r.json()};
 };
 const signup=email=>request('/api/auth/register','POST',{name:'Transfer Owner',email,password:'very long test password'});
 const close=async()=>{app.stop();await new Promise(r=>app.server.close(r));app.db.close();};
 return {app,request,signup,close};
}
test('workflow transfer excludes credentials, starts paused, rotates webhook secrets',async()=>{
 const h=await harness();try{
  await h.signup('transfer@example.com');
  const spec={start:'send',allowed_hosts:['api.example.com'],steps:[{id:'send',type:'http_post',url:'https://api.example.com/send',connection_id:'00000000-0000-4000-8000-000000000002',body_template:'{{input.body}}',next:'end'},{id:'end',type:'end'}]};
  const old=await h.request('/api/workflows','POST',{name:'Outbound alert',spec,trigger:{type:'webhook'},allow_external:true});
  assert.equal(old.status,201);
  const exported=await h.request('/api/workflows/'+old.data.id+'/export');
  assert.equal(exported.status,200);
  assert.equal(exported.data.format,'growthveyra-workflow');
  assert.equal(exported.data.schema_version,1);
  assert.equal(exported.data.spec.steps[0].connection_id,undefined);
  assert.doesNotMatch(JSON.stringify(exported.data),new RegExp(old.data.webhook_secret));
  const imported=await h.request('/api/workflows/import','POST',{...exported.data,enabled:true,allow_external:true});
  assert.equal(imported.status,201,JSON.stringify(imported.data));
  assert.notEqual(imported.data.id,old.data.id);
  assert.equal(imported.data.enabled,false);
  assert.equal(imported.data.allow_external,false);
  assert.notEqual(imported.data.webhook_secret,old.data.webhook_secret);
  assert.equal(imported.data.spec.steps[0].connection_id,undefined);
  assert.equal((await h.request('/api/workflows/'+imported.data.id+'/revisions')).data.length,1);
 }finally{await h.close();}
});
test('workspace exports cannot be accessed by other owners and invalid imports do not create automations',async()=>{
 const h=await harness();try{
  await h.signup('owner@example.com');
  const created=await h.request('/api/workflows','POST',{name:'Private flow',spec:{start:'done',steps:[{id:'done',type:'end'}]}});
  await h.signup('other@example.com');
  assert.equal((await h.request('/api/workflows/'+created.data.id+'/export')).status,404);
  const bad=await h.request('/api/workflows/import','POST',{format:'growthveyra-workflow',schema_version:1,name:'Invalid graph',spec:{start:'missing',steps:[{id:'done',type:'end'}]},trigger:{type:'manual'}});
  assert.equal(bad.status,400);
  assert.equal((await h.request('/api/workflows')).data.length,0);
 }finally{await h.close();}
});
