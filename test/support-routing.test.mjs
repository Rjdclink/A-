import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {Ledger} from '../src/ledger.mjs';
import {createSupport} from '../src/support.mjs';
import {createHandler} from '../src/api.mjs';
const tenants={alpha:{adminToken:'a'.repeat(32),ingestToken:'b'.repeat(32)},beta:{adminToken:'c'.repeat(32),ingestToken:'d'.repeat(32)}};
async function setup(){
 const ledger=new Ledger(':memory:',{pseudonymKey:'routing-support-key-123456789012345'});
 const support=createSupport(ledger.db),server=createServer(createHandler({ledger,support,tenants,adviser:async()=>''}));
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 return {base:'http://127.0.0.1:'+server.address().port,close:()=>new Promise(resolve=>server.close(()=>{ledger.close();resolve();}))};
}
async function request(root,path,{token,workspace='alpha',method='GET',body}={}){
 const r=await fetch(root+'/api/support/'+path+'?workspace='+workspace,{method,headers:{...(token?{authorization:'Bearer '+token}:{}),...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
 return {status:r.status,data:await r.json()};
}
test('internal routing rules prioritize tickets and assign pending requests to least-loaded active staff',async()=>{
 const h=await setup();try{
  const owner=tenants.alpha.adminToken;
  for(const [name,email] of [['Agent A','a@example.org'],['Agent B','b@example.org']]){
   assert.equal((await request(h.base,'team',{token:owner,method:'POST',body:{name,email,password:'very long test password',role:'agent'}})).status,201);
  }
  const rule=await request(h.base,'routing/rules',{token:owner,method:'POST',body:{phrase:'refund',priority:'high'}});
  assert.equal(rule.status,201);
  assert.equal((await request(h.base,'routing/rules',{workspace:'beta',token:tenants.beta.adminToken})).data.rules.length,0);
  for(let i=0;i<3;i++){
   assert.equal((await request(h.base,'chat',{method:'POST',body:{message:'Please advise on a refund for order '+i}})).status,201);
  }
  const inbox=await request(h.base,'tickets',{token:owner});
  assert.equal(inbox.data.tickets.length,3);
  assert.ok(inbox.data.tickets.every(t=>t.priority==='high'));
  assert.equal(new Set(inbox.data.tickets.map(t=>t.assignedTo)).size,2);
  const roles={};
  for(const t of inbox.data.tickets)roles[t.assignedTo]=(roles[t.assignedTo]||0)+1;
  assert.deepEqual(Object.values(roles).sort(),[1,2]);
  const login=await request(h.base,'team/login',{method:'POST',body:{email:'a@example.org',password:'very long test password'}});
  assert.equal((await request(h.base,'routing/rules',{token:login.data.token,method:'POST',body:{phrase:'order',priority:'urgent'}})).status,403);
  assert.equal((await request(h.base,'routing/rules/'+rule.data.rule.id,{token:owner,method:'DELETE'})).status,200);
 }finally{await h.close();}
});
