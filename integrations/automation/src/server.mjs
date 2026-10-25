import http from 'node:http';
import {readFileSync,mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {openDatabase,first,all,run,id,now,sha256,json,parse,register,passwordMatches,createSession,authenticated,publicUser,audit,enqueue,queryKnowledge,logEvent} from './core.mjs';
import {addConnection,connectionHeaders} from './connections.mjs';
import {providerProbe,validateProbe} from './integrations/providers.mjs';
import {getCatalog,getAppDefinition,resolveAppHost} from './integrations/catalog.mjs';
import {createBillingManager,BillingError} from './billing/manager.mjs';
import {subscriptionEntitlements,enforceBilling} from './billing/entitlements.mjs';
import {validateWorkflow,templates} from './engine.mjs';
import {schedule,claim,execute,failure,externalHttp} from './runner.mjs';
import {resumeFinishedChildren,cancelDescendants} from './subworkflows.mjs';
import {maintenanceConfig,createMaintenance} from './maintenance.mjs';
import {previewWorkflow} from './preview.mjs';
import {generateBlueprint,BlueprintValidationError} from './blueprints.mjs';
import {installReleaseHistory,recordRevision,revisionList,getRevision,restoreRevision} from './releases.mjs';

const website=readFileSync(new URL('../public/index.html',import.meta.url));
const dashboardCss=readFileSync(new URL('../public/dashboard.css',import.meta.url));
const designerJs=readFileSync(new URL('../public/designer.js',import.meta.url));
const designerCss=readFileSync(new URL('../public/designer.css',import.meta.url));
const commerceCss=readFileSync(new URL('../public/commerce.css',import.meta.url));
const commerceJs=readFileSync(new URL('../public/commerce.js',import.meta.url));
const text=(res,status,body,type='text/plain; charset=utf-8',headers={})=>{
 res.writeHead(status,{'content-type':type,'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','x-frame-options':'DENY',...headers});res.end(body);
};
const send=(res,status,data,headers={})=>text(res,status,JSON.stringify(data),'application/json; charset=utf-8',headers);
class HttpError extends Error{constructor(message,status=400){super(message);this.status=status;}}
const fail=(msg,status=400)=>{throw new HttpError(msg,status)};
async function bodyJson(req){
 if(!/^application\/json(?:\s*;|\s*$)/i.test(String(req.headers['content-type']||'')))fail('Expected application/json',415);
 let bytes=0,chunks=[];for await(const part of req){bytes+=part.length;if(bytes>110000)fail('Request body too large',413);chunks.push(part);}
 let parsed;try{parsed=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{fail('Invalid JSON');}
 if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))fail('Expected JSON object');
 return parsed;
}
function safeOrigin(req){
 if(['GET','HEAD','OPTIONS'].includes(req.method))return true;
 const o=req.headers.origin;
 if(!o)return !req.headers.cookie; // machine-to-machine requests may use bearer tokens
 try{return new URL(o).host===req.headers.host;}catch{return false;}
}
function tokenFrom(req,secure){
 const name=secure?'__Host-gv_session':'gv_session';
 const pair=String(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(name+'='));
 if(pair)return decodeURIComponent(pair.slice(name.length+1));
 const auth=String(req.headers.authorization||'');return auth.startsWith('Bearer ')?auth.slice(7):null;
}
function cookie(secret,secure){const name=secure?'__Host-gv_session':'gv_session';return `${name}=${encodeURIComponent(secret)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800${secure?'; Secure':''}`;}
function validateInput(input){
 if(input===undefined)return {};
 if(!input||typeof input!=='object'||Array.isArray(input)||JSON.stringify(input).length>20000)fail('Input must be a JSON object within 20 KB');
 return input;
}
function validateTrigger(value){
 const t=value||{type:'manual'};if(!t||typeof t!=='object'||!['manual','interval','webhook'].includes(t.type))fail('Invalid trigger type');
 if(t.type==='interval'&&(!Number.isInteger(t.every_minutes)||t.every_minutes<1||t.every_minutes>10080))fail('Interval must be 1-10080 whole minutes');
 return t.type==='interval'?{type:t.type,every_minutes:t.every_minutes}:{type:t.type};
}
function sanitizeWorkflow(w){return {...w,spec:parse(w.spec),trigger:parse(w.trigger),enabled:!!w.enabled,allow_external:!!w.allow_external,hook_hash:undefined};}
function resolveWorkflow(db,id,tenant){return first(db,`SELECT w.*,
 COALESCE((SELECT MAX(r.revision) FROM workflow_revisions r WHERE r.workflow_id=w.id),0) AS revision
 FROM workflows w WHERE w.id=? AND w.tenant_id=?`,id,tenant);}
