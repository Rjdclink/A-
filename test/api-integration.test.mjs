import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createHmac} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Ledger} from '../src/ledger.mjs';
import {createHandler} from '../src/api.mjs';
const tokens={one:{adminToken:'a'.repeat(32),ingestToken:'b'.repeat(32)},two:{adminToken:'c'.repeat(32),ingestToken:'d'.repeat(32)}};
function makeHarness({orders=true}={}){
 const ledger=new Ledger(':memory:',{pseudonymKey:'long-pseudonym-secret-32-character-key'});
 const handler=createHandler({ledger,tenants:tokens,adviser:async()=> 'Grounded experiment plan',shopify:{secret:'A long Shopify app shared secret key',shops:{'store.myshopify.com':'one'},allowOrders:orders}});
 const server=createServer(handler);
 return {ledger,server,start:()=>new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve('http://127.0.0.1:'+server.address().port))),stop:()=>new Promise(resolve=>server.close(()=>{ledger.close();resolve();}))};
}
async function api(url,path,token,method='GET',body){const r=await fetch(url+path,{method,headers:{...(token?{authorization:'Bearer '+token}:{}),...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json(),headers:r.headers};}
function hook(url,topic,payload,signature='valid'){const raw=JSON.stringify(payload),mac=createHmac('sha256','A long Shopify app shared secret key').update(raw).digest('base64');return fetch(url+'/webhooks/shopify',{method:'POST',body:raw,headers:{'content-type':'application/json','x-shopify-shop-domain':'store.myshopify.com','x-shopify-topic':topic,'x-shopify-hmac-sha256':signature==='valid'?mac:'tampered'}});}

test('workspace authorization, dedupe conflict, report windows and analytics protection',async()=>{
 const h=makeHarness();const base=await h.start();
 try{
  assert.equal((await api(base,'/api/overview?workspace=one',tokens.two.adminToken)).status,401);
  assert.equal((await api(base,'/api/overview?workspace=third',tokens.one.adminToken)).status,401);
  const event={workspace:'one',id:'order-1',type:'purchase',value:15.25,customerId:'subject-1',consent:true,campaign:'email'};
  assert.equal((await api(base,'/api/events',tokens.one.ingestToken,'POST',event)).status,201);
  assert.equal((await api(base,'/api/events',tokens.one.ingestToken,'POST',event)).status,200);
  assert.equal((await api(base,'/api/events',tokens.one.ingestToken,'POST',{...event,value:50})).status,409);
  const result=await api(base,'/api/overview?workspace=one',tokens.one.adminToken);
  assert.equal(result.status,200);assert.equal(result.data.metrics.revenue,15.25);
  assert.equal((await api(base,'/api/overview?workspace=two',tokens.two.adminToken)).data.metrics.revenue,0);
  assert.equal(result.headers.get('access-control-allow-origin'),null);
  const wrong=await api(base,'/api/events',tokens.one.adminToken,'POST',event);assert.equal(wrong.status,401);
  const privacy=await api(base,'/api/privacy/erase?workspace=one',tokens.one.adminToken,'POST',{subjectId:'subject-1'});
  assert.equal(privacy.data.deleted,1);
  assert.equal((await api(base,'/api/overview?workspace=one',tokens.one.adminToken)).data.metrics.revenue,0);
 }finally{await h.stop();}
});

test('deterministic assignments and 14-day attribution, protected by consent',async()=>{
 const h=makeHarness();const base=await h.start();
 try{
  assert.equal((await api(base,'/api/experiments?workspace=one',tokens.one.adminToken,'POST',{id:'checkout'})).status,201);
  assert.equal((await api(base,'/api/experiments/checkout/assign?workspace=one',tokens.one.ingestToken,'POST',{subjectId:'buyer',consent:false})).status,400);
  const assign=await api(base,'/api/experiments/checkout/assign?workspace=one',tokens.one.ingestToken,'POST',{subjectId:'buyer',consent:true});assert.ok(['control','treatment'].includes(assign.data.variant));
  const repeat=await api(base,'/api/experiments/checkout/assign?workspace=one',tokens.one.ingestToken,'POST',{subjectId:'buyer',consent:true});assert.equal(repeat.data.variant,assign.data.variant);
  await api(base,'/api/events',tokens.one.ingestToken,'POST',{workspace:'one',id:'paid-1',type:'purchase',value:7.5,consent:true,customerId:'buyer'});
  const report=await api(base,'/api/experiments/checkout?workspace=one',tokens.one.adminToken);
  assert.equal(report.status,200);assert.equal(report.data.results[assign.data.variant].n,1);assert.equal(report.data.results[assign.data.variant].conversions,1);
  assert.equal(report.data.analysis.status,'insufficient_data');
 }finally{await h.stop();}
});

test('Shopify webhook signature, consent-gated order processing and erasure',async()=>{
 const h=makeHarness();const base=await h.start();
 try{
  assert.equal((await hook(base,'orders/paid',{id:100,total_price:'13.00',currency:'USD'},'bad')).status,401);
  const p={id:100,total_price:'13.00',currency:'USD',customer:{id:111}};
  assert.equal((await hook(base,'shop/redact',p)).status,400);
  assert.equal((await hook(base,'customers/redact',p)).status,400);
  assert.equal((await hook(base,'orders/paid',p)).status,201);
  assert.equal((await hook(base,'orders/paid',p)).status,200);
  assert.equal((await api(base,'/api/overview?workspace=one',tokens.one.adminToken)).data.metrics.revenue,13);
  assert.equal((await hook(base,'customers/redact',{shop_id:33,shop_domain:'store.myshopify.com',customer:{id:111},orders_to_redact:[100]})).status,200);
  assert.equal((await api(base,'/api/overview?workspace=one',tokens.one.adminToken)).data.metrics.revenue,0);
  assert.equal((await hook(base,'orders/paid',{...p,id:101})).status,202);
  const guest={id:105,total_price:'4.00',currency:'USD'};
  assert.equal((await hook(base,'orders/paid',guest)).status,201);
  assert.equal((await hook(base,'customers/redact',{shop_id:33,shop_domain:'store.myshopify.com',orders_to_redact:[105]})).status,200);
  assert.equal((await hook(base,'orders/paid',guest)).status,202);
  assert.equal((await hook(base,'customers/data_request',{shop_id:33,shop_domain:'store.myshopify.com',customer:{id:22},data_request:{id:77}})).status,202);
  const pending=(await api(base,'/api/privacy/requests?workspace=one',tokens.one.adminToken)).data.requests;
  assert.equal(pending[0].request_id,'request:77');
  assert.equal((await hook(base,'shop/redact',{shop_id:33,shop_domain:'store.myshopify.com'})).status,200);
  assert.equal((await hook(base,'orders/paid',{id:102,total_price:'13.00',currency:'USD'})).status,202);
  assert.equal((await api(base,'/api/privacy/requests?workspace=one',tokens.one.adminToken)).data.requests.length,0);
 }finally{await h.stop();}
});

test('persisted SQLite events survive close and reopen',()=>{
 const dir=mkdtempSync(join(tmpdir(),'a-plus-db-'));const file=join(dir,'analytics.sqlite');
 try{
  let store=new Ledger(file,{pseudonymKey:'a stable 32 character analytics key'});
  store.add('default','test',{type:'purchase',value:9.21,consent:true});store.close();
  store=new Ledger(file,{pseudonymKey:'a stable 32 character analytics key'});
  assert.equal(store.overview('default').revenue,9.21);store.close();
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('public HTML includes effective CSP for its style blocks',async()=>{
 const h=makeHarness();const base=await h.start();
 try{const r=await fetch(base+'/');assert.equal(r.status,200);assert.match(r.headers.get('content-security-policy'),/style-src 'self' 'unsafe-inline'/);}
 finally{await h.stop();}
});
