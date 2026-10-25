import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createHandler} from '../src/api.mjs';
import {publicRouteNeedsAdmin} from '../src/security.mjs';

const tenants={default:{adminToken:'a'.repeat(32),ingestToken:'b'.repeat(32)}};
async function request(base,path,{method='GET',token,body}={}){
 return fetch(base+path,{method,headers:{
  ...(token?{authorization:'Bearer '+token}:{}),
  ...(body!==undefined?{'content-type':'application/json'}:{})
 },body:body===undefined?undefined:JSON.stringify(body)});
}

test('public route policy denies anonymous state-changing requests by default',()=>{
 const readOnly=['/api/overview','/api/recovery/overview','/api/growth/workflows'];
 for(const path of readOnly)assert.equal(publicRouteNeedsAdmin('GET',path),false,path);
 assert.equal(publicRouteNeedsAdmin('POST','/api/recovery/leads'),false,'public lead intake');
 for(const [method,path] of [
  ['GET','/api/recovery/leads'],
  ['POST','/api/growth/workflows'],
  ['PATCH','/api/growth/workflows/123'],
  ['DELETE','/api/growth/workflows/123'],
  ['POST','/api/orchestration/links'],
  ['POST','/api/campaigns/spend'],
  ['POST','/api/score'],
  ['POST','/api/advice'],
  ['POST','/api/experiments'],
  ['POST','/api/events'],
  ['POST','/api/recovery/routines'],
  ['POST','/api/recovery/outreach/x/send'],
  ['POST','/api/privacy/erase'],
  ['POST','/api/neon/history']
 ])assert.equal(publicRouteNeedsAdmin(method,path),true,method+' '+path);
});

test('public dashboard rejects anonymous business mutations before they reach services',async()=>{
 const calls=[];
 const ledger={
  add(){calls.push('event');return {status:'created'};},
  recordSpend(){calls.push('spend');return {recorded:true};},
  createExperiment(){calls.push('experiment');return 'created';}
 };
 const unified={
  async handle(workspace,path,method){
   calls.push(method+' '+path);
   return {status:method==='POST'?201:200,data:{ok:true}};
  },
  async emit(){calls.push('emit');}
 };
 const server=createServer(createHandler({
  ledger,tenants,unified,shopify:{},adviser:async()=>{calls.push('ai');return 'Advice';},
  publicDashboard:true,publicWorkspace:'default'
 }));
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+server.address().port;
 try{
  for(const [method,path] of [
   ['POST','/api/growth/workflows'],
   ['PATCH','/api/growth/workflows/123'],
   ['DELETE','/api/growth/workflows/123'],
   ['POST','/api/recovery/routines'],
   ['POST','/api/experiments'],
   ['POST','/api/events'],
   ['POST','/api/campaigns/spend'],
   ['POST','/api/score'],
   ['POST','/api/advice'],
   ['POST','/api/orchestration/links']
  ]){
   const response=await request(base,path,{method,body:method==='POST'?{workspace:'default'}:undefined});
   assert.equal(response.status,401,method+' '+path);
  }
  assert.deepEqual(calls,[],'denied calls must not reach backend services or AI');
  assert.equal((await request(base,'/api/growth/workflows')).status,200,'public browsing remains enabled');
  assert.equal((await request(base,'/api/recovery/leads',{method:'POST',body:{name:'Buyer',email:'buyer@example.org',inquiry:'Interested in the asset'}})).status,201,'public lead submission remains enabled');
  assert.equal((await request(base,'/api/recovery/leads')).status,401,'stored lead contacts remain private');
  assert.equal((await request(base,'/api/growth/workflows',{method:'POST',token:tenants.default.adminToken,body:{name:'Authorized workflow'}})).status,201,'admin write remains available');
  const event={workspace:'default',id:'ev-1',type:'visit',consent:true};
  assert.equal((await request(base,'/api/events',{method:'POST',token:tenants.default.adminToken,body:event})).status,401,'admin credentials cannot substitute for the ingestion token');
  assert.equal((await request(base,'/api/events',{method:'POST',token:tenants.default.ingestToken,body:event})).status,201,'ingestion credentials still work');
  assert.deepEqual(calls,[
   'GET growth/workflows','POST recovery/leads','POST growth/workflows','event','emit'
  ]);
 }finally{await new Promise(resolve=>server.close(resolve));}
});
