import nodemailer from 'nodemailer';
import {ImapFlow} from 'imapflow';
import {simpleParser} from 'mailparser';
import {query} from './db.mjs';
import {isValidEmail} from './security.mjs';
import {draftReply} from './ai.mjs';

const FROM=process.env.SENDER_EMAIL||'contact.badblue@gmail.com';
export function smtpReady(){return !!(process.env.SMTP_HOST&&process.env.SMTP_USER&&process.env.SMTP_PASSWORD);}
export function imapReady(){return !!(process.env.IMAP_HOST&&process.env.IMAP_USER&&(process.env.IMAP_PASSWORD||process.env.SMTP_PASSWORD));}
export function outreachReady(){
  return smtpReady()&&process.env.AUTO_OUTREACH==='true'&&!!process.env.BUSINESS_POSTAL_ADDRESS;
}
function safeHeader(v){return String(v||'').replace(/[\r\n]+/g,' ').slice(0,150);}
export function footer(){return '\n\nAI Revenue Recovery | Bad Blue\n'+(process.env.BUSINESS_POSTAL_ADDRESS||'')+'\nTo opt out of further messages, reply with "unsubscribe".';}
let transport;
export function closeMailTransport(){if(transport){transport.close();transport=undefined;}}
function getTransport(){
  if(!smtpReady())throw Error('SMTP mail delivery is not configured');
  if(!transport)transport=nodemailer.createTransport({
    host:process.env.SMTP_HOST,port:Number(process.env.SMTP_PORT||465),secure:Number(process.env.SMTP_PORT||465)===465,
    auth:{user:process.env.SMTP_USER,pass:process.env.SMTP_PASSWORD},pool:true,maxConnections:2,maxMessages:30
  });
  return transport;
}
export async function sendMail({to,subject,body,replyToMessageId}){
  if(!isValidEmail(to))throw Error('Invalid recipient address');
  const opts={from:FROM,to,subject:safeHeader(subject),text:String(body||'').slice(0,12000),replyTo:FROM};
  if(replyToMessageId&&/^<[^<> \r\n]+>$/.test(replyToMessageId))opts.inReplyTo=replyToMessageId;
  const result=await getTransport().sendMail(opts);
  if(!result.accepted?.some(v=>v.toLowerCase()===to.toLowerCase()))throw Error('SMTP did not accept recipient');
  return result.messageId||'';
}
export async function createOutreach(business,prospect,analysis,{send=false}={}){
  const email=String(prospect.contact_email||'').toLowerCase().trim();
  if(!email||!isValidEmail(email))return {status:'no_public_email'};
  const blocked=await query('SELECT 1 FROM optouts WHERE business_id=$1 AND email=$2',[business.id,email]);
  if(blocked.rowCount)return {status:'opted_out'};
  const prior=await query("SELECT 1 FROM correspondence WHERE business_id=$1 AND recipient=$2 AND direction='outbound' LIMIT 1",[business.id,email]);
  if(prior.rowCount)return {status:'already_contacted'};
  let body=String(analysis.email_body||'').trim();
  if(!body)return {status:'no_analysis_draft'};
  if(!body.includes('$299'))body+='\n\nOur service is $299 per month.';
  body+=footer();
  const subject=safeHeader(analysis.email_subject||'Sales recovery opportunities');
  const rec=await query("INSERT INTO correspondence(business_id,prospect_id,direction,sender,recipient,subject,body,status) VALUES($1,$2,'outbound',$3,$4,$5,$6,'draft') RETURNING id",[business.id,prospect.id,FROM,email,subject,body]);
  if(!send||!outreachReady())return {status:'draft_saved',id:rec.rows[0].id};
  try{
    const dayCount=await query("SELECT count(*)::int AS n FROM correspondence WHERE direction='outbound' AND status='sent' AND sender=$1 AND created_at>now()-interval '24 hours'",[FROM]);
    if(dayCount.rows[0].n>=Math.max(1,Number(process.env.MAX_OUTREACH_PER_DAY)||10))return {status:'rate_capped'};
    const id=await sendMail({to:email,subject,body});
    await query("UPDATE correspondence SET status='sent',provider_message_id=$2 WHERE id=$1",[rec.rows[0].id,id||null]);
    await query("UPDATE prospects SET contacted_at=now(),status='contacted' WHERE id=$1",[prospect.id]);
    return {status:'sent',message_id:id};
  }catch(err){
    await query("UPDATE correspondence SET status='error' WHERE id=$1",[rec.rows[0].id]);
    console.warn('Outbound email failed',String(err).slice(0,120));
    return {status:'error',reason:err.message};
  }
}
function optOut(text){return /^\s*(stop|unsubscribe|remove me|do not contact|don't contact|please remove me)\b/i.test(String(text||''))||/unsubscribe me|please stop (emailing|contacting)/i.test(String(text||''));}
export async function processInbound({from,subject,body,messageId,inReplyTo}){
  const sender=String(from||'').toLowerCase().trim();
  const text=String(body||'').trim().slice(0,10000);
  if(!isValidEmail(sender)||!text||sender===FROM.toLowerCase())return {status:'ignored'};
  if(messageId){
    const done=await query("SELECT 1 FROM correspondence WHERE provider_message_id=$1",[messageId]);
    if(done.rowCount)return {status:'duplicate'};
  }
  // Reply only to an address with a recorded relationship; never reply to unrelated inbox mail.
  const previous=await query(
    "SELECT c.business_id,c.prospect_id,c.lead_id,b.name as business_name FROM correspondence c JOIN businesses b ON b.id=c.business_id WHERE c.recipient=$1 AND c.direction='outbound' AND c.status='sent' ORDER BY c.created_at DESC LIMIT 1",
    [sender]
  );
  if(!previous.rowCount)return {status:'not_a_platform_conversation'};
  const p=previous.rows[0];
  const isOptOut=optOut(text);
  const input=await query("INSERT INTO correspondence(business_id,prospect_id,lead_id,direction,sender,recipient,subject,body,status,provider_message_id) VALUES($1,$2,$3,'inbound',$4,$5,$6,$7,'received',$8) RETURNING id",[p.business_id,p.prospect_id,p.lead_id,sender,FROM,safeHeader(subject),text,messageId||null]);
  if(isOptOut){
    await query('INSERT INTO optouts(business_id,email,reason) VALUES($1,$2,$3) ON CONFLICT(business_id,email) DO NOTHING',[p.business_id,sender,'requested by reply']);
    await query("UPDATE correspondence SET status='opted_out' WHERE id=$1",[input.rows[0].id]);
    return {status:'opted_out'};
  }
  if(/^(auto:|automatic reply|out of office|delivery status|undeliverable)/i.test(subject||''))return {status:'auto_reply_ignored'};
  if(process.env.AI_AUTO_REPLIES_ENABLED!=='true')return {status:'received_awaiting_authorization'};
  const history=await query("SELECT direction,subject,body FROM correspondence WHERE business_id=$1 AND (sender=$2 OR recipient=$2) ORDER BY created_at DESC LIMIT 8",[p.business_id,sender]);
  let answer;
  try{answer=await draftReply(history.rows.reverse(),{name:p.business_name});}catch(err){console.warn('AI reply unavailable',err.message);return {status:'ai_unavailable'};}
  const out=await query("INSERT INTO correspondence(business_id,prospect_id,lead_id,direction,sender,recipient,subject,body,status,reply_to_id) VALUES($1,$2,$3,'outbound',$4,$5,$6,$7,'draft',$8) RETURNING id",[p.business_id,p.prospect_id,p.lead_id,FROM,sender,safeHeader('Re: '+String(subject||'AI Revenue Recovery')),answer,inReplyTo||messageId||null]);
  if(!smtpReady())return {status:'reply_drafted'};
  const id=await sendMail({to:sender,subject:'Re: '+safeHeader(subject||'AI Revenue Recovery'),body:answer+footer(),replyToMessageId:messageId});
  await query("UPDATE correspondence SET status='sent',provider_message_id=$2 WHERE id=$1",[out.rows[0].id,id||null]);
  return {status:'replied'};
}
export async function deliverPendingEmail({maxMessages=4}={}){
 if(!smtpReady())return {status:'smtp_not_configured',sent:0};
 const candidates=await query(
  "SELECT * FROM correspondence WHERE direction='outbound' AND status IN ('draft','retry') AND send_attempts<4 AND (last_send_attempt_at IS NULL OR last_send_attempt_at<now()-interval '15 minutes') ORDER BY created_at ASC LIMIT $1",
  [Math.max(1,Math.min(maxMessages,10))]
 );
 let sent=0,skipped=0,failed=0;
 for(const c of candidates.rows){
  const prospecting=!!c.prospect_id&&!c.reply_to_id&&!c.lead_id;
  if(prospecting&&!outreachReady()){skipped++;continue;}
  if(c.reply_to_id&&process.env.AI_AUTO_REPLIES_ENABLED!=='true'){skipped++;continue;}
  const blocked=await query('SELECT 1 FROM optouts WHERE business_id=$1 AND email=$2',[c.business_id,c.recipient.toLowerCase()]);
  if(blocked.rowCount){await query("UPDATE correspondence SET status='opted_out' WHERE id=$1",[c.id]);skipped++;continue;}
  if(prospecting){
   const prior=await query("SELECT 1 FROM correspondence WHERE business_id=$1 AND recipient=$2 AND direction='outbound' AND status='sent' LIMIT 1",[c.business_id,c.recipient]);
   if(prior.rowCount){await query("UPDATE correspondence SET status='skipped_duplicate' WHERE id=$1",[c.id]);skipped++;continue;}
   const count=await query("SELECT count(*)::int AS n FROM correspondence WHERE direction='outbound' AND status='sent' AND sender=$1 AND created_at>now()-interval '24 hours'",[FROM]);
   if(count.rows[0].n>=Math.max(1,Number(process.env.MAX_OUTREACH_PER_DAY)||10))break;
  }
  const claim=await query("UPDATE correspondence SET status='sending',send_attempts=send_attempts+1,last_send_attempt_at=now() WHERE id=$1 AND status IN ('draft','retry') RETURNING *",[c.id]);
  if(!claim.rowCount)continue;
  try{
   const messageId=await sendMail({to:c.recipient,subject:c.subject,body:c.body,replyToMessageId:c.reply_to_id});
   await query("UPDATE correspondence SET status='sent',provider_message_id=$2,send_error='' WHERE id=$1",[c.id,messageId||null]);
   if(c.prospect_id)await query("UPDATE prospects SET contacted_at=now(),status='contacted' WHERE id=$1",[c.prospect_id]);
   sent++;
  }catch(error){
   await query("UPDATE correspondence SET status='retry',send_error=$2 WHERE id=$1",[c.id,String(error.message||error).slice(0,300)]);
   failed++;
  }
 }
 return {status:'processed',sent,skipped,failed};
}
export async function pollInbox({maxMessages=20}={}){
 if(!imapReady())return {status:'imap_not_configured',examined:0,handled:0};
 const mailbox=process.env.IMAP_USER.toLowerCase().trim();
 const client=new ImapFlow({host:process.env.IMAP_HOST,port:Number(process.env.IMAP_PORT||993),secure:true,
    auth:{user:process.env.IMAP_USER,pass:process.env.IMAP_PASSWORD||process.env.SMTP_PASSWORD},logger:false});
 let examined=0,handled=0;
 try{
  await client.connect();
  const lock=await client.getMailboxLock('INBOX');
  try{
   const validity=String(client.mailbox?.uidValidity||'');
   const existing=await query('SELECT uid_validity,last_uid FROM inbox_poll_state WHERE mailbox=$1',[mailbox]);
   let cursor=existing.rowCount&&existing.rows[0].uid_validity===validity?Number(existing.rows[0].last_uid):0;
   const uids=await client.search({since:new Date(Date.now()-10*24*3600*1000)},{uid:true});
   const recent=uids.filter(uid=>uid>cursor).sort((a,b)=>a-b);
   const fresh=(cursor===0&&recent.length>100?recent.slice(-100):recent).slice(0,Math.min(40,Math.max(1,maxMessages)));
   for(const uid of fresh){
    const raw=await client.fetchOne(uid,{source:true,envelope:true},{uid:true});
    if(raw?.source){
     examined++;
     const msg=await simpleParser(raw.source);
     if(!msg.headers?.get('auto-submitted')||msg.headers.get('auto-submitted')==='no'){
      const result=await processInbound({from:msg.from?.value?.[0]?.address||'',subject:msg.subject||'',body:msg.text||'',messageId:msg.messageId||undefined,inReplyTo:msg.inReplyTo||undefined});
      if(['replied','reply_drafted','opted_out'].includes(result.status))handled++;
     }
    }
    // Advance after processing, so messages are not silently lost during a failed run.
    cursor=uid;
    await query("INSERT INTO inbox_poll_state(mailbox,uid_validity,last_uid) VALUES($1,$2,$3) ON CONFLICT(mailbox) DO UPDATE SET uid_validity=EXCLUDED.uid_validity,last_uid=EXCLUDED.last_uid,updated_at=now()",[mailbox,validity,cursor]);
   }
  }finally{lock.release();}
  return {status:'ok',examined,handled};
 }finally{await client.logout().catch(()=>{});}
}