function insertWorkflow(db,user,payload,env=process.env){
 if(typeof payload.name!=='string'||payload.name.trim().length<2||payload.name.length>110)fail('Workflow name must be 2-110 characters');
 if(JSON.stringify(payload.spec||{}).length>50000)fail('Workflow definition exceeds 50 KB');
 let spec;try{spec=validateWorkflow(payload.spec);}catch(e){fail(e.message);}
 if(spec.allowed_hosts!==undefined){
  if(!Array.isArray(spec.allowed_hosts)||spec.allowed_hosts.length>12||spec.allowed_hosts.some(h=>typeof h!=='string'||!/^(?!-)[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(h)||h.length>253))fail('Invalid HTTPS integration host allowlist');
 }
 const trigger=validateTrigger(payload.trigger),stamp=now(),secret=trigger.type==='webhook'?randomBytes(32).toString('base64url'):null;
 const workflow={id:id(),tenant_id:user.tenant_id,name:payload.name.trim(),spec,trigger,enabled:payload.enabled!==false,
 allow_external:payload.allow_external===true,next_run_at:trigger.type==='interval'?stamp+trigger.every_minutes*60000:null,hook_hash:secret?sha256(secret):null};
 db.exec('BEGIN IMMEDIATE');
 try{
  if(enforceBilling(env)){
   const account=first(db,'SELECT plan,status FROM billing_accounts WHERE tenant_id=?',user.tenant_id);
   const allowances=subscriptionEntitlements(account,env);
   if(workflow.allow_external&&!allowances.external_actions)fail('Active subscription required for external actions',402);
   const existing=first(db,'SELECT COUNT(*) AS n FROM workflows WHERE tenant_id=?',user.tenant_id).n;
   if(existing>=allowances.max_workflows)fail('Plan automation limit reached',402);
  }
  run(db,'INSERT INTO workflows VALUES (?,?,?,?,?,?,?,?,?,?,?)',workflow.id,workflow.tenant_id,workflow.name,json(spec),json(trigger),Number(workflow.enabled),workflow.next_run_at,workflow.hook_hash,Number(workflow.allow_external),stamp,stamp);
  recordRevision(db,first(db,'SELECT * FROM workflows WHERE id=?',workflow.id));
  audit(db,user.tenant_id,user.id,'workflow.created',workflow.id,{name:workflow.name,trigger:trigger.type});
  db.exec('COMMIT');
 }catch(error){db.exec('ROLLBACK');throw error;}
 return {...sanitizeWorkflow(resolveWorkflow(db,workflow.id,user.tenant_id)),...(secret?{webhook_secret:secret}:{} )};
}
export function createApp({dbPath=process.env.DB_PATH||'data/growthveyra.sqlite',autoStart=true,env=process.env,aiFetch=fetch,httpRequest,backupFn,billingFetch=fetch}={}){
 const backupSettings=maintenanceConfig(dbPath,env);
 if(dbPath!==':memory:')mkdirSync(dirname(resolve(dbPath)),{recursive:true});
 const db=openDatabase(dbPath),secure=env.SESSION_COOKIE_SECURE!=='false';
 installReleaseHistory(db);
 const maintenance=createMaintenance(db,backupSettings,{backupFn});
 const billing=createBillingManager({db,env,billingFetch});
 let stopped=false,active=null,timer=null;
 const attempts=new Map();
 async function tick(stamp=now()){
  if(stopped)return 0;if(active)return active;
  active=(async()=>{
   schedule(db,stamp);let count=0;
   for(;count<10;count++){
    // Jobs created during this tick may have a later timestamp than the
    // initial scheduler snapshot. Re-evaluate time before each claim.
    const effectiveTime=Math.max(stamp,now());
    resumeFinishedChildren(db,effectiveTime);
    const job=claim(db,effectiveTime);if(!job)break;
    try{await execute(db,job,{env,aiFetch,httpRequest});}catch(error){failure(db,job,error,stamp);}
   }
   run(db,'DELETE FROM sessions WHERE expires_at<?',stamp);
   await maintenance.tick(stamp);
   return count;
  })();try{return await active;}finally{active=null;}
 }
 const server=http.createServer(async(req,res)=>{
  const address=new URL(req.url||'/',`http://${req.headers.host||'localhost'}`);const path=address.pathname;
  try{
   if(req.method==='GET'&&path==='/'){text(res,200,website,'text/html; charset=utf-8',{'content-security-policy':"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'"});return;}
   if(req.method==='GET'&&path==='/dashboard.css'){text(res,200,dashboardCss,'text/css; charset=utf-8',{'cache-control':'public, max-age=3600'});return;}
   if(req.method==='GET'&&path==='/designer.css'){text(res,200,designerCss,'text/css; charset=utf-8',{'cache-control':'public, max-age=3600'});return;}
   if(req.method==='GET'&&path==='/designer.js'){text(res,200,designerJs,'text/javascript; charset=utf-8',{'cache-control':'public, max-age=3600'});return;}
   if(req.method==='GET'&&path==='/commerce.css'){text(res,200,commerceCss,'text/css; charset=utf-8',{'cache-control':'public, max-age=3600'});return;}
   if(req.method==='GET'&&path==='/commerce.js'){text(res,200,commerceJs,'text/javascript; charset=utf-8',{'cache-control':'public, max-age=3600'});return;}
   if(req.method==='GET'&&path==='/api/health'){send(res,200,{status:'ok',service:'GrowthVeyra AI',database:'ready',time:new Date().toISOString()});return;}
   if(req.method==='GET'&&path==='/favicon.ico'){res.writeHead(204);res.end();return;}
   if(!safeOrigin(req))fail('Origin is not authorized',403);
   if(req.method==='POST'&&path==='/api/auth/register'){
    if(env.ALLOW_SIGNUP!=='true')fail('Registration is disabled',403);
    const input=await bodyJson(req);let user;
    try{user=register(db,input);}catch(e){fail(e.message,/exists/.test(e.message)?409:400);}
    const secret=createSession(db,user);audit(db,user.tenant_id,user.id,'account.created');
    send(res,201,{user:publicUser(user)}, {'set-cookie':cookie(secret,secure)});return;
   }
   if(req.method==='POST'&&path==='/api/auth/login'){
    const ip=req.socket.remoteAddress||'unknown',entry=attempts.get(ip)||{count:0,reset:now()+60000};
    if(entry.reset<now()){entry.count=0;entry.reset=now()+60000;}
    if(entry.count>=10)fail('Too many login attempts, try again later',429);
    const input=await bodyJson(req),user=first(db,'SELECT * FROM users WHERE email=?',String(input.email||'').trim().toLowerCase());
    if(!user||user.role!=='admin'||!passwordMatches(input.password,user.password_hash)){entry.count++;attempts.set(ip,entry);fail('Incorrect credentials',401);}
    attempts.delete(ip);const secret=createSession(db,user);
    audit(db,user.tenant_id,user.id,'account.login');send(res,200,{user:publicUser(user)},{'set-cookie':cookie(secret,secure)});return;
   }
   if(path==='/api/auth/accept-invite'||path==='/api/members'||path.startsWith('/api/members/'))fail('Not found',404);
   if(req.method==='POST'&&path==='/api/hooks/unused')fail('Not found',404);
   const hook=path.match(/^\/api\/hooks\/([0-9a-f-]{36})$/);
   if(req.method==='POST'&&hook){
    const wf=first(db,'SELECT * FROM workflows WHERE id=? AND enabled=1',hook[1]);
    if(!wf||parse(wf.trigger).type!=='webhook')fail('Not found',404);
    const supplied=String(req.headers['x-growthveyra-secret']||'');
    const expected=Buffer.from(wf.hook_hash||'', 'hex'),actual=Buffer.from(sha256(supplied),'hex');
    if(!supplied||expected.length!==actual.length||!timingSafeEqual(expected,actual))fail('Unauthorized webhook',401);
    const payload=validateInput(await bodyJson(req));
    const eventId=req.headers['x-growthveyra-event-id'];
    if(eventId!==undefined&&(typeof eventId!=='string'||eventId.length>180||!eventId.trim()))fail('Invalid webhook event ID');
    let job,duplicate=false;
    db.exec('BEGIN IMMEDIATE');
    try{
     const key=eventId?sha256(eventId):null;
     const existing=key?first(db,'SELECT run_id FROM webhook_events WHERE workflow_id=? AND event_hash=?',wf.id,key):null;
     if(existing){job=first(db,'SELECT * FROM runs WHERE id=?',existing.run_id);duplicate=true;}
     else{
      job=enqueue(db,wf,payload);
      if(key)run(db,'INSERT INTO webhook_events VALUES (?,?,?,?)',wf.id,key,job.id,now());
     }
     db.exec('COMMIT');
    }catch(e){db.exec('ROLLBACK');throw e;}
    if(!duplicate)audit(db,wf.tenant_id,'webhook','workflow.triggered',wf.id,{run_id:job.id});
    send(res,202,{id:job.id,status:job.status,duplicate});return;
   }
   if(req.method==='POST'&&path==='/api/billing/webhook/square'){
    let size=0,raw='';
    for await(const bytes of req){
     size+=bytes.length;
     if(size>65536)fail('Square webhook payload too large',413);
     raw+=bytes.toString('utf8');
    }
    let result;try{result=await billing.webhook(raw,String(req.headers['x-square-hmacsha256-signature']||''));}
    catch(error){if(error instanceof BillingError)fail(error.message,error.status);throw error;}
    send(res,200,result);return;
   }
   const user=authenticated(db,tokenFrom(req,secure));if(!user)fail('Authentication required',401);
   if(req.method==='GET'&&path==='/api/billing/plans'){
    send(res,200,billing.plans());return;
   }
   if(req.method==='GET'&&path==='/api/billing'){
    send(res,200,billing.state(user.tenant_id));return;
   }
   if(req.method==='POST'&&path==='/api/billing/checkout'){
    const input=await bodyJson(req);
    let result;try{result=await billing.checkout(user.tenant_id,user,input.plan);}
    catch(error){if(error instanceof BillingError)fail(error.message,error.status);throw error;}
    send(res,200,result);return;
   }
   if(req.method==='POST'&&path==='/api/billing/cancel'){
    await bodyJson(req);
    let result;try{result=await billing.cancel(user.tenant_id,user);}
    catch(error){if(error instanceof BillingError)fail(error.message,error.status);throw error;}
    send(res,200,result);return;
   }
   if(req.method==='GET'&&path==='/api/me'){send(res,200,{user:publicUser(user)});return;}
   if(req.method==='GET'&&path==='/api/maintenance'){
    send(res,200,{automatic_backups:maintenance.status(),worker_mode:'single-process'});return;
   }
   if(req.method==='GET'&&path==='/api/connections'){
    send(res,200,all(db,"SELECT id,name,host,auth_type,provider_id,created_at,verified_at,CASE WHEN verified_at IS NULL THEN 'configured' ELSE 'verified' END AS status FROM connections WHERE tenant_id=? ORDER BY created_at DESC",user.tenant_id));return;
   }
   if(req.method==='GET'&&path==='/api/integrations/catalog'){
    send(res,200,getCatalog({search:address.searchParams.get('search'),category:address.searchParams.get('category')}));return;
   }
   if(req.method==='POST'&&path==='/api/integrations/connect'){
    const input=await bodyJson(req),app=getAppDefinition(input.provider_id);
    if(!app)fail('Unknown app provider',400);
    if(input.auth_type!==undefined||typeof input.credential!=='string'||!input.credential.trim())fail('Provider-issued token required',400);
    let host;try{host=resolveAppHost(app,input.host);}catch(e){fail(e.message,400);}
    let info;try{info=addConnection(db,user.tenant_id,{name:app.name,host,auth_type:app.auth_type,secret:input.credential},env);}
    catch(e){fail(e.message,/not configured/.test(e.message)?503:400);}
    run(db,'UPDATE connections SET provider_id=? WHERE id=? AND tenant_id=?',app.id,info.id,user.tenant_id);
    audit(db,user.tenant_id,user.id,'integration.configured',info.id,{provider:app.id});
    send(res,201,{...info,provider_id:app.id,status:'configured'});return;
   }
   const verifyConnection=path.match(/^\/api\/integrations\/([0-9a-f-]{36})\/test$/);
   if(req.method==='POST'&&verifyConnection){
    await bodyJson(req);
    const c=first(db,'SELECT * FROM connections WHERE id=? AND tenant_id=?',verifyConnection[1],user.tenant_id);
    if(!c)fail('Connection not found',404);
    const app=getAppDefinition(c.provider_id);
    if(!app?.probe_path)fail('This app lacks an automatic read-only verification endpoint',409);
    const url='https://'+c.host+app.probe_path;
    let auth;try{auth=connectionHeaders(db,user.tenant_id,c.id,url,env);}catch(e){fail(e.message,400);}
    try{const reply=await (httpRequest||externalHttp)({url,...providerProbe(app.id),allowedHosts:[c.host],headers:auth.headers});validateProbe(app.id,reply);}
    catch(e){run(db,'UPDATE connections SET verified_at=NULL WHERE id=? AND tenant_id=?',c.id,user.tenant_id);console.error('Read-only provider check failed:',app.id,e?.name||'Error');fail('App declined or could not verify this token',502);}
    run(db,'UPDATE connections SET verified_at=? WHERE id=? AND tenant_id=?',now(),c.id,user.tenant_id);
    audit(db,user.tenant_id,user.id,'integration.verified',c.id,{provider:app.id});
    send(res,200,{id:c.id,provider_id:app.id,status:'verified'});return;
   }
   if(req.method==='POST'&&path==='/api/connections'){const payload=await bodyJson(req);
    let info;try{info=addConnection(db,user.tenant_id,payload,env);}catch(e){fail(e.message,/not configured/.test(e.message)?503:400);}
    audit(db,user.tenant_id,user.id,'connection.created',info.id,{host:info.host});
    send(res,201,info);return;
   }
   const connectionMatch=path.match(/^\/api\/connections\/([0-9a-f-]{36})$/);
   if(req.method==='DELETE'&&connectionMatch){
    const deleted=run(db,'DELETE FROM connections WHERE tenant_id=? AND id=?',user.tenant_id,connectionMatch[1]);
    if(!deleted.changes)fail('Connection not found',404);
    audit(db,user.tenant_id,user.id,'connection.deleted',connectionMatch[1]);send(res,200,{success:true});return;
   }
   if(req.method==='POST'&&path==='/api/auth/logout'){
    const token=tokenFrom(req,secure);run(db,'DELETE FROM sessions WHERE token_hash=?',sha256(token));
    send(res,200,{success:true},{'set-cookie':cookie('',secure).replace('Max-Age=604800','Max-Age=0')});return;
   }
   if(req.method==='POST'&&path==='/api/blueprints'){
    const request=await bodyJson(req),goal=request.goal;
    if(typeof goal!=='string'||goal.trim().length<15||goal.length>1500)
     fail('Describe an automation in 15-1,500 characters',400);
    const max=env.MAX_BLUEPRINTS_PER_HOUR===undefined?6:Number(env.MAX_BLUEPRINTS_PER_HOUR);
    if(!Number.isSafeInteger(max)||max<1||max>30)fail('AI draft limits are not configured',503);
    const stamp=now();
    db.exec('BEGIN IMMEDIATE');
    try{
     run(db,'DELETE FROM blueprint_requests WHERE created_at<?',stamp-86400_000);
     const used=first(db,'SELECT COUNT(*) AS n FROM blueprint_requests WHERE tenant_id=? AND created_at>?',user.tenant_id,stamp-3600000).n;
     if(used>=max)fail('AI draft hourly limit reached. Retry later.',429);
     run(db,'INSERT INTO blueprint_requests VALUES (?,?,?)',id(),user.tenant_id,stamp);
     db.exec('COMMIT');
    }catch(error){db.exec('ROLLBACK');throw error;}
    let blueprint;
    try{blueprint=await generateBlueprint(goal.trim(),{env,aiFetch});}
    catch(error){
     if(error instanceof BlueprintValidationError)fail(error.message,422);
     console.error('AI draft provider unavailable:',error?.name||'Error');
     fail('AI drafting service is temporarily unavailable',503);
    }
    send(res,200,blueprint);return;
   }
   if(req.method==='GET'&&path==='/api/overview'){
    const workflows=first(db,'SELECT COUNT(*) AS n FROM workflows WHERE tenant_id=?',user.tenant_id).n;
    const agents=first(db,"SELECT COUNT(*) AS n FROM workflows WHERE tenant_id=? AND enabled=1",user.tenant_id).n;
    const totals=all(db,'SELECT status,COUNT(*) AS count FROM runs WHERE tenant_id=? GROUP BY status',user.tenant_id);
    send(res,200,{workflows,active_workflows:agents,runs:Object.fromEntries(totals.map(x=>[x.status,x.count])),knowledge: first(db,'SELECT COUNT(*) AS n FROM knowledge WHERE tenant_id=?',user.tenant_id).n});return;
   }
   if(req.method==='GET'&&path==='/api/insights'){
    const since=now()-7*86400_000;
    const grouped=all(db,'SELECT status,COUNT(*) AS amount FROM runs WHERE tenant_id=? AND created_at>=? GROUP BY status',user.tenant_id,since);
    const counts=Object.fromEntries(grouped.map(r=>[r.status,r.amount]));
    const completed=counts.completed||0,failed=counts.failed||0,denominator=completed+failed;
    const timing=first(db,"SELECT ROUND(AVG(updated_at-created_at)) AS ms FROM runs WHERE tenant_id=? AND created_at>=? AND status IN ('completed','failed') AND updated_at>=created_at",user.tenant_id,since);
    const issues=all(db,"SELECT w.name,COUNT(*) AS failures FROM runs r JOIN workflows w ON r.workflow_id=w.id AND r.tenant_id=w.tenant_id WHERE r.tenant_id=? AND r.status='failed' AND r.created_at>=? GROUP BY r.workflow_id ORDER BY failures DESC LIMIT 5",user.tenant_id,since);
    const usage=first(db,`SELECT COUNT(*) AS completed_calls,SUM(total_tokens) AS reported_tokens,
       SUM(CASE WHEN total_tokens IS NULL THEN 1 ELSE 0 END) AS calls_missing_usage
       FROM ai_calls WHERE tenant_id=? AND created_at>=?`,user.tenant_id,since);
    const ai_usage={completed_calls:Number(usage.completed_calls),
      reported_tokens:usage.reported_tokens===null?null:Number(usage.reported_tokens),
      calls_missing_usage:Number(usage.calls_missing_usage||0)};
    send(res,200,{window_days:7,completed,failed,awaiting_approval:counts.awaiting_approval||0,
      running:counts.running||0,success_rate_percent:denominator?Math.round(100*completed/denominator):null,
      average_completion_ms:timing.ms===null?null:Number(timing.ms),issues,ai_usage});return;
   }
   if(req.method==='GET'&&path==='/api/templates'){send(res,200,templates());return;}
   if(req.method==='GET'&&path==='/api/workflows'){
    send(res,200,all(db,`SELECT w.*,
 COALESCE((SELECT MAX(r.revision) FROM workflow_revisions r WHERE r.workflow_id=w.id),0) AS revision
 FROM workflows w WHERE w.tenant_id=? ORDER BY w.created_at DESC LIMIT 100`,user.tenant_id).map(sanitizeWorkflow));return;
   }
   if(req.method==='POST'&&path==='/api/workflows'){const wf=insertWorkflow(db,user,await bodyJson(req),env);send(res,201,wf);return;
   }
   if(req.method==='POST'&&path==='/api/workflows/import'){
    const imported=await bodyJson(req);
    if(imported.format!=='growthveyra-workflow'||imported.schema_version!==1)fail('Unsupported workflow file format');
    if(!imported.trigger||typeof imported.trigger!=='object')fail('Imported workflow requires a valid trigger');
    const saved=insertWorkflow(db,user,{name:imported.name,spec:imported.spec,trigger:imported.trigger,enabled:false,allow_external:false},env);
    audit(db,user.tenant_id,user.id,'workflow.imported',saved.id);
    send(res,201,saved);return;
   }
   const exportMatch=path.match(/^\/api\/workflows\/([0-9a-f-]{36})\/export$/);
   if(req.method==='GET'&&exportMatch){
    const wf=resolveWorkflow(db,exportMatch[1],user.tenant_id);if(!wf)fail('Workflow not found',404);
    const spec=parse(wf.spec);
    // Credential references are workspace-local; they must not travel with an exported workflow.
    for(const step of spec.steps||[])delete step.connection_id;
    send(res,200,{format:'growthveyra-workflow',schema_version:1,name:wf.name,
     spec,trigger:parse(wf.trigger),enabled:false,allow_external:false});return;
   }
   const revisionMatch=path.match(/^\/api\/workflows\/([0-9a-f-]{36})\/revisions(?:\/(\d+)(?:\/(restore))?)?$/);
   if(revisionMatch){
    const wf=resolveWorkflow(db,revisionMatch[1],user.tenant_id);
    if(!wf)fail('Workflow not found',404);
    const revision=revisionMatch[2]===undefined?null:Number(revisionMatch[2]);
    if(revision!==null&&(!Number.isSafeInteger(revision)||revision<1))fail('Invalid revision',400);
    if(req.method==='GET'&&revision===null){send(res,200,revisionList(db,user.tenant_id,wf.id));return;}
    if(req.method==='GET'&&revision!==null&&!revisionMatch[3]){
     const version=getRevision(db,user.tenant_id,wf.id,revision);
     if(!version)fail('Revision not found',404);send(res,200,version);return;
    }
    if(req.method==='POST'&&revision!==null&&revisionMatch[3]==='restore'){
     const payload=await bodyJson(req);
     if(payload.expected_revision!==undefined&&(!Number.isSafeInteger(payload.expected_revision)||payload.expected_revision<1))
      fail('Invalid expected revision',400);
     let restored;
     db.exec('BEGIN IMMEDIATE');
     try{
      const latest=resolveWorkflow(db,wf.id,user.tenant_id);
      if(payload.expected_revision!==undefined&&latest.revision!==payload.expected_revision)
       fail('Automation changed in another tab. Reload before restoring.',409);
      if(first(db,"SELECT id FROM runs WHERE workflow_id=? AND status IN ('queued','running','awaiting_approval','awaiting_child') LIMIT 1",wf.id))fail('Cannot restore a workflow while executions are active',409);
      const next=restoreRevision(db,wf,revision);
      if(next===null)fail('Revision not found',404);
      audit(db,user.tenant_id,user.id,'workflow.restored',wf.id,{from_revision:revision,to_revision:next});
      restored=sanitizeWorkflow(resolveWorkflow(db,wf.id,user.tenant_id));
      db.exec('COMMIT');
     }catch(error){db.exec('ROLLBACK');throw error;}
     send(res,200,{...restored,revision:revisionList(db,user.tenant_id,wf.id)[0]?.revision});return;
    }
    fail('Not found',404);
   }
   const previewMatch=path.match(/^\/api\/workflows\/([0-9a-f-]{36})\/preview$/);
   if(req.method==='POST'&&previewMatch){
    const wf=resolveWorkflow(db,previewMatch[1],user.tenant_id);
    if(!wf)fail('Workflow not found',404);
    const payload=await bodyJson(req);const input=validateInput(payload.input);
    let report;try{report=previewWorkflow(db,user.tenant_id,{id:wf.id,spec:payload.spec===undefined?parse(wf.spec):payload.spec},input);}
    catch(error){fail(error.message);}
    send(res,200,report);return;
   }
   const workflowMatch=path.match(/^\/api\/workflows\/([0-9a-f-]{36})(?:\/(run))?$/);
   if(workflowMatch){
    const wf=resolveWorkflow(db,workflowMatch[1],user.tenant_id);if(!wf)fail('Workflow not found',404);
    if(req.method==='GET'&&!workflowMatch[2]){send(res,200,sanitizeWorkflow(wf));return;}
    if(req.method==='POST'&&workflowMatch[2]==='run'){if(!wf.enabled)fail('Workflow is disabled',409);
     if(enforceBilling(env)&&wf.allow_external){
      const r=first(db,'SELECT plan,status FROM billing_accounts WHERE tenant_id=?',user.tenant_id);
      if(!subscriptionEntitlements(r,env).external_actions)fail('Subscription required for external actions',402);
     }
     const input=validateInput((await bodyJson(req)).input);const job=enqueue(db,wf,input);
     audit(db,user.tenant_id,user.id,'workflow.started',wf.id,{run_id:job.id});send(res,202,{id:job.id,status:job.status});return;
    }
    if(req.method==='PATCH'&&!workflowMatch[2]){const payload=await bodyJson(req);
     if(enforceBilling(env)&&payload.allow_external===true){
      const r=first(db,'SELECT plan,status FROM billing_accounts WHERE tenant_id=?',user.tenant_id);
      if(!subscriptionEntitlements(r,env).external_actions)fail('Subscription required for external actions',402);
     }
     if(payload.expected_revision!==undefined&&(!Number.isSafeInteger(payload.expected_revision)||payload.expected_revision<1))
      fail('Invalid expected revision',400);
     if(payload.name!==undefined&&(typeof payload.name!=='string'||payload.name.trim().length<2||payload.name.length>110))fail('Invalid workflow name');
     if(payload.spec!==undefined&&first(db,"SELECT id FROM runs WHERE workflow_id=? AND status IN ('queued','running','awaiting_approval','awaiting_child') LIMIT 1",wf.id))fail('Cannot change a workflow graph while its executions are active',409);
     let nextSpec=parse(wf.spec);if(payload.spec!==undefined){if(JSON.stringify(payload.spec).length>50000)fail('Workflow definition too large');try{nextSpec=validateWorkflow(payload.spec);}catch(e){fail(e.message);}}
     db.exec('BEGIN IMMEDIATE');
     try{
      const latest=resolveWorkflow(db,wf.id,user.tenant_id);
      if(payload.expected_revision!==undefined&&latest.revision!==payload.expected_revision)
       fail('Automation changed in another tab. Reload before saving.',409);
      run(db,'UPDATE workflows SET name=?,spec=?,enabled=?,allow_external=?,updated_at=? WHERE id=?',payload.name===undefined?wf.name:payload.name.trim(),json(nextSpec),payload.enabled===undefined?wf.enabled:Number(!!payload.enabled),payload.allow_external===undefined?wf.allow_external:Number(payload.allow_external===true),now(),wf.id);
      recordRevision(db,resolveWorkflow(db,wf.id,user.tenant_id));
      audit(db,user.tenant_id,user.id,'workflow.updated',wf.id);
      db.exec('COMMIT');
     }catch(error){db.exec('ROLLBACK');throw error;}
     send(res,200,sanitizeWorkflow(resolveWorkflow(db,wf.id,user.tenant_id)));return;
    }
    if(req.method==='DELETE'&&!workflowMatch[2]){if(first(db,'SELECT id FROM runs WHERE workflow_id=? LIMIT 1',wf.id))fail('Workflow has execution history; disable it instead',409);
     run(db,'DELETE FROM workflows WHERE id=?',wf.id);audit(db,user.tenant_id,user.id,'workflow.deleted',wf.id);send(res,200,{success:true});return;
    }
   }
   if(req.method==='GET'&&path==='/api/runs'){
    send(res,200,all(db,'SELECT id,workflow_id,status,attempts,error,created_at,updated_at FROM runs WHERE tenant_id=? ORDER BY created_at DESC LIMIT 100',user.tenant_id));return;
   }
   const runMatch=path.match(/^\/api\/runs\/([0-9a-f-]{36})(?:\/(cancel|retry))?$/);
   if(runMatch){
    const r=first(db,'SELECT * FROM runs WHERE id=? AND tenant_id=?',runMatch[1],user.tenant_id);if(!r)fail('Run not found',404);
    if(req.method==='GET'&&!runMatch[2]){
     const logs=all(db,'SELECT step_id,event,detail,created_at FROM logs WHERE run_id=? ORDER BY created_at',r.id).map(x=>({...x,detail:parse(x.detail)}));
     const children=all(db,'SELECT c.id,c.workflow_id,c.status,c.created_at FROM child_runs edge JOIN runs c ON c.id=edge.child_run_id WHERE edge.parent_run_id=? ORDER BY edge.created_at',r.id);
     send(res,200,{...r,input:parse(r.input),state:parse(r.state),logs,children});return;
    }
    if(req.method==='POST'&&runMatch[2]==='retry'){
     await bodyJson(req);
     if(r.status!=='failed')fail('Only failed runs can be retried',409);
     if(r.manual_retries>=3)fail('Maximum manual retries reached',409);
     const workflow=resolveWorkflow(db,r.workflow_id,user.tenant_id);
     if(!workflow||!workflow.enabled)fail('Enable the automation before retrying',409);
     const stamp=now();
     db.exec('BEGIN IMMEDIATE');
     try{
      const outcome=run(db,"UPDATE runs SET status='queued',attempts=0,manual_retries=manual_retries+1,available_at=?,leased_at=NULL,error='',updated_at=? WHERE id=? AND tenant_id=? AND status='failed' AND manual_retries<3",
        stamp,stamp,r.id,user.tenant_id);
      if(!outcome.changes)fail('Run is no longer eligible for retry',409);
      logEvent(db,r,r.cursor,'run_manual_retry',{manual_retries:r.manual_retries+1});
      audit(db,user.tenant_id,user.id,'run.retried',r.id,{manual_retries:r.manual_retries+1});
      db.exec('COMMIT');
     }catch(error){db.exec('ROLLBACK');throw error;}
     send(res,202,{id:r.id,status:'queued',manual_retries:r.manual_retries+1});return;
    }
    if(req.method==='POST'&&runMatch[2]==='cancel'){
     if(['completed','cancelled','failed','rejected'].includes(r.status))fail('Run is already finished',409);
     const stamp=now();let descendants=0;
     db.exec('BEGIN IMMEDIATE');
     try{
      const cancelled=run(db,"UPDATE runs SET status='cancelled',updated_at=?,leased_at=NULL WHERE id=? AND tenant_id=? AND status IN ('queued','running','awaiting_approval','awaiting_child')",stamp,r.id,user.tenant_id);
      if(!cancelled.changes)fail('Run already finished',409);
      run(db,"UPDATE approvals SET status='rejected',actor=?,resolved_at=? WHERE run_id=? AND status='pending'",user.id,stamp,r.id);
      descendants=cancelDescendants(db,r.id,stamp);
      audit(db,user.tenant_id,user.id,'run.cancelled',r.id,{descendants});
      db.exec('COMMIT');
     }catch(error){db.exec('ROLLBACK');throw error;}
     send(res,200,{id:r.id,status:'cancelled',descendants});return;
    }
   }
   if(req.method==='GET'&&path==='/api/approvals'){
    send(res,200,all(db,"SELECT * FROM approvals WHERE tenant_id=? AND status='pending' ORDER BY created_at DESC",user.tenant_id));return;
   }
   const approveMatch=path.match(/^\/api\/approvals\/([0-9a-f-]{36})\/(approve|reject)$/);
   if(req.method==='POST'&&approveMatch){await bodyJson(req);const a=first(db,'SELECT * FROM approvals WHERE id=? AND tenant_id=?',approveMatch[1],user.tenant_id);
    if(!a)fail('Approval not found',404);if(a.status!=='pending')fail('Approval already resolved',409);
    const status=approveMatch[2]==='approve'?'approved':'rejected';
    db.exec('BEGIN IMMEDIATE');try{
      run(db,'UPDATE approvals SET status=?,actor=?,resolved_at=? WHERE id=? AND status=\'pending\'',status,user.id,now(),a.id);
      run(db,'UPDATE runs SET status=?,available_at=?,updated_at=? WHERE id=? AND status=\'awaiting_approval\'',status==='approved'?'queued':'rejected',now(),now(),a.run_id);
      db.exec('COMMIT');
    }catch(e){db.exec('ROLLBACK');throw e;}
    audit(db,user.tenant_id,user.id,'approval.'+status,a.run_id,{step_id:a.step_id});send(res,200,{status});return;
   }
   if(req.method==='GET'&&path==='/api/knowledge'){
    send(res,200,all(db,'SELECT id,name,substr(content,1,220) AS excerpt,created_at FROM knowledge WHERE tenant_id=? ORDER BY created_at DESC LIMIT 100',user.tenant_id));return;
   }
   if(req.method==='POST'&&path==='/api/knowledge'){const payload=await bodyJson(req);
    if(typeof payload.name!=='string'||payload.name.length<2||payload.name.length>120||typeof payload.content!=='string'||payload.content.length<10||payload.content.length>50000)fail('Provide a source name (2-120 chars) and text (10-50,000 chars)');
    const knowledgeId=id();run(db,'INSERT INTO knowledge VALUES (?,?,?,?,?)',knowledgeId,user.tenant_id,payload.name,payload.content,now());
    audit(db,user.tenant_id,user.id,'knowledge.added',knowledgeId);send(res,201,{id:knowledgeId,name:payload.name});return;
   }
   const knowledgeMatch=path.match(/^\/api\/knowledge\/([0-9a-f-]{36})$/);
   if(req.method==='DELETE'&&knowledgeMatch){const deleted=run(db,'DELETE FROM knowledge WHERE id=? AND tenant_id=?',knowledgeMatch[1],user.tenant_id);
    if(!deleted.changes)fail('Knowledge item not found',404);
    audit(db,user.tenant_id,user.id,'knowledge.deleted',knowledgeMatch[1]);send(res,200,{success:true});return;
   }
   if(req.method==='GET'&&path==='/api/audit'){send(res,200,all(db,'SELECT actor,action,target,details,created_at FROM audit WHERE tenant_id=? ORDER BY created_at DESC LIMIT 100',user.tenant_id).map(x=>({...x,details:parse(x.details)})));return;
   }
   fail('Not found',404);
  }catch(error){
   const status=error instanceof HttpError?error.status:500;
   if(status===500)console.error('Request error',error);
   if(!res.headersSent)send(res,status,{error:status===500?'Internal server error':error.message});else res.destroy();
  }
 });
 if(autoStart){timer=setInterval(()=>tick().catch(e=>console.error('Scheduler error',e)),1000);timer.unref();}
 return {server,db,tick,stop:()=>{stopped=true;if(timer)clearInterval(timer);}};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const app=createApp();const port=Number(process.env.PORT)||3000;
 app.server.listen(port,'0.0.0.0',()=>console.log(`GrowthVeyra AI running on port ${port}`));
 for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{app.stop();app.server.close(()=>{app.db.close();process.exit(0)});});
}
