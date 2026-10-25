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

test('private support knowledge is tenant-scoped and requires staff authorization',async()=>{
 const h=await harness({publicDashboard:false});
 try{
  const path='/api/support/articles?workspace=alpha';
  assert.equal((await request(h.base,path,{method:'POST',body:{question:'Shipping',answer:'Two days.'}})).status,401);
  assert.equal((await request(h.base,path,{token:tenants.alpha.ingestToken,method:'POST',body:{question:'Shipping',answer:'Two days.'}})).status,401);
  const created=await request(h.base,path,{token:tenants.alpha.adminToken,method:'POST',body:{question:'How long does shipping take?',answer:'Shipping usually takes two days.',locale:'en'}});
  assert.equal(created.status,201);assert.ok(created.data.article.id);
  assert.equal((await request(h.base,path,{token:tenants.beta.adminToken})).status,401);
  assert.equal((await request(h.base,'/api/support/articles?workspace=beta',{token:tenants.beta.adminToken})).status,200);
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


test('only the ticket holder can rate a conversation and support analytics aggregate ratings',async()=>{
 const h=await harness();
 try{
  const opened=await request(h.base,'/api/support/chat?workspace=alpha',{method:'POST',body:{message:'How do I find the helpdesk?'}});
  assert.equal(opened.status,201);
  const payload={ticketId:opened.data.ticketId,sessionToken:opened.data.sessionToken,rating:5,feedback:'Helpful'};
  assert.equal((await request(h.base,'/api/support/rating?workspace=alpha',{method:'POST',body:{...payload,sessionToken:'fake'}})).status,403);
  assert.equal((await request(h.base,'/api/support/rating?workspace=beta',{method:'POST',body:payload})).status,403);
  assert.equal((await request(h.base,'/api/support/rating?workspace=alpha',{method:'POST',body:{...payload,rating:6}})).status,400);
  const submitted=await request(h.base,'/api/support/rating?workspace=alpha',{method:'POST',body:payload});
  assert.equal(submitted.status,200);assert.equal(submitted.data.rating,5);
  assert.equal((await request(h.base,'/api/support/rating?workspace=alpha',{method:'POST',body:{...payload,rating:4}})).status,200);
  const metrics=await request(h.base,'/api/support/metrics?workspace=alpha',{token:tenants.alpha.adminToken});
  assert.equal(metrics.data.ratedTickets,1);assert.equal(metrics.data.averageRating,4);
  assert.equal((await request(h.base,'/api/support/metrics?workspace=beta',{token:tenants.beta.adminToken})).data.ratedTickets,0);
  const detail=await request(h.base,'/api/support/tickets/'+opened.data.ticketId+'?workspace=alpha',{token:tenants.alpha.adminToken});
  assert.equal(detail.data.rating.feedback,'Helpful');
 }finally{await h.stop();}
});

test('support triggers sanitized, tenant-scoped workflow events after persistence',async()=>{
 const ledger=new Ledger(':memory:',{pseudonymKey:'stable-pseudonym-key-32-characters'});
 const events=[];
 const support=createSupport(ledger.db,{onEvent:async(workspace,event,data)=>{
  assert.ok(ledger.db.prepare('SELECT 1 FROM support_tickets WHERE id=?').get(data.ticket.id));
  events.push({workspace,event,data});
 }});
 try{
  const created=await support.receive('alpha',{message:'Please contact a person',name:'Private Name',email:'contact@private.example'});
  assert.equal(created.needsHuman,true);
  support.updateTicket('alpha',created.ticketId,{status:'resolved',priority:'high'});
  support.staffReply('alpha',created.ticketId,{message:'We can help.'});
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(events.map(x=>x.event),['support.ticket_created','support.handoff_required','support.ticket_updated','support.agent_replied']);
  const serialized=JSON.stringify(events);
  assert.doesNotMatch(serialized,/Private Name|private\.example|Please contact a person|We can help/);
  assert.ok(events.every(x=>x.workspace==='alpha'));
 }finally{ledger.close();}
});


test('visitors explicitly opt in before contact leads appear in the private pipeline',async()=>{
 const h=await harness();
 try{
  const bad=await request(h.base,'/api/support/chat?workspace=alpha',{method:'POST',body:{message:'Please call me',leadConsent:true}});
  assert.equal(bad.status,400);
  const regular=await request(h.base,'/api/support/chat?workspace=alpha',{method:'POST',body:{message:'Tell me the price',name:'Regular',email:'regular@example.org'}});
  assert.equal(regular.status,201);
  const lead=await request(h.base,'/api/support/chat?workspace=alpha',{method:'POST',body:{message:'Please contact me about a service',name:'Potential Buyer',email:'buyer@example.org',leadConsent:true}});
  assert.equal(lead.status,201);assert.equal(lead.data.leadCaptured,true);
  const list=await request(h.base,'/api/support/leads?workspace=alpha',{token:tenants.alpha.adminToken});
  assert.equal(list.status,200);assert.equal(list.data.leads.length,1);
  assert.equal(list.data.leads[0].email,'buyer@example.org');
  assert.equal((await request(h.base,'/api/support/leads?workspace=beta',{token:tenants.beta.adminToken})).data.leads.length,0);
  assert.equal((await request(h.base,'/api/support/leads?workspace=alpha')).status,401);
  assert.equal((await request(h.base,'/api/support/leads/'+lead.data.ticketId+'?workspace=alpha',{token:tenants.alpha.adminToken,method:'PATCH',body:{status:'contacted'}})).data.lead.status,'contacted');
  const exported=await request(h.base,'/api/support/privacy/export?workspace=alpha',{token:tenants.alpha.adminToken,method:'POST',body:{email:'buyer@example.org'}});
  assert.equal(exported.data.leads.length,1);
  const erased=await request(h.base,'/api/support/privacy/erase?workspace=alpha',{token:tenants.alpha.adminToken,method:'POST',body:{email:'buyer@example.org'}});
  assert.equal(erased.data.deleted,1);
  assert.equal((await request(h.base,'/api/support/leads?workspace=alpha',{token:tenants.alpha.adminToken})).data.leads.length,0);
 }finally{await h.stop();}
});

test('appointment requests require a valid customer session and remain unconfirmed until external scheduling',async()=>{
 const h=await harness();
 try{
  const opened=await request(h.base,'/api/support/chat?workspace=alpha',{method:'POST',body:{message:'I need an appointment'}});
  const when=new Date(Date.now()+3*86400000).toISOString();
  const payload={ticketId:opened.data.ticketId,sessionToken:opened.data.sessionToken,service:'Consultation',requestedAt:when,timezone:'America/Chicago',notes:'Morning preferred'};
  assert.equal((await request(h.base,'/api/support/appointments?workspace=alpha',{method:'POST',body:{...payload,sessionToken:'fake'}})).status,403);
  assert.equal((await request(h.base,'/api/support/appointments?workspace=alpha',{method:'POST',body:{...payload,requestedAt:'2020-01-01T00:00:00Z'}})).status,400);
  const created=await request(h.base,'/api/support/appointments?workspace=alpha',{method:'POST',body:payload});
  assert.equal(created.status,201);assert.equal(created.data.appointment.status,'requested');assert.equal(created.data.appointment.confirmed,false);
  const other=await request(h.base,'/api/support/appointments?workspace=beta',{token:tenants.beta.adminToken});
  assert.equal(other.data.appointments.length,0);
  const queued=await request(h.base,'/api/support/appointments?workspace=alpha',{token:tenants.alpha.adminToken});
  assert.equal(queued.data.appointments.length,1);
  const id=created.data.appointment.id;
  assert.equal((await request(h.base,'/api/support/appointments/'+id+'?workspace=beta',{token:tenants.beta.adminToken,method:'PATCH',body:{status:'reviewing'}})).status,404);
  const reviewed=await request(h.base,'/api/support/appointments/'+id+'?workspace=alpha',{token:tenants.alpha.adminToken,method:'PATCH',body:{status:'reviewing'}});
  assert.equal(reviewed.data.appointment.status,'reviewing');assert.equal(reviewed.data.appointment.confirmed,false);
  const thread=await request(h.base,'/api/support/thread?workspace=alpha',{method:'POST',body:{ticketId:opened.data.ticketId,sessionToken:opened.data.sessionToken}});
  assert.equal(thread.status,200);assert.match(JSON.stringify(thread.data.messages),/Consultation/);
  const exported=await request(h.base,'/api/support/privacy/export?workspace=alpha',{token:tenants.alpha.adminToken,method:'POST',body:{email:'unknown@example.org'}});
  assert.equal(exported.data.tickets.length,0);
 }finally{await h.stop();}
});


test('a visitor can explicitly request a human even when the knowledge base has an answer',async()=>{
 const h=await harness();
 try{
  await request(h.base,'/api/support/articles?workspace=alpha',{token:tenants.alpha.adminToken,method:'POST',body:{question:'What is your return policy?',answer:'Returns are accepted within thirty days.'}});
  const chat=await request(h.base,'/api/support/chat?workspace=alpha',{method:'POST',body:{message:'What is your return policy?'}});
  assert.equal(chat.status,201);assert.equal(chat.data.needsHuman,false);
  assert.equal((await request(h.base,'/api/support/handoff?workspace=alpha',{method:'POST',body:{ticketId:chat.data.ticketId,sessionToken:'not-a-token'}})).status,403);
  assert.equal((await request(h.base,'/api/support/handoff?workspace=beta',{method:'POST',body:{ticketId:chat.data.ticketId,sessionToken:chat.data.sessionToken}})).status,403);
  const handoff=await request(h.base,'/api/support/handoff?workspace=alpha',{method:'POST',body:{ticketId:chat.data.ticketId,sessionToken:chat.data.sessionToken}});
  assert.equal(handoff.status,200);assert.equal(handoff.data.status,'pending');assert.equal(handoff.data.needsHuman,true);
  const ticket=await request(h.base,'/api/support/tickets/'+chat.data.ticketId+'?workspace=alpha',{token:tenants.alpha.adminToken});
  assert.equal(ticket.data.ticket.status,'pending');
  assert.match(JSON.stringify(ticket.data.messages),/human representative/);
  const repeated=await request(h.base,'/api/support/handoff?workspace=alpha',{method:'POST',body:{ticketId:chat.data.ticketId,sessionToken:chat.data.sessionToken}});
  assert.equal(repeated.status,200);assert.equal(repeated.data.status,'pending');
 }finally{await h.stop();}
});


test('staff-only customer profiles group self-declared email histories inside one workspace',async()=>{
 const h=await harness({publicDashboard:false});
 try{
  const first=await request(h.base,'/api/support/chat?workspace=alpha',{method:'POST',body:{message:'My first inquiry',name:'Client A',email:'client@example.org'}});
  const second=await request(h.base,'/api/support/chat?workspace=alpha',{method:'POST',body:{message:'Another inquiry',name:'Client A',email:'CLIENT@example.org'}});
  await request(h.base,'/api/support/chat?workspace=alpha',{method:'POST',body:{message:'Anonymous inquiry'}});
  assert.equal(first.status,201);assert.equal(second.status,201);
  assert.equal((await request(h.base,'/api/support/customers?workspace=alpha')).status,401);
  assert.equal((await request(h.base,'/api/support/customers?workspace=alpha',{token:tenants.beta.adminToken})).status,401);
  const result=await request(h.base,'/api/support/customers?workspace=alpha',{token:tenants.alpha.adminToken});
  assert.equal(result.status,200);assert.equal(result.data.customers.length,1);
  assert.equal(result.data.customers[0].ticketCount,2);
  assert.equal(result.data.customers[0].verified,false);
  const profile=await request(h.base,'/api/support/customers/lookup?workspace=alpha',{token:tenants.alpha.adminToken,method:'POST',body:{email:'client@example.org'}});
  assert.equal(profile.status,200);assert.equal(profile.data.profile.tickets.length,2);
  assert.equal((await request(h.base,'/api/support/customers/lookup?workspace=alpha',{token:tenants.beta.adminToken,method:'POST',body:{email:'client@example.org'}})).status,401);
  assert.equal((await request(h.base,'/api/support/customers/lookup?workspace=alpha',{token:tenants.alpha.adminToken,method:'POST',body:{email:'unknown@example.org'}})).status,404);
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
