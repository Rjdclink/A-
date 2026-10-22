const TYPES=new Set(['visit','view','cart','checkout','purchase','lead']);
export function validateEvent(e){
 if(!e||!TYPES.has(e.type))throw Error('Unsupported event type');
 if(e.consent!==true)throw Error('Explicit analytics consent required');
 if(e.value!==undefined&&(!Number.isFinite(e.value)||e.value<0||e.value>1e9))throw Error('Invalid value');
 if(e.currency!==undefined&&!/^[A-Z]{3}$/.test(e.currency))throw Error('Invalid currency');
 if(e.type==='purchase'&&e.currency!==undefined&&e.currency!=='USD')throw Error('Only USD purchase events supported until currency conversion is implemented');
 if(e.customerId!==undefined&&(typeof e.customerId!=='string'||e.customerId.length>120))throw Error('Invalid customer ID');
 if(e.campaign!==undefined&&(typeof e.campaign!=='string'||e.campaign.length>120))throw Error('Invalid campaign');
 return {type:e.type,value:e.value??0,currency:e.currency??'USD',customerId:e.customerId??null,campaign:e.campaign??'organic',consent:true};
}
export function scoreLead(lead){
 const set=new Set(Array.isArray(lead.events)?lead.events:[]);
 return Math.min(100,(set.has('view')?10:0)+(set.has('cart')?30:0)+(set.has('checkout')?35:0)+(set.has('purchase')?50:0)+(typeof lead.email==='string'&&lead.email.includes('@')?10:0));
}
export function summarize(events,workspace){
 const seen=new Set(),items=[];
 for(const e of events){if(e.workspace!==workspace||seen.has(e.id))continue;seen.add(e.id);items.push(e);}
 const count=type=>items.filter(e=>e.type===type).length;
 const purchases=items.filter(e=>e.type==='purchase');
 const revenue=Math.round(purchases.reduce((n,e)=>n+e.value,0)*100)/100;
 const byCampaign=Object.create(null);
 for(const e of items){const name=e.campaign||'organic';const c=byCampaign[name]??={visits:0,carts:0,purchases:0,revenue:0};if(e.type==='visit')c.visits++;if(e.type==='cart')c.carts++;if(e.type==='purchase'){c.purchases++;c.revenue=Math.round((c.revenue+e.value)*100)/100;}}
 return {visits:count('visit'),views:count('view'),carts:count('cart'),checkouts:count('checkout'),purchases:purchases.length,leads:count('lead'),revenue,conversionRate:count('visit')?Math.round(purchases.length/count('visit')*10000)/100:null,byCampaign};
}
export function recommend(s){
 const result=[];
 if(s.visits===0)result.push('Collect consented traffic and purchase events before making optimization claims.');
 if(s.carts>=5&&s.purchases/s.carts<0.35)result.push('Investigate checkout abandonment: test shipping disclosure, payment friction and checkout speed.');
 if(s.visits>=20&&s.carts/s.visits<0.08)result.push('Investigate product-page merchandising, offer clarity and add-to-cart friction.');
 if(s.purchases>0)result.push('Compare campaign revenue and acquisition costs before shifting advertising budget.');
 return result.length?result:['Continue measuring campaign cohorts; avoid changes on small samples.'];
}
