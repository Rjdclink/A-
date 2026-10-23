import {query} from './db.mjs';
import {inspectWebsite,normalizePublicURL} from './scanner.mjs';
import {analyzeOpportunity,draftLeadReply} from './ai.mjs';
import {createOutreach,pollInbox,deliverPendingEmail,smtpReady,sendMail} from './mail.mjs';
import {isValidEmail} from './security.mjs';

// This list is a crawl starting set, NOT a verified league table of company profits.
// Smaller independent businesses; profitability is unverified until reliable financial evidence is obtained.
export const STARTING_BUSINESSES=[
 ['https://www.barebonesliving.com',60],['https://www.grovemade.com',60],
 ['https://www.beardbrand.com',60],['https://www.tortugabackpacks.com',60],
 ['https://www.ugmonk.com',60],['https://www.blueland.com',60],
 ['https://www.bokksu.com',60],['https://www.nomatic.com',60],
 ['https://www.carawayhome.com',58],['https://www.fellowproducts.com',58],
 ['https://www.peakdesign.com',58],['https://www.bellroy.com',58],
 ['https://www.aersf.com',58],['https://www.graza.co',58],
 ['https://www.eastfork.com',58],['https://www.artoftea.com',58],
 ['https://www.american-giant.com',58],['https://www.publicgoods.com',58],
 ['https://www.rumpl.com',55],['https://www.outerknown.com',55],
 ['https://www.greatjonesgoods.com',55],['https://www.misen.com',55],
 ['https://www.heathceramics.com',55],['https://www.nocsdesign.com',55],
 ['https://www.cuyana.com',55],['https://www.brooklinen.com',55],
 ['https://www.meundies.com',55],['https://www.andar.com',55],
 ['https://www.loandsons.com',55],['https://www.houseplant.com',55],
 ['https://www.mackweldon.com',55],['https://www.paktbags.com',55],
 ['https://www.huckberry.com',50],['https://www.ridge.com',50]
]
export const SYSTEM_EMAIL='system@ai-revenue-recovery.invalid';
export async function systemBusiness(){
  const existing=await query('SELECT * FROM businesses WHERE owner_email=$1',[SYSTEM_EMAIL]);
  if(existing.rowCount)return existing.rows[0];
  // Internal-only identity: no known password or login path, never a paid subscriber.
  const r=await query("INSERT INTO businesses(owner_email,password_hash,name,slug,description,services,contact_email,subscription_status) VALUES($1,$2,'AI Revenue Recovery','internal-research','Independent public-market opportunity research','AI revenue-recovery services',$3,'internal') ON CONFLICT(owner_email) DO UPDATE SET name=EXCLUDED.name RETURNING *",
  [SYSTEM_EMAIL,'DISABLED_'+crypto.randomUUID(),'contact.badblue@gmail.com']);
  return r.rows[0];
}
export async function seedProspects(business){
  let inserted=0;
  for(const [website,priority] of STARTING_BUSINESSES){
    if(priority===0)continue;
    const host=normalizePublicURL(website).hostname.replace(/^www\./,'');
    const r=await query("INSERT INTO prospects(business_id,website,host,source_url,priority,priority_basis) SELECT $1,$2,$3,$4,$5,'Independent business candidate; actual profits not verified' WHERE NOT EXISTS (SELECT 1 FROM prospects WHERE business_id=$1 AND (host=$3 OR host='www.'||$3)) ON CONFLICT(business_id,host) DO NOTHING",
    [business.id,website,host,website,priority]);inserted+=r.rowCount;
  }
  return inserted;
}
export function allowRecurse(u,host,label=''){
  try{
    const x=normalizePublicURL(u);
    if(x.protocol!=='https:')return false;
    const normalized=x.hostname.toLowerCase().replace(/^www\./,'');
    const source=String(host).toLowerCase().replace(/^www\./,'');
    if(normalized===source||normalized.endsWith('.'+source)||source.endsWith('.'+normalized))return false;
    if(/^(help|support|static|cdn|checkout|account|login|news|docs|status|blog|analytics|tracking)\./i.test(normalized))return false;
    const prohibited=/^(?:[^.]+\.)*(?:google|facebook|instagram|threads|twitter|x|tiktok|linkedin|youtube|pinterest|reddit|wikipedia|paypal|stripe|cloudflare|amazon|microsoft|apple|meta|shopify|bitly|bit|linktr|t|wa|whatsapp|zendesk|gorgias|klaviyo|attentive|yotpo|judge|klarna|afterpay|affirm|twilio|salesforce|mailchimp|trustpilot|hotjar|hcaptcha|recaptcha)\.(?:com|me|io|net|org|co|ee)$/i;
    if(prohibited.test(normalized))return false;
    if(/\.(jpg|png|gif|svg|pdf|js|css|mp4)$/i.test(x.pathname))return false;
    if(/social|follow us|privacy|terms|support|cookies|contact us|help center|facebook|instagram|tiktok|pinterest|youtube|twitter/i.test(label||''))return false;
    return true;
  }catch{return false;}
}

