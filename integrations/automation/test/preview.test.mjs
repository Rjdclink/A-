import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../src/server.mjs';

async function harness({aiFetch,httpRequest}={}){
 const app=createApp({dbPath:':memory:',autoStart:false,env:{ALLOW_SIGNUP:'true',SESSION_COOKIE_SECURE:'false'},aiFetch,httpRequest});
 await new Promise(done=>app.server.listen(0,'127.0.0.1',done));
 const base='http://127.0.0.1:'+app.server.address().port;let cookie='';
 const api=async(path,method='GET',body)=>{
  const res=await fetch(base+path,{method,headers:{origin:base,...(cookie?{cookie}:{}),...(body===undefined?{}:{'content-type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});
  const setCookie=res.headers.get('set-cookie');if(setCookie)cookie=setCookie.split(';')[0];
  return {status:res.status,data:await res.json()};
 };
 const signup=email=>api('/api/auth/register','POST',{name:'Preview Workspace',email,password:'a long private password'});
 const close=async()=>{app.stop();await new Promise(done=>app.server.close(done));app.db.close();};
 return {app,api,signup,close};
}
const finish={id:'finish',type:'end'};

test('preview executes deterministic text/branch steps and never writes an execution',async()=>{
 const h=await harness();try{
  await h.signup('preview@example.org');
  const spec={start:'draft',steps:[{id:'draft',type:'template',template:'Hello {{input.name}}',next:'gate'},
  {id:'gate',type:'branch',condition:{path:'input.approved',operator:'eq',value:true},yes:'yes',no:'no'},
  {id:'yes',type:'template',template:'Accepted {{steps.draft}}',next:'finish'},
  {id:'no',type:'template',template:'Denied',next:'finish'},finish]};
  const saved=await h.api('/api/workflows','POST',{name:'Branching preview',spec,enabled:false});
  const report=await h.api('/api/workflows/'+saved.data.id+'/preview','POST',{input:{name:'Ada',approved:true}});
  assert.equal(report.status,200,JSON.stringify(report.data));
  assert.equal(report.data.mode,'safe-preview');
  assert.equal(report.data.stopped_before_side_effect,false);
  assert.deepEqual(report.data.trace.map(x=>x.step_id),['draft','gate','yes','finish']);
  assert.equal(report.data.outputs.yes,'Accepted Hello Ada');
  assert.equal(h.app.db.prepare('SELECT COUNT(*) AS n FROM runs').get().n,0);
  assert.equal(h.app.db.prepare('SELECT COUNT(*) AS n FROM audit WHERE action=?').get('workflow.started').n,0);
 }finally{await h.close();}
});

test('preview stops before AI, external integrations and approvals without consuming tokens or sending requests',async()=>{
 let calledAI=0,calledHTTP=0;
 const h=await harness({aiFetch:async()=>{calledAI++;throw Error('must not invoke inference');},
  httpRequest:async()=>{calledHTTP++;throw Error('must not call integrations');}});
 try{
  await h.signup('safe@example.org');
  const specs=[
   {start:'ai',steps:[{id:'ai',type:'ai',prompt:'{{input.secret}}',next:'finish'},finish]},
   {start:'http',allowed_hosts:['api.example.org'],steps:[{id:'http',type:'http_post',url:'https://api.example.org/send',requires_approval:false,next:'finish'},finish]},
   {start:'authorize',steps:[{id:'authorize',type:'approval',message:'Review?',next:'finish'},finish]}
  ];
  for(const [i,spec] of specs.entries()){
   const saved=await h.api('/api/workflows','POST',{name:'Untrusted step '+i,spec,allow_external:true});
   const response=await h.api('/api/workflows/'+saved.data.id+'/preview','POST',{input:{secret:'private customer message'}});
   assert.equal(response.status,200);
   assert.equal(response.data.stopped_before_side_effect,true);
   assert.equal(response.data.trace.at(-1).status,'requires-live-run');
   assert.equal(JSON.stringify(response.data).includes('private customer message'),false);
  }
  assert.equal(calledAI,0);assert.equal(calledHTTP,0);
  assert.equal(h.app.db.prepare('SELECT COUNT(*) AS n FROM runs').get().n,0);
 }finally{await h.close();}
});

test('preview is tenant isolated and invalid payloads cannot run side effects',async()=>{
 const h=await harness();try{
  await h.signup('one@example.org');
  const created=await h.api('/api/workflows','POST',{name:'Private',spec:{start:'finish',steps:[finish]}});
  await h.signup('two@example.org');
  assert.equal((await h.api('/api/workflows/'+created.data.id+'/preview','POST',{input:{}})).status,404);
  const own=await h.api('/api/workflows','POST',{name:'Own',spec:{start:'finish',steps:[finish]}});
  const bad=await h.api('/api/workflows/'+own.data.id+'/preview','POST',{input:['invalid']});
  assert.equal(bad.status,400);
  assert.equal(h.app.db.prepare('SELECT COUNT(*) AS n FROM runs').get().n,0);
 }finally{await h.close();}
});

test('safe preview pauses before dependent nondeterministic values and does not claim an outcome',async()=>{
 const h=await harness();try{
  await h.signup('dependent@example.org');
  const spec={start:'first',steps:[
   {id:'first',type:'template',template:'Draft {{input.name}}',next:'agent'},
   {id:'agent',type:'agent_team',agents:[{name:'analyst',prompt:'read {{steps.first}}'},{name:'critic',prompt:'critique {{agents.analyst}}'}],next:'last'},
   {id:'last',type:'template',template:'Result {{steps.agent}}',next:'finish'},finish
  ]};
  const wf=await h.api('/api/workflows','POST',{name:'Complex preview',spec});
  const res=await h.api('/api/workflows/'+wf.data.id+'/preview','POST',{input:{name:'Sample'}});
  assert.equal(res.status,200);
  assert.deepEqual(res.data.trace.map(x=>x.step_id),['first','agent']);
  assert.equal(res.data.outputs.last,undefined);
  assert.ok(!JSON.stringify(res.data).includes('Result '));
 }finally{await h.close();}
});

test('preview may simulate an unsaved, validated graph without changing the saved automation',async()=>{
 const h=await harness();try{
  await h.signup('unsaved@example.org');
  const old={start:'draft',steps:[{id:'draft',type:'template',template:'Before',next:'finish'},finish]};
  const wf=await h.api('/api/workflows','POST',{name:'Existing',spec:old});
  const newDraft={start:'draft',steps:[{id:'draft',type:'template',template:'After {{input.name}}',next:'finish'},finish]};
  const preview=await h.api('/api/workflows/'+wf.data.id+'/preview','POST',{input:{name:'Taylor'},spec:newDraft});
  assert.equal(preview.status,200);
  assert.equal(preview.data.outputs.draft,'After Taylor');
  assert.equal((await h.api('/api/workflows/'+wf.data.id)).data.spec.steps[0].template,'Before');
  assert.equal(h.app.db.prepare('SELECT COUNT(*) AS n FROM runs').get().n,0);
  const bad=await h.api('/api/workflows/'+wf.data.id+'/preview','POST',{input:{},spec:{start:'bogus',steps:[finish]}});
  assert.equal(bad.status,400);
 }finally{await h.close();}
});

test('the visual editor offers preview without requiring the main dashboard to show technical data',async()=>{
 const {readFileSync}=await import('node:fs');
 const js=readFileSync(new URL('../public/designer.js',import.meta.url),'utf8');
 assert.match(js,/data-gv-action="preview"/);
 assert.match(js,/preview-plan/);
 assert.match(js,/Preview has no side effects/);
 const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
 const summary=html.split('<section id="dashboard"')[1].split('<section id="workflows"')[0];
 assert.equal((summary.match(/class="metric"/g)||[]).length,3);
});
