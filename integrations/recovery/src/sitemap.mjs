import * as cheerio from 'cheerio';

/** URL discovery for public, same-host XML sitemaps; no forms or checkout paths. */
const cat = [
 ['product',100, /\/products?\/|\/item\/|\/p\/|\/shop\/[^/]+$/i],
 ['pricing',90, /\/pricing\/?$|\/plans?\/?$|\/services?\/?$/i],
 ['collection',85, /\/collections?\/|\/categories?\/|\/catalog\/|\/shop\/?$/i],
 ['booking',82, /\/(?:book|schedule|appointment|consultation)\b/i],
 ['shipping',77, /\/(?:shipping|delivery|fulfillment)\b/i],
 ['returns',74, /\/(?:returns?|refunds?|exchanges?)\b/i],
 ['contact',70, /\/(?:contact|about-us|about)\b/i],
 ['faq',63, /\/(?:faq|frequently-asked)\b/i]
];
const excluded=/(checkout|cart|account|login|signin|admin|auth|privacy|terms|gift.card|payment|order.status|track.order|wishlist|search|collections\/all|policies\/privacy)/i;
export function parseSitemap(xml,sourceUrl,{maxUrls=1200}={}){
 const content=String(xml||'');
 if(content.length>450000)return {type:'oversized',urls:[]};
 const $=cheerio.load(content,{xmlMode:true,decodeEntities:true});
 const index=$('sitemapindex > sitemap > loc').map((_,n)=>$(n).text().trim()).get().slice(0,12);
 const pages=$('urlset > url > loc').map((_,n)=>$(n).text().trim()).get().slice(0,maxUrls);
 const base=new URL(sourceUrl);
 const sanitize=(raw)=>{
  try {
   const u=new URL(raw,base);
   if(u.protocol!=='https:'||u.username||u.password||u.port)return null;
   if(u.hostname.toLowerCase()!==base.hostname.toLowerCase())return null;
   u.hash='';return u.href;
  }catch{return null;}
 };
 return {type:index.length?'index':'urls',
   urls:(index.length?index:pages).map(sanitize).filter(Boolean)};
}
export function prioritizeSitemapUrls(urls,rootUrl,max=8){
 const root=new URL(rootUrl).hostname.toLowerCase();
 const candidates=[];
 const seen=new Set();
 for(const raw of (urls||[]).slice(0,1500)){
  let u;
  try{u=new URL(raw)}catch{continue}
  if(u.protocol!=='https:'||u.hostname.toLowerCase()!==root||u.username||u.password||u.port||excluded.test(u.pathname))continue;
  const category=cat.find(([,score,rule])=>rule.test(u.pathname));
  if(!category)continue;
  const normalized=u.pathname.replace(/\/$/,'').toLowerCase();
  if(seen.has(normalized))continue;
  seen.add(normalized);
  candidates.push({type:category[0],weight:category[1],url:u.href});
 }
 const out=[],types=new Set();
 for(const c of candidates.sort((a,b)=>b.weight-a.weight)){
  if(types.has(c.type))continue;
  types.add(c.type);out.push(c);
  if(out.length>=Math.min(12,Math.max(1,max)))break;
 }
 return out;
}
