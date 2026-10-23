import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../src/server.mjs';

function response(content){return new Response(JSON.stringify({choices:[{message:{content}}]}),{status:200});}
async function fixture({aiFetch}={}){
 const app=createApp({dbPath:':memory:',autoStart:false,env:{ALLOW_SIGNUP:'true',SESSION_COOKIE_SECURE:'false'},aiFetch});
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
 const origin='http://127.0.0.1:'+app.server.address().port;let cookie='';
 const request=async(path,method='GET',body)=>{
  const res=await fetch(origin+path,{method,headers:{origin,...(cookie?{cookie}:{}),...(body===undefined?{}:{'content-type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});
  if(res.headers.get('set-cookie'))cookie=res.headers.get('set-cookie').split(';')[0];
  return {status:res.status,data:await res.json()};
 };
 const signup=email=>request('/api/auth/register','POST',{name:'Recovery Owner',email,password:'a long testing password'});
 const close=async()=>{app.stop();await new Promise(resolve=>app.server.close(resolve));app.db.close();};
 return {app,request,signup,close};
}

test('failed automation may be safely resumed in-place with its durable output and definition preserved',async()=>{
 let outage=true;
 const h=await fixture({aiFetch:async()=>outage?Promise.reject(Error('AI unavailable')):response('Recovered response')});
 try{
  await h.signup('recovery@example.com');
  const spec={start:'draft',steps:[{id:'draft',type:'template',template:'Persistent {{input.text}}',next:'ai'},{id:'ai',type:'ai',prompt:'{{steps.draft}}',next:'done'},{id:'done',type:'end'}]};
  const wf=await h.request('/api/workflows','POST',{name:'Persistent automation',spec});
  const start=await h.request('/api/workflows/'+wf.data.id+'/run','POST',{input:{text:'test'}});
  const stamp=Date.now();await h.app.tick(stamp);await h.app.tick(stamp+10000);await h.app.tick(stamp+20000);
  const before=await h.request('/api/runs/'+start.data.id);
  assert.equal(before.data.status,'failed');
  assert.equal(before.data.state.steps.draft,'Persistent test');
  const res=await h.request('/api/runs/'+start.data.id+'/retry','POST',{});
  assert.equal(res.status,202);
  assert.equal(res.data.id,start.data.id);
  assert.equal(res.data.status,'queued');
  outage=false;await h.app.tick(stamp+30000);
  const finished=await h.request('/api/runs/'+start.data.id);
  assert.equal(finished.data.status,'completed');
  assert.equal(finished.data.manual_retries,1);
  assert.equal(finished.data.state.steps.draft,'Persistent test');
  assert.equal(finished.data.state.steps.ai,'Recovered response');
  assert.ok(finished.data.logs.some(l=>l.event==='run_manual_retry'));
 }finally{await h.close();}
});

test('manual retry rejects pending, cancelled and another tenant\'s runs',async()=>{
 const h=await fixture();try{
  await h.signup('first@example.com');
  const wf=await h.request('/api/workflows','POST',{name:'Flow',spec:{start:'end',steps:[{id:'end',type:'end'}]}});
  const run=await h.request('/api/workflows/'+wf.data.id+'/run','POST',{input:{}});
  assert.equal((await h.request('/api/runs/'+run.data.id+'/retry','POST',{})).status,409);
  assert.equal((await h.request('/api/runs/'+run.data.id+'/cancel','POST',{})).status,200);
  assert.equal((await h.request('/api/runs/'+run.data.id+'/retry','POST',{})).status,409);
  await h.signup('second@example.com');
  assert.equal((await h.request('/api/runs/'+run.data.id+'/retry','POST',{})).status,404);
 }finally{await h.close();}
});

test('retry limit prevents unbounded operator-driven replays',async()=>{
 const h=await fixture();try{
  await h.signup('bounded@example.com');
  const wf=await h.request('/api/workflows','POST',{name:'Bounded',spec:{start:'end',steps:[{id:'end',type:'end'}]}});
  const started=await h.request('/api/workflows/'+wf.data.id+'/run','POST',{input:{}});
  for(let i=0;i<3;i++){
   h.app.db.prepare("UPDATE runs SET status='failed' WHERE id=?").run(started.data.id);
   const retry=await h.request('/api/runs/'+started.data.id+'/retry','POST',{});
   assert.equal(retry.status,202,'attempt '+i);
  }
  h.app.db.prepare("UPDATE runs SET status='failed' WHERE id=?").run(started.data.id);
  assert.equal((await h.request('/api/runs/'+started.data.id+'/retry','POST',{})).status,409);
  assert.equal(h.app.db.prepare('SELECT manual_retries FROM runs WHERE id=?').get(started.data.id).manual_retries,3);
 }finally{await h.close();}
});

test('disabled workflows do not allow restarting previously failed executions',async()=>{
 const h=await fixture();try{
  await h.signup('pause@example.com');
  const wf=await h.request('/api/workflows','POST',{name:'Paused',spec:{start:'end',steps:[{id:'end',type:'end'}]}});
  const started=await h.request('/api/workflows/'+wf.data.id+'/run','POST',{input:{}});
  h.app.db.prepare("UPDATE runs SET status='failed' WHERE id=?").run(started.data.id);
  await h.request('/api/workflows/'+wf.data.id,'PATCH',{enabled:false});
  assert.equal((await h.request('/api/runs/'+started.data.id+'/retry','POST',{})).status,409);
 }finally{await h.close();}
});


test('retry control is confined to the existing activity details modal',async()=>{
 const {readFileSync}=await import('node:fs');
 const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
 const overview=html.split('<section id="dashboard"')[1].split('<section id="workflows"')[0];
 assert.doesNotMatch(overview,/retry-run/);
 assert.match(html,/data-action="retry-run"/);
 assert.ok(html.includes('api(`/api/runs/${id}/retry`'), 'retry API must be wired to the activity control');
});
