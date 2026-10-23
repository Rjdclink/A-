const url=process.env.AI_BASE_URL||'https://vireonix.ai/v1/chat/completions';
export async function complete(system,user,{maxTokens=750}={}) {
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),Number(process.env.AI_TIMEOUT_MS)||55000);
  try {
    const response=await fetch(url,{
      method:'POST',
      headers:{'content-type':'application/json'},
      body:JSON.stringify({model:process.env.AI_MODEL||'auto',temperature:0.25,max_tokens:maxTokens,messages:[{role:'system',content:system},{role:'user',content:user}]}),
      signal:controller.signal
    });
    if(!response.ok) throw new Error('AI service HTTP '+response.status);
    const data=await response.json();
    const content=data?.choices?.[0]?.message?.content;
    if(typeof content!=='string'||!content.trim()) throw new Error('AI service response missing content');
    return content.trim();
  } finally {clearTimeout(timeout);}
}
export function extractJson(text) {
  const clean=String(text||'').replace(/^\s*\x60{3}(?:json)?\s*/i,'').replace(/\s*\x60{3}\s*$/,'').trim();
  try {return JSON.parse(clean);} catch {}
  const a=clean.indexOf('{'),b=clean.lastIndexOf('}');
  if(a<0||b<a) throw new Error('AI returned no JSON object');
  return JSON.parse(clean.slice(a,b+1));
}
export async function analyzeOpportunity(observation) {
  const system='You are a rigorous B2B ecommerce conversion and lead-funnel auditor. Review ONLY supplied evidence from publicly accessible pages, and distinguish direct observed HTML from untested hypotheses. A deterministic multi-page audit with URLs, category, impact and confidence is provided; prioritize its evidence, including findings about product discoverability, accessible purchase buttons, forms, shipping, and contact policies. NEVER invent profits, cart abandonment, actual customer confusion, internal conversion metrics, page performance, analytics, security findings, or dollar losses. Never call a possible problem a verified failure unless the evidence is direct and sufficient. Revenue scenarios require explicit invented assumptions; prefer no numeric estimate where data is missing. Return a SINGLE compact valid JSON object: company_name, summary, confidence (low/medium/high), opportunities (array with finding,evidence,source_url,service,impact_scenario,assumptions), priority_score (0-100), priority_basis, email_subject, email_body. Evidence must name specific supplied page and exact observation. Outreach email must be specific, professional, and offer $299/month without implying proven losses, contact history or verified profit. Omit results unsupported by provided evidence.';
  const audit=observation.site_audit||null;
  const concise={
    company_website:observation.url,company_homepage_title:observation.title,
    evidence_scope:observation.evidence_scope,
    multi_page_review:audit?{
      method:audit.method,pages_audited:audit.pages_audited,
      page_coverage:(audit.page_coverage||[]).slice(0,6),
      ranked_findings:(audit.findings||[]).slice(0,9),
      score_explanation:audit.score?.type
    }:null,
    homepage_text:String(observation.body_excerpt||'').slice(0,2000),
    supporting_pages:(observation.supporting_pages||[]).slice(0,4).map(page=>({
      url:page.url,kind:page.category,title:page.title,excerpt:String(page.body_excerpt||'').slice(0,850)
    })),
    navigation:(observation.visible_link_labels||[]).slice(0,16),
    public_contact_email_present:Boolean(observation.public_contact_emails?.length)
  };
  const input=JSON.stringify(concise).slice(0,13000);
  let result;
  try {result=extractJson(await complete(system,input,{maxTokens:2200}));}
  catch(error){
    console.warn('AI structured analysis unavailable:',String(error.message).slice(0,140));
    const title=String(observation.title||observation.host||'Business');
    const body=String(observation.body_excerpt||'');
    const opportunities=(audit?.findings||[]).slice(0,5).map(f=>({finding:f.code.replace(/-/g,' '),evidence:f.evidence,source_url:f.url,service:f.service,impact_scenario:'No actual sales data was measured; potential benefit must be tested',assumptions:f.assumptions}));
    if(!opportunities.length&&/checkout|shop|cart|buy|purchase|pricing/i.test(body))opportunities.push({finding:'Review purchasing journey for potential friction',evidence:'Public website contains shopping or pricing terminology; no cart abandonment data is available',service:'Customer inquiry capture and consent-based follow-up',impact_scenario:'Potential improvement cannot be quantified without actual traffic and conversion data',assumptions:'Merchant analytics required'});
    if(!opportunities.length&&/contact|book|schedule|appointment|request|demo/i.test(body))opportunities.push({finding:'Evaluate inquiry and appointment response time',evidence:'Public website presents contact or scheduling calls to action',service:'Automated inquiry responses and appointment follow-up',impact_scenario:'Illustrative benefit only; no lost-revenue amount verified',assumptions:'Requires business inquiry data'});
    result={company_name:title,summary:'Preliminary public-website review; detailed AI response was unavailable',confidence:'low',opportunities,priority_score:25,priority_basis:'Public calls to action, not verified profitability',email_subject:'Potential conversion improvements for '+title,email_body:'Hello, we reviewed the publicly available customer journey on your website and identified possible areas for improving inquiry follow-up. Our AI Revenue Recovery service provides automated lead responses and follow-ups for $299 per month. These are opportunities for review, not verified lost purchases or revenue. Please let us know if you would like details.'};
  }
  if(!Array.isArray(result.opportunities))result.opportunities=[];
  result.opportunities=result.opportunities.slice(0,6).map(o=>({
    finding:String(o.finding||'').slice(0,400),evidence:String(o.evidence||'').slice(0,700),
    source_url:(audit?.page_coverage||[]).some(p=>p.url===o.source_url)?String(o.source_url):String(observation.url||''),
    service:String(o.service||'').slice(0,600),impact_scenario:String(o.impact_scenario||'').slice(0,600),
    assumptions:String(o.assumptions||'').slice(0,600)
  }));
  result.company_name=String(result.company_name||observation.title||observation.host||'Business').slice(0,140);
  result.summary=String(result.summary||'').slice(0,1400);
  result.priority_score=Math.min(100,Math.max(0,Number(result.priority_score)||0));
  result.priority_basis=String(result.priority_basis||'Public site signals only, not verified company profit').slice(0,650);
  result.email_subject=String(result.email_subject||'Revenue opportunities for '+result.company_name).replace(/[\r\n]/g,' ').slice(0,150);
  result.email_body=String(result.email_body||'').slice(0,4500);
  result.confidence=['low','medium','high'].includes(result.confidence)?result.confidence:'low';
  result.technical_audit=audit;
  result.public_pages_reviewed=Number(audit?.pages_audited||1);
  result.profitability_verified=false;
  result.actual_revenue_loss_measured=false;
  return result;
}
export async function draftReply(thread,company) {
  const system='You write professional, concise B2B email replies for AI Revenue Recovery. Only use supplied email context, be transparent that opportunity estimates are scenarios rather than measured abandoned carts. Price is $299 per month paid manually by the Bad Blue Venmo business QR (@bad-blue). Never invent that a payment was received or claim access to private analytics. Respect stop/unsubscribe immediately. If the prospect asks about a call, offer a reply with scheduling availability rather than inventing calendar events. Do not make legal promises or guarantee revenue. Output only the email body, with no subject, no markdown.';
  return (await complete(system,JSON.stringify({thread,company}).slice(0,12000),{maxTokens:450})).slice(0,3000);
}
export async function draftLeadReply(lead,business) {
  return (await complete('Respond to a prospective customer for a business using only its supplied service information and FAQ. Do not claim availability or prices unless supplied. Brief, polite, helpful; invite booking and clarify questions. Output body only.',JSON.stringify({lead:{name:lead.name,inquiry:lead.inquiry},business:{name:business.name,services:business.services,faq:business.faq}}),{maxTokens:350})).slice(0,2600);
}
