import {readFile} from 'node:fs/promises';
import {validateWorkspace,authorized,createLimiter,publicRouteNeedsAdmin} from './security.mjs';
import {scoreLead,recommend} from './analytics.mjs';
import {verifyShopify,validateShopDomain,shopifyOrder} from './shopify.mjs';
import {createSupport,createSupportResponder} from './support.mjs';
import {parseSupportCsv} from './support-csv.mjs';

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
function supportFrameOrigins(value){
 if(!value)return {};
 const parsed=JSON.parse(value);
 if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw Error('Invalid SUPPORT_EMBED_ORIGINS_JSON');
 const result=Object.create(null);
 for(const [workspace,origins] of Object.entries(parsed)){
  validateWorkspace(workspace);
  if(!Array.isArray(origins)||origins.length>20)throw Error('Invalid support embed origins');
  result[workspace]=origins.map(origin=>{
   if(typeof origin!=='string'||origin.length>250)throw Error('Invalid support embed origin');
   const parsedOrigin=new URL(origin);
   if(parsedOrigin.origin!==origin||(parsedOrigin.protocol!=='https:'&&!(parsedOrigin.protocol==='http:'&&['localhost','127.0.0.1'].includes(parsedOrigin.hostname))))throw Error('Support embed origins must be exact HTTPS origins');
   return origin;
  });
 }
 return result;
}
function configureShopify(options){
 const {secret,shops={},allowOrders=false}=options||{};
 const safe=Object.create(null),used=new Set();for(const [domain,workspace]of Object.entries(shops)){validateShopDomain(domain);validateWorkspace(workspace);if(used.has(workspace))throw Error('Each Shopify shop must have its own workspace');used.add(workspace);safe[domain]=workspace;}
 return {secret,shops:safe,allowOrders};
}
export function createHandler({ledger,tenants,adviser,shopify,unified,support=null,embedOrigins=process.env.SUPPORT_EMBED_ORIGINS_JSON||'',publicDashboard=false,publicWorkspace='default'}={}){
 if(!ledger||!tenants||!adviser)throw Error('Missing server dependencies');
 if(publicDashboard&&(!Object.hasOwn(tenants,publicWorkspace)||validateWorkspace(publicWorkspace)!==publicWorkspace))throw Error('Public workspace is not configured');
 let shop=configureShopify(shopify);
 const supportService=support||(ledger.db?createSupport(ledger.db,{responder:createSupportResponder(unified?.env||process.env),onEvent:unified?.emit}):null);
 let supportFrames=supportFrameOrigins(embedOrigins);
 const supportRequests=createLimiter({max:12,windowMs:60000,maxKeys:3000});
 const staffLogins=createLimiter({max:6,windowMs:60000,maxKeys:3000});
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
   if(unified?.env?.SUPPORT_EMBED_ORIGINS_JSON)supportFrames=supportFrameOrigins(unified.env.SUPPORT_EMBED_ORIGINS_JSON);
   if(req.method==='GET'&&['/support','/support-admin','/support.js','/support-admin.js','/support.css'].includes(url.pathname)){
    if(url.pathname==='/support'){
     const workspace=requiredWorkspace(url);
     if(!Object.hasOwn(tenants,workspace)||(publicDashboard&&workspace!==publicWorkspace))return response(res,404,{error:'Not found'});
    }
    const filenames={'/support':'support.html','/support-admin':'support-admin.html','/support.js':'support.js','/support-admin.js':'support-admin.js','/support.css':'support.css'};
    const path=filenames[url.pathname];
    const asset=await readFile(new URL('../public/'+path,import.meta.url));
    const isHtml=path.endsWith('.html');
    const headers={...securityHeaders,'content-type':isHtml?'text/html; charset=utf-8':path.endsWith('.css')?'text/css; charset=utf-8':'text/javascript; charset=utf-8'};
    if(isHtml){
     let frames="'none'";
     if(url.pathname==='/support'){
      const origins=supportFrames[requiredWorkspace(url)]||[];
      if(origins.length){frames="'self' "+origins.join(' ');delete headers['x-frame-options'];}
     }
     headers['content-security-policy']="default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors "+frames+"; form-action 'self'; object-src 'none'";
    }
    res.writeHead(200,headers);res.end(asset);return;
   }
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
    if(unified?.env)shop=configureShopify({secret:unified.env.SHOPIFY_SECRET,shops:JSON.parse(unified.env.SHOPIFY_SHOPS_JSON||'{}'),allowOrders:unified.env.SHOPIFY_ANALYTICS_BASIS_ACKNOWLEDGED==='true'});
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
     ledger.eraseWorkspace(workspace,{shopDomain:domain});supportService?.eraseWorkspace(workspace);unified?.recovery.eraseWorkspace(workspace);unified?.erase(workspace);return response(res,200,{received:true});
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
   const isSupport=url.pathname.startsWith('/api/support/');
   const supportPublicGet=new Set(['/api/support/config','/api/support/calendar/slots']);
   const supportPublicPost=new Set(['/api/support/chat','/api/support/thread','/api/support/rating','/api/support/appointments','/api/support/handoff','/api/support/team/login','/api/support/calendar/book','/api/support/calendar/cancel','/api/support/calendar/my','/api/support/files','/api/support/files/read','/api/support/files/list','/api/support/privacy/self/export','/api/support/privacy/self/erase']);
   const publicSupport=isSupport&&((req.method==='GET'&&supportPublicGet.has(url.pathname))||(req.method==='POST'&&supportPublicPost.has(url.pathname)));
   const owner=publicDashboard&&w===publicWorkspace||bearerFor(req,tenants,w,'adminToken');
   if(isSupport){
    if(!supportService)return response(res,503,{error:'Support unavailable'});
    if(!publicSupport&&!owner){
     const principal=supportService.roleOf(w,req.headers.authorization);
     if(!principal)return response(res,401,{error:'Unauthorized'});
     const ownerOnly=(url.pathname==='/api/support/team'||url.pathname.startsWith('/api/support/team/')&&!['/api/support/team/logout','/api/support/team/me'].includes(url.pathname))||url.pathname.startsWith('/api/support/privacy/')||url.pathname==='/api/support/audit';
     const managerOnly=ownerOnly||(
      req.method!=='GET'&&(
       url.pathname==='/api/support/settings'||url.pathname==='/api/support/articles'||url.pathname.startsWith('/api/support/articles/')||
       url.pathname==='/api/support/sla'||url.pathname==='/api/support/routing/rules'||url.pathname.startsWith('/api/support/routing/rules/')||url.pathname==='/api/support/macros'||url.pathname.startsWith('/api/support/macros/')||
       url.pathname==='/api/support/calendar/slots'||url.pathname.startsWith('/api/support/calendar/slots/')
      )
     );
     if(ownerOnly||managerOnly&&principal.role!=='manager')return response(res,403,{error:'Insufficient support permissions'});
    }
   }else if((!publicDashboard||publicRouteNeedsAdmin(req.method,url.pathname))&&!bearerFor(req,tenants,w,isIngest?'ingestToken':'adminToken'))return response(res,401,{error:'Unauthorized'});
   if(isSupport){
    if(publicSupport&&req.method==='POST'&&!supportRequests(peer+':'+w))return response(res,429,{error:'Support request limit reached'});
    if(url.pathname==='/api/support/team/login'&&req.method==='POST'&&!staffLogins(peer+':'+w))return response(res,429,{error:'Too many staff sign-in attempts'});
    const isFileWrite=req.method==='POST'&&(url.pathname==='/api/support/files'||/^\/api\/support\/tickets\/[0-9a-f-]{36}\/files$/i.test(url.pathname));
    const payload=['POST','PATCH','PUT'].includes(req.method)?await parseJSON(req,['/api/support/articles/import','/api/support/articles/import-csv'].includes(url.pathname)?530000:isFileWrite?1500000:10000):null;
    if(req.method==='POST'&&url.pathname==='/api/support/team/login')return response(res,200,supportService.login(w,payload));
    if(req.method==='POST'&&url.pathname==='/api/support/team/logout')return response(res,200,supportService.logout(w,req.headers.authorization));
    if(req.method==='GET'&&url.pathname==='/api/support/team/me'){
     if(owner)return response(res,200,{role:'owner',name:'Workspace owner'});
     const principal=supportService.roleOf(w,req.headers.authorization);
     return response(res,200,{role:principal.role,name:principal.name});
    }
    if(req.method==='GET'&&url.pathname==='/api/support/team')return response(res,200,{members:supportService.team(w)});
    if(req.method==='POST'&&url.pathname==='/api/support/team')return response(res,201,{member:supportService.createStaff(w,payload)});
    const member=url.pathname.match(/^\/api\/support\/team\/([0-9a-f-]{36})$/i);
    if(member&&req.method==='PATCH')return response(res,200,{member:supportService.editStaff(w,member[1],payload)});
    if(req.method==='GET'&&url.pathname==='/api/support/calendar/slots')return response(res,200,{slots:supportService.slots(w,{includeDisabled:owner||!!supportService.roleOf(w,req.headers.authorization)})});
    if(req.method==='POST'&&url.pathname==='/api/support/calendar/slots')return response(res,201,{slot:supportService.createSlot(w,payload)});
    const slot=url.pathname.match(/^\/api\/support\/calendar\/slots\/([0-9a-f-]{36})$/i);
    if(slot&&req.method==='PATCH')return response(res,200,{slot:supportService.updateSlot(w,slot[1],payload)});
    if(req.method==='POST'&&url.pathname==='/api/support/calendar/book')return response(res,201,{booking:supportService.book(w,payload)});
    if(req.method==='POST'&&url.pathname==='/api/support/calendar/cancel')return response(res,200,supportService.cancelBooking(w,payload));
    if(req.method==='POST'&&url.pathname==='/api/support/calendar/my'){
     supportService.selfExport(w,payload);
     return response(res,200,{bookings:supportService.bookings(w,{ticketId:payload.ticketId})});
    }
    if(req.method==='GET'&&url.pathname==='/api/support/calendar/bookings')return response(res,200,{bookings:supportService.bookings(w)});
    if(req.method==='GET'&&url.pathname==='/api/support/config')return response(res,200,supportService.settings(w));
    if(req.method==='GET'&&url.pathname==='/api/support/settings')return response(res,200,supportService.settings(w));
    if(req.method==='PATCH'&&url.pathname==='/api/support/settings')return response(res,200,supportService.updateSettings(w,payload));
    if(req.method==='POST'&&url.pathname==='/api/support/chat'){
     const created=!payload.ticketId;
     return response(res,created?201:200,await supportService.receive(w,payload));
    }
    if(req.method==='POST'&&url.pathname==='/api/support/handoff')return response(res,200,supportService.requestHandoff(w,payload));
    if(req.method==='POST'&&url.pathname==='/api/support/thread')return response(res,200,supportService.thread(w,payload));
    if(req.method==='POST'&&url.pathname==='/api/support/rating')return response(res,200,supportService.rate(w,payload));
    if(req.method==='GET'&&url.pathname==='/api/support/routing/rules')return response(res,200,{rules:supportService.routingRules(w)});
    if(req.method==='POST'&&url.pathname==='/api/support/routing/rules')return response(res,201,{rule:supportService.createRoutingRule(w,payload)});
    const routing=url.pathname.match(/^\/api\/support\/routing\/rules\/([0-9a-f-]{36})$/i);
    if(routing&&req.method==='DELETE')return response(res,200,supportService.deleteRoutingRule(w,routing[1]));
    if(req.method==='GET'&&url.pathname==='/api/support/sla')return response(res,200,supportService.sla(w));
    if(req.method==='PATCH'&&url.pathname==='/api/support/sla')return response(res,200,supportService.updateSla(w,payload));
    if(req.method==='GET'&&url.pathname==='/api/support/alerts')return response(res,200,supportService.alerts(w));
    if(req.method==='GET'&&url.pathname==='/api/support/notifications')return response(res,200,{notifications:supportService.listNotifications(w)});
    const notification=url.pathname.match(/^\/api\/support\/notifications\/([0-9a-f-]{36})\/read$/i);
    if(notification&&req.method==='POST')return response(res,200,supportService.markNotification(w,notification[1]));
    if(req.method==='GET'&&url.pathname==='/api/support/macros')return response(res,200,{macros:supportService.macros(w)});
    if(req.method==='POST'&&url.pathname==='/api/support/macros')return response(res,201,{macro:supportService.createMacro(w,payload)});
    const macro=url.pathname.match(/^\/api\/support\/macros\/([0-9a-f-]{36})$/i);
    if(macro&&req.method==='PATCH')return response(res,200,{macro:supportService.updateMacro(w,macro[1],payload)});
    if(macro&&req.method==='DELETE')return response(res,200,{deleted:supportService.deleteMacro(w,macro[1])});
    if(req.method==='POST'&&url.pathname==='/api/support/articles/import')return response(res,201,supportService.bulkArticles(w,payload));
    if(req.method==='POST'&&url.pathname==='/api/support/articles/import-csv')return response(res,201,supportService.bulkArticles(w,{articles:parseSupportCsv(payload?.csv)}));
    if(req.method==='GET'&&url.pathname==='/api/support/articles/search')return response(res,200,{articles:supportService.articleSearch(w,{q:url.searchParams.get('q')||'',category:url.searchParams.get('category')||'',locale:url.searchParams.get('locale')||'',active:url.searchParams.get('active')||undefined})});
    if(req.method==='GET'&&url.pathname==='/api/support/articles')return response(res,200,{articles:supportService.listArticles(w)});
    if(req.method==='POST'&&url.pathname==='/api/support/articles')return response(res,201,{article:supportService.addArticle(w,payload)});
    const article=url.pathname.match(/^\/api\/support\/articles\/([0-9a-f-]{36})$/i);
    if(article&&req.method==='PATCH')return response(res,200,{article:supportService.editArticle(w,article[1],payload)});
    if(article&&req.method==='DELETE')return response(res,200,{deleted:supportService.removeArticle(w,article[1])});
    if(req.method==='GET'&&url.pathname==='/api/support/customers')return response(res,200,{customers:supportService.customers(w)});
    if(req.method==='POST'&&url.pathname==='/api/support/customers/lookup')return response(res,200,{profile:supportService.customerLookup(w,payload?.email)});
    if(req.method==='GET'&&url.pathname==='/api/support/leads')return response(res,200,{leads:supportService.leads(w,{status:url.searchParams.get('status')||undefined})});
    const lead=url.pathname.match(/^\/api\/support\/leads\/([0-9a-f-]{36})$/i);
    if(lead&&req.method==='PATCH')return response(res,200,{lead:supportService.updateLead(w,lead[1],payload)});
    if(req.method==='GET'&&url.pathname==='/api/support/appointments')return response(res,200,{appointments:supportService.appointments(w,{status:url.searchParams.get('status')||undefined})});
    if(req.method==='POST'&&url.pathname==='/api/support/appointments')return response(res,201,{appointment:supportService.requestAppointment(w,payload)});
    const appt=url.pathname.match(/^\/api\/support\/appointments\/([0-9a-f-]{36})$/i);
    if(appt&&req.method==='PATCH')return response(res,200,{appointment:supportService.updateAppointment(w,appt[1],payload)});
    if(req.method==='GET'&&url.pathname==='/api/support/metrics')return response(res,200,supportService.metrics(w));
    if(req.method==='POST'&&url.pathname==='/api/support/files')return response(res,201,{file:supportService.uploadAttachment(w,payload)});
    if(req.method==='POST'&&url.pathname==='/api/support/files/read')return response(res,200,{file:supportService.readAttachment(w,payload?.fileId,{ticketId:payload?.ticketId,sessionToken:payload?.sessionToken})});
    if(req.method==='POST'&&url.pathname==='/api/support/files/list')return response(res,200,{files:supportService.sessionAttachments(w,payload)});
    const files=url.pathname.match(/^\/api\/support\/tickets\/([0-9a-f-]{36})\/files$/i);
    if(files&&req.method==='GET')return response(res,200,{files:supportService.attachments(w,files[1])});
    if(files&&req.method==='POST')return response(res,201,{file:supportService.uploadAttachment(w,{...payload,ticketId:files[1]},{staff:true})});
    const fileRead=url.pathname.match(/^\/api\/support\/tickets\/([0-9a-f-]{36})\/files\/([0-9a-f-]{36})$/i);
    if(fileRead&&req.method==='GET')return response(res,200,{file:supportService.readAttachment(w,fileRead[2],{ticketId:fileRead[1],staff:true})});
    if(req.method==='GET'&&url.pathname==='/api/support/reports')return response(res,200,supportService.reports(w,Number(url.searchParams.get('days')||7)));
    if(req.method==='GET'&&url.pathname==='/api/support/audit')return response(res,200,{events:supportService.auditEvents(w)});
    if(req.method==='GET'&&url.pathname==='/api/support/tickets/search')return response(res,200,{tickets:supportService.ticketSearch(w,{
     q:url.searchParams.get('q')||'',status:url.searchParams.get('status')||'',priority:url.searchParams.get('priority')||'',assignedTo:url.searchParams.get('assignedTo')||''
    })});
    if(req.method==='GET'&&url.pathname==='/api/support/tickets')return response(res,200,{tickets:supportService.tickets(w,{status:url.searchParams.get('status')||undefined})});
    const notes=url.pathname.match(/^\/api\/support\/tickets\/([0-9a-f-]{36})\/notes$/i);
    if(notes&&req.method==='GET')return response(res,200,{notes:supportService.notes(w,notes[1])});
    if(notes&&req.method==='POST')return response(res,201,{note:supportService.addNote(w,notes[1],payload,owner?'owner':'staff')});
    const reply=url.pathname.match(/^\/api\/support\/tickets\/([0-9a-f-]{36})\/replies$/i);
    if(reply&&req.method==='POST')return response(res,201,supportService.staffReply(w,reply[1],payload));
    const ticket=url.pathname.match(/^\/api\/support\/tickets\/([0-9a-f-]{36})$/i);
    if(ticket&&req.method==='GET')return response(res,200,supportService.ticketDetail(w,ticket[1]));
    if(ticket&&req.method==='PATCH')return response(res,200,{ticket:supportService.updateTicket(w,ticket[1],payload)});
    if(req.method==='POST'&&url.pathname==='/api/support/privacy/self/export')return response(res,200,supportService.selfExport(w,payload));
    if(req.method==='POST'&&url.pathname==='/api/support/privacy/self/erase')return response(res,200,supportService.selfErase(w,payload));
    if(req.method==='POST'&&url.pathname==='/api/support/privacy/export')return response(res,200,supportService.exportEmail(w,payload?.email));
    if(req.method==='POST'&&url.pathname==='/api/support/privacy/erase')return response(res,200,{deleted:supportService.eraseEmail(w,payload?.email)});
    return response(res,404,{error:'Not found'});
   }
   if(unified&&req.method==='GET'&&url.pathname==='/api/advanced/summary'){
    const entries=[
     ['workflows','growth/workflows'],
     ['plans','growth/billing/plans'],
     ['billing','growth/billing'],
     ['audit','growth/audit'],
     ['history','neon/history'],
     ['maintenance','growth/maintenance'],
     ['connections','integrations/status']
    ];
    const results=await Promise.all(entries.map(async([name,route])=>{
     try{
      const result=await unified.handle(w,route,'GET',null);
      return [name,result.status>=200&&result.status<300?result.data:null];
     }catch{return [name,null];}
    }));
    const data=Object.fromEntries(results);
    data.privacy={requests:ledger.pendingPrivacyRequests(w)};
    return response(res,200,data);
   }
   if(unified&&(url.pathname.startsWith('/api/growth/')||url.pathname.startsWith('/api/recovery/')||url.pathname.startsWith('/api/orchestration/')||url.pathname.startsWith('/api/neon/')||url.pathname.startsWith('/api/integrations/'))){
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
    const advice=await (unified?.adviser||adviser)({metrics,objective:input.objective});return response(res,200,{advice,metrics});
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
