import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../src/server.mjs';
import {first} from '../src/core.mjs';

async function makeHarness(httpRequest){
 const app=createApp({dbPath:':memory:',autoStart:false,env:{ALLOW_SIGNUP:'true',SESSION_COOKIE_SECURE:'false'},httpRequest});
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+app.server.address().port;let cookie='';
 async function api(path,method='GET',body){
  const res=await fetch(base+path,{method,headers:{origin:base,...(body===undefined?{}:{'content-type':'application/json'}),...(cookie?{cookie}:{})},body:body===undefined?undefined:JSON.stringify(body)});
  if(res.headers.get('set-cookie'))cookie=res.headers.get('set-cookie').split(';')[0];
  return {status:res.status,data:await res.json()};
 }
 await api('/api/auth/register','POST',{name:'External Tasks',email:'external@example.org',password:'long, secure test password'});
 return {app,api,stop:async()=>{app.stop();await new Promise(resolve=>app.server.close(resolve));app.db.close();}};
}

test('successful external POST is receipted before run checkpoint; retry reuses receipt without another send',async()=>{
 let posts=0;
 const h=await makeHarness(async()=>{posts++;return 'external id 123';});
 try{
  const spec={allowed_hosts:['api.example.com'],start:'submit',steps:[{id:'submit',type:'http_post',url:'https://api.example.com/submit',requires_approval:false,body_template:'{{input.request}}',next:'done'},{id:'done',type:'end'}]};
  const wf=await h.api('/api/workflows','POST',{name:'Exactly once after checkpoint failure',spec,allow_external:true});
  assert.equal(wf.status,201,JSON.stringify(wf.data));
  const started=await h.api(`/api/workflows/${wf.data.id}/run`,'POST',{input:{request:'send me'}});
  // Force a post-response local checkpoint failure. The downstream external service has already answered.
  h.app.db.exec(`CREATE TRIGGER transient_state_failure BEFORE UPDATE OF state ON runs
    WHEN NEW.state LIKE '%external id 123%' BEGIN SELECT RAISE(FAIL,'test crash after remote acknowledgement'); END;`);
  await h.app.tick();
  assert.equal(posts,1);
  const receipt=first(h.app.db,'SELECT * FROM action_receipts WHERE run_id=? AND step_id=?',started.data.id,'submit');
  assert.equal(receipt?.response,'external id 123','external completion must be durably recorded before changing run checkpoint');
  const paused=await h.api(`/api/runs/${started.data.id}`);
  assert.equal(paused.data.status,'queued');
  h.app.db.exec('DROP TRIGGER transient_state_failure');
  await h.app.tick(Date.now()+10000);
  const completed=await h.api(`/api/runs/${started.data.id}`);
  assert.equal(completed.data.status,'completed',JSON.stringify(completed.data));
  assert.equal(completed.data.state.steps.submit,'external id 123');
  assert.equal(posts,1,'do not repeat external POST when receipt already exists');
 }finally{await h.stop();}
});

test('external POST failures never create success receipts',async()=>{
 const h=await makeHarness(async()=>{throw Error('service unavailable');});
 try{
  const spec={allowed_hosts:['api.example.com'],start:'submit',steps:[{id:'submit',type:'http_post',url:'https://api.example.com/submit',requires_approval:false,next:'done'},{id:'done',type:'end'}]};
  const wf=await h.api('/api/workflows','POST',{name:'Failed transport',spec,allow_external:true});
  const started=await h.api(`/api/workflows/${wf.data.id}/run`,'POST',{input:{}});
  await h.app.tick();
  assert.equal(first(h.app.db,'SELECT COUNT(*) AS n FROM action_receipts WHERE run_id=?',started.data.id).n,0);
 }finally{await h.stop();}
});
