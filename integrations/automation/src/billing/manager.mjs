import {first,run,id,now,audit} from '../core.mjs';
import {configuredPlans,squareClient,verifySquareSignature,validateCheckoutUrl,subscriptionStatus} from './square.mjs';
import {subscriptionEntitlements} from './entitlements.mjs';

export class BillingError extends Error{
 constructor(message,status=400){super(message);this.status=status;}
}
const error=(message,status=400)=>{throw new BillingError(message,status);};
const providerId=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,120}$/.test(value);

export function createBillingManager({db,env=process.env,billingFetch=fetch}={}){
 const plans=()=>configuredPlans(env).map(({variation_id,...info})=>info);
 const record=tenant=>first(db,'SELECT * FROM billing_accounts WHERE tenant_id=?',tenant);
 const state=tenant=>{const r=record(tenant);return {...(r?{plan:r.plan,status:r.status,updated_at:r.updated_at}:{plan:null,status:'free',updated_at:null}),entitlements:subscriptionEntitlements(r,env)};};

 async function checkout(tenant,user,planId){
  const plan=configuredPlans(env).find(x=>x.id===planId);
  if(!plan)error('Subscription plan unavailable',400);
  if(!env.SQUARE_LOCATION_ID)error('Square location is not configured',503);
  const old=record(tenant);
  if(old&&['active','cancel_scheduled','paused'].includes(old.status))error('Existing subscription must be managed before purchasing another',409);
  let client;try{client=squareClient({env,fetchImpl:billingFetch});}catch{error('Square is not configured',503);}
  const reference=id(),order={location_id:env.SQUARE_LOCATION_ID,reference_id:reference,
   line_items:[{name:'GrowthVeyra '+plan.name,quantity:'1',
    base_price_money:{amount:plan.amount_cents,currency:plan.currency}}]};
  let result;try{
   result=await client.request('POST','/v2/online-checkout/payment-links',{
    idempotency_key:id(),order,checkout_options:{subscription_plan_id:plan.variation_id},
    pre_populated_data:{buyer_email:user.email},description:'GrowthVeyra recurring '+plan.name+' subscription'
   });
  }catch{error('Square could not create the recurring checkout',502);}
  const link=result.payment_link;
  if(!link||!providerId(link.id)||!providerId(link.order_id))error('Square checkout did not return a traceable order',502);
  let url;try{url=validateCheckoutUrl(link.url);}catch{error('Unexpected Square checkout destination',502);}
  db.exec('BEGIN IMMEDIATE');
  try{
   run(db,"INSERT INTO billing_accounts(tenant_id,plan,status,reference_id,checkout_order_id,checkout_link_id,updated_at) "+
    "VALUES (?,?,'pending_checkout',?,?,?,?) ON CONFLICT(tenant_id) DO UPDATE SET plan=excluded.plan,status='pending_checkout',"+
    "reference_id=excluded.reference_id,checkout_order_id=excluded.checkout_order_id,"+
    "checkout_link_id=excluded.checkout_link_id,subscription_id=NULL,square_customer_id=NULL,updated_at=excluded.updated_at",
    tenant,plan.id,reference,link.order_id,link.id,now());
   audit(db,tenant,user.id,'billing.checkout_requested',tenant,{plan:plan.id});
   db.exec('COMMIT');
  }catch(e){db.exec('ROLLBACK');throw e;}
  return {url,plan:plan.id,status:'pending_checkout'};
 }
 async function cancel(tenant,user){
  const r=record(tenant);
  if(!r?.subscription_id||!['active','paused','cancel_scheduled'].includes(r.status))error('No active subscription to cancel',409);
  if(r.status==='cancel_scheduled')return {status:'cancel_scheduled'};
  let result;try{
   result=await squareClient({env,fetchImpl:billingFetch}).request('POST','/v2/subscriptions/'+encodeURIComponent(r.subscription_id)+'/cancel',{});
  }catch{error('Square could not schedule cancellation',502);}
  if(result.subscription?.id!==r.subscription_id)error('Square did not confirm cancellation',502);
  run(db,"UPDATE billing_accounts SET status='cancel_scheduled',updated_at=? WHERE tenant_id=? AND subscription_id=?",
   now(),tenant,r.subscription_id);
  audit(db,tenant,user.id,'billing.cancel_requested',tenant,{plan:r.plan});
  return {status:'cancel_scheduled'};
 }
 async function webhook(raw,signature){
  if(!verifySquareSignature(raw,signature,env))error('Invalid Square signature',401);
  let event;try{event=JSON.parse(raw);}catch{error('Invalid Square event',400);}
  if(!event||typeof event.event_id!=='string'||event.event_id.length>180||!event.event_id)error('Invalid Square event ID',400);
  if(first(db,'SELECT event_id FROM billing_events WHERE event_id=?',event.event_id))return {accepted:true,duplicate:true};
  const subId=event.data?.object?.subscription?.id;
  let subscription=null,tenantRecord=null;
  if(['subscription.created','subscription.updated'].includes(event.type)&&providerId(subId)){
   try{subscription=(await squareClient({env,fetchImpl:billingFetch}).request(
    'GET','/v2/subscriptions/'+encodeURIComponent(subId))).subscription;}
   catch{error('Unable to verify subscription with Square',503);}
   if(subscription?.id===subId&&providerId(subscription.customer_id)){
    tenantRecord=first(db,'SELECT * FROM billing_accounts WHERE subscription_id=?',subId);
    if(!tenantRecord){
     for(const phase of Array.isArray(subscription.phases)?subscription.phases:[]){
      if(!providerId(phase.order_template_id))continue;
      tenantRecord=first(db,'SELECT * FROM billing_accounts WHERE checkout_order_id=? AND status=?',
       phase.order_template_id,'pending_checkout');
      if(tenantRecord)break;
      try{
       const order=(await squareClient({env,fetchImpl:billingFetch}).request(
        'GET','/v2/orders/'+encodeURIComponent(phase.order_template_id))).order;
       if(order?.reference_id)tenantRecord=first(db,'SELECT * FROM billing_accounts WHERE reference_id=? AND status=?',
         order.reference_id,'pending_checkout');
      }catch{/* Missing or unrelated orders cannot grant access. */}
      if(tenantRecord)break;
     }
    }
    if(tenantRecord){
     const tier=configuredPlans(env).find(x=>x.id===tenantRecord.plan);
     if(!tier||tier.variation_id!==subscription.plan_variation_id||
        (tenantRecord.subscription_id&&tenantRecord.subscription_id!==subscription.id))tenantRecord=null;
    }
   }
  }
  let duplicate=false;
  db.exec('BEGIN IMMEDIATE');
  try{
   const write=run(db,'INSERT OR IGNORE INTO billing_events(event_id,provider,created_at) VALUES (?,?,?)',event.event_id,'square',now());
   duplicate=!write.changes;
   if(!duplicate&&tenantRecord&&subscription)
    run(db,"UPDATE billing_accounts SET subscription_id=?,square_customer_id=?,status=?,updated_at=? "+
      "WHERE tenant_id=? AND (subscription_id IS NULL OR subscription_id=?)",
     subscription.id,subscription.customer_id,subscriptionStatus(subscription.status),now(),tenantRecord.tenant_id,subscription.id);
   db.exec('COMMIT');
  }catch(e){db.exec('ROLLBACK');throw e;}
  return {accepted:true,duplicate};
 }
 return {plans,state,checkout,cancel,webhook};
}
