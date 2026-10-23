import {lookup} from 'node:dns/promises';
import {isIP} from 'node:net';
import http from 'node:http';
import https from 'node:https';
import {URL} from 'node:url';
import {ProxyAgent} from 'undici';
import robotsParser from 'robots-parser';
import {auditPage,auditWebsitePages,chooseAuditLinks} from './audit.mjs';
import {parseSitemap,prioritizeSitemapUrls} from './sitemap.mjs';

const UA='AIRevenueRecoveryBot/1.0 (+mailto:contact.badblue@gmail.com)';
const MAX_BYTES=1500000;
export function isGlobalIP(ip){
  const v=isIP(ip);
  if(v===4){
    const [a,b,c,d]=ip.split('.').map(Number);
    if(a===0||a===10||a===127||a>=224)return false;
    if(a===100&&b>=64&&b<=127)return false;
    if(a===169&&b===254)return false;
    if(a===172&&b>=16&&b<=31)return false;
    if(a===192&&(b===168||(b===0&&c===0)||(b===0&&c===2)||(b===88&&c===99)))return false;
    if(a===198&&(b===18||b===19||(b===51&&c===100)))return false;
    if(a===203&&b===0&&c===113)return false;
    if(a===192&&b===0&&c===0)return false;
    if(a===255&&b===255&&c===255&&d===255)return false;
    return true;
  }
  if(v===6){
    const addr=ip.toLowerCase().split('%')[0];
    if(addr==='::1'||addr==='::'||addr.startsWith('fc')||addr.startsWith('fd')||addr.startsWith('fe8')||addr.startsWith('fe9')||addr.startsWith('fea')||addr.startsWith('feb'))return false;
    if(addr.startsWith('::ffff:'))return isGlobalIP(addr.slice(7));
    if(!/^2[0-9a-f]{3}:/i.test(addr)&&!/^3[0-9a-f]{3}:/i.test(addr))return false;
    if(addr.startsWith('2001:db8:')||addr.startsWith('2001:0:')||addr.startsWith('2001:10:'))return false;
    return true;
  }
  return false;
}
export function normalizePublicURL(input) {
  const u=new URL(String(input).trim());
  if(!['https:','http:'].includes(u.protocol)||u.username||u.password||u.port&&!['80','443'].includes(u.port))throw Error('Only public HTTP and HTTPS website addresses are supported');
  const host=u.hostname.toLowerCase().replace(/\.$/,'');
  if(host.length>253||!host.includes('.')||isIP(host)||host==='localhost'||/\.(localhost|local|internal|intranet|test|invalid|example|onion)$/.test(host))throw Error('Only ordinary public business domains can be scanned');
  u.hash='';u.hostname=host;return u;
}
async function resolveURL(u){
  const answers=await lookup(u.hostname,{all:true,verbatim:true});
  if(!answers.length||answers.some(a=>!isGlobalIP(a.address)))throw Error('Refusing non-public network destination');
  return answers.find(a=>a.family===4)||answers[0];
}
async function proxyFetch(u,{maxBytes=MAX_BYTES,timeout=11000}={}){
  // Resolve and validate every target before the proxy request; never use this route for internal/private hosts.
  await resolveURL(u);
  const proxy=process.env.HTTPS_PROXY||process.env.https_proxy||process.env.HTTP_PROXY||process.env.http_proxy;
  if(!proxy)throw Error('Proxy not configured');
  const dispatcher=new ProxyAgent(proxy);
  try{
    const res=await fetch(u.href,{dispatcher,redirect:'manual',signal:AbortSignal.timeout(timeout),headers:{'User-Agent':UA,'Accept':'text/html,text/plain;q=0.8,*/*;q=0.1'}});
    const headers=Object.fromEntries(res.headers);
    if(res.status>=300&&res.status<400)return {status:res.status,location:res.headers.get('location')||'',headers,body:''};
    if(res.status!==200)return {status:res.status,headers,body:''};
    const reported=Number(res.headers.get('content-length')||0);
    if(reported>maxBytes)throw Error('Website exceeds safe scan size');
    const chunks=[];let total=0;
    for await(const chunk of res.body){total+=chunk.length;if(total>maxBytes)throw Error('Website exceeds safe scan size');chunks.push(Buffer.from(chunk));}
    const bytes=Buffer.concat(chunks);
    if(bytes.length>maxBytes)throw Error('Website exceeds safe scan size');
    return {status:res.status,headers,body:bytes.toString('utf8')};
  }finally{await dispatcher.close();}
}
async function platformFetch(u,{maxBytes=MAX_BYTES,timeout=11000}={}){
  // Reject private network destinations before any request; handle redirects separately.
  await resolveURL(u);
  const res=await fetch(u.href,{redirect:'manual',signal:AbortSignal.timeout(timeout),headers:{'User-Agent':UA,'Accept':'text/html,text/plain;q=0.8,*/*;q=0.1'}});
  const headers=Object.fromEntries(res.headers);
  if(res.status>=300&&res.status<400)return {status:res.status,location:res.headers.get('location')||'',headers,body:''};
  if(res.status!==200)return {status:res.status,headers,body:''};
  const reported=Number(res.headers.get('content-length')||0);
  if(reported>maxBytes)throw Error('Website exceeds safe scan size');
  const chunks=[];let total=0;
  for await(const chunk of res.body){total+=chunk.length;if(total>maxBytes)throw Error('Website exceeds safe scan size');chunks.push(Buffer.from(chunk));}
  return {status:res.status,headers,body:Buffer.concat(chunks).toString('utf8')};
}
async function singleFetch(u,{maxBytes=MAX_BYTES,timeout=11000}={}){
  const a=await resolveURL(u);
  const client=u.protocol==='https:'?https:http;
  return new Promise((resolve,reject)=>{
    let done=false;
    const req=client.request({hostname:u.hostname,port:u.port||undefined,path:u.pathname+u.search,method:'GET',
      servername:u.hostname,lookup:(_name,opts,callback)=>{if(opts&&opts.all)callback(null,[{address:a.address,family:a.family}]);else callback(null,a.address,a.family);},
      headers:{'User-Agent':UA,'Accept':'text/html,text/plain;q=0.8,*/*;q=0.1','Accept-Encoding':'identity','Host':u.host},
      timeout},res=>{
      const chunks=[];let size=0;
      const code=res.statusCode||0;
      if(code>=300&&code<400){res.resume();done=true;resolve({status:code,location:res.headers.location||'',headers:res.headers,body:''});return;}
      if(code<200||code>=300){res.resume();done=true;resolve({status:code,headers:res.headers,body:''});return;}
      res.on('data',chunk=>{size+=chunk.length;if(size>maxBytes){req.destroy(Error('Website exceeds safe scan size'));return;}chunks.push(chunk);});
      res.on('end',()=>{if(done)return;done=true;resolve({status:code,headers:res.headers,body:Buffer.concat(chunks).toString('utf8')});});
    });
    req.on('timeout',()=>req.destroy(Error('Website scan timed out')));
    req.on('error',e=>{if(!done){done=true;reject(e);}});
    req.end();
  });
}
async function safeTransportFetch(u,options={}){
  const proxy=process.env.HTTPS_PROXY||process.env.https_proxy||process.env.HTTP_PROXY||process.env.http_proxy;
  try {return proxy?await proxyFetch(u,options):await platformFetch(u,options);}
  catch (error) {
    if(error?.code==='ERR_INVALID_IP_ADDRESS'||String(error?.message||'').includes('Invalid IP address')){
      console.warn('Platform transport rejected an IP address; retrying with validated pinned DNS');
      return await singleFetch(u,options);
    }
    throw error;
  }
}
export async function fetchPublicPage(input,limit=2) {
  let u=normalizePublicURL(input);
  for(let i=0;i<=limit;i++){
    const result=await safeTransportFetch(u);
    if(result.status>=300&&result.status<400){
      if(!result.location)throw Error('Missing redirect destination');
      if(i===limit)throw Error('Excessive redirects');
      u=normalizePublicURL(new URL(result.location,u).href);continue;
    }
    if(result.status!==200)throw Error('Website returned HTTP '+result.status);
    const mime=String(result.headers['content-type']||'');
    if(!/text\/html|text\/plain|application\/xhtml\+xml/i.test(mime))throw Error('Non-HTML website response');
    return {...result,url:u.href};
  }
  throw Error('Website unavailable');
}
function decodeEntities(x){return x.replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&lt;/gi,'<').replace(/&gt;/gi,'>');}
function textOnly(html){return decodeEntities(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ').replace(/<!--[\s\S]*?-->/g,' ').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ')).trim();}
function attr(tag,name){const re=new RegExp('\\b'+name+'\\s*=\\s*(?:\"([^\"]*)\"|\\x27([^\\x27]*)\\x27|([^\\s>]+))','i');const a=String(tag).match(re);return a?(a[1]??a[2]??a[3]):'';}
export function summarizePage(url,html){
 const base=new URL(url),title=textOnly((html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)||[])[1]||'').slice(0,180);
 const headings=[...html.matchAll(/<h[1-4]\b[^>]*>([\s\S]*?)<\/h[1-4]>/gi)].map(m=>textOnly(m[1]).slice(0,200)).filter(Boolean).slice(0,30);
 const links=[...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)].slice(0,280).map(m=>{
  const href=attr(m[1],'href');try{const parsed=new URL(href,base);return {url:parsed.href,label:textOnly(m[2]).slice(0,95)};}catch{return null;}
 }).filter(Boolean);
 const outbound=links.filter(l=>{try{const h=new URL(l.url).hostname;return h!==base.hostname&&/^https?:/.test(l.url);}catch{return false;}}).slice(0,50);
 const related=links.filter(l=>{try{const z=new URL(l.url);return z.hostname===base.hostname&&/contact|about|shipping|return|faq|support|book|schedule|appointment/i.test(l.label+' '+z.pathname)&&!/(cart|checkout|account|login|signin|payment)/i.test(z.pathname);}catch{return false;}}).slice(0,20);
 const contact=[...new Set(links.filter(l=>l.url.startsWith('mailto:')).map(l=>decodeURIComponent(l.url.slice(7)).split('?')[0].trim().toLowerCase()).filter(x=>/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(x)&&!/^(noreply|no-reply|unsubscribe|security|privacy|abuse|support\+|billing\+)/i.test(x)))].slice(0,5);
 const allText=textOnly(html).slice(0,11500);
 const forms=[...html.matchAll(/<form\b[\s\S]*?<\/form>/gi)].map(m=>textOnly(m[0]).slice(0,400)).slice(0,8);
 const nav=links.map(l=>l.label).filter(Boolean).slice(0,100);
 return {url,host:base.hostname,title,headings,body_excerpt:allText.slice(0,9000),forms,visible_link_labels:nav,public_contact_emails:contact,external_links:outbound,related_links:related,evidence_scope:'Public HTML from server response only; cannot observe private user sessions, actual abandoned carts, conversion analytics, or authenticated checkouts.',observed_at:new Date().toISOString()};
}
const robotsCache=new Map();
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export async function respectRobots(u){
 const parsed=normalizePublicURL(u),origin=parsed.origin;
 const entry=robotsCache.get(origin);
 if(entry&&Date.now()-entry.at<(entry.allowed?15:3)*60000){
  const isAllowed=entry.policy?entry.policy.isAllowed(parsed.href,UA)!==false:entry.allowed;
  return {allowed:isAllowed,reason:isAllowed?'Permitted by robots.txt':entry.reason,crawl_delay:entry.delay||0};
 }
 let target=origin+'/robots.txt',result;
 try{
  for(let redirect=0;redirect<=3;redirect++){
   const url=normalizePublicURL(target);
   result=await safeTransportFetch(url,{maxBytes:150000,timeout:8500});
   if(result.status>=300&&result.status<400&&result.location&&redirect<3){
    target=new URL(result.location,url).href;continue;
   }
   break;
  }
 }catch(error){
  const answer={allowed:false,reason:'Unable to verify crawl permission: '+String(error.code||error.message).slice(0,120)};
  robotsCache.set(origin,{at:Date.now(),...answer});return answer;
 }
 if(result.status===404){
  const answer={allowed:true,reason:'No robots.txt',crawl_delay:0};
  robotsCache.set(origin,{at:Date.now(),...answer});return answer;
 }
 if(result.status!==200){
  const answer={allowed:false,reason:'Robots response '+result.status,crawl_delay:0};
  robotsCache.set(origin,{at:Date.now(),...answer});return answer;
 }
 const policy=robotsParser(origin+'/robots.txt',result.body);
 const allowed=policy.isAllowed(parsed.href,UA)!==false;
 const delayRaw=Number(policy.getCrawlDelay(UA)||0);
 const delay=Number.isFinite(delayRaw)?Math.max(0,Math.min(60,delayRaw)):0;
 const answer={allowed,reason:allowed?'Permitted by robots.txt':'Disallowed by robots.txt',crawl_delay:delay};
 robotsCache.set(origin,{at:Date.now(),...answer,policy,delay});
 if(robotsCache.size>300)robotsCache.delete(robotsCache.keys().next().value);
 return answer;
}
async function retrievePublicSitemap(input){
 let target=normalizePublicURL(input);
 for(let redirects=0;redirects<3;redirects++){
  const permission=await respectRobots(target.href);
  if(!permission.allowed)return null;
  const response=await safeTransportFetch(target,{maxBytes:300000,timeout:7500});
  if(response.status>=300&&response.status<400&&response.location){
   const candidate=normalizePublicURL(new URL(response.location,target).href);
   if(candidate.hostname!==target.hostname)return null;
   target=candidate;continue;
  }
  if(response.status!==200)return null;
  if(!/xml|text\/plain|octet-stream/i.test(String(response.headers['content-type']||'')))return null;
  return {url:target.href,body:response.body};
 }
 return null;
}
export async function discoverSitemapLinks(website,{maxLinks=8}={}){
 const origin=normalizePublicURL(website).origin,queue=[origin+'/sitemap.xml'],seen=new Set(),urls=[];
 while(queue.length&&seen.size<3){
  const next=queue.shift();
  if(seen.has(next))continue;
  seen.add(next);
  try{
   const data=await retrievePublicSitemap(next);
   if(!data)continue;
   const parsed=parseSitemap(data.body,data.url);
   if(parsed.type==='index'){
    for(const entry of parsed.urls.slice(0,2)){
     if(!seen.has(entry))queue.push(entry);
    }
   }else urls.push(...parsed.urls);
  }catch(error){console.warn('Optional public sitemap unavailable:',String(error.message||error).slice(0,90));}
 }
 return prioritizeSitemapUrls(urls,origin,Math.max(1,Math.min(8,maxLinks)));
}

