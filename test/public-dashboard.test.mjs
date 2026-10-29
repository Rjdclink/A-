import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {Ledger} from '../src/ledger.mjs';
import {createHandler} from '../src/api.mjs';
import {createUnified} from '../src/unified.mjs';
const tenants={default:{adminToken:'a'.repeat(32),ingestToken:'b'.repeat(32)},other:{adminToken:'c'.repeat(32),ingestToken:'d'.repeat(32)}};
test('public dashboard exposes aggregates but requires credentials for private operations',async()=>{
 const ledger=new Ledger(':memory:',{pseudonymKey:'strong-demo-pseudonym-key-is-stable'});
 const unified=createUnified({ledger,automationDbPath:':memory:',env:{AUTO_BACKUP_HOURS:'0',SESSION_COOKIE_SECURE:'false'}});
 const server=createServer(createHandler({ledger,tenants,unified,adviser:async()=> 'Measured insights',shopify:{},publicDashboard:true,publicWorkspace:'default'}));
 await new Promise(done=>server.listen(0,'127.0.0.1',done));
 const base='http://127.0.0.1:'+server.address().port;
 try{
  const page=await (await fetch(base+'/')).text();
  assert.doesNotMatch(page,/id="token"/);
  assert.doesNotMatch(page,/id="workspace"/);
  assert.doesNotMatch(page,/id="toggleWorkspace"/);
  const config=await (await fetch(base+'/api/dashboard-config')).json();
  assert.equal(config.public,true);assert.equal(config.workspace,'default');
  const overview=await fetch(base+'/api/overview');
  assert.equal(overview.status,200);
  assert.equal((await overview.json()).metrics.revenue,0);
  assert.equal((await fetch(base+'/api/recovery/overview')).status,200);
  for(const path of ['/api/growth/workflows','/api/recovery/leads','/api/privacy/requests','/api/advanced/summary']){
   assert.equal((await fetch(base+path)).status,401,`anonymous GET ${path} must be denied`);
  }
  const lead={name:'Real Lead',email:'real@example.com',inquiry:'Requested information'};
  const headers={'content-type':'application/json'};
  for(const [path,body] of [
   ['/api/recovery/leads',lead],['/api/privacy/erase',{subjectId:'test-subject'}],
   ['/api/advice',{objective:'test'}],['/api/campaigns/spend',{campaign:'test',date:'2026-10-29',spend:1}]
  ]){
   assert.equal((await fetch(base+path,{method:'POST',headers,body:JSON.stringify(body)})).status,401,`anonymous POST ${path} must be denied`);
  }
  const ownerHeaders={...headers,authorization:'Bearer '+tenants.default.adminToken};
  assert.equal((await fetch(base+'/api/growth/workflows',{headers:ownerHeaders})).status,200);
  const created=await fetch(base+'/api/recovery/leads',{method:'POST',headers:ownerHeaders,body:JSON.stringify(lead)});
  assert.equal(created.status,201);
  const adminLeads=await fetch(base+'/api/recovery/leads',{headers:ownerHeaders});
  assert.equal(adminLeads.status,200);
  assert.equal((await adminLeads.json()).leads.length,1);
  const forbidden=await fetch(base+'/api/recovery/leads?workspace=other');
  assert.equal(forbidden.status,403);
  const disallowed=await fetch(base+'/api/growth/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
  assert.equal(disallowed.status,401);
 }finally{
  await new Promise(done=>server.close(done));await unified.close();ledger.close();
 }
});
test('private mode continues to require credentials',async()=>{
 const ledger=new Ledger(':memory:',{pseudonymKey:'strong-private-pseudonym-key-stable'});
 const server=createServer(createHandler({ledger,tenants,adviser:async()=>'',shopify:{},publicDashboard:false}));
 await new Promise(done=>server.listen(0,'127.0.0.1',done));
 try{assert.equal((await fetch('http://127.0.0.1:'+server.address().port+'/api/overview')).status,401);}
 finally{await new Promise(done=>server.close(done));ledger.close();}
});