import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import nodemailer from 'nodemailer';
import {ImapFlow} from 'imapflow';
import {query} from './db.mjs';

export const BADBLUE_EMAIL='contact.badblue@gmail.com';
const CONFIG_NAME='badblue-gmail';
let loaded=false,lastLoad=0;
function encryptionKey(){
  const raw=process.env.MAIL_ENCRYPTION_KEY;
  if(typeof raw!=='string'||!/^[a-f0-9]{64}$/i.test(raw))throw Error('Encrypted mail storage is not configured on the server');
  return Buffer.from(raw,'hex');
}

export function sealMailPassword(value){
  const plain=String(value||'');
  if(!plain||plain.length>200)throw Error('Invalid Gmail application password');
  const iv=randomBytes(12);
  const cipher=createCipheriv('aes-256-gcm',encryptionKey(),iv);
  const encrypted=Buffer.concat([cipher.update(plain,'utf8'),cipher.final()]);
  return ['v1',iv.toString('base64url'),cipher.getAuthTag().toString('base64url'),encrypted.toString('base64url')].join('.');
}
export function openMailPassword(payload){
  const [v,iv,tag,body]=String(payload||'').split('.');
  if(v!=='v1'||!iv||!tag||!body)throw Error('Saved Gmail credentials are malformed');
  const decipher=createDecipheriv('aes-256-gcm',encryptionKey(),Buffer.from(iv,'base64url'));
  decipher.setAuthTag(Buffer.from(tag,'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(body,'base64url')),decipher.final()]).toString('utf8');
}
export function normalizeGmailAppPassword(value){
  const str=String(value||'').replace(/\s+/g,'');
  if(!/^[a-zA-Z0-9]{16}$/.test(str))throw Error('Enter the 16-character Google app password, not the normal Gmail password');
  return str;
}
export async function getMailConnection(){
 const r=await query('SELECT account_email,verified_at,postal_address,outreach_enabled,ai_replies_enabled,updated_at FROM mail_connections WHERE connection_name=$1',[CONFIG_NAME]);
 const row=r.rows[0];
 return row?{connected:true,...row}:{connected:false,account_email:BADBLUE_EMAIL,verified_at:null,postal_address:'',outreach_enabled:false,ai_replies_enabled:false};
}
function applyEnvironment(password,{postal_address='',outreach_enabled=false,ai_replies_enabled=false}={}){
 process.env.SMTP_HOST='smtp.gmail.com';
 process.env.SMTP_PORT='465';
 process.env.SMTP_USER=BADBLUE_EMAIL;
 process.env.SMTP_PASSWORD=password;
 process.env.IMAP_HOST='imap.gmail.com';
 process.env.IMAP_PORT='993';
 process.env.IMAP_USER=BADBLUE_EMAIL;
 process.env.IMAP_PASSWORD=password;
 process.env.SENDER_EMAIL=BADBLUE_EMAIL;
 process.env.BUSINESS_POSTAL_ADDRESS=postal_address||'';
 process.env.AUTO_OUTREACH=outreach_enabled?'true':'false';
 process.env.AI_AUTO_REPLIES_ENABLED=ai_replies_enabled?'true':'false';
}
export async function loadMailConnection({force=false}={}){
 if(loaded&&!force&&Date.now()-lastLoad<30000)return Boolean(process.env.SMTP_PASSWORD&&process.env.IMAP_PASSWORD);
 try{encryptionKey();}catch{return false;}
 const r=await query('SELECT secret_encrypted,postal_address,outreach_enabled,ai_replies_enabled FROM mail_connections WHERE connection_name=$1',[CONFIG_NAME]);
 if(!r.rowCount){for(const name of ['SMTP_HOST','SMTP_PORT','SMTP_USER','SMTP_PASSWORD','IMAP_HOST','IMAP_PORT','IMAP_USER','IMAP_PASSWORD'])delete process.env[name];process.env.AUTO_OUTREACH='false';process.env.AI_AUTO_REPLIES_ENABLED='false';loaded=true;lastLoad=Date.now();return false;}
 try{
  applyEnvironment(openMailPassword(r.rows[0].secret_encrypted),r.rows[0]);
  loaded=true;lastLoad=Date.now();return true;
 }catch(error){
  console.error('Stored mail connection could not be decrypted; credentials must be reconnected');
  loaded=false;return false;
 }
}

const VERIFIED_MAIL_STAGES=new Set(['smtp','imap']);
export function classifyGmailFailure(error,stage){
 const protocol=VERIFIED_MAIL_STAGES.has(stage)?stage:'verification';
 const code=String(error?.code||'').toUpperCase();
 const responseCode=Number(error?.responseCode||0);
 const details=[error?.response,error?.responseText,error?.message].filter(x=>typeof x==='string').join(' ').slice(0,2200);
 const isAuth=code==='EAUTH'||[534,535].includes(responseCode)||/AUTHENTICATIONFAILED|Invalid credentials|Username and Password not accepted|Application-specific password required|Invalid login|login failed|authenticate|auth failed/i.test(details);
 const isTimeout=['ETIMEDOUT','ESOCKETTIMEDOUT','ETIMEOUT'].includes(code)||/timed out|timeout/i.test(details);
 const isTls=['CERT_HAS_EXPIRED','UNABLE_TO_VERIFY_LEAF_SIGNATURE','SELF_SIGNED_CERT_IN_CHAIN','ERR_TLS_CERT_ALTNAME_INVALID'].includes(code)||/TLS handshake|certificate verify/i.test(details);
 const isNetwork=['ECONNREFUSED','ENETUNREACH','EHOSTUNREACH','ECONNRESET','ENOTFOUND','EAI_AGAIN','ESOCKET'].includes(code)||/getaddrinfo|socket hang up|connection closed/i.test(details);
 const label=protocol==='imap'?'incoming IMAP':'outgoing SMTP';
 if(isAuth) return {
  code:protocol+'_auth_rejected',
  stage:protocol,
  message:'Google rejected the '+label+' sign-in. Create a new App Password while signed into contact.badblue@gmail.com, paste its 16 characters, and verify this specific account permits mail-app access. Your ordinary Gmail password cannot be used here.'
 };
 if(isTimeout)return {
  code:protocol+'_timeout',stage:protocol,
  message:'The '+label+' connection timed out before verification finished. Gmail may be temporarily unavailable or blocking this network route; please retry later.'
 };
 if(isTls)return {
  code:protocol+'_tls_failure',stage:protocol,
  message:'The '+label+' TLS connection could not be verified securely. Server certificate or transport configuration must be repaired; do not disable TLS verification.'
 };
 if(isNetwork)return {
  code:protocol+'_network_failure',stage:protocol,
  message:'The '+label+' connection failed at the network layer. This is not evidence that your Gmail App Password is incorrect.'
 };
 return {
  code:protocol+'_verification_failed',stage:protocol,
  message:'The '+label+' verification failed unexpectedly. Check the Google App Password and server logs for this stage; no password has been saved.'
 };
}
export function describeGmailFailure(error){
 if(error?.safeGmailFailure===true&&typeof error.code==='string'&&typeof error.message==='string'){
  return {code:error.code,stage:error.stage,message:error.message};
 }
 return {
  code:'verification_error',stage:'verification',
  message:'Gmail verification could not be completed. Generate an App Password for contact.badblue@gmail.com; ordinary Gmail passwords do not work for SMTP/IMAP.'
 };
}
function verifiedFailure(error,stage){
 const diagnostic=classifyGmailFailure(error,stage);
 const failure=new Error(diagnostic.message);
 failure.code=diagnostic.code;
 failure.stage=diagnostic.stage;
 failure.safeGmailFailure=true;
 return failure;
}

export async function verifyGmailAppPassword(password,{timeoutMs=15000}={}){
 const credential=normalizeGmailAppPassword(password);
 const transport=nodemailer.createTransport({
  host:'smtp.gmail.com',port:465,secure:true,
  auth:{user:BADBLUE_EMAIL,pass:credential},
  connectionTimeout:timeoutMs,greetingTimeout:timeoutMs,socketTimeout:timeoutMs
 });
 let smtpVerified=false,imapVerified=false;
 try{await transport.verify();smtpVerified=true;}
 catch(error){throw verifiedFailure(error,'smtp');}
 finally{transport.close();}
 const client=new ImapFlow({
  host:'imap.gmail.com',port:993,secure:true,
  auth:{user:BADBLUE_EMAIL,pass:credential},
  logger:false,connectionTimeout:timeoutMs,greetingTimeout:timeoutMs,socketTimeout:timeoutMs
 });
 try{await client.connect();imapVerified=true;}
 catch(error){throw verifiedFailure(error,'imap');}
 finally{await client.logout().catch(()=>{});}
 return {smtpVerified,imapVerified};
}
export async function connectMail({password,postalAddress='',outreach=false,aiReplies=false}){
 const normalized=normalizeGmailAppPassword(password);
 const postal=String(postalAddress||'').replace(/[\r\n\t]/g,' ').trim().slice(0,350);
 if(outreach&&postal.length<10)throw Error('A real business postal address is required before cold outreach can be enabled');
 // Verify SMTP and IMAP without sending any email.
 await verifyGmailAppPassword(normalized);
 const encrypted=sealMailPassword(normalized);
 await query("INSERT INTO mail_connections(connection_name,account_email,secret_encrypted,verified_at,postal_address,outreach_enabled,ai_replies_enabled) VALUES($1,$2,$3,now(),$4,$5,$6) ON CONFLICT(connection_name) DO UPDATE SET secret_encrypted=EXCLUDED.secret_encrypted,verified_at=now(),postal_address=EXCLUDED.postal_address,outreach_enabled=EXCLUDED.outreach_enabled,ai_replies_enabled=EXCLUDED.ai_replies_enabled,updated_at=now()",[CONFIG_NAME,BADBLUE_EMAIL,encrypted,postal,outreach,aiReplies]);
 applyEnvironment(normalized,{postal_address:postal,outreach_enabled:outreach,ai_replies_enabled:aiReplies});
 loaded=true;lastLoad=Date.now();
 return {smtpVerified:true,imapVerified:true};
}
export async function updateMailOptions({postalAddress='',outreach=false,aiReplies=false}){
 const postal=String(postalAddress||'').replace(/[\r\n\t]/g,' ').trim().slice(0,350);
 if(outreach&&postal.length<10)throw Error('A real business postal address is required before cold outreach can be enabled');
 const r=await query("UPDATE mail_connections SET postal_address=$2,outreach_enabled=$3,ai_replies_enabled=$4,updated_at=now() WHERE connection_name=$1 RETURNING secret_encrypted",[CONFIG_NAME,postal,outreach,aiReplies]);
 if(!r.rowCount)throw Error('Connect the Gmail mailbox before setting automation options');
 applyEnvironment(openMailPassword(r.rows[0].secret_encrypted),{postal_address:postal,outreach_enabled:outreach,ai_replies_enabled:aiReplies});
 loaded=true;lastLoad=Date.now();
}
export async function disconnectMail(){
 await query('DELETE FROM mail_connections WHERE connection_name=$1',[CONFIG_NAME]);
 for(const key of ['SMTP_HOST','SMTP_PORT','SMTP_USER','SMTP_PASSWORD','IMAP_HOST','IMAP_PORT','IMAP_USER','IMAP_PASSWORD','SENDER_EMAIL','BUSINESS_POSTAL_ADDRESS'])delete process.env[key];
 process.env.AUTO_OUTREACH='false';
 process.env.AI_AUTO_REPLIES_ENABLED='false';
 loaded=false;lastLoad=0;
}
