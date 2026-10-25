import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {Ledger} from '../src/ledger.mjs';
import {createSupport} from '../src/support.mjs';
import {createHandler} from '../src/api.mjs';

const users={
 alpha:{adminToken:'a'.repeat(32),ingestToken:'b'.repeat(32)},
 beta:{adminToken:'c'.repeat(32),ingestToken:'d'.repeat(32)}
};
async function harness(){
 const ledger=new Ledger(':memory:',{pseudonymKey:'support-completion-integration-key'});
 const support=createSupport(ledger.db,{clock:()=>Date.now()});
 const server=createServer(createHandler({ledger,support,tenants:users,adviser:async()=>''}));
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 return {ledger,support,base:'http://127.0.0.1:'+server.address().port,close:()=>new Promise(resolve=>server.close(()=>{ledger.close();resolve();}))};
}
async function call(root,path,{token,method='GET',body}={}){
 const r=await fetch(root+'/api/support/'+path,{method,headers:{...(token?{authorization:'Bearer '+token}:{}),...(body?{'content-type':'application/json'}:{})},body:body===undefined?undefined:JSON.stringify(body)});
 return {status:r.status,data:await r.json()};
}
const path=(route,w='alpha')=>route+(route.includes('?')?'&':'?')+'workspace='+w;

test('staff accounts authenticate with scoped limited permissions and revocation',async()=>{
 const h=await harness();try{
  const owner=users.alpha.adminToken;
  const created=await call(h.base,path('team'),{token:owner,method:'POST',body:{name:'Agent One',email:'agent1@example.org',password:'correct horse battery',role:'agent'}});
  assert.equal(created.status,201);assert.equal(created.data.member.role,'agent');assert.ok(!JSON.stringify(created.data).includes('correct horse battery'));
  assert.equal((await call(h.base,path('team'),{method:'GET'})).status,401);
  assert.equal((await call(h.base,path('team'),{token:users.beta.adminToken})).status,401);
  const wrong=await call(h.base,path('team/login'),{method:'POST',body:{email:'agent1@example.org',password:'incorrect'}});
  assert.equal(wrong.status,401);
  const login=await call(h.base,path('team/login'),{method:'POST',body:{email:'agent1@example.org',password:'correct horse battery'}});
  assert.equal(login.status,200);assert.equal(login.data.role,'agent');
  const agent=login.data.token;assert.ok(agent.length>=32);
  assert.equal((await call(h.base,path('tickets'),{token:agent})).status,200);
  assert.equal((await call(h.base,path('metrics'),{token:agent})).status,200);
  assert.equal((await call(h.base,path('articles'),{token:agent,method:'POST',body:{question:'Shipping?',answer:'Soon'}})).status,403);
  assert.equal((await call(h.base,path('privacy/export'),{token:agent,method:'POST',body:{email:'private@example.org'}})).status,403);
  const general=await fetch(h.base+'/api/overview?workspace=alpha',{headers:{authorization:'Bearer '+agent}});
  assert.equal(general.status,401);
  assert.equal((await call(h.base,path('tickets','beta'),{token:agent})).status,401);
  assert.equal((await call(h.base,path('team/'+created.data.member.id),{token:owner,method:'PATCH',body:{active:false}})).status,200);
  assert.equal((await call(h.base,path('tickets'),{token:agent})).status,401);
  const reopened=await call(h.base,path('team/login'),{method:'POST',body:{email:'agent1@example.org',password:'correct horse battery'}});
  assert.equal(reopened.status,401,'disabled staff account stays disabled');

 }finally{await h.close();}
});

test('staff session logout actively revokes server-side access',async()=>{
 const h=await harness();try{
  await call(h.base,path('team'),{token:users.alpha.adminToken,method:'POST',body:{name:'Support Agent',email:'logout@example.org',password:'very long secure pass',role:'agent'}});
  const login=await call(h.base,path('team/login'),{method:'POST',body:{email:'logout@example.org',password:'very long secure pass'}});
  const token=login.data.token;assert.equal((await call(h.base,path('tickets'),{token})).status,200);
  assert.equal((await call(h.base,path('team/logout'),{token,method:'POST',body:{}})).status,200);
  assert.equal((await call(h.base,path('tickets'),{token})).status,401);
 }finally{await h.close();}
});

test('approved knowledge bulk import is atomic; reusable internal macros, notes and ticket searching',async()=>{
 const h=await harness();try{
  const admin=users.alpha.adminToken;
  const bad=await call(h.base,path('articles/import'),{token:admin,method:'POST',body:{articles:[{question:'What is your warranty?',answer:'One year.'},{question:'Missing answer'}]}});
  assert.equal(bad.status,400);
  assert.equal((await call(h.base,path('articles'),{token:admin})).data.articles.length,0);
  const imported=await call(h.base,path('articles/import'),{token:admin,method:'POST',body:{articles:[{question:'What is your warranty?',answer:'One year.',locale:'en',category:'Policies'},{question:'Delivery speed?',answer:'Three days.',active:false}]}});
  assert.equal(imported.status,201);assert.equal(imported.data.imported,2);
  const found=await call(h.base,path('articles/search?q=warranty'),{token:admin});
  assert.equal(found.data.articles.length,1);
  assert.equal(found.data.articles[0].category,'Policies');
  const macro=await call(h.base,path('macros'),{token:admin,method:'POST',body:{title:'Greeting',body:'Hello, we are checking.'}});
  assert.equal(macro.status,201);
  assert.equal((await call(h.base,path('macros'),{token:admin})).data.macros.length,1);
  const conversation=await call(h.base,path('chat'),{method:'POST',body:{message:'Please help',email:'customer@example.org'}});
  const note=await call(h.base,path('tickets/'+conversation.data.ticketId+'/notes'),{token:admin,method:'POST',body:{body:'Staff-only internal details'}});
  assert.equal(note.status,201);
  const thread=await call(h.base,path('thread'),{method:'POST',body:{ticketId:conversation.data.ticketId,sessionToken:conversation.data.sessionToken}});
  assert.doesNotMatch(JSON.stringify(thread),/Staff-only internal details/);
  const search=await call(h.base,path('tickets/search?q=help&status=pending'),{token:admin});
  assert.equal(search.status,200);assert.equal(search.data.tickets.length,1);
  const exportResult=await call(h.base,path('privacy/export'),{token:admin,method:'POST',body:{email:'customer@example.org'}});
  assert.match(JSON.stringify(exportResult.data),/Staff-only internal details/);
 }finally{await h.close();}
});

