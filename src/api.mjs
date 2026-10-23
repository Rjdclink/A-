import {readFile} from 'node:fs/promises';
import {validateWorkspace,authorized,createLimiter} from './security.mjs';
import {scoreLead,recommend} from './analytics.mjs';
import {verifyShopify,validateShopDomain,shopifyOrder} from './shopify.mjs';

const securityHeaders={
 'cache-control':'no-store',
 'x-content-type-options':'nosniff',
 'referrer-policy':'no-referrer',
 'x-frame-options':'DENY',
 'permissions-policy':'camera=(), microphone=(), geolocation=()',
 'cross-origin-resource-policy':'same-origin'
};
function response(res,status,body){res.writeHead(status,{...securityHeaders,'content-type':'application/json; charset=utf-8'});res.end(JSON.stringify(body));}
async function bytes(req,max){let total=0;const chunks=[];for await(const chunk of req){total+=chunk.byteLength;if(total>max){const err=Error('Request body too large');err.status=413;throw err;}chunks.push(chunk);}return Buffer.concat(chunks);}
async function parseJSON(req,max=16384){if(!/application\/json(?:\s*;|\s*$)/i.test(req.headers['content-type']||'')){const err=Error('JSON Content-Type required');err.status=415;throw err;}const raw=await bytes(req,max);try{return JSON.parse(raw.toString('utf8'));}catch{const err=Error('Invalid JSON');err.status=400;throw err;}}
function requiredWorkspace(url){const workspace=url.searchParams.get('workspace')||'default';validateWorkspace(workspace);return workspace;}
function bearerFor(req,tenants,workspace,role){return Object.hasOwn(tenants,workspace)&&authorized(req.headers.authorization,tenants[workspace][role]);}
function safeStatus(e){if(Number.isInteger(e?.status)&&e.status>=400&&e.status<600)return e.status;return /Invalid|Unsupported|consent|required|precision/i.test(e.message)?400:500;}
function fail(status,message){const e=Error(message);e.status=status;throw e;}
function configureShopify(options){
 const {secret,shops={},allowOrders=false}=options||{};
 const safe=Object.create(null),used=new Set();for(const [domain,workspace]of Object.entries(shops)){validateShopDomain(domain);validateWorkspace(workspace);if(used.has(workspace))throw Error('Each Shopify shop must have its own workspace');used.add(workspace);safe[domain]=workspace;}
 return {secret,shops:safe,allowOrders};
}
export function createHandler({ledger,tenants,adviser,shopify,unified,publicDashboard=false,publicWorkspace='default'}={}){
 if(!ledger||!tenants||!adviser)throw Error('Missing server dependencies');
 if(publicDashboard&&(!Object.hasOwn(tenants,publicWorkspace)||validateWorkspace(publicWorkspace)!==publicWorkspace))throw Error('Public workspace is not configured');
 const shop=configureShopify(shopify);
 const requests=createLimiter({max:150,windowMs:60000,maxKeys:3000});
 const aiRequests=createLimiter({max:8,windowMs:60000,maxKeys:3000});
 return async(req,res)=>{
  try{
   const url=new URL(req.url,'http://localhost');
   const peer=req.socket.remoteAddress||'unknown';
   if(!requests(peer))return response(res,429,{error:'Request limit reached'});
   if((req.method==='GET'||req.method==='HEAD')&&url.pathname==='/health'){
    ledger.db.prepare('SELECT 1').get();return response(res,200,{status:'ok'});
   }
   if(req.method==='GET'&&url.pathname==='/api/dashboard-config')return response(res,200,{public:Boolean(publicDashboard),workspace:publicDashboard?publicWorkspace:null});
   if(req.method==='GET'&&(url.pathname==='/'||url.pathname==='/app.js')){
    const isScript=url.pathname==='/app.js';const file=isScript?'../public/app.js':'../public/index.html';
    let output=await readFile(new URL(file,import.meta.url));
    if(!isScript&&publicDashboard){
     let html=output.toString('utf8');
     html=html.replace(/<button class="pill" id="toggleWorkspace"[^>]*>[\s\S]*?<\/button>/,'');
     html=html.replace(/<section class="panel hidden" id="workspacePanel"[^>]*>[\s\S]*?<\/section>/,'');
     html=html.replace(/<button class="secondary" data-action="openWorkspace"[^>]*>[\s\S]*?<\/button>/,'');
     html=html.replace('Connect workspace</span>','Loading live data</span>');
     html=html.replace('Connect your workspace for your most important next growth opportunity.','Live business insights appear here when data is available.');
     html=html.replace('<h2>Connection</h2><p class="muted">A+ administrator tokens are never stored in local storage or session storage.</p>',
       '<h2>Dashboard access</h2><p class="muted">Open this website to use the live dashboard directly.</p>');
     output=Buffer.from(html);
    }
    const headers={...securityHeaders,'content-type':isScript?'text/javascript; charset=utf-8':'text/html; charset=utf-8'};
    if(!isScript)headers['content-security-policy']="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'; object-src 'none'";
    res.writeHead(200,headers);res.end(output);return;
   }

   if(req.method==='GET'&&url.pathname.startsWith('/studio/')){
    const filename=url.pathname.slice('/studio/'.length);
    const allowed={'dashboard.css':'text/css','designer.css':'text/css','designer.js':'text/javascript','commerce.css':'text/css','commerce.js':'text/javascript'};
    if(filename===''||filename==='index.html'){
     let html=await readFile(new URL('../integrations/automation/public/index.html',import.meta.url),'utf8');
     html=html.replace(/(href|src)="\/(dashboard\.css|designer\.css|designer\.js|commerce\.css|commerce\.js)"/g,'$1="/studio/$2"');
     const bootstrap=String.raw`(function(){
      let creds=null,accept;
      const ready=new Promise(resolve=>{accept=resolve});
      window.addEventListener('message',event=>{
       if(event.source!==window.parent||event.origin!==location.origin||event.data?.type!=='aplus:auth')return;
       if(typeof event.data.token!=='string'||typeof event.data.workspace!=='string')return;
       creds={token:event.data.token,workspace:event.data.workspace};accept();
      });
      const original=window.fetch.bind(window);
      window.fetch=async(input,init={})=>{
       if(typeof input==='string'&&input.startsWith('/api/')){
        await ready;
        const route='/api/growth/'+input.slice(5);
        const target=route+(route.includes('?')?'&':'?')+'workspace='+encodeURIComponent(creds.workspace);
        return original(target,{...init,headers:{...init.headers,authorization:'Bearer '+creds.token}});
       }
       return original(input,init);
      };
     })();`;
     html=html.replace('</head>','<script>'+bootstrap+'</script></head>');
     if(publicDashboard){
      html=html.replace(/GrowthVeyra AI/g,'A+ Automation Studio').replace(/GROWTHVEYRA AI/g,'A+ AUTOMATION STUDIO');
      html=html.replace(/<button class="btn small ghost" data-action="logout">Sign out<\/button>/,'');
      html=html.replace('</head>','<style>#auth{display:none!important}</style></head>');
     }
     res.writeHead(200,{...securityHeaders,'content-type':'text/html; charset=utf-8',
      'content-security-policy':"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'self'; form-action 'none'; object-src 'none'"});
     res.end(html);return;
    }
    if(!Object.hasOwn(allowed,filename))return response(res,404,{error:'Not found'});
    const file=await readFile(new URL('../integrations/automation/public/'+filename,import.meta.url));
    res.writeHead(200,{...securityHeaders,'content-type':allowed[filename]+'; charset=utf-8'});res.end(file);return;
   }
   if(req.method==='POST'&&url.pathname==='/webhooks/shopify'){
    if(!shop.secret||shop.secret.length<24)return response(res,404,{error:'Not configured'});
    const raw=await bytes(req,1024*1024);
    if(!verifyShopify(raw,req.headers['x-shopify-hmac-sha256'],shop.secret))return response(res,401,{error:'Invalid webhook signature'});
    const domain=validateShopDomain(req.headers['x-shopify-shop-domain']);
    const workspace=shop.shops[domain];if(!workspace||!Object.hasOwn(tenants,workspace))return response(res,403,{error:'Unregistered shop'});
    const topic=req.headers['x-shopify-topic'];
    let data;try{data=JSON.parse(raw.toString('utf8'));}catch{fail(400,'Invalid JSON');}
    if(!data||typeof data!=='object'||Array.isArray(data))fail(400,'Invalid Shopify payload');
    if(['shop/redact','customers/redact','customers/data_request'].includes(topic)){
     if(data.shop_domain!==domain||!Number.isSafeInteger(Number(data.shop_id)))fail(400,'Shopify shop identity mismatch');
    }
    if(topic==='app/uninstalled'&&data.myshopify_domain!==domain)fail(400,'Shopify shop identity mismatch');
    if(topic==='customers/redact'&&!Array.isArray(data.orders_to_redact))fail(400,'Invalid customer redaction payload');
    if(topic==='customers/data_request'&&(data.customer?.id==null||data.data_request?.id==null))fail(400,'Invalid customer data request');
    if(topic==='shop/redact'||topic==='app/uninstalled'){
     ledger.eraseWorkspace(workspace,{shopDomain:domain});unified?.recovery.eraseWorkspace(workspace);unified?.erase(workspace);return response(res,200,{received:true});
    }
    if(topic==='customers/redact'){
     if(data.customer?.id!=null)ledger.eraseCustomer(workspace,String(data.customer.id));
     ledger.redactShopifyOrders(workspace,domain,data.orders_to_redact);
     return response(res,200,{received:true});
    }
    if(topic==='customers/data_request'){
     if(data.customer?.id!=null)ledger.privacyRequest(workspace,'request:'+String(data.data_request?.id||req.headers['x-shopify-webhook-id']||Date.now()),String(data.customer.id));
     return response(res,202,{received:true,action:'merchant_follow_up_required'});
    }
    if(topic==='orders/paid'){
     if(!shop.allowOrders||!ledger.shopActive(workspace,domain))return response(res,202,{received:true,imported:false});
     const normalized=shopifyOrder(data);
     const result=ledger.add(workspace,'shopify:'+domain+':'+String(data.id),normalized);
     if(result.status==='created'&&unified)await unified.emit(workspace,'commerce.purchase',{event_id:'shopify:'+domain+':'+String(data.id),commerce:{type:'purchase',revenue:normalized.value,campaign:normalized.campaign||'shopify'}});
     return response(res,result.status==='created'?201:result.status==='suppressed'?202:200,{received:true,duplicate:result.status==='duplicate',suppressed:result.status==='suppressed'});
    }
    return response(res,202,{received:true,ignored:true});
   }
   if(unified&&req.method==='POST'&&(/^\/api\/growth\/hooks\/[0-9a-f-]{36}$/i.test(url.pathname)||url.pathname==='/api/growth/billing/webhook/square')){
    const result=await unified.webhook(req,url.pathname.slice('/api/growth/'.length));
    return response(res,result.status,result.data);
   }
   if(!url.pathname.startsWith('/api/'))return response(res,404,{error:'Not found'});
   const preloaded=req.method==='POST'&&url.pathname==='/api/events'?await parseJSON(req):null;
   if(preloaded&&(typeof preloaded!=='object'||Array.isArray(preloaded)))fail(400,'JSON object required');
   const w=preloaded?validateWorkspace(preloaded.workspace||(publicDashboard?publicWorkspace:undefined)):requiredWorkspace(url);
   if(preloaded&&url.searchParams.has('workspace')&&url.searchParams.get('workspace')!==w)fail(400,'Conflicting workspace identifiers');
   if(publicDashboard&&w!==publicWorkspace)return response(res,403,{error:'Workspace unavailable'});
   if(!Object.hasOwn(tenants,w))return response(res,401,{error:'Unauthorized'});
   const isIngest=req.method==='POST'&&(url.pathname==='/api/events'||/^\/api\/experiments\/[^/]+\/assign$/.test(url.pathname));
   if(!publicDashboard&&!bearerFor(req,tenants,w,isIngest?'ingestToken':'adminToken'))return response(res,401,{error:'Unauthorized'});
   if(unified&&(url.pathname.startsWith('/api/growth/')||url.pathname.startsWith('/api/recovery/')||url.pathname.startsWith('/api/orchestration/')||url.pathname.startsWith('/api/neon/'))){
    const payload=['POST','PATCH','PUT'].includes(req.method)?await parseJSON(req,110000):null;
    const result=await unified.handle(w,url.pathname.slice('/api/'.length),req.method,payload);
    return response(res,result.status,result.data);
   }
   if(req.method==='POST'&&url.pathname==='/api/events'){
    const input=preloaded;
    const result=ledger.add(w,input.id,input);
    if(result.status==='created'&&unified)await unified.emit(w,'commerce.'+input.type,{event_id:input.id,commerce:{type:input.type,campaign:String(input.campaign||''),... (input.type==='purchase'?{revenue:Number(input.value)||0}:{})}});
    return response(res,result.status==='created'?201:result.status==='suppressed'?202:200,{id:input.id,deduplicated:result.status==='duplicate',suppressed:result.status==='suppressed'});
   }
   if(req.method==='GET'&&url.pathname==='/api/overview'){
    const days=Number(url.searchParams.get('days')||30);
    if(![7,30,90].includes(days))fail(400,'Invalid reporting window');
    const metrics=ledger.overview(w,{days});return response(res,200,{metrics,recommendations:recommend(metrics)});
   }
   if(req.method==='POST'&&url.pathname==='/api/campaigns/spend'){const input=await parseJSON(req);return response(res,200,ledger.recordSpend(w,input));}
   if(req.method==='POST'&&url.pathname==='/api/score'){
    const input=await parseJSON(req);return response(res,200,{score:scoreLead(input)});
   }
   if(req.method==='POST'&&url.pathname==='/api/advice'){
    if(!aiRequests(peer+':'+w))return response(res,429,{error:'AI request limit reached'});
    const input=await parseJSON(req);const metrics=ledger.overview(w);
    const advice=await adviser({metrics,objective:input.objective});return response(res,200,{advice,metrics});
   }
   if(req.method==='POST'&&url.pathname==='/api/experiments'){
    const input=await parseJSON(req);return response(res,201,{status:ledger.createExperiment(w,input.id)});
   }
   const match=url.pathname.match(/^\/api\/experiments\/([a-z0-9_:.\/-]+?)(?:\/(assign))?$/i);
   if(match&&req.method==='POST'&&match[2]==='assign'){
    const input=await parseJSON(req);return response(res,200,{variant:ledger.assign(w,match[1],input.subjectId,{consent:input.consent})});
   }
   if(match&&req.method==='GET'&&!match[2])return response(res,200,ledger.experimentReport(w,match[1]));
   if(req.method==='POST'&&url.pathname==='/api/privacy/erase'){
    const input=await parseJSON(req);if(typeof input.subjectId!=='string'||input.subjectId.length>120||!input.subjectId)fail(400,'Invalid subject token');
    return response(res,200,{deleted:ledger.eraseCustomer(w,input.subjectId)});
   }
   if(req.method==='POST'&&url.pathname==='/api/privacy/export'){
    const input=await parseJSON(req);if(typeof input.subjectId!=='string'||input.subjectId.length>120||!input.subjectId)fail(400,'Invalid subject token');
    return response(res,200,{events:ledger.exportCustomer(w,input.subjectId)});
   }
   if(req.method==='GET'&&url.pathname==='/api/privacy/requests')return response(res,200,{requests:ledger.pendingPrivacyRequests(w)});
   if(req.method==='POST'&&url.pathname==='/api/privacy/requests/complete'){const input=await parseJSON(req);if(input.deliveryConfirmed!==true)fail(400,'Merchant delivery confirmation required');return response(res,200,{completed:ledger.completePrivacyRequest(w,input.requestId)});}
   return response(res,404,{error:'Not found'});
  }catch(e){const status=safeStatus(e);response(res,status,{error:status<500?e.message:'Operation failed'});}
 };
}
