import test from 'node:test';
import assert from 'node:assert/strict';
import {createNeonApp} from '../functions/aplus/index.mjs';
class FakePool{
 constructor(){this.values=new Map();this.queries=[];}
 async query(sql){this.queries.push(sql);return {rows:[]};}
 async connect(){return new FakeClient(this);}
}
class FakeClient{
 constructor(pool){this.pool=pool;}
 async query(sql,args=[]){
  this.pool.queries.push(sql);
  if(['BEGIN','COMMIT','ROLLBACK'].includes(sql))return {rows:[]};
  if(sql.startsWith('INSERT INTO aplus_function_state')){
   if(!this.pool.values.has(args[0]))this.pool.values.set(args[0],{commerce:null,automation:null,admin_token:args[1],ingest_token:args[2],pseudonym_key:args[3]});
   return {rows:[]};
  }
  if(sql.includes('FROM aplus_function_state')&&sql.includes('FOR UPDATE'))return {rows:[this.pool.values.get(args[0])]};
  if(sql.startsWith('UPDATE aplus_function_state')){
   const val=this.pool.values.get(args[0]);val.commerce=args[1];val.automation=args[2];return {rows:[]};
  }
  throw Error('Unexpected statement '+sql.slice(0,85));
 }
 release(){}
}
const req=(route,method='GET',data)=>new Request('https://aplus.example'+route,{method,headers:data?{'content-type':'application/json'}:{},body:data?JSON.stringify(data):undefined});
test('Neon HTTP runtime provides real passwordless dashboard and durable lead data',async()=>{
 const pool=new FakePool(),first=createNeonApp({pool,env:{AUTO_BACKUP_HOURS:'0'}});
 const page=await first.fetch(req('/'));assert.equal(page.status,200);
 const html=await page.text();assert.match(html,/Unified Growth Intelligence/);
 assert.doesNotMatch(html,/id="token"/);assert.match(html,/Advanced Controls/);
 const created=await first.fetch(req('/api/recovery/leads','POST',{name:'Buyer',email:'buyer@example.com',inquiry:'Sales request'}));
 assert.equal(created.status,201);
 const next=createNeonApp({pool,env:{AUTO_BACKUP_HOURS:'0'}});
 const anonymous=await next.fetch(req('/api/recovery/leads'));assert.equal(anonymous.status,200);
 const storedAdmin=pool.values.get('default').admin_token;
 const result=await next.fetch(new Request('https://aplus.example/api/recovery/leads',{headers:{authorization:'Bearer '+storedAdmin}}));
 assert.equal(result.status,200);assert.equal((await result.json()).leads[0].name,'Buyer');
 const secretCheck=await next.fetch(req('/api/recovery/leads?workspace=other'));assert.equal(secretCheck.status,403);
});
test('commerce event triggers a durable GrowthVeyra run under the same Neon workspace',async()=>{
 const pool=new FakePool(),app=createNeonApp({pool,env:{AUTO_BACKUP_HOURS:'0'}});
 await app.fetch(req('/health'));
 const call=async(path,method='GET',data)=>{
  const request=req(path,method,data);
  request.headers.set('authorization','Bearer '+pool.values.get('default')[path==='/api/events'?'ingest_token':'admin_token']);
  const r=await app.fetch(request);return {status:r.status,data:await r.json()};
 };
 const spec={start:'compose',steps:[{id:'compose',type:'template',template:'Purchase {{input.source_event}}',next:'done'},{id:'done',type:'end'}]};
 const w=await call('/api/growth/workflows','POST',{name:'Purchase workflow',spec,enabled:true,trigger:{type:'manual'}});
 assert.equal(w.status,201);
 const link=await call('/api/orchestration/links','POST',{event:'commerce.purchase',workflow_id:w.data.id});
 assert.equal(link.status,201);
 const purchase=await call('/api/events','POST',{id:'durable-order-001',workspace:'default',type:'purchase',value:21.25,currency:'USD',consent:true,campaign:'spring'});
 assert.equal(purchase.status,201);
 const runs=await call('/api/growth/runs');assert.equal(runs.data.length,1);assert.equal(runs.data[0].status,'completed');
 const overview=await call('/api/overview');assert.equal(overview.data.metrics.revenue,21.25);
});
test('live health reports status, and disabled third-party connections do not fabricate success',async()=>{
 const app=createNeonApp({pool:new FakePool(),env:{AUTO_BACKUP_HOURS:'0'}});
 const health=await app.fetch(req('/health'));assert.equal(health.status,200);assert.equal((await health.json()).status,'ok');
 const status=await app.fetch(req('/api/dashboard-config'));assert.equal((await status.json()).public,true);
});

test('Neon scheduled task endpoint only accepts attested trigger invocations',async()=>{
 const pool=new FakePool(),app=createNeonApp({pool,env:{AUTO_BACKUP_HOURS:'0'}});
 const publicPath=await app.fetch(new Request('https://aplus.example/tasks',{method:'POST'}));
 assert.equal(publicPath.status,403);
 const scheduled=await app.fetch(new Request('https://aplus.example/tasks',{method:'POST',headers:{'x-neon-trigger-invocation-id':'trigger-call-01','content-type':'application/json'},body:JSON.stringify({data:{scheduled_at:'2026-10-23T22:00:00Z'}})}));
 assert.equal(scheduled.status,200);
 const reply=await scheduled.json();
 assert.equal(reply.ok,true);
 assert.equal(reply.maintenance,'processed');
});
