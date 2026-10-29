import {timingSafeEqual} from 'node:crypto';
export function validateWorkspace(value){if(typeof value!=='string'||!/^[a-z0-9_-]{1,60}$/i.test(value))throw Error('Invalid workspace');return value;}
export function createLimiter({windowMs=60000,max=60,maxKeys=2000}={}){const counters=new Map();return (key,now=Date.now())=>{for(const [k,v] of counters)if(now-v.start>=windowMs)counters.delete(k);if(!counters.has(key)){if(counters.size>=maxKeys)return false;counters.set(key,{start:now,count:1});return true;}const state=counters.get(key);state.count++;return state.count<=max;};}
export function authorized(header,secret){if(typeof header!=='string'||typeof secret!=='string'||!header.startsWith('Bearer '))return false;const a=Buffer.from(header.slice(7)),b=Buffer.from(secret);return a.length===b.length&&timingSafeEqual(a,b);}
export function loadTenants(env=process.env){
 if(env.WORKSPACES_JSON){const config=JSON.parse(env.WORKSPACES_JSON);if(!config||Array.isArray(config)||typeof config!=='object')throw Error('Invalid WORKSPACES_JSON');const result=Object.create(null);const used=new Set();for(const [name,value]of Object.entries(config)){validateWorkspace(name);if(!value||typeof value.adminToken!=='string'||value.adminToken.length<24||typeof value.ingestToken!=='string'||value.ingestToken.length<24||value.adminToken===value.ingestToken)throw Error('Invalid workspace credentials');if(used.has(value.adminToken)||used.has(value.ingestToken))throw Error('Workspace credentials must be globally unique');used.add(value.adminToken);used.add(value.ingestToken);result[name]={adminToken:value.adminToken,ingestToken:value.ingestToken};}if(!Object.keys(result).length)throw Error('No workspaces configured');return result;}
 if(!env.ADMIN_TOKEN||!env.INGEST_TOKEN||env.ADMIN_TOKEN.length<24||env.INGEST_TOKEN.length<24||env.ADMIN_TOKEN===env.INGEST_TOKEN)throw Error('Set distinct ADMIN_TOKEN and INGEST_TOKEN (24+ chars)');
 return {default:{adminToken:env.ADMIN_TOKEN,ingestToken:env.INGEST_TOKEN}};
}

/** Public dashboard access is limited to explicitly reviewed aggregate reads.
 * Every other API operation requires a workspace token, including new routes.
 * Support visitor endpoints have their own independent authentication gates.
 */
const PUBLIC_AGGREGATE_READS=new Set(['/api/overview','/api/recovery/overview']);
export function publicRouteNeedsAdmin(method,pathname){
 return method!=='GET'||!PUBLIC_AGGREGATE_READS.has(pathname);
}

export function safeEventIdentity(existing,incoming){
 if(existing.id!==incoming.id||existing.workspace!==incoming.workspace)return 'distinct';
 const fields=['type','value','currency','customerId','campaign','consent'];
 return fields.every(k=>existing[k]===incoming[k])?'duplicate':'conflict';
}