export async function scanAndRecord(business,prospect){
  try{
    const observation=await inspectWebsite(prospect.website);
    const analysis=await analyzeOpportunity(observation);
    await query("UPDATE prospects SET observation=$2,analysis=$3,company_name=$4,contact_email=$5,priority=$6,priority_basis=$7,status='analyzed',scanned_at=now() WHERE id=$1",
      [prospect.id,JSON.stringify(observation),JSON.stringify(analysis),analysis.company_name,observation.public_contact_emails?.[0]||'',Math.max(0,Math.min(100,Number(analysis.priority_score)||0)),analysis.priority_basis]);
    await query("INSERT INTO business_scans(business_id,website,page_title,evidence,ai_analysis,outreach_draft) VALUES($1,$2,$3,$4,$5,$6)",[
      business.id,observation.url,observation.title,JSON.stringify(observation),JSON.stringify(analysis),analysis.email_body||''
    ]);
    for(const link of (observation.external_links||[]).slice(0,8)){
      if(!allowRecurse(link.url,observation.host,link.label))continue;
      const x=normalizePublicURL(link.url);
      const host=x.hostname.replace(/^www\./,'');
      await query("INSERT INTO prospects(business_id,website,host,source_url,priority,priority_basis) SELECT $1,$2,$3,$4,$5,$6 WHERE NOT EXISTS (SELECT 1 FROM prospects WHERE business_id=$1 AND (host=$3 OR host='www.'||$3)) ON CONFLICT(business_id,host) DO NOTHING",[
        business.id,x.origin,host,observation.url,30,'Discovered from a permitted public business link; profitability unknown'
      ]);
    }
    const r=await createOutreach(business,{...prospect,contact_email:observation.public_contact_emails?.[0]||''},analysis,{send:process.env.AUTO_OUTREACH==='true'});
    return {status:'analyzed',company:analysis.company_name,priority:analysis.priority_score,outreach:r.status};
  }catch(err){
    const reason=String(err.message||err).slice(0,350);
    await query("UPDATE prospects SET status='scan_failed',analysis=$2,scanned_at=now() WHERE id=$1",[prospect.id,JSON.stringify({error:reason})]);
    return {status:'scan_failed',website:prospect.website,reason};
  }
}
export async function discoverAndAnalyze({maxScans}={}){
  const business=await systemBusiness();
  await seedProspects(business);
  const limit=Math.min(5,Math.max(1,maxScans||Number(process.env.SCAN_BATCH_SIZE)||2));
  const results=[];
  // One next public host at a time, to reduce load on third-party websites.
  const pending=await query("SELECT * FROM prospects WHERE business_id=$1 AND (status='pending' OR (status='analyzed' AND scanned_at<now()-interval '30 days')) AND host NOT IN ('www.amazon.com','www.walmart.com','www.apple.com','www.microsoft.com','www.homedepot.com','www.target.com','www.nike.com','www.bestbuy.com','www.costco.com','www.shopify.com','www.adobe.com','www.ebay.com','www.salesforce.com','www.lowes.com','www.etsy.com') AND host !~ '(^|\\.)(instagram|threads|facebook|x|twitter|tiktok|youtube|pinterest|linkedin|reddit|amazon|google|microsoft|apple)\\.com$' ORDER BY CASE WHEN status='pending' THEN 0 ELSE 1 END,priority DESC,discovered_at ASC LIMIT $2",[business.id,limit]);
  for(const prospect of pending.rows)results.push(await scanAndRecord(business,prospect));
  return results;
}
export async function createLead(business,input){
  const {name,email,phone='',inquiry,consent=false}=input;
  const r=await query("INSERT INTO leads(business_id,name,email,phone,inquiry,consent) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",[business.id,name,email,phone,inquiry,!!consent]);
  const lead=r.rows[0];
  if(consent){
    for(const [kind,hours] of [['lead_initial',0],['lead_followup_24h',24],['lead_followup_72h',72]]){
      await query("INSERT INTO jobs(business_id,lead_id,kind,payload,run_at,status) VALUES($1,$2,$3,'{}'::jsonb,now()+($4::int * interval '1 hour'),'pending') ON CONFLICT(business_id,lead_id,kind) DO NOTHING",[business.id,lead.id,kind,hours]);
    }
  }
  return lead;
}
async function runOneJob(job){
 const item=await query("SELECT l.*,b.name AS business_name,b.services,b.faq,b.subscription_status FROM leads l JOIN businesses b ON b.id=l.business_id WHERE l.id=$1",[job.lead_id]);
 if(!item.rowCount)return {status:'no_lead'};
 const lead=item.rows[0];
 if(!lead.consent||!isValidEmail(lead.email))return {status:'not_authorized'};
 const optout=await query('SELECT 1 FROM optouts WHERE business_id=$1 AND email=$2',[job.business_id,lead.email.toLowerCase()]);
 if(optout.rowCount)return {status:'opted_out'};
 if(!smtpReady())return {status:'no_smtp'};
 let text;
 if(job.kind==='lead_initial'){
  text=await draftLeadReply(lead,{name:lead.business_name,services:lead.services,faq:lead.faq});
 }else{
  const row=await query('SELECT follow_up_count,status FROM leads WHERE id=$1',[lead.id]);
  if(row.rows[0]?.status==='closed'||row.rows[0]?.status==='converted')return {status:'closed'};
  text='Hello '+lead.name+', following up on your inquiry to '+lead.business_name+'. We would be happy to answer questions or help you schedule an appointment. Reply to this message whenever you are ready.';
 }
 const messageId=await sendMail({to:lead.email,subject:'Your inquiry — '+lead.business_name,body:text+'\n\nTo stop follow-up messages, reply with unsubscribe.'});
 await query("INSERT INTO correspondence(business_id,lead_id,direction,sender,recipient,subject,body,status,provider_message_id) VALUES($1,$2,'outbound',$3,$4,$5,$6,'sent',$7)",
  [job.business_id,lead.id,process.env.SENDER_EMAIL||'contact.badblue@gmail.com',lead.email,'Your inquiry — '+lead.business_name,text,messageId||null]);
 await query("UPDATE leads SET last_contact_at=now(),follow_up_count=follow_up_count+1,status='contacted' WHERE id=$1",[lead.id]);
 return {status:'sent'};
}
export async function processDueJobs({maxJobs=8}={}){
 const statuses=[];
 for(let i=0;i<Math.max(1,Math.min(15,maxJobs));i++){
  const claim=await query("UPDATE jobs SET status='processing',attempts=attempts+1 WHERE id=(SELECT id FROM jobs WHERE status='pending' AND run_at<=now() ORDER BY run_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *");
  if(!claim.rowCount)break;
  const job=claim.rows[0];
  try{
    const res=await runOneJob(job);
    if(res.status==='no_smtp'){await query("UPDATE jobs SET status='pending',run_at=now()+interval '1 hour',last_error='Email credentials not configured' WHERE id=$1",[job.id]);statuses.push(res.status);break;}
    await query("UPDATE jobs SET status='done',last_error='' WHERE id=$1",[job.id]);statuses.push(res.status);
  }catch(err){
    const attempts=job.attempts;
    const retry=attempts<4;
    await query("UPDATE jobs SET status=$2,last_error=$3,run_at=now()+($4::int*interval '1 minute') WHERE id=$1",[job.id,retry?'pending':'failed',String(err.message).slice(0,600),Math.pow(4,Math.min(attempts,4))]);
    statuses.push('retry');
  }
 }
 return statuses;
}
export async function processInvoiceReminders({maxInvoices=4}={}){
 if(!smtpReady())return {status:'smtp_not_configured',sent:0};
 const due=await query(
  "SELECT i.*,b.name AS business_name,l.consent FROM invoices i JOIN businesses b ON b.id=i.business_id JOIN leads l ON l.id=i.lead_id WHERE i.status='unpaid' AND i.due_at<=now() AND l.consent=true AND (i.last_reminded_at IS NULL OR i.last_reminded_at<now()-interval '7 days') ORDER BY i.due_at ASC LIMIT $1",
  [Math.max(1,Math.min(10,maxInvoices))]
 );
 let sent=0,failed=0;
 for(const invoice of due.rows){
  const blocked=await query('SELECT 1 FROM optouts WHERE business_id=$1 AND email=$2',[invoice.business_id,invoice.email.toLowerCase()]);
  if(blocked.rowCount)continue;
  const amount=(Number(invoice.amount_cents)/100).toFixed(2);
  const paymentLink=invoice.payment_url&&/^https:\/\//i.test(invoice.payment_url)?'\nSecure payment link: '+invoice.payment_url:'';
  const subject='Invoice payment reminder — '+invoice.business_name;
  const body='Hello '+invoice.customer_name+',\n\nOur records show an unpaid invoice from '+invoice.business_name+' for $'+amount+', due '+new Date(invoice.due_at).toISOString().slice(0,10)+'.'+paymentLink+'\n\nIf you have already paid or believe this is incorrect, please reply so we can investigate.\n\n'+invoice.business_name;
  try{
   const messageId=await sendMail({to:invoice.email,subject,body});
   await query('UPDATE invoices SET reminded_count=reminded_count+1,last_reminded_at=now() WHERE id=$1',[invoice.id]);
   await query("INSERT INTO correspondence(business_id,direction,sender,recipient,subject,body,status,provider_message_id) VALUES($1,'outbound',$2,$3,$4,$5,'sent',$6)",
    [invoice.business_id,process.env.SENDER_EMAIL||'contact.badblue@gmail.com',invoice.email,subject,body,messageId||null]);
   sent++;
  }catch(error){failed++;console.warn('Invoice reminder delivery failed:',String(error.message).slice(0,150));}
 }
 return {status:'processed',sent,failed};
}

export async function cycle(){
 const out={started_at:new Date().toISOString(),scans:[],jobs:[],inbound:null};
 out.scans=await discoverAndAnalyze();
 out.jobs=await processDueJobs();
 try{out.outbound=await deliverPendingEmail({maxMessages:4});}catch(error){out.outbound={status:'error',message:String(error.message).slice(0,150)}}
 try{out.invoices=await processInvoiceReminders();}catch(error){out.invoices={status:'error',message:String(error.message).slice(0,150)}}
 try{out.inbound=await pollInbox({maxMessages:12});}catch(e){out.inbound={status:'error',message:String(e.message).slice(0,180)};}
 return out;
}
