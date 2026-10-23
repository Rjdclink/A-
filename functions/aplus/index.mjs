import {randomBytes} from 'node:crypto';
import {createServer} from 'node:http';
import {mkdtemp,rm,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import pg from 'pg';
import {Ledger} from '../../src/ledger.mjs';
import {createHandler} from '../../src/api.mjs';
import {createUnified} from '../../src/unified.mjs';
import {advisory} from '../../src/ai.mjs';
import {neonTLSConnectionString} from '../../src/neon.mjs';

const token=()=>randomBytes(32).toString('base64url');
const schema="CREATE TABLE IF NOT EXISTS aplus_function_state (workspace TEXT PRIMARY KEY, commerce BYTEA, automation BYTEA, admin_token TEXT NOT NULL, ingest_token TEXT NOT NULL, pseudonym_key TEXT NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now())";
const insert="INSERT INTO aplus_function_state (workspace,admin_token,ingest_token,pseudonym_key) VALUES($1,$2,$3,$4) ON CONFLICT (workspace) DO NOTHING";
const select="SELECT commerce,automation,admin_token,ingest_token,pseudonym_key FROM aplus_function_state WHERE workspace=$1 FOR UPDATE";
const update="UPDATE aplus_function_state SET commerce=$2,automation=$3,updated_at=now() WHERE workspace=$1";
const strip=new Set(['connection','transfer-encoding','content-length','keep-alive','upgrade']);

async function forward(request,dir,saved,env){
 const commerce=join(dir,'commerce.sqlite'),automation=join(dir,'automation.sqlite');
 if(saved.commerce)await writeFile(commerce,saved.commerce);
 if(saved.automation)await writeFile(automation,saved.automation);
 const appEnv={...env,PUBLIC_DASHBOARD:'true',PUBLIC_WORKSPACE:'default',ALLOW_SIGNUP:'false',
  ADMIN_TOKEN:saved.admin_token,INGEST_TOKEN:saved.ingest_token,PSEUDONYM_KEY:saved.pseudonym_key,
  DB_PATH:commerce,AUTOMATION_DB_PATH:automation,AUTO_BACKUP_HOURS:'0',SESSION_COOKIE_SECURE:'true'};
 let ledger,unified,server;
 try{
  ledger=new Ledger(commerce,{pseudonymKey:appEnv.PSEUDONYM_KEY,maxEvents:Number(appEnv.MAX_EVENTS||500000)});
  unified=createUnified({ledger,env:appEnv,automationDbPath:automation,autoStart:false});
  const tenants={default:{adminToken:appEnv.ADMIN_TOKEN,ingestToken:appEnv.INGEST_TOKEN}};
  const shops=appEnv.SHOPIFY_SHOPS_JSON?JSON.parse(appEnv.SHOPIFY_SHOPS_JSON):{};
  const handler=createHandler({ledger,tenants,unified,adviser:advisory,publicDashboard:true,publicWorkspace:'default',shopify:{
   secret:appEnv.SHOPIFY_SECRET,shops,allowOrders:appEnv.SHOPIFY_ANALYTICS_BASIS_ACKNOWLEDGED==='true'}});
  server=createServer(handler);
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)});
  const url=new URL(request.url),target='http://127.0.0.1:'+server.address().port;
  const headers=new Headers(request.headers);
  for(const h of strip)headers.delete(h);
  headers.set('host','127.0.0.1:'+server.address().port);
  const body=['GET','HEAD'].includes(request.method)?undefined:Buffer.from(await request.arrayBuffer());
  if(body?.byteLength>1024*1024)return {response:new Response(JSON.stringify({error:'Request body too large'}),{status:413,headers:{'content-type':'application/json'}}),snapshot:false};
  const reply=await fetch(target+url.pathname+url.search,{method:request.method,headers,body,signal:AbortSignal.timeout(165000)});
  const data=request.method==='HEAD'?null:await reply.arrayBuffer();
  const resultHeaders=new Headers(reply.headers);
  for(const name of strip)resultHeaders.delete(name);
  // Neon Functions do not host unattended application workers. Scheduled
  // invocations and ordinary requests can make progress on queued workflows.
  await unified.growth.tick().catch(e=>console.error('Growth tick:',e?.code||e?.name));
  await unified.recovery.tick().catch(e=>console.error('Recovery tick:',e?.code||e?.name));
  ledger.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  unified.growth.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  return {response:new Response(data,{status:reply.status,headers:resultHeaders}),snapshot:true};
 }finally{
  if(server?.listening)await new Promise(resolve=>server.close(resolve));
  if(unified)await unified.close();
  if(ledger)ledger.close();
 }
}
export function createNeonApp({pool,env=process.env}={}){
 const db=pool||new pg.Pool({connectionString:neonTLSConnectionString(env.DATABASE_URL),max:2,connectionTimeoutMillis:8000,idleTimeoutMillis:30000});
 if(db.on)db.on('error',e=>console.error('Neon connection error:',e?.code||e?.name));
 let ready;
 const initialize=()=>{
  if(!ready)ready=db.query(schema).catch(e=>{ready=null;throw e});
  return ready;
 };
 return {
  async fetch(request){
   const route=new URL(request.url);
   const scheduled=route.pathname==='/tasks';
   if(scheduled&&(request.method!=='POST'||!request.headers.get('x-neon-trigger-invocation-id')))
    return new Response(JSON.stringify({error:'Neon trigger required'}),{status:403,headers:{'content-type':'application/json'}});
   if(!['GET','HEAD','POST','PUT','PATCH','DELETE'].includes(request.method))return new Response('Method not allowed',{status:405});
   let client,dir;
   try{
    await initialize();
    client=await db.connect();
    await client.query('BEGIN');
    await client.query(insert,['default',token(),token(),token()]);
    const state=(await client.query(select,['default'])).rows[0];
    if(!state)throw Error('Workspace state unavailable');
    dir=await mkdtemp(join(tmpdir(),'aplus-neon-'));
    // Copy-on-request serialized under row lock; snapshots are stored durably in Neon.
    const forwarded=scheduled?new Request(new URL('/health',route),{method:'GET'}):request;
    const answer=await forward(forwarded,dir,state,env);
    if(answer.snapshot){
     const files=await Promise.all(['commerce.sqlite','automation.sqlite'].map(name=>readFile(join(dir,name))));
     await client.query(update,['default',...files]);
    }
    await client.query('COMMIT');
    if(scheduled){
     if(!answer.response.ok)return answer.response;
     return new Response(JSON.stringify({ok:true,maintenance:'processed'}),{status:200,headers:{'content-type':'application/json'}});
    }
    return answer.response;
   }catch(e){
    if(client)await client.query('ROLLBACK').catch(()=>{});
    console.error('A+ request failed:',e?.code||e?.name||'Error');
    return new Response(JSON.stringify({error:'Application temporarily unavailable'}),{status:503,headers:{'content-type':'application/json; charset=utf-8'}});
   }finally{
    client?.release();
    if(dir)await rm(dir,{recursive:true,force:true}).catch(()=>{});
   }
  }
 };
}
const neonApp=createNeonApp();
export default {fetch:request=>neonApp.fetch(request)};
