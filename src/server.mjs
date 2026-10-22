import http from 'node:http';
import {randomUUID,timingSafeEqual} from 'node:crypto';
import {readFile,writeFile,rename,mkdir} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {validateEvent,summarize,recommend,scoreLead} from './analytics.mjs';
import {advisory} from './ai.mjs';
const dbPath=resolve(process.env.DB_PATH||'data/events.json');
const admin=process.env.ADMIN_TOKEN;
const ingest=process.env.INGEST_TOKEN;
if(!admin||!ingest||admin.length<24||ingest.length<24||admin===ingest)throw Error('Set distinct ADMIN_TOKEN and INGEST_TOKEN (24+ chars)');
const workspace=/^[a-z0-9_-]{1,60}$/i;
let events=[];
try{const stored=JSON.parse(await readFile(dbPath,'utf8'));if(!Array.isArray(stored))throw Error('Invalid data store');events=stored;}catch(e){if(e.code!=='ENOENT')throw e;}
function authorized(header,secret){if(typeof header!=='string'||!header.startsWith('Bearer '))return false;const a=Buffer.from(header.slice(7)),b=Buffer.from(secret);return a.length===b.length&&timingSafeEqual(a,b);}
async function persist(){await mkdir(dirname(dbPath),{recursive:true});const tmp=dbPath+'.'+randomUUID()+'.tmp';await writeFile(tmp,JSON.stringify(events),{mode:0o600});await rename(tmp,dbPath);}
let queue=Promise.resolve();
function transactionalInsert(record){const next=queue.then(async()=>{if(events.some(x=>x.id===record.id&&x.workspace===record.workspace))return false;events=[...events,record];try{await persist();return true;}catch(e){events=events.filter(x=>x!==record);throw e;}});queue=next.catch(()=>{});return next;}
function reply(res,status,data){res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','access-control-allow-origin':'null'});res.end(JSON.stringify(data));}
async function body(req){let raw='';for await(const c of req){raw+=c;if(raw.length>16384)throw Error('Request too large');}return JSON.parse(raw||'{}');}
const server=http.createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://localhost');
  if(req.method==='GET'&&url.pathname==='/health')return reply(res,200,{status:'ok'});
  if(req.method==='GET'&&url.pathname==='/'){const html=await readFile(new URL('../public/index.html',import.meta.url));res.writeHead(200,{'content-type':'text/html; charset=utf-8','x-content-type-options':'nosniff','content-security-policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'"});return res.end(html);}
  if(req.method==='GET'&&url.pathname==='/app.js'){const script=await readFile(new URL('../public/app.js',import.meta.url));res.writeHead(200,{'content-type':'text/javascript; charset=utf-8','x-content-type-options':'nosniff'});return res.end(script);}
  if(url.pathname==='/api/events'&&req.method==='POST'){
   if(!authorized(req.headers.authorization,ingest))return reply(res,401,{error:'Unauthorized'});
   const input=await body(req),workspaceId=input.workspace;
   if(typeof workspaceId!=='string'||!workspace.test(workspaceId))return reply(res,400,{error:'Invalid workspace'});
   if(typeof input.id!=='string'||input.id.length>100||!input.id.trim())return reply(res,400,{error:'Stable event ID required'});
   const normalized=validateEvent(input);
   const record={...normalized,id:input.id,workspace:workspaceId,createdAt:new Date().toISOString()};
   const created=await transactionalInsert(record);return reply(res,created?201:200,{id:record.id,deduplicated:!created});
  }
  if(!authorized(req.headers.authorization,admin))return reply(res,401,{error:'Unauthorized'});
  const w=url.searchParams.get('workspace')||'default';
  if(!workspace.test(w))return reply(res,400,{error:'Invalid workspace'});
  if(req.method==='GET'&&url.pathname==='/api/overview'){const metrics=summarize(events,w);return reply(res,200,{metrics,recommendations:recommend(metrics)});}
  if(req.method==='POST'&&url.pathname==='/api/score'){const input=await body(req);return reply(res,200,{score:scoreLead(input)});}
  if(req.method==='POST'&&url.pathname==='/api/advice'){const input=await body(req);const metrics=summarize(events,w);const advice=await advisory({metrics,objective:input.objective});return reply(res,200,{advice,metrics});}
  return reply(res,404,{error:'Not found'});
 }catch(e){const expected=/Invalid|Unsupported|consent|required|large|Unexpected token/i.test(e.message);reply(res,expected?400:502,{error:expected?e.message:'Operation failed'});}
});
server.listen(Number(process.env.PORT||3000),'0.0.0.0',()=>console.log('A+ listening'));
