import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../src/server.mjs';
import {APP_CATALOG} from '../src/integrations/catalog.mjs';
import {connectionHeaders} from '../src/connections.mjs';
const env={ALLOW_SIGNUP:'true',SESSION_COOKIE_SECURE:'false',INTEGRATION_MASTER_KEY:'c'.repeat(64)};
test('all 95 profiles save encrypted credentials, resolve provider requests, verify and create connected workflows',async()=>{
 const requests=[];
 const app=createApp({dbPath:':memory:',autoStart:false,env,httpRequest:async args=>{requests.push(args);return JSON.stringify({ok:true,ID:1,data:{shop:{id:'fixture-shop'}}});}});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.server.address().port;let cookie='';
 async function api(path,body,method='POST'){const r=await fetch(base+path,{method,headers:{origin:base,cookie,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];return {status:r.status,data:await r.json()};}
 try{
  await api('/api/auth/register',{name:'Connections',email:'fixture@example.com',password:'fixture-password-long-enough'});
  const tenant=app.db.prepare('SELECT tenant_id FROM users').get().tenant_id;
  assert.equal(APP_CATALOG.length,95);
  for(const p of APP_CATALOG){
   const host=p.requires_instance_host?({databricks:'fixture.azuredatabricks.net',activecampaign:'fixture.api-us1.com',workday:'fixture.myworkday.com',mailchimp:'us1.api.mailchimp.com'}[p.id]||'fixture.'+p.hostname):p.hostname;
   const credentials=Object.fromEntries(p.fields.map(f=>[f.key,f.key==='endpoint_path'?'/ccx/api/v1/fixture/workers':f.key==='email'?'owner@example.com':'fixture_'+f.key]));
   const saved=await api('/api/integrations/connect',{provider_id:p.id,credentials,...(p.requires_instance_host?{host}:{})});assert.equal(saved.status,201,p.id+': '+JSON.stringify(saved.data));
   assert.ok(p.probe_path,p.id);
   const auth=connectionHeaders(app.db,tenant,saved.data.id,'https://'+host+p.probe_path,env);
   assert.equal(new URL(auth.url).hostname,host);assert.doesNotMatch(auth.url,/[{}]/,p.id);
   const verified=await api('/api/integrations/'+saved.data.id+'/test',{});assert.equal(verified.status,200,p.id+': '+JSON.stringify(verified.data));
   const workflow=await api('/api/integrations/'+saved.data.id+'/workflow',{});assert.equal(workflow.status,201,p.id+': '+JSON.stringify(workflow.data));
   assert.equal(workflow.data.spec.steps[0].connection_id,saved.data.id);
   assert.deepEqual(workflow.data.spec.allowed_hosts,[host]);
   const started=await api('/api/workflows/'+workflow.data.id+'/run',{input:{}});assert.equal(started.status,202,p.id);
   await app.tick();
   let execution=(await api('/api/runs/'+started.data.id,undefined,'GET')).data;
   if(execution.status==='awaiting_approval'){
    const pending=(await api('/api/approvals',undefined,'GET')).data.find(x=>x.run_id===started.data.id);
    assert.ok(pending,p.id);await api('/api/approvals/'+pending.id+'/approve',{});await app.tick();
    execution=(await api('/api/runs/'+started.data.id,undefined,'GET')).data;
   }
   assert.equal(execution.status,'completed',p.id+': '+JSON.stringify(execution));
   const raw=app.db.prepare('SELECT secret_cipher FROM connections WHERE id=?').get(saved.data.id);assert.ok(!raw.secret_cipher.includes('fixture_token'));
  }
  assert.equal(requests.length,190);
 }finally{app.stop();await new Promise(r=>app.server.close(r));app.db.close();}
});
