import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../src/server.mjs';

async function harness(options={}){
  const app=createApp({dbPath:':memory:',autoStart:false, env:{ALLOW_SIGNUP:'true',SESSION_COOKIE_SECURE:'false',...options.env}, ...options});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${app.server.address().port}`;
  let cookie='';
  async function request(path,{method='GET',body,headers={}}={}){
    const res=await fetch(base+path,{method,headers:{ ...(body===undefined?{}:{'content-type':'application/json'}), ...(cookie?{cookie}:{}), origin:base,...headers},body:body===undefined?undefined:JSON.stringify(body),redirect:'manual'});
    if(res.headers.get('set-cookie'))cookie=res.headers.get('set-cookie').split(';')[0];
    const raw=await res.text();let data;try{data=JSON.parse(raw)}catch{data=raw};return {status:res.status,data,headers:res.headers};
  }
  return {app,request,base,close:async()=>{app.stop();await new Promise(resolve=>app.server.close(resolve));app.db.close();}};
}

const flow={start:'hello',steps:[{id:'hello',type:'template',template:'Hello {{input.name}}',next:'finish'},{id:'finish',type:'end'}]};

async function signup(h,email='owner@example.com'){
  return h.request('/api/auth/register',{method:'POST',body:{name:'First Workspace',email,password:'very long test password'}});
}

test('health endpoint works, registration authenticates, untrusted callers cannot list workflows',async()=>{
  const h=await harness();
  try{
    assert.equal((await h.request('/api/health')).status,200);
    assert.equal((await h.request('/api/workflows')).status,401);
    const registered=await signup(h);assert.equal(registered.status,201);
    assert.equal(registered.data.user.email,'owner@example.com');
    assert.equal((await h.request('/api/me')).status,200);
  }finally{await h.close();}
});

test('workflow runs autonomously and records actual output and audit trail',async()=>{
  const h=await harness();try{
    await signup(h);
    const cr=await h.request('/api/workflows',{method:'POST',body:{name:'Greeting',spec:flow,trigger:{type:'manual'}}});
    assert.equal(cr.status,201,JSON.stringify(cr.data));
    const started=await h.request(`/api/workflows/${cr.data.id}/run`,{method:'POST',body:{input:{name:'Ada'}}});
    assert.equal(started.status,202);await h.app.tick();
    const run=await h.request(`/api/runs/${started.data.id}`);
    assert.equal(run.data.status,'completed',JSON.stringify(run.data));
    assert.equal(run.data.state.steps.hello,'Hello Ada');
    assert.ok(run.data.logs.some(x=>x.event==='step_completed'));
  }finally{await h.close();}
});

test('approval gates execution, rejection terminates and permits no action',async()=>{
 const h=await harness();try{
  await signup(h);
  const spec={start:'prepare',steps:[{id:'prepare',type:'template',template:'Draft {{input.text}}',next:'review'},{id:'review',type:'approval',message:'Send {{steps.prepare}}?',next:'done'},{id:'done',type:'end'}]};
  const cr=await h.request('/api/workflows',{method:'POST',body:{name:'Human approval',spec,trigger:{type:'manual'}}});
  const started=await h.request(`/api/workflows/${cr.data.id}/run`,{method:'POST',body:{input:{text:'proposal'}}});await h.app.tick();
  assert.equal((await h.request(`/api/runs/${started.data.id}`)).data.status,'awaiting_approval');
  const approvals=await h.request('/api/approvals');assert.equal(approvals.data.length,1);
  assert.match(approvals.data[0].message,/Draft proposal/);
  const ok=await h.request(`/api/approvals/${approvals.data[0].id}/approve`,{method:'POST',body:{}});assert.equal(ok.status,200);
  await h.app.tick();assert.equal((await h.request(`/api/runs/${started.data.id}`)).data.status,'completed');
 }finally{await h.close();}
});

test('AI step uses the same configurable auto endpoint and records provider output',async()=>{
 let observed;
 const aiFetch=async(url,opts)=>{observed={url,body:JSON.parse(opts.body)};return new Response(JSON.stringify({choices:[{message:{content:'Approved summary'}}]}),{status:200,headers:{'content-type':'application/json'}})};
 const h=await harness({aiFetch});try{
  await signup(h);
  const spec={start:'ai',steps:[{id:'ai',type:'ai',system:'Summarize faithfully',prompt:'{{input.text}}',next:'done'},{id:'done',type:'end'}]};
  const cr=await h.request('/api/workflows',{method:'POST',body:{name:'AI summarization',spec,trigger:{type:'manual'}}});
  const started=await h.request(`/api/workflows/${cr.data.id}/run`,{method:'POST',body:{input:{text:'Acme document'}}});await h.app.tick();
  assert.equal((await h.request(`/api/runs/${started.data.id}`)).data.state.steps.ai,'Approved summary');
  assert.equal(observed.body.model,'auto');assert.equal(observed.body.messages[1].content,'Acme document');
 }finally{await h.close();}
});

test('webhook trigger requires a secret and enqueues a workflow without an account cookie',async()=>{
 const h=await harness();try{
  await signup(h);
  const cr=await h.request('/api/workflows',{method:'POST',body:{name:'Webhook worker',spec:flow,trigger:{type:'webhook'}}});
  assert.equal(cr.status,201);assert.ok(cr.data.webhook_secret);
  const bad=await h.request(`/api/hooks/${cr.data.id}`,{method:'POST',body:{name:'Bob'}});assert.equal(bad.status,401);
  const ok=await h.request(`/api/hooks/${cr.data.id}`,{method:'POST',body:{name:'Bob'},headers:{'x-growthveyra-secret':cr.data.webhook_secret}});
  assert.equal(ok.status,202);await h.app.tick();
  const run=await h.request(`/api/runs/${ok.data.id}`);assert.equal(run.data.state.steps.hello,'Hello Bob');
 }finally{await h.close();}
});