export async function inspectWebsite(url,{maxSupporting=4}={}){
 const home=normalizePublicURL(url),permission=await respectRobots(home.href);
 if(!permission.allowed)throw Error(permission.reason);
 const started=Date.now();
 const result=await fetchPublicPage(home.href);
 const observation=summarizePage(result.url,result.body);
 const homeAudit=auditPage({url:result.url,html:result.body,elapsed_ms:Date.now()-started});
 const pages=[homeAudit];
 observation.supporting_pages=[];
 const max=Math.max(0,Math.min(5,maxSupporting));
 const targets=chooseAuditLinks(homeAudit,result.url,Math.max(max*3,9));
 if(targets.length<2&&max>0){
  const extraTargets=await discoverSitemapLinks(result.url,{maxLinks:max});
  for(const candidate of extraTargets){
   if(!targets.some(x=>x.url===candidate.url))targets.push(candidate);
  }
 }

 const seen=new Set([new URL(result.url).pathname]);
 const delayMs=Math.min(12000,Math.ceil(Number(permission.crawl_delay||0)*1000));
 for(const target of targets){
  if(observation.supporting_pages.length>=max)break;
  try{
   const candidate=normalizePublicURL(target.url);
   if(candidate.hostname!==new URL(result.url).hostname)continue;
   const key=candidate.pathname.replace(/\/$/,'').toLowerCase();
   if(seen.has(key))continue;
   seen.add(key);
   const policy=await respectRobots(candidate.href);
   if(!policy.allowed)continue;
   if(delayMs>0)await sleep(delayMs);
   const began=Date.now();
   const sub=await fetchPublicPage(candidate.href,3);
   if(new URL(sub.url).hostname!==new URL(result.url).hostname)continue;
   const analysis=auditPage({url:sub.url,html:sub.body,elapsed_ms:Date.now()-began});
   pages.push(analysis);
   const parsed=summarizePage(sub.url,sub.body);
   observation.supporting_pages.push({
    url:sub.url,category:target.type,title:analysis.title,
    body_excerpt:parsed.body_excerpt.slice(0,1700),
    headings:parsed.headings.slice(0,8),
    cta_count:analysis.cta_count,forms:analysis.forms.length,
    evidence:analysis.notes
   });
   for(const address of parsed.public_contact_emails||[]){
    if(!observation.public_contact_emails.includes(address))observation.public_contact_emails.push(address);
   }
  }catch(error){
   console.warn('Optional public audit page unavailable:',String(error.message||error).slice(0,90));
  }
 }
 observation.public_contact_emails=observation.public_contact_emails.slice(0,5);
 observation.site_audit=auditWebsitePages(pages);
 observation.audited_at=new Date().toISOString();
 observation.audit_scope='Static GET of public, robots-permitted pages; did not submit forms or measure sales/conversions.';
 return observation;
}
