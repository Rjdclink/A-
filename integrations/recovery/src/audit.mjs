import * as cheerio from 'cheerio';

/**
 * Evidence-first static storefront and lead-funnel audit. It never represents a
 * screenshot, Lighthouse run, actual cart, analytics access, or transaction.
 * Pages are public GET responses; no forms are submitted.
 */
const MAX_EVIDENCE=260;
const trim=(s,n=MAX_EVIDENCE)=>String(s??'').replace(/\s+/g,' ').trim().slice(0,n);
const urlPath=(u)=>{try{return new URL(u).pathname}catch{return '/'}};
function rootDomain(u){try{return new URL(u).hostname.replace(/^www\./,'').toLowerCase()}catch{return ''}}
function canonicalUrl(href,base){
 try{
  const u=new URL(href,base);
  if(!['https:','http:'].includes(u.protocol)||u.username||u.password)return '';
  u.hash='';return u.href;
 }catch{return ''}
}
function jsonLd($){
 const out=[];
 $('script[type="application/ld+json"]').slice(0,8).each((_,node)=>{
  const raw=$(node).html()?.trim();
  if(!raw||raw.length>70000)return;
  try{
   const obj=JSON.parse(raw);
   const visit=(value,depth=0)=>{
    if(!value||depth>4)return;
    if(Array.isArray(value)){value.slice(0,15).forEach(v=>visit(v,depth+1));return}
    if(typeof value!=='object')return;
    const type=Array.isArray(value['@type'])?value['@type'].join(','):value['@type'];
    if(type)out.push({type:trim(type,100),name:trim(value.name,130),offers:!!value.offers,aggregateRating:!!value.aggregateRating});
    if(value['@graph'])visit(value['@graph'],depth+1);
    if(value.mainEntity)visit(value.mainEntity,depth+1);
   };
   visit(obj);
  }catch{/* malformed structured data is a factual observation below */}
 });
 return out.slice(0,20);
}
export function auditPage({url,html,status=200,elapsed_ms=null}){
 const $=cheerio.load(String(html||''),{decodeEntities:true});
 const structured=jsonLd($);
 $('script,style,noscript,template,svg').remove();
 const title=trim($('title').first().text(),180);
 const description=trim($('meta[name="description"]').first().attr('content'),300);
 const heading=$('h1').map((_,n)=>trim($(n).text(),160)).get().filter(Boolean);
 const viewport=$('meta[name="viewport"]').attr('content')||'';
 const links=$('a[href]').map((_,n)=>{
  const href=canonicalUrl($(n).attr('href'),url);
  if(!href)return null;
  return {url:href,text:trim($(n).text()||$(n).attr('aria-label')||'',100)};
 }).get().slice(0,350);
 const domain=rootDomain(url);
 const internal=links.filter(x=>rootDomain(x.url)===domain);
 const categories={
  product:/(\/products?\/|\/item\/|\/p\/|product[-_]|\/shop\/[^/]+$)/i,
  collection:/(\/collections?\/|\/categories?\/|\/shop\/?$|\/catalog\/)/i,
  pricing:/(pricing|plans?|services?)/i,
  shipping:/(shipping|delivery|fulfill)/i,
  returns:/(returns?|refund|exchange)/i,
  contact:/(contact|support|reach-us|about-us)/i,
  booking:/(book|schedule|appointment|consultation|reserve)/i,
  faq:/(faq|frequently-asked|help-center)/i
 };
 const relevant_links={};
 for(const [cat,pattern] of Object.entries(categories)){
  relevant_links[cat]=internal.filter(l=>pattern.test(new URL(l.url).pathname+' '+l.text)).slice(0,8);
 }
 const forms=[];
 $('form').slice(0,15).each((_,form)=>{
  const $form=$(form),inputs=$form.find('input,select,textarea').filter((_,el)=>!['hidden','submit'].includes(($(el).attr('type')||'').toLowerCase()));
  const controls=inputs.map((_,n)=>{
   const el=$(n),id=el.attr('id');
   const label=trim(el.attr('aria-label')||el.attr('placeholder')||(id?$('label[for="'+id.replace(/"/g,'')+'"]').first().text():'')||el.closest('label').text(),100);
   return {type:trim(el.attr('type')||el.get(0)?.tagName||'text',25),name:trim(el.attr('name'),50),has_label:!!label,required:el.is('[required]')};
  }).get().slice(0,25);
  forms.push({action_path:trim($form.attr('action')||urlPath(url),110),control_count:controls.length,unlabeled:controls.filter(c=>!c.has_label).length,controls,method:trim($form.attr('method')||'GET',8)});
 });
 const images=$('img').length;
 const missingAlt=$('img').filter((_,n)=>$(n).attr('alt')===undefined).length;
 const buttons=$('button').length;
 const unlabeledButtons=$('button').filter((_,n)=>!trim($(n).text()||$(n).attr('aria-label')||$(n).attr('title'))).length;
 const ctaText=$('button,a').map((_,n)=>trim($(n).text()||$(n).attr('aria-label'),70)).get().filter(Boolean).slice(0,200);
 const text=trim($('body').text(),9000);
 const isProduct=categories.product.test(urlPath(url))||structured.some(o=>/product/i.test(o.type));
 const callsToAction=ctaText.filter(x=>/^(add to cart|buy now|shop now|checkout|book now|schedule|request a quote|start trial|contact us|buy|subscribe|get started)$/i.test(x)).slice(0,35);
 const media={images,missing_alt:missingAlt,buttons,unlabeled_buttons:unlabeledButtons};
 const meta={
  title,description,h1:heading.slice(0,5),viewport:!!viewport,canonical:canonicalUrl($('link[rel="canonical"]').attr('href'),url),
  lang:trim($('html').attr('lang'),20),og_title:trim($('meta[property="og:title"]').attr('content'),160),
  og_description:trim($('meta[property="og:description"]').attr('content'),160),
  json_ld:structured
 };
 const prices=(text.match(/(?:\$|USD\s?)\s?\d{1,5}(?:\.\d{2})?/gi)||[]).slice(0,12);
 const notes={
  shipping:trim((text.match(/.{0,80}(?:free shipping|shipping rates?|delivery time|ships within).{0,120}/i)||[])[0],190),
  returns:trim((text.match(/.{0,80}(?:returns? policy|refund policy|30.day returns?|money.back).{0,120}/i)||[])[0],190),
  availability:trim((text.match(/.{0,60}(?:sold out|out of stock|currently unavailable).{0,90}/i)||[])[0],160)
 };
 return {url,title,kind:isProduct?'product':categories.collection.test(urlPath(url))?'collection':'general',status,elapsed_ms,
  meta,forms,media,link_count:links.length,internal_link_count:internal.length,links:internal.slice(0,100),
  relevant_links,cta_count:callsToAction.length,cta_text:callsToAction.slice(0,15),prices,
  notes,text_excerpt:text.slice(0,2200),audit_method:'server-returned public HTML (not a browser performance audit)'};
}
function finding(code,category,impact,confidence,evidence,page,service,assumptions){
 return {code,category,impact,confidence,evidence:trim(evidence,360),url:page.url,
   service,assumptions:trim(assumptions,300),
   note:'Potential optimization; no proof of lost sales, cart abandonment, or revenue impact'};
}
export function auditWebsitePages(pages){
 const results=(pages||[]).filter(p=>p&&p.url).slice(0,7);
 const homepage=results[0]||null;
 const findings=[];
 const add=(...args)=>{if(findings.length<25)findings.push(finding(...args))};
 for(const page of results){
  if(!page.meta.description)add('missing-meta-description','discovery',22,'high','Page has no meta description in returned HTML.',page,'Write a specific, accurate description reflecting the offer.','Search engines may generate snippets automatically.');
  if(page.meta.h1.length===0)add('missing-primary-heading','discovery',18,'high','No H1 was present in the returned HTML.',page,'Add a descriptive primary heading that communicates the offer.','Client-side rendering could add content not visible to this scan.');
  if(!page.meta.viewport)add('missing-mobile-viewport','mobile',45,'high','Viewport meta tag was absent in the returned HTML.',page,'Review responsive viewport and test mobile shopping or lead capture.','HTML omission does not directly prove mobile checkout difficulty.');
  if(page.media.missing_alt>0)add('missing-image-alternatives','accessibility',32,'high',page.media.missing_alt+' of '+page.media.images+' image elements lack alt attributes.',page,'Add meaningful product-image descriptions or empty alt for decorative images.','Decorative graphics may correctly have empty alternatives; audit individually.');
  if(page.media.unlabeled_buttons>0)add('unlabeled-buttons','accessibility',45,'high',page.media.unlabeled_buttons+' of '+page.media.buttons+' button elements have no visible text or aria-label.',page,'Give functional buttons accessible names, especially purchasing and inquiry actions.','JavaScript-enhanced content may differ after rendering.');
  if(page.forms.some(f=>f.unlabeled>0)){
   const f=page.forms.find(f=>f.unlabeled>0);
   add('unclear-form-labels','lead-capture',55,'medium',f.unlabeled+' form controls have no accessible name or placeholder in returned HTML.',page,'Provide explicit field labels, validation, and a clear submission confirmation.','Some custom forms label fields after client-side rendering.');
  }
  if(page.kind==='product'&&!page.prices.length)add('product-price-not-in-html','purchase-clarity',40,'medium','Product page HTML does not expose a recognizable public price.',page,'Review visibility of item prices before checkout and on mobile.','Price may load after JavaScript hydration or be displayed in another currency.');
  if(page.kind==='product'&&!page.cta_count)add('product-action-not-in-html','purchase-clarity',42,'medium','No standard buy/add-to-cart action was found in returned product HTML.',page,'Verify the purchase action is clear, visible, and keyboard accessible.','Add-to-cart components may be client-rendered.');
  const shippingText=page.notes.shipping.toLowerCase();
  if(shippingText.includes('qualifies for free shipping')&&shippingText.includes('away from')){
   add('shipping-message-mismatch','purchase-clarity',55,'low','Public HTML contains both eligibility and distance-to-free-shipping wording.',page,'Verify that live cart states show only the applicable message.','Alternate snippets may represent separate cart states; do not assume shoppers see both.');
  }
  if(page.meta.json_ld.some(x=>/product/i.test(x.type)&&!x.offers))add('product-structured-price','discovery',15,'medium','Product JSON-LD appears without an Offers object.',page,'Verify structured price and availability data matches the visible product.','Other valid structured-data implementations may exist.');
 }
 if(homepage){
  const links=homepage.relevant_links;
  const hasPurchase=Boolean(links.product.length||links.collection.length||homepage.cta_count);
  const hasContact=Boolean(links.contact.length||links.booking.length||homepage.forms.length);
  if(!hasPurchase&&!hasContact)add('unclear-primary-next-step','conversion-path',48,'low','Homepage HTML exposes no obvious shopping, booking, or customer inquiry path.',homepage,'Present one clear, accessible primary next step above the fold.','Navigation may be hydrated after initial server HTML.');
  if(hasPurchase&&!links.shipping.length)add('shipping-info-discoverability','purchase-clarity',25,'low','No obvious shipping-policy link was detected in sampled homepage links.',homepage,'Expose shipping costs and thresholds before the last purchase step.','A footer link or cart message may be present but not recognized.');
  if(hasPurchase&&!links.returns.length)add('returns-info-discoverability','trust',25,'low','No obvious returns or refund link was detected in sampled homepage links.',homepage,'Make returns and exchange policy easy to discover from product pages.','A policy can exist even without a directly recognized navigation link.');
  if(!hasContact)add('contact-route-discoverability','lead-capture',30,'low','No clear business-contact or booking route was identified from the homepage.',homepage,'Provide a visible way to reach a person and capture pre-sale questions.','Contact information may exist in another channel.');
 }
 const groups=new Map();
 for(const current of findings){
   const prev=groups.get(current.code);
   if(prev){prev.occurrences++;if(prev.source_urls.length<5&&!prev.source_urls.includes(current.url))prev.source_urls.push(current.url);}
   else groups.set(current.code,{...current,occurrences:1,source_urls:[current.url]});
 }
 const distinct=[...groups.values()].sort((a,b)=>b.impact-a.impact);
 const sources=results.map(p=>({url:p.url,kind:p.kind,title:p.title,cta_count:p.cta_count,forms:p.forms.length,elapsed_ms:p.elapsed_ms}));
 const totalIssues=distinct.filter(f=>f.confidence==='high').length;
 return {
  version:'1.0',method:'Public server-rendered GET pages, static HTML; no access to analytics, user sessions, internal profits, purchases, or client-side performance',
  pages_audited:results.length,page_coverage:sources,findings:distinct.slice(0,15),
  high_confidence_findings:totalIssues,
  findings_count:distinct.length,
  score:{type:'heuristic review priority; not actual performance, financial success or business profitability',value:Math.min(100,Math.round(distinct.slice(0,6).reduce((sum,f)=>sum+f.impact*(f.confidence==='high'?1:f.confidence==='medium'?.65:.35),0)/3))},
  evidence_limitations:['No real shopping transactions or abandoned-cart analytics measured.','Server-rendered HTML can differ from the final browser UI.','Mobile speed, accessibility conformance, and actual lost revenue require separate owner-authorized testing.']
 };
}
export function chooseAuditLinks(home,baseUrl,max=5){
 const base=rootDomain(baseUrl);
 const scored=[];
 for(const [type,weight] of [['product',100],['pricing',90],['collection',88],['booking',85],['shipping',78],['returns',76],['contact',72],['faq',65]]){
  for(const l of home.relevant_links?.[type]||[]){
   if(rootDomain(l.url)!==base)continue;
   const u=new URL(l.url);
   if(u.protocol!=='https:'||u.pathname==='/'||/(cart|checkout|account|login|signin|admin|auth|order-status|payment|gift.?cards?|privacy|terms.of|legal|wholesale|wishlist|track.?order)/i.test(u.pathname))continue;
   scored.push({type,url:l.url,weight});
  }
 }
 const seen=new Set(),out=[],used=new Set();
 for(const s of scored.sort((a,b)=>b.weight-a.weight)){
  if(seen.has(s.url)||used.has(s.type))continue;
  seen.add(s.url);used.add(s.type);out.push(s);
  if(out.length>=max)break;
 }
 return out;
}