test('local notifications and SLA monitoring are scoped, and customer can export and erase an anonymous chat',async()=>{
 const h=await harness();try{
  const opened=await call(h.base,path('chat'),{method:'POST',body:{message:'Please contact support urgently'}});
  const admin=users.alpha.adminToken;
  const sla=await call(h.base,path('sla'),{token:admin,method:'PATCH',body:{firstResponseMinutes:1,resolutionMinutes:1}});
  assert.equal(sla.status,200);
  const notice=await call(h.base,path('notifications'),{token:admin});
  assert.ok(notice.data.notifications.length>=1);
  assert.equal((await call(h.base,path('notifications','beta'),{token:users.beta.adminToken})).data.notifications.length,0);
  const id=notice.data.notifications[0].id;
  assert.equal((await call(h.base,path('notifications/'+id+'/read'),{token:admin,method:'POST',body:{}})).status,200);
  const exported=await call(h.base,path('privacy/self/export'),{method:'POST',body:{ticketId:opened.data.ticketId,sessionToken:opened.data.sessionToken}});
  assert.equal(exported.status,200);assert.match(JSON.stringify(exported.data),/support urgently/);
  const erased=await call(h.base,path('privacy/self/erase'),{method:'POST',body:{ticketId:opened.data.ticketId,sessionToken:opened.data.sessionToken}});
  assert.equal(erased.data.erased,true);
  assert.equal((await call(h.base,path('thread'),{method:'POST',body:{ticketId:opened.data.ticketId,sessionToken:opened.data.sessionToken}})).status,403);
  assert.equal((await call(h.base,path('tickets'),{token:admin})).data.tickets.length,0);
 }finally{await h.close();}
});

test('internal appointment calendar prevents overbooking and supports customer cancellation',async()=>{
 const h=await harness();try{
  const time=new Date(Date.now()+48*3600000).toISOString();
  const slot=await call(h.base,path('calendar/slots'),{token:users.alpha.adminToken,method:'POST',body:{service:'Consultation',startAt:time,durationMinutes:30,capacity:1}});
  assert.equal(slot.status,201);
  const slots=await call(h.base,path('calendar/slots'));
  assert.equal(slots.status,200);assert.equal(slots.data.slots[0].remaining,1);
  const first=await call(h.base,path('chat'),{method:'POST',body:{message:'Book my appointment'}});
  const second=await call(h.base,path('chat'),{method:'POST',body:{message:'Book me also'}});
  const firstBook=await call(h.base,path('calendar/book'),{method:'POST',body:{slotId:slot.data.slot.id,ticketId:first.data.ticketId,sessionToken:first.data.sessionToken}});
  assert.equal(firstBook.status,201);assert.equal(firstBook.data.booking.status,'confirmed_local');
  const noRoom=await call(h.base,path('calendar/book'),{method:'POST',body:{slotId:slot.data.slot.id,ticketId:second.data.ticketId,sessionToken:second.data.sessionToken}});
  assert.equal(noRoom.status,409);
  const noCross=await call(h.base,path('calendar/book','beta'),{method:'POST',body:{slotId:slot.data.slot.id,ticketId:first.data.ticketId,sessionToken:first.data.sessionToken}});
  assert.equal(noCross.status,403);
  const cancelled=await call(h.base,path('calendar/cancel'),{method:'POST',body:{bookingId:firstBook.data.booking.id,ticketId:first.data.ticketId,sessionToken:first.data.sessionToken}});
  assert.equal(cancelled.status,200);
  const nowRoom=await call(h.base,path('calendar/book'),{method:'POST',body:{slotId:slot.data.slot.id,ticketId:second.data.ticketId,sessionToken:second.data.sessionToken}});
  assert.equal(nowRoom.status,201);
  const other=await call(h.base,path('calendar/bookings','beta'),{token:users.beta.adminToken});
  assert.equal(other.data.bookings.length,0);
 }finally{await h.close();}
});

test('local operational dashboard exposes trends and safe audit events per workspace',async()=>{
 const h=await harness();try{
  const owner=users.alpha.adminToken;
  await call(h.base,path('chat'),{method:'POST',body:{message:'Need help'}});
  const trends=await call(h.base,path('reports?days=7'),{token:owner});
  assert.equal(trends.status,200);assert.equal(trends.data.daily.length,7);
  assert.equal(trends.data.daily.at(-1).tickets,1);
  const audit=await call(h.base,path('audit'),{token:owner});
  assert.equal(audit.status,200);assert.ok(Array.isArray(audit.data.events));
  assert.equal((await call(h.base,path('audit','beta'),{token:users.beta.adminToken})).data.events.length,0);
 }finally{await h.close();}
});
