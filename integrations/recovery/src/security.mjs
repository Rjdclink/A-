import {randomBytes,createHash,scryptSync,timingSafeEqual} from 'node:crypto';
export function escapeHtml(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
export function digest(v){return createHash('sha256').update(String(v)).digest('hex');}
export function passwordHash(password,salt=randomBytes(16).toString('hex')){if(String(password).length<12)throw Error('Password must be at least 12 characters');return salt+':'+scryptSync(password,salt,64).toString('hex');}
export function passwordMatches(password,hash){try{const [salt,hex]=hash.split(':');const a=scryptSync(String(password),salt,64),b=Buffer.from(hex,'hex');return a.length===b.length&&timingSafeEqual(a,b);}catch{return false;}}
export const randomToken=()=>randomBytes(32).toString('base64url');
export function slugify(v){return String(v??'').normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,42)||'business';}
export function sameOrigin(request){const given=request.headers.get('origin');return !given||given===new URL(request.url).origin;}
export function privateRequest(request){return request.method!=='GET'&&request.method!=='HEAD'&&request.method!=='OPTIONS';}
export function dateString(date){try{return new Date(date).toLocaleString('en-US',{dateStyle:'medium',timeStyle:'short',timeZone:'UTC'})+' UTC';}catch{return String(date||'');}}
export function secureCookie(token){
const secure=process.env.SESSION_COOKIE_SECURE!=='false';
return (secure?'__Host-arr_session':'arr_session')+'='+encodeURIComponent(token)+'; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000'+(secure?'; Secure':'');
}
export function cookieToken(request){const ck=request.headers.get('cookie')||'';const name=process.env.SESSION_COOKIE_SECURE==='false'?'arr_session':'__Host-arr_session';return ck.split(';').map(v=>v.trim()).find(v=>v.startsWith(name+'='))?.split('=')[1]||'';}
const buckets=new Map();
export function rateLimit(request,key,limit=30,windowMs=60000){
const ip=request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()||'unknown';
const now=Date.now(),id=key+':'+ip;
if(buckets.size>3000)for(const [k,v] of buckets)if(v.reset<now)buckets.delete(k);
const item=buckets.get(id);
if(!item||now>=item.reset){buckets.set(id,{remaining:limit-1,reset:now+windowMs});return true;}
if(item.remaining<=0)return false;item.remaining--;return true;
}
export function isValidEmail(email){return typeof email==='string'&&email.length<=254&&/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);}
export async function readForm(request,maxBytes=12000){
const len=Number(request.headers.get('content-length')||0);if(len>maxBytes)throw Error('Request too large');
const raw=await request.text();if(raw.length>maxBytes)throw Error('Request too large');
return new URLSearchParams(raw);
}
export function requireValidText(x,limit=500){const v=String(x||'').trim();if(!v||v.length>limit)throw Error('Please enter a valid value (maximum '+limit+' characters)');return v;}
