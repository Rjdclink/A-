import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {createApp} from '../src/server.mjs';

const env={ALLOW_SIGNUP:'true',SESSION_COOKIE_SECURE:'false',
 SQUARE_ACCESS_TOKEN:'sandbox-only-example',
 SQUARE_ENVIRONMENT:'sandbox',
 SQUARE_LOCATION_ID:'LOCATION',
 SQUARE_WEBHOOK_URL:'https://example.org/api/billing/webhook/square',
 SQUARE_WEBHOOK_SIGNATURE_KEY:'local-test-signature-key',
 SQUARE_PLAN_STARTER_VARIATION_ID:'STARTER_VAR',
 SQUARE_PLAN_STARTER_CENTS:'4900',
 SQUARE_PLAN_PRO_VARIATION_ID:'PRO_VAR',
 SQUARE_PLAN_PRO_CENTS:'14900',
 BILLING_ENFORCE:'true'
};
async function fixture(){
 const calls=[];let providerStatus='ACTIVE',checkoutOrderId='ORDER-A';
 const billingFetch=async(url,options)=>{
  const body=options.body?JSON.parse(options.body):null;
  calls.push({url,method:options.method,body});
  if(url.endsWith('/v2/online-checkout/payment-links')){
   assert.ok(body.order?.reference_id,'Every checkout must identify the purchaser via an order reference');
   assert.equal(body.checkout_options.subscription_plan_id,'STARTER_VAR');
   return new Response(JSON.stringify({payment_link:{id:'LINK_A',order_id:checkoutOrderId,url:'https://square.link/u/EXAMPLE'}}),{status:200});
  }
  if(url.endsWith('/v2/subscriptions/SUB_A')){
   return new Response(JSON.stringify({subscription:{id:'SUB_A',customer_id:'CUSTOMER_CREATED_AT_CHECKOUT',
    plan_variation_id:'STARTER_VAR',status:providerStatus,phases:[{order_template_id:checkoutOrderId}]}}),{status:200});
  }
  if(url.endsWith('/v2/subscriptions/SUB_A/cancel')){
   return new Response(JSON.stringify({subscription:{id:'SUB_A',canceled_date:'2026-11-20',status:'ACTIVE'}}),{status:200});
  }
  return new Response(JSON.stringify({errors:[{detail:'No such test endpoint'}]}),{status:404});
 };
 const app=createApp({dbPath:':memory:',autoStart:false,env,billingFetch});
 await new Promise(done=>app.server.listen(0,'127.0.0.1',done));
 const base='http://127.0.0.1:'+app.server.address().port;let cookie='';
 const api=async(path,method='GET',data)=>{
  const r=await fetch(base+path,{method,headers:{origin:base,...(cookie?{cookie}:{}),...(data===undefined?{}:{'content-type':'application/json'})},body:data===undefined?undefined:JSON.stringify(data)});
  const sc=r.headers.get('set-cookie');if(sc)cookie=sc.split(';')[0];
  return {status:r.status,data:await r.json()};
 };
 const notify=async(eventId='event-a',signature='')=>{
  const body=JSON.stringify({event_id:eventId,type:'subscription.updated',data:{object:{subscription:{id:'SUB_A',status:'ACTIVE'}}}});
  const correct=createHmac('sha256',env.SQUARE_WEBHOOK_SIGNATURE_KEY).update(env.SQUARE_WEBHOOK_URL+body).digest('base64');
  const r=await fetch(base+'/api/billing/webhook/square',{method:'POST',headers:{'content-type':'application/json','x-square-hmacsha256-signature':signature||correct},body});
  return {status:r.status,data:await r.json()};
 };
 const signup=email=>api('/api/auth/register','POST',{name:'Billing owner',email,password:'A secure example password 123'});
 const close=async()=>{app.stop();await new Promise(done=>app.server.close(done));app.db.close();};
 return {app,api,notify,signup,close,calls,setStatus:s=>providerStatus=s,setOrder:s=>checkoutOrderId=s};
}
test('Square subscription checkout never trusts a supplied price and retains a unique order reference for matching',async()=>{
 const h=await fixture();try{
  await h.signup('billing@example.org');
  const plans=await h.api('/api/billing/plans');
  assert.equal(plans.status,200);
  assert.deepEqual(plans.data.map(x=>x.id),['starter','pro']);
  const link=await h.api('/api/billing/checkout','POST',{plan:'starter',price_override:1});
  assert.equal(link.status,200,JSON.stringify(link.data));
  assert.equal(link.data.url,'https://square.link/u/EXAMPLE');
  const order=h.calls.find(c=>c.url.endsWith('payment-links')).body.order;
  assert.equal(order.line_items[0].base_price_money.amount,4900);
  assert.equal(order.location_id,'LOCATION');
  const record=h.app.db.prepare('SELECT * FROM billing_accounts').get();
  assert.equal(record.checkout_order_id,'ORDER-A');
  assert.ok(record.reference_id&&record.reference_id.length>=20);
  assert.equal((await h.api('/api/billing')).data.status,'pending_checkout');
  assert.equal((await h.api('/api/billing')).data.entitlements.paid,false);
  assert.equal(h.calls.some(c=>c.url.endsWith('/v2/customers')),false,'Square checkout creates or selects customer; pre-created IDs are not guaranteed to match');
 }finally{await h.close();}
});
test('only a verified mapped subscription may unlock a plan, and duplicate Square events are replay safe',async()=>{
 const h=await fixture();try{
  await h.signup('paying@example.org');
  await h.api('/api/billing/checkout','POST',{plan:'starter'});
  assert.equal((await h.notify('evt-invalid','bad-sig')).status,401);
  assert.equal((await h.api('/api/billing')).data.status,'pending_checkout');
  const first=await h.notify();
  assert.equal(first.status,200,JSON.stringify(first.data));
  assert.equal((await h.api('/api/billing')).data.status,'active');
  assert.equal((await h.api('/api/billing')).data.entitlements.paid,true);
  const repeated=await h.notify();
  assert.equal(repeated.data.duplicate,true);
  assert.equal(h.app.db.prepare('SELECT COUNT(*) AS n FROM billing_events').get().n,1);
  h.setStatus('CANCELED');
  assert.equal((await h.notify('evt-canceled')).status,200);
  assert.equal((await h.api('/api/billing')).data.status,'cancelled');
 }finally{await h.close();}
});
test('unmatched Square subscription events cannot assign paid status to unrelated tenants',async()=>{
 const h=await fixture();try{
  await h.signup('owner@example.org');
  const checkout=await h.api('/api/billing/checkout','POST',{plan:'starter'});
  assert.equal(checkout.status,200);
  h.setOrder('NOT_THIS_CHECKOUT');
  assert.equal((await h.notify('evt-unmatched')).status,200);
  assert.equal((await h.api('/api/billing')).data.status,'pending_checkout');
  await h.signup('second@example.org');
  assert.equal((await h.api('/api/billing')).data.status,'free');
 }finally{await h.close();}
});
test('owner can cancel a verified subscription through Square and no forged status update is allowed',async()=>{
 const h=await fixture();try{
  await h.signup('cancel@example.org');
  assert.equal((await h.api('/api/billing/cancel','POST',{})).status,409);
  await h.api('/api/billing/checkout','POST',{plan:'starter'});
  await h.notify();
  const cancel=await h.api('/api/billing/cancel','POST',{});
  assert.equal(cancel.status,200);
  assert.equal(cancel.data.status,'cancel_scheduled');
  assert.ok(h.calls.some(x=>x.url.endsWith('/v2/subscriptions/SUB_A/cancel')));
  assert.equal((await h.api('/api/billing','POST',{status:'active'})).status,404);
 }finally{await h.close();}
});
