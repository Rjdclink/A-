import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {Ledger} from '../src/ledger.mjs';
import {createHandler} from '../src/api.mjs';
import {createSupport} from '../src/support.mjs';

const tenants = {
 alpha:{adminToken:'a'.repeat(32),ingestToken:'b'.repeat(32)},
 beta:{adminToken:'c'.repeat(32),ingestToken:'d'.repeat(32)}
};

async function harness({publicDashboard=false,responder=null}={}){
 const ledger=new Ledger(':memory:',{pseudonymKey:'stable-pseudonym-key-32-characters'});
 const support=createSupport(ledger.db,{responder});
 const server=createServer(createHandler({ledger,support,tenants,adviser:async()=> 'test',publicDashboard,publicWorkspace:'alpha'}));
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 return {ledger,support,base:'http://127.0.0.1:'+server.address().port,stop:()=>new Promise(resolve=>server.close(()=>{ledger.close();resolve();}))};
}

async function request(base,path,{token,method='GET',body}={}){
 const res=await fetch(base+path,{method,headers:{...(token?{authorization:'Bearer '+token}:{}),...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
 const raw=await res.text();let data;try{data=JSON.parse(raw);}catch{data=raw;}
 return {status:res.status,data,headers:res.headers};
}

test('support knowledge is tenant-scoped and never publicly administrable, even on a public dashboard',async()=>{
 const h=await harness({publicDashboard:true});
 try{
  const path='/api/support/articles?workspace=alpha';
  assert.equal((await request(h.base,path,{method:'POST',body:{question:'Shipping',answer:'Two days.'}})).status,401);
  assert.equal((await request(h.base,path,{token:tenants.alpha.ingestToken,method:'POST',body:{question:'Shipping',answer:'Two days.'}})).status,401);
  const created=await request(h.base,path,{token:tenants.alpha.adminToken,method:'POST',body:{question:'How long does shipping take?',answer:'Shipping usually takes two days.',locale:'en'}});
  assert.equal(created.status,201);assert.ok(created.data.article.id);
  assert.equal((await request(h.base,path,{token:tenants.beta.adminToken})).status,401);
  assert.equal((await request(h.base,'/api/support/articles?workspace=beta',{token:tenants.beta.adminToken})).status,403);
  assert.equal((await request(h.base,path)).status,401);
  assert.equal((await request(h.base,'/api/support/config?workspace=alpha')).status,200);
 }finally{await h.stop();}
});

test('workspace separation applies to support tickets and knowledge',async()=>{
 const h=await harness();
 try{
  await request(h.base,'/api/support/articles?workspace=alpha',{token:tenants.alpha.adminToken,method:'POST',body:{question:'Which products are available?',answer:'Only our published catalog.'}});
  const other=await request(h.base,'/api/support/articles?workspace=beta',{token:tenants.beta.adminToken});
  assert.equal(other.status,200);assert.equal(other.data.articles.length,0);
  const chat=await request(h.base,'/api/support/chat?workspace=beta',{method:'POST',body:{message:'Which products are available?'}});
  assert.equal(chat.status,201);assert.equal(chat.data.needsHuman,true);
  assert.equal((await request(h.base,'/api/support/tickets?workspace=alpha',{token:tenants.alpha.adminToken})).data.tickets.length,0);
 }finally{await h.stop();}
});

test('customer chat responds from approved knowledge and creates a persistent ticket and protected history',async()=>{
 const h=await harness();
 try{
  await request(h.base,'/api/support/articles?workspace=alpha',{token:tenants.alpha.adminToken,method:'POST',body:{question:'What is your return policy?',answer:'Returns are accepted within 30 days.'}});
  const first=await request(h.base,'/api/support/chat?workspace=alpha',{method:'POST',body:{message:'What is your return policy?',name:'Customer',email:'customer@example.org'}});
  assert.equal(first.status,201);assert.match(first.data.reply,/30 days/);
  assert.equal(first.data.needsHuman,false);assert.ok(first.data.sessionToken);
  assert.equal((await request(h.base,'/api/support/tickets?workspace=alpha')).status,401);
  const all=await request(h.base,'/api/support/tickets?workspace=alpha',{token:tenants.alpha.adminToken});
  assert.equal(all.data.tickets.length,1);
  assert.equal(all.data.tickets[0].name,'Customer');
  assert.equal((await request(h.base,'/api/support/thread?workspace=alpha',{method:'POST',body:{ticketId:first.data.ticketId,sessionToken:'wrong'}})).status,403);
  assert.equal((await request(h.base,'/api/support/thread?workspace=beta',{method:'POST',body:{ticketId:first.data.ticketId,sessionToken:first.data.sessionToken}})).status,403);
  const unknown=await request(h.base,'/api/support/chat?workspace=alpha',{method:'POST',body:{message:'Can I talk to someone?',ticketId:first.data.ticketId,sessionToken:first.data.sessionToken}});
  assert.equal(unknown.status,200);assert.equal(unknown.data.ticketId,first.data.ticketId);assert.equal(unknown.data.needsHuman,true);
  const reply=await request(h.base,'/api/support/tickets/'+first.data.ticketId+'/replies?workspace=alpha',{token:tenants.alpha.adminToken,method:'POST',body:{message:'A team member will follow up shortly.'}});
  assert.equal(reply.status,201);
  const thread=await request(h.base,'/api/support/thread?workspace=alpha',{method:'POST',body:{ticketId:first.data.ticketId,sessionToken:first.data.sessionToken}});
  assert.equal(thread.status,200);assert.equal(thread.data.messages.at(-1).sender,'agent');
  assert.equal(thread.data.messages.length,5);
 }finally{await h.stop();}
});

test('ticket administration, metrics, and data export/erasure are tenant-scoped',async()=>{
 const h=await harness();
 try{
  const fresh=await request(h.base,'/api/support/chat?workspace=alpha',{method:'POST',body:{message:'Help me with this order',email:'remove@example.org'}});
  assert.equal(fresh.status,201);
  const id=fresh.data.ticketId;
  assert.equal((await request(h.base,'/api/support/tickets/'+id+'?workspace=beta',{token:tenants.beta.adminToken})).status,404);
  const update=await request(h.base,'/api/support/tickets/'+id+'?workspace=alpha',{token:tenants.alpha.adminToken,method:'PATCH',body:{status:'pending',priority:'high',assignedTo:'Alex'}});
  assert.equal(update.status,200);assert.equal(update.data.ticket.priority,'high');
  const metrics=await request(h.base,'/api/support/metrics?workspace=alpha',{token:tenants.alpha.adminToken});
  assert.equal(metrics.status,200);assert.equal(metrics.data.total,1);assert.equal(metrics.data.pending,1);
  const exported=await request(h.base,'/api/support/privacy/export?workspace=alpha',{token:tenants.alpha.adminToken,method:'POST',body:{email:'remove@example.org'}});
  assert.equal(exported.data.tickets.length,1);
  assert.equal((await request(h.base,'/api/support/privacy/erase?workspace=alpha',{token:tenants.beta.adminToken,method:'POST',body:{email:'remove@example.org'}})).status,401);
  const erased=await request(h.base,'/api/support/privacy/erase?workspace=alpha',{token:tenants.alpha.adminToken,method:'POST',body:{email:'remove@example.org'}});
  assert.equal(erased.data.deleted,1);
  assert.equal((await request(h.base,'/api/support/thread?workspace=alpha',{method:'POST',body:{ticketId:id,sessionToken:fresh.data.sessionToken}})).status,403);
  assert.equal((await request(h.base,'/api/support/metrics?workspace=alpha',{token:tenants.alpha.adminToken})).data.total,0);
 }finally{await h.stop();}
});

test('AI processing needs per-customer consent and errors safely revert to approved knowledge',async()=>{
 const calls=[];
 const h=await harness({responder:async input=>{calls.push(input);return 'The documented 14-day window applies.';}});
 try{
  await request(h.base,'/api/support/articles?workspace=alpha',{token:tenants.alpha.adminToken,method:'POST',body:{question:'How many days are refunds available?',answer:'Refunds are accepted within 14 days.'}});
  const simple=await request(h.base,'/api/support/chat?workspace=alpha',{method:'POST',body:{message:'How many days are refunds available?',aiConsent:false}});
  assert.match(simple.data.reply,/14 days/);assert.equal(calls.length,0);
  const consented=await request(h.base,'/api/support/chat?workspace=alpha',{method:'POST',body:{message:'How many days are refunds available?',aiConsent:true}});
  assert.equal(consented.data.reply,'The documented 14-day window applies.');assert.equal(calls.length,1);
  const unknown=await request(h.base,'/api/support/chat?workspace=alpha',{method:'POST',body:{message:'Give me an exact order status',aiConsent:true}});
  assert.equal(unknown.data.needsHuman,true);assert.equal(calls.length,1);
 }finally{await h.stop();}
});

test('public support page has a strict framing policy unless an explicit origin is configured',async()=>{
 const h=await harness();
 try{
  const page=await fetch(h.base+'/support?workspace=alpha');
  assert.equal(page.status,200);
  assert.match(page.headers.get('content-security-policy'),/frame-ancestors 'none'/);
  assert.match(await page.text(),/Customer support/);
  const admin=await fetch(h.base+'/support-admin');
  assert.equal(admin.status,200);
  assert.match(admin.headers.get('content-security-policy'),/script-src 'self'/);
 }finally{await h.stop();}
});
