import {createHmac,timingSafeEqual} from 'node:crypto';

export const SQUARE_API_VERSION='2026-09-16';
const tierNames=['starter','pro','enterprise'];
export function configuredPlans(env=process.env){
 return tierNames.flatMap(id=>{
  const prefix='SQUARE_PLAN_'+id.toUpperCase()+'_';
  const variation=env[prefix+'VARIATION_ID'],amount=env[prefix+'CENTS'];
  if(typeof variation!=='string'||!/^[A-Za-z0-9_-]{3,120}$/.test(variation)||!/^[1-9]\d{0,7}$/.test(String(amount||'')))return [];
  return [{id,name:id[0].toUpperCase()+id.slice(1),variation_id:variation,
   amount_cents:Number(amount),currency:'USD',interval:'month'}];
 });
}
function apiOrigin(env){
 if(env.SQUARE_ENVIRONMENT==='sandbox')return 'https://connect.squareupsandbox.com';
 if(env.SQUARE_ENVIRONMENT==='production')return 'https://connect.squareup.com';
 throw Error('Configure SQUARE_ENVIRONMENT as sandbox or production');
}
export function squareClient({env=process.env,fetchImpl=fetch}={}){
 if(typeof env.SQUARE_ACCESS_TOKEN!=='string'||!env.SQUARE_ACCESS_TOKEN.trim())throw Error('Square API credentials are unavailable');
 const root=apiOrigin(env);
 async function request(method,path,body){
  if(!['GET','POST'].includes(method)||!/^\/v2\/(?:subscriptions\/[A-Za-z0-9_-]{1,120}(?:\/cancel)?|online-checkout\/payment-links|orders\/[A-Za-z0-9_-]{1,120})$/.test(path))
   throw Error('Unsupported Square API request');
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),18000);
  try{
   const response=await fetchImpl(root+path,{method,headers:{
    'Authorization':'Bearer '+env.SQUARE_ACCESS_TOKEN,'Square-Version':SQUARE_API_VERSION,
    'Content-Type':'application/json'
   },...(body===undefined?{}:{body:JSON.stringify(body)}),signal:controller.signal});
   const text=await response.text();let parsed;
   try{parsed=JSON.parse(text);}catch{parsed={};}
   if(!response.ok)throw Error('Square API rejected request ('+response.status+')');
   return parsed;
  }finally{clearTimeout(timeout);}
 }
 return {request};
}
export function verifySquareSignature(raw,header,env=process.env){
 const url=env.SQUARE_WEBHOOK_URL,key=env.SQUARE_WEBHOOK_SIGNATURE_KEY;
 if(typeof raw!=='string'||typeof header!=='string'||typeof url!=='string'||typeof key!=='string'||!url.startsWith('https://'))return false;
 const expected=createHmac('sha256',key).update(url+raw).digest();
 let received;try{received=Buffer.from(header,'base64');}catch{return false;}
 return received.length===expected.length&&timingSafeEqual(received,expected);
}
export function validateCheckoutUrl(value){
 let url;try{url=new URL(value);}catch{throw Error('Unrecognized Square checkout link');}
 if(url.protocol!=='https:'||!['square.link','sandbox.square.link','checkout.square.site','squareup.com','www.squareup.com'].includes(url.hostname)||
  url.username||url.password)throw Error('Untrusted Square checkout destination');
 return url.href;
}
export function subscriptionStatus(status){
 return status==='ACTIVE'?'active':
  status==='PAUSED'?'paused':
  ['CANCELED','DEACTIVATED'].includes(status)?'cancelled':'pending_checkout';
}
