import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHmac} from 'node:crypto';
import {createRecoveryEngine,verifyStripe} from '../src/recovery-engine.mjs';
const HOUR=3600000,DAY=24*HOUR;
function fixture(extra={}){
 const db=new DatabaseSync(':memory:');let time=1700000000000;const sent=[];
 const mail=async message=>sent.push(message);mail.configured=()=>true;
 const env={PSEUDONYM_KEY:'test-key'.repeat(8),RECOVERY_PUBLIC_URL:'https://example.com',...extra.env};
 const e=createRecoveryEngine(db,{clock:()=>time,mail,...extra,env});
 const call=(p,data,method=data?'POST':'GET')=>e.handle('w',p,method,data);
 return {db,e,call,sent,env,advance:n=>{time+=n;},time:()=>time,close:()=>db.close()};
}
async function enroll(f,cid,type='checkout'){
 await f.call('contacts',{customer_id:cid,email:cid+'@example.com',phone:'+15551234567',email_consent:true,sms_consent:true,consent_source:'checkout opt-in'});
 await f.call('signals',{id:'cart:'+cid,customer_id:cid,type,amount_cents:12000,currency:'USD',return_url:'https://shop.example/checkout',evidence:'Customer requested checkout'});
 return (await f.call('cases')).cases.find(c=>c.customer_id===cid);
}
async function treatment(f){for(let i=0;i<50;i++){const c=await enroll(f,'c'+i);if(c.arm==='treatment')return c;}throw Error('No treatment fixture');}
test('priority, grounded previews, deduplicated signals and immutable experiment policies',async()=>{
 const f=fixture();try{
  const c=await treatment(f);assert.equal(c.evidence.source,'merchant_event');assert.ok(c.score>=80);
  const p=await f.call('cases/'+c.id+'/preview');assert.match(p.email.body,/120.00 USD/);assert.match(p.email.body,/https:\/\/shop.example\/checkout/);assert.match(p.email.body,/unsubscribe/);assert.equal(p.email.mode,'grounded_template');
  assert.equal((await f.call('signals',{id:'cart:'+c.customer_id,customer_id:c.customer_id,type:'checkout'})).duplicate,true);
  await assert.rejects(f.call('settings',{holdout_percent:30}),/new experiment/);
  await f.call('settings',{experiment:'v2'});
  await assert.rejects(f.call('signals',{id:'other',customer_id:c.customer_id,type:'cart'}),/observation window/);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM recovery_signals WHERE id='other'").get().n,0);
 }finally{f.close();}
});
test('scheduler respects pause, timing, per-customer caps, holdouts and purchase stop',async()=>{
 const f=fixture();try{
  const c=await treatment(f);assert.equal(await f.e.tick(),0);await f.call('settings',{enabled:true});assert.equal(await f.e.tick(),0);
  f.advance(3*HOUR);assert.equal(await f.e.tick(),1);assert.equal(f.sent.length,1);assert.equal(await f.e.tick(),0);
  await f.call('signals',{id:'paid',customer_id:c.customer_id,type:'purchase',amount_cents:10000,currency:'USD'});f.advance(3*DAY);await f.e.tick();assert.equal(f.sent.length,1);
  assert.equal((await f.call('cases')).cases.find(x=>x.id===c.id).status,'purchased');
  const report=await f.call('report');assert.equal(report.cohorts[0].incremental_revenue_cents,null);
 }finally{f.close();}
});
test('concurrent sends claim once and unknown delivery is never retried',async()=>{
 let release;const gate=new Promise(r=>release=r);let attempts=0;const mail=async()=>{attempts++;await gate;throw Error('ack lost');};mail.configured=()=>true;
 const f=fixture({mail});try{const c=await treatment(f);f.advance(3*HOUR);const first=f.call('cases/'+c.id+'/send',{confirm:true});const second=await f.call('cases/'+c.id+'/send',{confirm:true});assert.equal(second.skipped,'delivery_review_required');release();assert.equal((await first).review_required,true);f.advance(3*DAY);await f.call('settings',{enabled:true});await f.e.tick();assert.equal(attempts,1);}finally{f.close();}
});
test('opt-out and replies stop all sequences, and opt-out persists across contact updates',async()=>{
 const f=fixture();try{const c=await treatment(f);const preview=await f.call('cases/'+c.id+'/preview');const url=new URL(preview.email.body.split('Stop recovery messages: ')[1]);
  assert.throws(()=>f.e.unsubscribe('w',c.customer_id,'bad'),/Invalid/);
  f.e.unsubscribe('w',c.customer_id,url.searchParams.get('token'));await enroll(f,c.customer_id);await f.call('settings',{enabled:true});f.advance(3*DAY);assert.equal(await f.e.tick(),0);assert.equal(f.sent.length,0);
  assert.equal((await f.call('contacts')).contacts.find(x=>x.id===c.customer_id).stopped,1);
 }finally{f.close();}
});
test('no-consent steps are skipped and missing transport never claims a send',async()=>{
 const mail=async()=>assert.fail('must not send');mail.configured=()=>false;const f=fixture({mail});try{const c=await treatment(f);f.advance(3*HOUR);assert.equal((await f.call('cases/'+c.id+'/send',{confirm:true})).skipped,'email_not_configured');assert.equal((await f.call('deliveries')).deliveries.length,0);
 await f.call('contacts',{customer_id:c.customer_id,email:'a@example.com',email_consent:false,sms_consent:false,consent_source:''});assert.equal((await f.call('cases/'+c.id+'/send',{confirm:true})).skipped,'no_channel_consent');
 }finally{f.close();}
});
test('mature randomized holdout report uses deduplicated outcomes, separates currencies and allows negative lift',async()=>{
 const f=fixture();try{let holdout,treat;for(let i=0;i<100&&(!holdout||!treat);i++){const c=await enroll(f,'cohort'+i);if(c.arm==='holdout')holdout=c;else treat=c;}
  await f.call('signals',{id:'purchase-h',customer_id:holdout.customer_id,type:'purchase',amount_cents:5000,currency:'USD'});
  await f.call('signals',{id:'purchase-h',customer_id:holdout.customer_id,type:'purchase',amount_cents:5000,currency:'USD'});
  f.advance(15*DAY);const g=(await f.call('report')).cohorts[0];assert.equal(g.holdout.conversions,1);assert.equal(g.treatment.conversions,0);assert.ok(g.incremental_revenue_cents<0);assert.equal(g.holdout.revenue_cents,5000);
  assert.equal((await f.call('cases/'+holdout.id+'/send',{confirm:true})).skipped,'purchased');
 }finally{f.close();}
});
test('Stripe verifies signatures, fetches current state and never initiates charges',async()=>{
 const calls=[];const f=fixture({env:{RECOVERY_STRIPE_KEY:'sk_fixture',RECOVERY_STRIPE_WEBHOOK_SECRET:'whsec_fixture'},fetcher:async(url,opts)=>{calls.push([url,opts]);return {ok:true,json:async()=>({id:'in_fixture',status:'paid',amount_remaining:0,attempt_count:2,currency:'usd',hosted_invoice_url:'https://invoice.stripe.com/i/fixture'})};}});
 try{const raw=Buffer.from(JSON.stringify({type:'invoice.payment_failed',data:{object:{id:'in_fixture',status:'open'}}}));const t=Math.floor(f.time()/1000),signature='t='+t+',v1='+createHmac('sha256','whsec_fixture').update(t+'.').update(raw).digest('hex');
  assert.equal(verifyStripe(raw,signature,'whsec_fixture',f.time()),true);assert.equal(verifyStripe(raw,signature,'whsec_fixture',f.time()+400000),false);
  await assert.rejects(f.e.stripeEvent('w',raw,'bad'),/signature/);await f.e.stripeEvent('w',raw,signature);await f.e.stripeEvent('w',raw,signature);
  assert.equal((await f.call('invoices')).invoices[0].status,'paid');assert.ok(calls.every(([url,o])=>url.endsWith('/invoices/in_fixture')&&!o.method));
 }finally{f.close();}
});
test('Twilio SMS uses provider protocol and signed STOP suppresses future messages',async()=>{
 const calls=[];const env={RECOVERY_TWILIO_SID:'AC'+'a'.repeat(32),RECOVERY_TWILIO_TOKEN:'fixture-token',RECOVERY_TWILIO_FROM:'+15550000000',RECOVERY_TWILIO_WEBHOOK_URL:'https://example.com/api/recovery/webhooks/twilio'};
 const f=fixture({env,fetcher:async(url,opts)=>{calls.push({url,opts});return {ok:true,json:async()=>({sid:'SMfixture'})};}});
 try{await f.call('settings',{steps:[{channel:'sms',delay_hours:1}],max_messages:1});const c=await treatment(f);f.advance(2*HOUR);assert.equal((await f.call('cases/'+c.id+'/send',{confirm:true})).accepted,true);assert.match(calls[0].url,/Messages.json$/);assert.equal(calls[0].opts.body.get('To'),'+15551234567');
  const raw=Buffer.from('From=%2B15551234567&Body=STOP');const sig=createHmac('sha1','fixture-token').update(env.RECOVERY_TWILIO_WEBHOOK_URL+'BodySTOPFrom+15551234567').digest('base64');assert.throws(()=>f.e.twilioEvent('w',raw,'bad'),/signature/);f.e.twilioEvent('w',raw,sig);assert.equal((await f.call('cases')).cases.find(x=>x.id===c.id).status,'opted_out');
 }finally{f.close();}
});
test('workspace isolation and erasure include recovery engine data',async()=>{const f=fixture();try{await treatment(f);assert.equal((await f.e.handle('other','cases','GET')).cases.length,0);f.e.erase('w');assert.equal((await f.call('cases')).cases.length,0);assert.equal((await f.call('contacts')).contacts.length,0);}finally{f.close();}});
test('AI drafts require review, preserve unsubscribe and invalidate approval when evidence changes',async()=>{
 const f=fixture({env:{AI_API_KEY:'fixture'},ai:async()=>JSON.stringify({subject:'Can we help?',body:'Continue securely: https://shop.example/checkout'})});
 try{const c=await treatment(f);const d=await f.call('cases/'+c.id+'/draft',{});assert.equal(d.draft.mode,'ai');assert.equal(d.draft.status,'review_required');await assert.rejects(f.call('cases/'+c.id+'/approve',{}),/confirm/);await f.call('cases/'+c.id+'/approve',{confirm:true});f.advance(3*HOUR);await f.call('cases/'+c.id+'/send',{confirm:true});assert.equal(f.sent[0].subject,'Can we help?');assert.match(f.sent[0].text,/Stop recovery messages/);
 await f.call('signals',{id:'new-checkout',customer_id:c.customer_id,type:'checkout',amount_cents:13000,evidence:'Changed checkout'});await assert.rejects(f.call('cases/'+c.id+'/approve',{confirm:true}),/latest evidence/);
 }finally{f.close();}
});
test('unavailable AI returns reviewable fallback and customer erasure prevents recreation',async()=>{
 const f=fixture({env:{AI_API_KEY:'fixture'},ai:async()=>{throw Error('unavailable');}});try{const c=await treatment(f);const d=await f.call('cases/'+c.id+'/draft',{});assert.equal(d.draft.mode,'deterministic_fallback');f.e.eraseCustomer('w',c.customer_id);assert.equal(f.e.exportCustomer('w',c.customer_id).contact,null);await assert.rejects(enroll(f,c.customer_id),/erased/);assert.equal((await f.call('signals',{id:'new',customer_id:c.customer_id,type:'purchase'})).suppressed,true);}finally{f.close();}
});
