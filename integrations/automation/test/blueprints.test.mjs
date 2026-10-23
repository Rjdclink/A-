import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../src/server.mjs';

const suggested={name:'Lead intake organizer',spec:{start:'assess',steps:[
 {id:'assess',type:'ai',system:'Only use supplied lead details.',prompt:'Summarize {{input.lead}}',next:'finish'},
 {id:'finish',type:'end'}
]}};
const mock=text=>new Response(JSON.stringify({choices:[{message:{content:text}}]}),{status:200});
async function harness(aiFetch,env={}){
 const app=createApp({dbPath:':memory:',autoStart:false,aiFetch,env:{ALLOW_SIGNUP:'true',SESSION_COOKIE_SECURE:'false',...env}});
 await new Promise(done=>app.server.listen(0,'127.0.0.1',done));
 const base='http://127.0.0.1:'+app.server.address().port;let cookie='';
 const api=async(path,method='GET',body)=>{
  const res=await fetch(base+path,{method,headers:{origin:base,...(cookie?{cookie}:{}),...(body===undefined?{}:{'content-type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});
  const ck=res.headers.get('set-cookie');if(ck)cookie=ck.split(';')[0];
  return {status:res.status,data:await res.json()};
 };
 const signup=email=>api('/api/auth/register','POST',{name:'Automation Owner',email,password:'a long private testing password'});
 const close=async()=>{app.stop();await new Promise(done=>app.server.close(done));app.db.close();};
 return {app,api,signup,close};
}

test('AI describes a valid draft workflow without saving, enabling or executing it',async()=>{
 let calls=0;
 const h=await harness(async(url,options)=>{calls++;const req=JSON.parse(options.body);
  assert.match(req.messages[0].content,/JSON|workflow/i);
  return mock(JSON.stringify(suggested));});
 try{
  await h.signup('assistant@example.org');
  const result=await h.api('/api/blueprints','POST',{goal:'Automatically organize incoming business leads with AI summarization and a draft.'});
  assert.equal(result.status,200,JSON.stringify(result.data));
  assert.equal(result.data.name,suggested.name);
  assert.deepEqual(result.data.spec,suggested.spec);
  assert.equal(result.data.enabled,false);
  assert.equal(result.data.allow_external,false);
  assert.equal(result.data.requires_review,true);
  assert.equal(result.data.trigger.type,'manual');
  assert.equal(calls,1);
  assert.equal(h.app.db.prepare('SELECT COUNT(*) AS n FROM workflows').get().n,0);
  assert.equal(h.app.db.prepare('SELECT COUNT(*) AS n FROM runs').get().n,0);
 }finally{await h.close();}
});

test('AI blueprint output cannot smuggle executable external actions or malformed graphs',async()=>{
 const h=await harness(async()=>mock(JSON.stringify({name:'Automate payments',spec:{
  start:'pay',steps:[{id:'pay',type:'http_post',url:'https://api.example.com/pay',requires_approval:false,next:'end'},{id:'end',type:'end'}]
 }})));
 try{
  await h.signup('external@example.org');
  const res=await h.api('/api/blueprints','POST',{goal:'Review payment proposals before any external action.'});
  assert.equal(res.status,422);
  assert.equal(h.app.db.prepare('SELECT COUNT(*) AS n FROM workflows').get().n,0);
 }finally{await h.close();}
});

test('AI generation is quota limited per workspace using durable counters',async()=>{
 let count=0;
 const h=await harness(async()=>{count++;return mock(JSON.stringify(suggested));},{MAX_BLUEPRINTS_PER_HOUR:'2'});
 try{
  await h.signup('quota1@example.org');
  for(let i=0;i<2;i++)assert.equal((await h.api('/api/blueprints','POST',{goal:'Create an AI lead intake automation.'})).status,200);
  const third=await h.api('/api/blueprints','POST',{goal:'Create an AI lead intake automation.'});
  assert.equal(third.status,429);
  assert.equal(count,2);
  await h.signup('quota2@example.org');
  assert.equal((await h.api('/api/blueprints','POST',{goal:'Create an AI lead intake automation.'})).status,200);
  assert.equal(count,3);
 }finally{await h.close();}
});

test('invalid goal and broken model output report errors without persisting a draft',async()=>{
 const h=await harness(async()=>mock('This is not JSON.'));
 try{
  await h.signup('invalid@example.org');
  assert.equal((await h.api('/api/blueprints','POST',{goal:'short'})).status,400);
  const bad=await h.api('/api/blueprints','POST',{goal:'Organize incoming customer support messages.'});
  assert.equal(bad.status,422);
  assert.equal(h.app.db.prepare('SELECT COUNT(*) AS n FROM workflows').get().n,0);
 }finally{await h.close();}
});

test('dashboard keeps AI generation an optional advanced choice rather than new top-level cards',async()=>{
 const {readFileSync}=await import('node:fs');
 const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
 const overview=html.split('<section id="dashboard"')[1].split('<section id="workflows"')[0];
 assert.equal((overview.match(/class="metric"/g)||[]).length,3);
 assert.match(html,/data-action="generate-workflow"/);
 assert.match(html,/ai-builder-goal/);
 assert.match(html,/No automation is saved until you review/);
});
