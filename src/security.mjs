export function validateWorkspace(value){
 if(typeof value!=='string'||!/^[a-z0-9_-]{1,60}$/i.test(value))throw Error('Invalid workspace');
 return value;
}
export function createLimiter({windowMs=60000,max=60,maxKeys=2000}={}){
 const counters=new Map();
 return (key,now=Date.now())=>{
  for(const [k,v] of counters)if(now-v.start>=windowMs)counters.delete(k);
  if(!counters.has(key)){if(counters.size>=maxKeys)return false;counters.set(key,{start:now,count:1});return true;}
  const state=counters.get(key);state.count++;return state.count<=max;
 };
}
export function safeEventIdentity(existing,incoming){
 if(existing.id!==incoming.id||existing.workspace!==incoming.workspace)return 'distinct';
 const fields=['type','value','currency','customerId','campaign','consent'];
 return fields.every(k=>existing[k]===incoming[k])?'duplicate':'conflict';
}
