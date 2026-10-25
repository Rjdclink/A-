import {serviceSettings} from './service-settings.mjs';
import {advisory} from './ai.mjs';
import {createHmac} from 'node:crypto';
import {createApp} from '../integrations/automation/src/server.mjs';
import {createSession,first,run,now} from '../integrations/automation/src/core.mjs';
import {createRecovery} from './recovery.mjs';
import {createOrchestration} from './orchestration.mjs';
import {createNeonIntegration} from './neon.mjs';

function mailer(env){
 const send=async({to,subject,text,messageId})=>{
  if(!env.RECOVERY_SMTP_HOST||!env.RECOVERY_SMTP_USER||!env.RECOVERY_SMTP_PASS||!env.RECOVERY_SMTP_FROM)throw Error('Mail transport is not configured');
  const {default:nodemailer}=await import('nodemailer');
  const transport=nodemailer.createTransport({
   host:env.RECOVERY_SMTP_HOST,port:Number(env.RECOVERY_SMTP_PORT||587),
   secure:Number(env.RECOVERY_SMTP_PORT||587)===465,
   auth:{user:env.RECOVERY_SMTP_USER,pass:env.RECOVERY_SMTP_PASS},
   connectionTimeout:15000,socketTimeout:20000
  });
  try{await transport.sendMail({from:env.RECOVERY_SMTP_FROM,to,subject,text,messageId});}
  finally{transport.close();}
 };
 send.configured=()=>Boolean(env.RECOVERY_SMTP_HOST&&env.RECOVERY_SMTP_USER&&env.RECOVERY_SMTP_PASS&&env.RECOVERY_SMTP_FROM);
 return send;
}
export function createUnified({ledger,env=process.env,automationDbPath=env.AUTOMATION_DB_PATH||(env.DB_PATH?env.DB_PATH+'.automation.sqlite':'data/a-plus.automation.sqlite'),autoStart=true,neonIntegration=null,recoveryOptions={}}){
 // Stable domain-separated key keeps saved credentials usable across restarts.
 if(!env.INTEGRATION_MASTER_KEY&&typeof env.PSEUDONYM_KEY==='string'&&env.PSEUDONYM_KEY.length>=24)env={...env,INTEGRATION_MASTER_KEY:createHmac('sha256',env.PSEUDONYM_KEY).update('aplus:integration-credentials:v1').digest('hex')};
 env={...env,ALLOW_SIGNUP:'false'};
 const services=serviceSettings(ledger.db,env);
 const growth=createApp({dbPath:automationDbPath,env,autoStart});
 const orchestration=createOrchestration(ledger.db,growth.db);
 const neon=neonIntegration||createNeonIntegration({env});
 const recovery=createRecovery(ledger.db,{...recoveryOptions,env,mail:mailer(env),onOpportunity:async(workspace,site)=>{
  const evidence={opportunity:{website:site.website,summary:site.analysis?.summary||'',score:site.analysis?.priority_score??null}};
  await orchestration.emit(workspace,'recovery.analysis',evidence);
  await neon.record(workspace,'recovery.analysis','recovery:'+site.id+':'+site.updated_at,evidence.opportunity);
 }});
 // The GrowthVeyra server is loopback-only and is never exposed as another public application.
 growth.server.listen(0,'127.0.0.1');
 const ready=new Promise((resolve,reject)=>{
  if(growth.server.listening)resolve();
  else{growth.server.once('listening',resolve);growth.server.once('error',reject);}
 });
 const sessions=new Map();
 function tokenFor(workspace){
  const stored=sessions.get(workspace);
  if(stored&&stored.expires>now()+60000)return stored.secret;
  const tenant='aplus:'+workspace,uid='aplus-admin:'+workspace,stamp=now();
  if(!first(growth.db,'SELECT id FROM tenants WHERE id=?',tenant)){
   run(growth.db,'INSERT INTO tenants(id,name,created_at) VALUES(?,?,?)',tenant,workspace,stamp);
  }
  if(!first(growth.db,'SELECT id FROM users WHERE id=?',uid)){
   // A+ handles all authentication; there is no independent login credential for this service identity.
   run(growth.db,'INSERT INTO users(id,tenant_id,email,password_hash,role,created_at) VALUES(?,?,?,?,?,?)',
    uid,tenant,'aplus-'+workspace+'@internal.invalid','disabled','admin',stamp);
  }
  const user=first(growth.db,'SELECT * FROM users WHERE id=? AND tenant_id=?',uid,tenant);
  const secret=createSession(growth.db,user);
  const expires=stamp+6*86400000;sessions.set(workspace,{secret,expires});
  return secret;
 }
 async function proxy(path,method='GET',payload=null,workspace=null,extraHeaders={}){
  await ready;
  const port=growth.server.address().port;
  const headers={...extraHeaders};
  if(workspace!==null)headers.authorization='Bearer '+tokenFor(workspace);
  if(payload!==null)headers['content-type']='application/json';
  const upstream=await fetch('http://127.0.0.1:'+port+path,{
   method,headers,body:payload!==null?JSON.stringify(payload):undefined,signal:AbortSignal.timeout(60000)
  });
  const body=await upstream.text();
  let parsed;try{parsed=JSON.parse(body);}catch{parsed={error:upstream.ok?'Unexpected automation response':'Automation service unavailable'};}
  return {status:upstream.status,data:parsed};
 }
 async function handle(workspace,path,method,payload){
  if(path==='integrations/settings'&&method==='GET')return {status:200,data:services.status()};
  if(path==='integrations/settings'&&method==='POST'){try{return {status:200,data:services.save(payload?.values)};}catch(e){return {status:400,data:{error:e.message}};}}
  if(path==='integrations/status'&&method==='GET'){
   const activeEmail=Boolean(env.RECOVERY_SMTP_HOST&&env.RECOVERY_SMTP_USER&&env.RECOVERY_SMTP_PASS&&env.RECOVERY_SMTP_FROM);
   const square=Boolean(env.SQUARE_ACCESS_TOKEN&&env.SQUARE_LOCATION_ID);
   const shops=(()=>{try{return JSON.parse(env.SHOPIFY_SHOPS_JSON||'{}');}catch{return {};}})();
   const shopReady=Boolean(env.SHOPIFY_SECRET&&Object.keys(shops).length&&env.SHOPIFY_ANALYTICS_BASIS_ACKNOWLEDGED==='true');
   const dbStatus=await neon.status(workspace);
   return {status:200,data:{providers:{
    email:activeEmail?'configured':'not_configured',
    ai:env.AI_API_KEY?'configured':'not_configured',
    square:square?'configured':env.SQUARE_ACCESS_TOKEN?'configuration_incomplete':'not_configured',
    shopify:shopReady?'configured':env.SHOPIFY_SECRET||Object.keys(shops).length?'configuration_incomplete':'not_configured',
    neon:dbStatus.connected?'connected':dbStatus.configured?'unavailable':'not_configured'
   },note:'Configured means credentials were supplied, not that external providers have verified them.'}};
  }
  if(path==='neon/status'&&method==='GET')return {status:200,data:await neon.status(workspace)};
  if(path==='neon/history'&&method==='GET'){
   try{return {status:200,data:await neon.history(workspace)};}
   catch{return {status:503,data:{error:'Neon database unavailable'}};}
  }
  if(path.startsWith('orchestration/')){
   try{return orchestration.handle(workspace,path.slice(14),method,payload||{});}catch(e){return {status:e.status||500,data:{error:e.status?e.message:'Operation failed'}};}
  }
  if(path.startsWith('growth/')){
   const route=path.slice(7);
   if(!route||route.startsWith('auth/')||route.startsWith('hooks/')||route==='billing/webhook/square')return {status:404,data:{error:'Not found'}};
   const out=await proxy('/api/'+route,method,payload,workspace);
   return out;
  }
  if(path.startsWith('recovery/')){
   const action=path.slice(9);
   const result=await recovery.handle(workspace,action,method,payload||{});
   return {status:method==='POST'?201:200,data:result};
  }
  return {status:404,data:{error:'Not found'}};
 }
 async function webhook(req,path){
  if(req.method!=='POST')return {status:405,data:{error:'Method not allowed'}};
  const headers={};
  const external={ 'x-growthveyra-secret':'x-growthveyra-secret',
   'x-growthveyra-event-id':'x-growthveyra-event-id',
   'x-square-hmacsha256-signature':'x-square-hmacsha256-signature'};
  for(const [key,target]of Object.entries(external)){
   if(typeof req.headers[key]==='string')headers[target]=req.headers[key];
  }
  let total=0;const chunks=[];
  for await(const part of req){total+=part.length;if(total>65536)return {status:413,data:{error:'Payload too large'}};chunks.push(part);}
  await ready;
  const upstream=await fetch('http://127.0.0.1:'+growth.server.address().port+'/api/'+path,{
   method:'POST',headers:{...headers,'content-type':req.headers['content-type']||'application/json'},
   body:Buffer.concat(chunks),signal:AbortSignal.timeout(30000)});
  const raw=await upstream.text();let data;try{data=JSON.parse(raw);}catch{data={error:'Invalid upstream response'};}
  return {status:upstream.status,data};
 }
 const interval=autoStart?setInterval(()=>recovery.tick().catch(e=>console.error('Recovery scheduler:',e.message)),60000):null;
 interval?.unref();
 async function close(){
  if(interval)clearInterval(interval);growth.stop();
  await new Promise(resolve=>growth.server.close(resolve));growth.db.close();await neon.close();
 }
 async function emit(workspace,event,data={}){
  const queued=await orchestration.emit(workspace,event,data);
  if(neon.configured&&data.event_id){
   const filtered={...data};delete filtered.event_id;
   await neon.record(workspace,event,'commerce:'+data.event_id,filtered);
  }
  return queued;
 }
 return {handle,webhook,recovery,close,growth,emit,env,adviser:args=>advisory({...args,env}),erase:orchestration.erase};
}
