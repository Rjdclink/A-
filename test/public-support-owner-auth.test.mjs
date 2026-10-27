import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createHandler} from '../src/api.mjs';

const tenants={default:{adminToken:'a'.repeat(32),ingestToken:'b'.repeat(32)}};

test('public dashboard never grants anonymous support owner access',async()=>{
 const calls=[];
 const support={
  roleOf:()=>null,
  settings:()=>({welcome:'Hello'}),
  tickets:()=>{calls.push('tickets');return [{id:'private-ticket'}];},
  team:()=>{calls.push('team');return [{email:'private@example.org'}];},
  customers:()=>{calls.push('customers');return [{email:'private@example.org'}];},
  auditEvents:()=>{calls.push('audit');return [{action:'private'}];},
  createStaff:()=>{calls.push('createStaff');return {id:'staff-1'};},
  eraseEmail:()=>{calls.push('eraseEmail');return 1;},
  receive:async()=>({reply:'Welcome'})
 };
 const server=createServer(createHandler({
  ledger:{},tenants,support,shopify:{},adviser:async()=>'',publicDashboard:true,publicWorkspace:'default'
 }));
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+server.address().port;
 const request=(path,{method='GET',token,body}={})=>fetch(base+path,{
  method,headers:{...(token?{authorization:'Bearer '+token}:{}),...(body?{'content-type':'application/json'}:{})},
  ...(body?{body:JSON.stringify(body)}:{})
 });
 try{
  for(const path of ['/api/support/tickets','/api/support/team','/api/support/customers','/api/support/audit','/api/support/team/me']){
   assert.equal((await request(path)).status,401,'anonymous '+path);
   assert.equal((await request(path,{token:tenants.default.ingestToken})).status,401,'ingest '+path);
  }
  assert.equal((await request('/api/support/team',{method:'POST',body:{name:'Unauthorized'}})).status,401);
  assert.equal((await request('/api/support/privacy/erase',{method:'POST',body:{email:'victim@example.org'}})).status,401);
  assert.deepEqual(calls,[],'rejected requests must not reach private support operations');
  assert.equal((await request('/api/support/config')).status,200,'public support config remains accessible');
  assert.equal((await request('/api/support/chat',{method:'POST',body:{message:'Hello'}})).status,201,'public support chat remains accessible');
  assert.equal((await request('/api/support/tickets',{token:tenants.default.adminToken})).status,200);
  assert.equal((await request('/api/support/team',{token:tenants.default.adminToken})).status,200);
  assert.equal((await request('/api/support/team',{method:'POST',token:tenants.default.adminToken,body:{name:'Authorized'}})).status,201);
  assert.deepEqual(calls,['tickets','team','createStaff']);
 }finally{await new Promise(resolve=>server.close(resolve));}
});
