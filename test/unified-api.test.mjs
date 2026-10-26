import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {Ledger} from '../src/ledger.mjs';
import {createHandler} from '../src/api.mjs';
import {createUnified} from '../src/unified.mjs';
const tenants={alpha:{adminToken:'a'.repeat(32),ingestToken:'b'.repeat(32)},beta:{adminToken:'c'.repeat(32),ingestToken:'d'.repeat(32)}};
async function setup(){
 const ledger=new Ledger(':memory:',{pseudonymKey:'stable-pseudonym-key-32-characters-long'});
 const unified=createUnified({ledger,automationDbPath:':memory:',env:{SESSION_COOKIE_SECURE:'false',ALLOW_SIGNUP:'false',AUTO_BACKUP_HOURS:'0'}});
 const handler=createHandler({ledger,tenants,unified,adviser:async()=>'',shopify:{}});
 const server=createServer(handler);
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const root='http://127.0.0.1:'+server.address().port;
 return {root,async close(){await new Promise(resolve=>server.close(resolve));await unified.close();ledger.close();}};
}
async function call(root,path,token,method='GET',body){const r=await fetch(root+path,{method,headers:{authorization:'Bearer '+token,...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});let data;try{data=await r.json();}catch{data=await r.text().catch(()=>'');}return {status:r.status,data};}
test('unified API isolates revenue and automation per A+ workspace',async()=>{
 const app=await setup();try{
  assert.equal((await call(app.root,'/api/growth/me?workspace=alpha',tenants.alpha.adminToken)).status,200);
  assert.equal((await call(app.root,'/api/growth/me?workspace=alpha',tenants.beta.adminToken)).status,401);
  const r=await call(app.root,'/api/recovery/leads?workspace=alpha',tenants.alpha.adminToken,'POST',{name:'Example',email:'x@example.com',inquiry:'Hello'});
  assert.equal(r.status,201);
  assert.equal((await call(app.root,'/api/recovery/leads?workspace=alpha',tenants.alpha.adminToken)).data.leads.length,1);
  assert.equal((await call(app.root,'/api/recovery/leads?workspace=beta',tenants.beta.adminToken)).data.leads.length,0);
 }finally{await app.close();}
});
test('advanced studio loads the original visual designer through A+ assets',async()=>{
 const app=await setup();try{
  const page=await fetch(app.root+'/studio/');
  assert.equal(page.status,200);
  const html=await page.text();
  assert.match(html,/GrowthVeyra/);
  assert.match(html,/aplus:auth/);
  assert.match(html,/\/studio\/designer\.js/);
  const asset=await fetch(app.root+'/studio/designer.js');
  assert.equal(asset.status,200);
  assert.match(await asset.text(),/GVDesigner/);
 }finally{await app.close();}
});
test('catalog and growth-agent APIs are workspace-scoped through the public HTTP router',async()=>{
 const app=await setup();try{
  const created=await call(app.root,'/api/catalog/products?workspace=alpha',tenants.alpha.adminToken,'POST',{id:'sku1',title:'Test Product',price_cents:1200,cost_cents:500,currency:'USD'});
  assert.equal(created.status,200);
  const event=await call(app.root,'/api/catalog/events?workspace=alpha',tenants.alpha.adminToken,'POST',{event_id:'evt1',product_id:'sku1',type:'purchase',customer_id:'customer-1',consent:true});
  assert.equal(event.status,200);
  const alpha=await call(app.root,'/api/catalog/products?workspace=alpha',tenants.alpha.adminToken);
  const beta=await call(app.root,'/api/catalog/products?workspace=beta',tenants.beta.adminToken);
  assert.equal(alpha.data.products.length,1);
  assert.equal(beta.data.products.length,0);
  const recs=await call(app.root,'/api/catalog/recommendations?workspace=alpha',tenants.alpha.adminToken);
  assert.equal(recs.data.recommendations[0].id,'sku1');
  const settings=await call(app.root,'/api/growth-agent/settings?workspace=alpha',tenants.alpha.adminToken);
  assert.equal(settings.data.settings.enabled,false);
 }finally{await app.close();}
});

test('catalog ingestion routes require workspace ingest credentials',async()=>{
 const app=await setup();try{
  await call(app.root,'/api/catalog/products?workspace=alpha',tenants.alpha.adminToken,'POST',{id:'sku-ingest',title:'Ingest Product',price_cents:1000,currency:'USD'});
  const denied=await call(app.root,'/api/catalog/ingest/events?workspace=alpha',tenants.alpha.adminToken,'POST',{event_id:'ingest-1',product_id:'sku-ingest',type:'view'});
  assert.equal(denied.status,401);
  const accepted=await call(app.root,'/api/catalog/ingest/events?workspace=alpha',tenants.alpha.ingestToken,'POST',{event_id:'ingest-1',product_id:'sku-ingest',type:'view'});
  assert.equal(accepted.status,200);
 }finally{await app.close();}
});
