import test from 'node:test';
import assert from 'node:assert/strict';
import {aiComplete} from '../src/runner.mjs';
import {createApp} from '../src/server.mjs';

const mock=(content,usage,model='provider-model')=>new Response(JSON.stringify({model,choices:[{message:{content}}],...(usage?{usage}:{})}),{status:200});
async function fixture({env={},aiFetch}={}){
 const app=createApp({dbPath:':memory:',autoStart:false,aiFetch,env:{ALLOW_SIGNUP:'true',SESSION_COOKIE_SECURE:'false',...env}});
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
 let cookie='';const origin='http://127.0.0.1:'+app.server.address().port;
 const req=async(path,method='GET',body)=>{
  const res=await fetch(origin+path,{method,headers:{origin,...(cookie?{cookie}:{}),...(body===undefined?{}:{'content-type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});
  if(res.headers.get('set-cookie'))cookie=res.headers.get('set-cookie').split(';')[0];
  return {status:res.status,data:await res.json()};
 };
 const signup=email=>req('/api/auth/register','POST',{name:'AI Budget',email,password:'very long testing password'});
 const close=async()=>{app.stop();await new Promise(resolve=>app.server.close(resolve));app.db.close();};
 return {app,req,signup,close};
}

test('AI completion exposes actual usage without changing the existing text API',async()=>{
 const options={env:{AI_BASE_URL:'https://model.example/v1/chat/completions',AI_MODEL:'auto'},
  fetchImpl:async()=>mock('Hello', {prompt_tokens:37,completion_tokens:12,total_tokens:49},'actual-served-model')};
 const fullFn=(await import('../src/runner.mjs')).aiCompleteDetailed;
 assert.equal(typeof fullFn,'function','detailed AI completion must be available');
 const full=await fullFn('System','User',options);
 assert.equal(full.text,'Hello');
 assert.equal(full.provider,'primary');
 assert.equal(full.model,'actual-served-model');
 assert.deepEqual(full.usage,{prompt_tokens:37,completion_tokens:12,total_tokens:49});
 assert.equal(await aiComplete('System','User',options),'Hello');
});

test('missing AI usage remains null and is never synthesized from prompt length',async()=>{
 const fullFn=(await import('../src/runner.mjs')).aiCompleteDetailed;
 assert.equal(typeof fullFn,'function');
 const record=await fullFn('System','User',{
  env:{AI_BASE_URL:'https://model.example/v1/chat/completions'},
  fetchImpl:async()=>mock('Response',null)});
 assert.deepEqual(record.usage,{prompt_tokens:null,completion_tokens:null,total_tokens:null});
});

test('AI invocations are bounded per run and completed call usage is recorded without prompts',async()=>{
 let received=0;
 const h=await fixture({env:{MAX_AI_CALLS_PER_RUN:'1'},aiFetch:async()=>{received++;return mock('answer',{prompt_tokens:5,completion_tokens:3,total_tokens:8})}});
 try{
  await h.signup('budget@example.org');
  const spec={start:'one',steps:[{id:'one',type:'ai',prompt:'confidential content',next:'two'},{id:'two',type:'ai',prompt:'another request',next:'finish'},{id:'finish',type:'end'}]};
  const wf=await h.req('/api/workflows','POST',{name:'Bounded calls',spec});
  const created=await h.req('/api/workflows/'+wf.data.id+'/run','POST',{input:{}});
  const stamp=Date.now();await h.app.tick(stamp);await h.app.tick(stamp+10000);await h.app.tick(stamp+20000);
  const done=await h.req('/api/runs/'+created.data.id);
  assert.equal(done.data.status,'failed');
  assert.match(done.data.error,/budget/i);
  assert.equal(received,1);
  assert.equal(done.data.ai_invocations,1);
  assert.equal(h.app.db.prepare('SELECT COUNT(*) AS n FROM ai_calls WHERE run_id=?').get(created.data.id).n,1);
  const info=h.app.db.prepare('SELECT * FROM ai_calls WHERE run_id=?').get(created.data.id);
  assert.equal(info.total_tokens,8);
  assert.equal(info.prompt_tokens,5);
  assert.equal(info.completion_tokens,3);
  assert.doesNotMatch(JSON.stringify(info),/confidential content|another request/i);
  const insight=(await h.req('/api/insights')).data;
  assert.equal(insight.ai_usage.completed_calls,1);
  assert.equal(insight.ai_usage.reported_tokens,8);
  assert.equal(insight.ai_usage.calls_missing_usage,0);
 }finally{await h.close();}
});

test('AI telemetry never pretends to know token usage omitted by an inference provider',async()=>{
 const h=await fixture({aiFetch:async()=>mock('text',null)});
 try{
  await h.signup('unknown-tokens@example.org');
  const wf=await h.req('/api/workflows','POST',{name:'AI',spec:{start:'a',steps:[{id:'a',type:'ai',prompt:'Hi',next:'end'},{id:'end',type:'end'}]}});
  await h.req('/api/workflows/'+wf.data.id+'/run','POST',{input:{}});
  await h.app.tick();
  const metrics=(await h.req('/api/insights')).data.ai_usage;
  assert.equal(metrics.completed_calls,1);
  assert.equal(metrics.reported_tokens,null);
  assert.equal(metrics.calls_missing_usage,1);
 }finally{await h.close();}
});
