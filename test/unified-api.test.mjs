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