import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createHandler} from '../src/api.mjs';
import {publicRouteNeedsAdmin} from '../src/security.mjs';

const tenants={default:{adminToken:'a'.repeat(32),ingestToken:'b'.repeat(32)}};
const id='9c9180bf-cb58-4e7b-8b8e-e581d138de57';
const body={headers:{'content-type':'application/json'},body:JSON.stringify({subjectId:'buyer-1'})};

test('public route policy protects personal contact details, outreach and privacy controls',()=>{
 for(const [method,path] of [
  ['GET','/api/recovery/leads'],['GET','/api/recovery/outreach'],
  ['POST',`/api/recovery/outreach/${id}/send`],
  ['POST',`/api/recovery/leads/${id}/status`],
  ['POST','/api/privacy/export'],['POST','/api/privacy/erase'],
  ['GET','/api/privacy/requests'],['POST','/api/privacy/requests/complete']
 ])assert.equal(publicRouteNeedsAdmin(method,path),true,`${method} ${path}`);
 for(const [method,path] of [
  ['GET','/api/dashboard-config'],['GET','/api/recovery/overview'],
  ['POST','/api/recovery/leads'],['GET','/api/growth/workflows']
 ])assert.equal(publicRouteNeedsAdmin(method,path),false,`${method} ${path}`);
});

test('public dashboard permits lead intake but denies anonymous PII reads, outreach sending and erasure',async()=>{
 const calls=[];
 const ledger={pendingPrivacyRequests:()=>[{request_id:'request:77',customer_hash:'hidden'}],exportCustomer:()=>[],eraseCustomer:()=>0};
 const unified={handle:async(workspace,path,method,payload)=>{
  calls.push({workspace,path,method,payload});
  if(path==='recovery/leads'&&method==='GET')return {status:200,data:{leads:[{email:'private@example.com'}]}};
  if(path==='recovery/leads'&&method==='POST')return {status:201,data:{lead:{id,email:'new@example.com'}}};
  return {status:200,data:{ok:true}};
 }};
 const server=createServer(createHandler({ledger,tenants,unified,adviser:async()=>'',shopify:{},publicDashboard:true}));
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+server.address().port;
 const admin={authorization:'Bearer '+tenants.default.adminToken};
 const ingest={authorization:'Bearer '+tenants.default.ingestToken};
 try{
  const lead=await fetch(base+'/api/recovery/leads',{method:'POST',headers:body.headers,body:JSON.stringify({name:'Buyer',email:'new@example.com',inquiry:'Question'})});
  assert.equal(lead.status,201,'lead form must remain usable without login');
  assert.equal((await fetch(base+'/api/recovery/leads')).status,401,'raw leads must not be disclosed');
  assert.equal((await fetch(base+'/api/recovery/leads',{headers:ingest})).status,401,'ingest credentials are not admin credentials');
  assert.equal((await fetch(base+'/api/recovery/leads',{headers:admin})).status,200,'admin can access leads');
  assert.equal((await fetch(base+'/api/recovery/outreach')).status,401,'recipient list is private');
  assert.equal((await fetch(base+`/api/recovery/outreach/${id}/send`,{method:'POST',headers:body.headers,body:'{"confirm":true}'})).status,401,'anonymous visitors cannot send drafts');
  assert.equal((await fetch(base+`/api/recovery/outreach/${id}/send`,{method:'POST',headers:{...body.headers,...admin},body:'{"confirm":true}'})).status,200,'admin may reach existing send logic');
  assert.equal((await fetch(base+'/api/privacy/export',{method:'POST',...body})).status,401);
  assert.equal((await fetch(base+'/api/privacy/erase',{method:'POST',...body})).status,401);
  assert.equal((await fetch(base+'/api/privacy/requests')).status,401);
  assert.equal((await fetch(base+'/api/privacy/export',{method:'POST',headers:{...body.headers,...admin},body:body.body})).status,200);
  assert.equal((await fetch(base+'/api/privacy/erase',{method:'POST',headers:{...body.headers,...admin},body:body.body})).status,200);
  assert.equal((await fetch(base+'/api/recovery/overview')).status,200,'public aggregate overview remains usable');
  assert.equal((await fetch(base+'/api/dashboard-config')).status,200);
  const publicSummary=await (await fetch(base+'/api/advanced/summary')).json();
  assert.deepEqual(publicSummary.privacy,{requests:[],restricted:true},'public advanced summary must not re-expose privacy requests');
  const adminSummary=await (await fetch(base+'/api/advanced/summary',{headers:admin})).json();
  assert.equal(adminSummary.privacy.requests[0].request_id,'request:77');
  assert.equal(calls.filter(x=>x.path==='recovery/leads'&&x.method==='GET').length,1,'only authorized lead reads reach backend');
  assert.equal(calls.filter(x=>x.path.includes('/send')).length,1,'only authorized sends reach backend');
 }finally{await new Promise(resolve=>server.close(resolve));}
});
