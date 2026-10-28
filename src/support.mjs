import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {validateWorkspace} from './security.mjs';
import {extendSupport} from './support-extensions.mjs';

const EMAIL=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LOCALE=/^[a-z]{2}(?:-[A-Z]{2})?$/;
const STATUS=new Set(['open','pending','resolved']);
const PRIORITY=new Set(['low','normal','high','urgent']);
const STOP=new Set(['a','an','and','are','can','could','do','does','for','how','i','in','is','me','my','of','on','or','our','please','the','there','to','we','what','when','where','which','with','you','your']);
const DAY=86_400_000;
const sql=`CREATE TABLE IF NOT EXISTS support_articles(
 workspace TEXT NOT NULL,id TEXT NOT NULL,question TEXT NOT NULL,answer TEXT NOT NULL,
 locale TEXT NOT NULL DEFAULT 'en',active INTEGER NOT NULL DEFAULT 1,
 created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,PRIMARY KEY(workspace,id));
CREATE INDEX IF NOT EXISTS support_articles_active ON support_articles(workspace,locale,active);
CREATE TABLE IF NOT EXISTS support_settings(
 workspace TEXT PRIMARY KEY,business_name TEXT NOT NULL DEFAULT 'Customer support',
 greeting TEXT NOT NULL DEFAULT 'Hello! How may we help you today?',
 business_hours TEXT NOT NULL DEFAULT '',default_locale TEXT NOT NULL DEFAULT 'en',
 brand_color TEXT NOT NULL DEFAULT '#5264d8');
CREATE TABLE IF NOT EXISTS support_tickets(
 workspace TEXT NOT NULL,id TEXT NOT NULL,session_hash TEXT NOT NULL,
 name TEXT NOT NULL DEFAULT '',email TEXT NOT NULL DEFAULT '',
 subject TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'open'
  CHECK(status IN ('open','pending','resolved')),
 priority TEXT NOT NULL DEFAULT 'normal'
  CHECK(priority IN ('low','normal','high','urgent')),
 assigned_to TEXT NOT NULL DEFAULT '',channel TEXT NOT NULL DEFAULT 'web',
 automated_responses INTEGER NOT NULL DEFAULT 0,first_agent_at INTEGER,
 created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,
 PRIMARY KEY(workspace,id));
CREATE INDEX IF NOT EXISTS support_tickets_status ON support_tickets(workspace,status,updated_at);
CREATE INDEX IF NOT EXISTS support_tickets_email ON support_tickets(workspace,email);
CREATE TABLE IF NOT EXISTS support_messages(
 workspace TEXT NOT NULL,id TEXT NOT NULL,ticket_id TEXT NOT NULL,
 sender TEXT NOT NULL CHECK(sender IN ('customer','assistant','agent')),
 body TEXT NOT NULL,created_at INTEGER NOT NULL,
 PRIMARY KEY(workspace,id),
 FOREIGN KEY(workspace,ticket_id) REFERENCES support_tickets(workspace,id) ON DELETE CASCADE);
CREATE INDEX IF NOT EXISTS support_messages_ticket ON support_messages(workspace,ticket_id,created_at);
CREATE TABLE IF NOT EXISTS support_ratings(
 workspace TEXT NOT NULL,ticket_id TEXT NOT NULL,rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
 feedback TEXT NOT NULL DEFAULT '',updated_at INTEGER NOT NULL,
 PRIMARY KEY(workspace,ticket_id),
 FOREIGN KEY(workspace,ticket_id) REFERENCES support_tickets(workspace,id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS support_leads(
 workspace TEXT NOT NULL,ticket_id TEXT NOT NULL,
 name TEXT NOT NULL,email TEXT NOT NULL,inquiry TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'new'
 CHECK(status IN ('new','contacted','qualified','closed')),
 created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,
 PRIMARY KEY(workspace,ticket_id),
 FOREIGN KEY(workspace,ticket_id) REFERENCES support_tickets(workspace,id) ON DELETE CASCADE);
CREATE INDEX IF NOT EXISTS support_leads_status ON support_leads(workspace,status,created_at);
CREATE TABLE IF NOT EXISTS support_appointments(
 workspace TEXT NOT NULL,id TEXT NOT NULL,ticket_id TEXT NOT NULL,
 service TEXT NOT NULL,requested_at TEXT NOT NULL,timezone TEXT NOT NULL,
 notes TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'requested'
 CHECK(status IN ('requested','reviewing','declined','handled')),
 created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,
 PRIMARY KEY(workspace,id),
 FOREIGN KEY(workspace,ticket_id) REFERENCES support_tickets(workspace,id) ON DELETE CASCADE);
CREATE INDEX IF NOT EXISTS support_appointments_status ON support_appointments(workspace,status,created_at);`;

function fault(status,message){const e=Error(message);e.status=status;throw e;}
function requiredText(value,max,name){
 if(typeof value!=='string'||!value.trim()||value.length>max)fault(400,'Invalid '+name);
 return value.trim();
}
function optionalText(value,max,name){
 if(value===undefined||value===null)return '';
 if(typeof value!=='string'||value.length>max)fault(400,'Invalid '+name);
 return value.trim();
}
function emailField(value){
 const email=optionalText(value,254,'email').toLowerCase();
 if(email&&!EMAIL.test(email))fault(400,'Invalid email');
 return email;
}
function validLocale(value){if(typeof value!=='string'||!LOCALE.test(value))fault(400,'Invalid locale');return value;}
function validId(value){if(typeof value!=='string'||!/^[0-9a-f-]{36}$/i.test(value))fault(400,'Invalid identifier');return value;}
function digest(token){return createHash('sha256').update(token).digest('hex');}
function tokens(text){return [...new Set((text.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu)||[]).filter(w=>!STOP.has(w)))];}
function matchArticle(message,articles){
 const words=tokens(message);if(!words.length)return null;
 const ranked=articles.map(a=>{
  const topic=tokens(a.question);
  const hits=topic.filter(w=>words.includes(w)).length;
  return {article:a,score:topic.length?hits/topic.length:0,hits};
 }).filter(x=>x.hits>0&&x.score>=0.5).sort((a,b)=>b.score-a.score||b.hits-a.hits);
 return ranked[0]?.article||null;
}
function articleView(row){return {id:row.id,question:row.question,answer:row.answer,locale:row.locale,category:row.category||'',active:!!row.active,createdAt:row.created_at,updatedAt:row.updated_at};}
function leadView(row){return {ticketId:row.ticket_id,name:row.name,email:row.email,inquiry:row.inquiry,status:row.status,createdAt:row.created_at,updatedAt:row.updated_at};}
function appointmentView(row){return {id:row.id,ticketId:row.ticket_id,service:row.service,requestedAt:row.requested_at,timezone:row.timezone,notes:row.notes,status:row.status,confirmed:false,createdAt:row.created_at,updatedAt:row.updated_at};}
function ticketView(row){return {id:row.id,name:row.name,email:row.email,subject:row.subject,status:row.status,priority:row.priority,assignedTo:row.assigned_to,channel:row.channel,automatedResponses:row.automated_responses,createdAt:row.created_at,updatedAt:row.updated_at,firstAgentAt:row.first_agent_at,lastMessage:row.last_message??undefined};}

export function createSupport(db,{responder=null,onEvent=null,clock=()=>Date.now()}={}){
 db.exec(sql);
 const settingsColumns=new Set(db.prepare('PRAGMA table_info(support_settings)').all().map(row=>row.name));
 for(const [column,definition] of [
  ['logo_text',"TEXT NOT NULL DEFAULT 'A+'"],
  ['greeting_es',"TEXT NOT NULL DEFAULT '¡Hola! ¿En qué podemos ayudarte hoy?'"],
  ['greeting_fr',"TEXT NOT NULL DEFAULT 'Bonjour ! Comment pouvons-nous vous aider ?'"]
 ]){
  if(!settingsColumns.has(column))db.exec('ALTER TABLE support_settings ADD COLUMN '+column+' '+definition);
 }
 let enhanced=null;
 const one=(query,...args)=>db.prepare(query).get(...args);
 const all=(query,...args)=>db.prepare(query).all(...args);
 const run=(query,...args)=>db.prepare(query).run(...args);
 function ticket(workspace,id){
  validateWorkspace(workspace);validId(id);
  const found=one('SELECT * FROM support_tickets WHERE workspace=? AND id=?',workspace,id);
  if(!found)fault(404,'Ticket not found');
  return found;
 }
 function notify(workspace,event,id){
  enhanced?.onSupportEvent(workspace,event,id);
  if(typeof onEvent!=='function')return;
  const t=ticket(workspace,id);
  const data={ticket:{id:t.id,status:t.status,priority:t.priority,channel:t.channel}};
  try{Promise.resolve(onEvent(workspace,event,data)).catch(()=>console.warn('Support workflow event failed'));}
  catch{console.warn('Support workflow event failed');}
 }
 function messages(workspace,id){
  return all('SELECT id,sender,body,created_at AS createdAt FROM support_messages WHERE workspace=? AND ticket_id=? ORDER BY created_at,id LIMIT 200',workspace,id);
 }
 function settings(workspace){
  validateWorkspace(workspace);
  const row=one('SELECT * FROM support_settings WHERE workspace=?',workspace);
  return row?{businessName:row.business_name,greeting:row.greeting,greetingEs:row.greeting_es,greetingFr:row.greeting_fr,logoText:row.logo_text,businessHours:row.business_hours,defaultLocale:row.default_locale,brandColor:row.brand_color}:
   {businessName:'Customer support',greeting:'Hello! How may we help you today?',greetingEs:'¡Hola! ¿En qué podemos ayudarte hoy?',greetingFr:'Bonjour ! Comment pouvons-nous vous aider ?',logoText:'A+',businessHours:'',defaultLocale:'en',brandColor:'#5264d8'};
 }
 function updateSettings(workspace,payload){
  validateWorkspace(workspace);
  if(!payload||typeof payload!=='object'||Array.isArray(payload))fault(400,'Invalid settings');
  const previous=settings(workspace);
  const current={
   businessName:payload.businessName===undefined?previous.businessName:requiredText(payload.businessName,100,'business name'),
   greeting:payload.greeting===undefined?previous.greeting:requiredText(payload.greeting,500,'greeting'),
   greetingEs:payload.greetingEs===undefined?previous.greetingEs:requiredText(payload.greetingEs,500,'Spanish greeting'),
   greetingFr:payload.greetingFr===undefined?previous.greetingFr:requiredText(payload.greetingFr,500,'French greeting'),
   logoText:payload.logoText===undefined?previous.logoText:requiredText(payload.logoText,20,'logo text'),
   businessHours:payload.businessHours===undefined?previous.businessHours:optionalText(payload.businessHours,500,'business hours'),
   defaultLocale:payload.defaultLocale===undefined?previous.defaultLocale:validLocale(payload.defaultLocale),
   brandColor:payload.brandColor===undefined?previous.brandColor:payload.brandColor
  };
  if(typeof current.brandColor!=='string'||!/^#[0-9a-f]{6}$/i.test(current.brandColor))fault(400,'Invalid brand color');
  run('INSERT INTO support_settings(workspace,business_name,greeting,greeting_es,greeting_fr,logo_text,business_hours,default_locale,brand_color) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(workspace) DO UPDATE SET business_name=excluded.business_name,greeting=excluded.greeting,greeting_es=excluded.greeting_es,greeting_fr=excluded.greeting_fr,logo_text=excluded.logo_text,business_hours=excluded.business_hours,default_locale=excluded.default_locale,brand_color=excluded.brand_color',
   workspace,current.businessName,current.greeting,current.greetingEs,current.greetingFr,current.logoText,current.businessHours,current.defaultLocale,current.brandColor);
  return current;
 }
 function listArticles(workspace){
  validateWorkspace(workspace);
  return all('SELECT * FROM support_articles WHERE workspace=? ORDER BY updated_at DESC LIMIT 500',workspace).map(articleView);
 }
 function addArticle(workspace,payload){
  validateWorkspace(workspace);
  const question=requiredText(payload?.question,500,'question');
  const answer=requiredText(payload?.answer,4000,'answer');
  const locale=validLocale(payload.locale??'en');
  const category=optionalText(payload.category,80,'category');
  if(payload.active!==undefined&&typeof payload.active!=='boolean')fault(400,'Invalid active flag');
  const id=randomUUID(),time=clock();
  run('INSERT INTO support_articles(workspace,id,question,answer,locale,category,active,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)',workspace,id,question,answer,locale,category,payload.active===false?0:1,time,time);
  return articleView(one('SELECT * FROM support_articles WHERE workspace=? AND id=?',workspace,id));
 }
 function editArticle(workspace,id,payload){
  validateWorkspace(workspace);validId(id);
  const existing=one('SELECT * FROM support_articles WHERE workspace=? AND id=?',workspace,id);
  if(!existing)fault(404,'Article not found');
  const question=payload?.question===undefined?existing.question:requiredText(payload.question,500,'question');
  const answer=payload?.answer===undefined?existing.answer:requiredText(payload.answer,4000,'answer');
  const locale=payload?.locale===undefined?existing.locale:validLocale(payload.locale);
  const category=payload?.category===undefined?existing.category:optionalText(payload.category,80,'category');
  const active=payload?.active===undefined?existing.active:(typeof payload.active==='boolean'?Number(payload.active):fault(400,'Invalid active flag'));
  run('UPDATE support_articles SET question=?,answer=?,locale=?,category=?,active=?,updated_at=? WHERE workspace=? AND id=?',question,answer,locale,category,active,clock(),workspace,id);
  return articleView(one('SELECT * FROM support_articles WHERE workspace=? AND id=?',workspace,id));
 }
 function removeArticle(workspace,id){
  validateWorkspace(workspace);validId(id);
  return run('DELETE FROM support_articles WHERE workspace=? AND id=?',workspace,id).changes>0;
 }
 function verifySession(workspace,id,token){
  if(typeof token!=='string'||token.length<32||token.length>150)fault(403,'Session unauthorized');
  const t=one('SELECT * FROM support_tickets WHERE workspace=? AND id=? AND session_hash=?',workspace,validId(id),digest(token));
  if(!t)fault(403,'Session unauthorized');
  return t;
 }
 async function receive(workspace,payload={}){
  validateWorkspace(workspace);
  if(!payload||typeof payload!=='object'||Array.isArray(payload))fault(400,'Invalid chat payload');
  const message=requiredText(payload.message,2000,'message');
  const hasTicket=payload.ticketId!==undefined||payload.sessionToken!==undefined;
  if(hasTicket&&(!payload.ticketId||!payload.sessionToken))fault(400,'Ticket and session token required');
  const existing=hasTicket?verifySession(workspace,payload.ticketId,payload.sessionToken):null;
  if(existing&&one('SELECT COUNT(*) AS n FROM support_messages WHERE workspace=? AND ticket_id=?',workspace,existing.id).n>=190)fault(429,'Conversation message limit reached');
  const config=settings(workspace);
  const locale=validLocale(payload.locale??config.defaultLocale);
  const name=existing?existing.name:optionalText(payload.name,120,'name');
  const email=existing?existing.email:emailField(payload.email);
  if(payload.aiConsent!==undefined&&typeof payload.aiConsent!=='boolean')fault(400,'Invalid AI consent');
  if(payload.leadConsent!==undefined&&typeof payload.leadConsent!=='boolean')fault(400,'Invalid lead consent');
  if(payload.leadConsent===true&&(existing||!name||!email))fault(400,'Lead consent requires a new chat with name and email');
  const leadCaptured=payload.leadConsent===true&&!existing;
  const articles=all('SELECT question,answer FROM support_articles WHERE workspace=? AND locale=? AND active=1',workspace,locale);
  const matched=matchArticle(message,articles);
  const fallback={
   en:'I cannot verify that from the business information available. I have flagged your request for a team member to review.',
   es:'No puedo verificar esa información con los datos aprobados de la empresa. He señalado tu solicitud para que la revise una persona del equipo.',
   fr:'Je ne peux pas vérifier cette information avec les renseignements approuvés de l’entreprise. Votre demande a été transmise à un membre de l’équipe.'
  };
  let reply=matched?.answer||(fallback[locale.slice(0,2)]||fallback.en);
  let source=matched?'knowledge':'handoff';
  if(matched&&payload.aiConsent===true&&typeof responder==='function'){
   try{
    const generated=await responder({message,locale,articles:[{question:matched.question,answer:matched.answer}]});
    if(typeof generated==='string'&&generated.trim()&&generated.length<=2000){reply=generated.trim();source='ai';}
   }catch{ /* Remain on the business-approved knowledge answer if the provider is unavailable. */ }
  }
  const time=Math.max(clock(),(existing?.updated_at??0)+1),id=existing?.id||randomUUID(),sessionToken=existing?null:randomBytes(32).toString('base64url');
  const needsHuman=!matched;
  db.exec('BEGIN IMMEDIATE');
  try{
   if(!existing){
    run('INSERT INTO support_tickets(workspace,id,session_hash,name,email,subject,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)',
     workspace,id,digest(sessionToken),name,email,message.slice(0,140),needsHuman?'pending':'open',time,time);
   }
   if(leadCaptured)run('INSERT INTO support_leads(workspace,ticket_id,name,email,inquiry,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)',
    workspace,id,name,email,message,'new',time,time);
   run('INSERT INTO support_messages(workspace,id,ticket_id,sender,body,created_at) VALUES(?,?,?,?,?,?)',workspace,randomUUID(),id,'customer',message,time);
   run('INSERT INTO support_messages(workspace,id,ticket_id,sender,body,created_at) VALUES(?,?,?,?,?,?)',workspace,randomUUID(),id,'assistant',reply,time+1);
   run("UPDATE support_tickets SET updated_at=?,status=CASE WHEN ?=1 THEN 'pending' WHEN status='resolved' THEN 'open' ELSE status END,automated_responses=automated_responses+? WHERE workspace=? AND id=?",
    time+1,Number(needsHuman),Number(!needsHuman),workspace,id);
   db.exec('COMMIT');
  }catch(e){db.exec('ROLLBACK');throw e;}
  if(!existing)notify(workspace,'support.ticket_created',id);
  else notify(workspace,'support.customer_replied',id);
  if(needsHuman)notify(workspace,'support.handoff_required',id);
  if(leadCaptured)notify(workspace,'support.lead_captured',id);
  return {ticketId:id,...(sessionToken?{sessionToken}:{}),reply,source,needsHuman,leadCaptured,status:ticket(workspace,id).status};
 }
 function requestHandoff(workspace,payload={}){
  validateWorkspace(workspace);
  if(!payload||typeof payload!=='object'||Array.isArray(payload))fault(400,'Invalid handoff request');
  const t=verifySession(workspace,payload.ticketId,payload.sessionToken);
  if(t.status==='pending')return {ticketId:t.id,status:'pending',needsHuman:true};
  const time=Math.max(clock(),t.updated_at+1);
  db.exec('BEGIN IMMEDIATE');
  try{
   run('INSERT INTO support_messages(workspace,id,ticket_id,sender,body,created_at) VALUES(?,?,?,?,?,?)',
    workspace,randomUUID(),t.id,'customer','I would like to speak with a human representative.',time);
   run("UPDATE support_tickets SET status='pending',updated_at=? WHERE workspace=? AND id=?",time,workspace,t.id);
   db.exec('COMMIT');
  }catch(e){db.exec('ROLLBACK');throw e;}
  notify(workspace,'support.handoff_required',t.id);
  return {ticketId:t.id,status:'pending',needsHuman:true};
 }
 function thread(workspace,payload={}){
  validateWorkspace(workspace);
  if(!payload||typeof payload!=='object'||Array.isArray(payload))fault(400,'Invalid session request');
  const t=verifySession(workspace,payload.ticketId,payload.sessionToken);
  return {ticketId:t.id,status:t.status,messages:messages(workspace,t.id)};
 }
 function tickets(workspace,{status}={}){
  validateWorkspace(workspace);
  if(status!==undefined&&!STATUS.has(status))fault(400,'Invalid status');
  const rows=status?all("SELECT t.*,(SELECT m.body FROM support_messages m WHERE m.workspace=t.workspace AND m.ticket_id=t.id ORDER BY m.created_at DESC,m.id DESC LIMIT 1) AS last_message FROM support_tickets t WHERE t.workspace=? AND t.status=? ORDER BY t.updated_at DESC LIMIT 100",workspace,status):
   all("SELECT t.*,(SELECT m.body FROM support_messages m WHERE m.workspace=t.workspace AND m.ticket_id=t.id ORDER BY m.created_at DESC,m.id DESC LIMIT 1) AS last_message FROM support_tickets t WHERE t.workspace=? ORDER BY t.updated_at DESC LIMIT 100",workspace);
  return rows.map(ticketView);
 }
 function ticketDetail(workspace,id){
  const t=ticket(workspace,id);
  const row=one('SELECT rating,feedback,updated_at AS updatedAt FROM support_ratings WHERE workspace=? AND ticket_id=?',workspace,id);
  const appointments=all('SELECT * FROM support_appointments WHERE workspace=? AND ticket_id=? ORDER BY created_at,id',workspace,id).map(appointmentView);
  return {ticket:ticketView(t),messages:messages(workspace,id),rating:row||null,appointments};
 }
 function rate(workspace,payload={}){
  if(!payload||typeof payload!=='object'||Array.isArray(payload))fault(400,'Invalid rating');
  const t=verifySession(workspace,payload.ticketId,payload.sessionToken);
  const rating=payload.rating;
  if(!Number.isInteger(rating)||rating<1||rating>5)fault(400,'Rating must be between 1 and 5');
  const feedback=optionalText(payload.feedback,500,'feedback');
  run('INSERT INTO support_ratings(workspace,ticket_id,rating,feedback,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(workspace,ticket_id) DO UPDATE SET rating=excluded.rating,feedback=excluded.feedback,updated_at=excluded.updated_at',
   workspace,t.id,rating,feedback,clock());
  return {rating,recorded:true};
 }
 function customers(workspace){
  validateWorkspace(workspace);
  return all("SELECT email,MAX(name) AS name,COUNT(*) AS ticketCount,COUNT(*) FILTER (WHERE status!='resolved') AS unresolvedTickets,MAX(updated_at) AS lastContact FROM support_tickets WHERE workspace=? AND email!='' GROUP BY email ORDER BY lastContact DESC LIMIT 100",workspace)
   .map(row=>({...row,verified:false}));
 }
 function customerLookup(workspace,email){
  validateWorkspace(workspace);
  const address=emailField(email);if(!address)fault(400,'Email required');
  const rows=all('SELECT * FROM support_tickets WHERE workspace=? AND email=? ORDER BY updated_at DESC LIMIT 100',workspace,address);
  if(!rows.length)fault(404,'Customer history not found');
  const leadCount=one('SELECT COUNT(*) AS n FROM support_leads WHERE workspace=? AND email=?',workspace,address).n;
  return {email:address,displayName:rows.find(row=>row.name)?.name||'',verified:false,tickets:rows.map(ticketView),consentedLeadCount:leadCount};
 }
 function leads(workspace,{status}={}){
  validateWorkspace(workspace);
  if(status!==undefined&&!['new','contacted','qualified','closed'].includes(status))fault(400,'Invalid lead status');
  return (status?all('SELECT * FROM support_leads WHERE workspace=? AND status=? ORDER BY created_at DESC LIMIT 100',workspace,status):
   all('SELECT * FROM support_leads WHERE workspace=? ORDER BY created_at DESC LIMIT 100',workspace)).map(leadView);
 }
 function updateLead(workspace,id,payload={}){
  validateWorkspace(workspace);validId(id);
  if(!payload||!['new','contacted','qualified','closed'].includes(payload.status))fault(400,'Invalid lead status');
  if(!run('UPDATE support_leads SET status=?,updated_at=? WHERE workspace=? AND ticket_id=?',payload.status,clock(),workspace,id).changes)fault(404,'Lead not found');
  return leadView(one('SELECT * FROM support_leads WHERE workspace=? AND ticket_id=?',workspace,id));
 }
 function appointments(workspace,{status}={}){
  validateWorkspace(workspace);
  if(status!==undefined&&!['requested','reviewing','declined','handled'].includes(status))fault(400,'Invalid appointment status');
  return (status?all('SELECT * FROM support_appointments WHERE workspace=? AND status=? ORDER BY created_at DESC LIMIT 100',workspace,status):
   all('SELECT * FROM support_appointments WHERE workspace=? ORDER BY created_at DESC LIMIT 100',workspace)).map(appointmentView);
 }
 function requestAppointment(workspace,payload={}){
  validateWorkspace(workspace);
  if(!payload||typeof payload!=='object'||Array.isArray(payload))fault(400,'Invalid appointment request');
  const t=verifySession(workspace,payload.ticketId,payload.sessionToken);
  const service=requiredText(payload.service,140,'service');
  const notes=optionalText(payload.notes,1000,'notes');
  const requestedAt=requiredText(payload.requestedAt,40,'requested time');
  const timezone=requiredText(payload.timezone,64,'timezone');
  const millis=Date.parse(requestedAt);
  if(!/^\d{4}-\d\d-\d\dT\d\d:\d\d:[\d.]+(?:Z|[+-]\d\d:\d\d)$/.test(requestedAt)||!Number.isFinite(millis)||millis<=clock()||millis>clock()+366*DAY)fault(400,'Choose a future appointment request date within one year');
  try{new Intl.DateTimeFormat('en',{timeZone:timezone});}catch{fault(400,'Invalid timezone');}
  if(one('SELECT COUNT(*) AS n FROM support_appointments WHERE workspace=? AND ticket_id=?',workspace,t.id).n>=3)fault(429,'Too many appointment requests for this conversation');
  const id=randomUUID(),time=Math.max(clock(),t.updated_at+1);
  const rowMessage='Appointment request (not booked): '+service+' at '+requestedAt+' ('+timezone+').'+(notes?' Notes: '+notes:'');
  db.exec('BEGIN IMMEDIATE');
  try{
   run('INSERT INTO support_appointments(workspace,id,ticket_id,service,requested_at,timezone,notes,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
    workspace,id,t.id,service,requestedAt,timezone,notes,'requested',time,time);
   run('INSERT INTO support_messages(workspace,id,ticket_id,sender,body,created_at) VALUES(?,?,?,?,?,?)',
    workspace,randomUUID(),t.id,'customer',rowMessage,time);
   run("UPDATE support_tickets SET status='pending',updated_at=? WHERE workspace=? AND id=?",time,workspace,t.id);
   db.exec('COMMIT');
  }catch(e){db.exec('ROLLBACK');throw e;}
  notify(workspace,'support.appointment_requested',t.id);
  return appointmentView(one('SELECT * FROM support_appointments WHERE workspace=? AND id=?',workspace,id));
 }
 function updateAppointment(workspace,id,payload={}){
  validateWorkspace(workspace);validId(id);
  if(!payload||!['requested','reviewing','declined','handled'].includes(payload.status))fault(400,'Invalid appointment status');
  if(!run('UPDATE support_appointments SET status=?,updated_at=? WHERE workspace=? AND id=?',payload.status,clock(),workspace,id).changes)fault(404,'Appointment request not found');
  return appointmentView(one('SELECT * FROM support_appointments WHERE workspace=? AND id=?',workspace,id));
 }
 function updateTicket(workspace,id,payload={}){
  const t=ticket(workspace,id);
  if(!payload||typeof payload!=='object'||Array.isArray(payload))fault(400,'Invalid ticket update');
  const status=payload.status===undefined?t.status:payload.status;
  const priority=payload.priority===undefined?t.priority:payload.priority;
  const assignedTo=payload.assignedTo===undefined?t.assigned_to:optionalText(payload.assignedTo,120,'assignee');
  if(!STATUS.has(status)||!PRIORITY.has(priority))fault(400,'Invalid status or priority');
  run('UPDATE support_tickets SET status=?,priority=?,assigned_to=?,updated_at=? WHERE workspace=? AND id=?',status,priority,assignedTo,clock(),workspace,id);
  if(status!==t.status||priority!==t.priority||assignedTo!==t.assigned_to)notify(workspace,'support.ticket_updated',id);
  return ticketView(ticket(workspace,id));
 }
 function staffReply(workspace,id,payload={}){
  const previous=ticket(workspace,id);
  const message=requiredText(payload?.message,4000,'reply');
  const time=Math.max(clock(),previous.updated_at+1);
  db.exec('BEGIN IMMEDIATE');
  try{
   run('INSERT INTO support_messages(workspace,id,ticket_id,sender,body,created_at) VALUES(?,?,?,?,?,?)',workspace,randomUUID(),id,'agent',message,time);
   run("UPDATE support_tickets SET updated_at=?,first_agent_at=COALESCE(first_agent_at,?),status='open' WHERE workspace=? AND id=?",time,time,workspace,id);
   db.exec('COMMIT');
  }catch(e){db.exec('ROLLBACK');throw e;}
  notify(workspace,'support.agent_replied',id);
  return ticketDetail(workspace,id);
 }
 function metrics(workspace){
  validateWorkspace(workspace);
  const row=one("SELECT COUNT(*) AS total,COUNT(*) FILTER(WHERE status='open') AS open,COUNT(*) FILTER(WHERE status='pending') AS pending,COUNT(*) FILTER(WHERE status='resolved') AS resolved,COALESCE(SUM(automated_responses),0) AS automatedResponses,AVG(CASE WHEN first_agent_at IS NOT NULL THEN (first_agent_at-created_at)/1000.0 END) AS averageFirstAgentSeconds FROM support_tickets WHERE workspace=?",workspace);
  const ratings=one('SELECT COUNT(*) AS ratedTickets,ROUND(AVG(rating),1) AS averageRating FROM support_ratings WHERE workspace=?',workspace);
  const l=one('SELECT COUNT(*) AS contactLeads FROM support_leads WHERE workspace=?',workspace);
  const a=one("SELECT COUNT(*) AS appointmentRequests,COUNT(*) FILTER(WHERE status='requested') AS appointmentPending FROM support_appointments WHERE workspace=?",workspace);
  return {...row,...ratings,...l,...a,averageFirstAgentSeconds:row.averageFirstAgentSeconds===null?null:Math.round(row.averageFirstAgentSeconds)};
 }
 function exportEmail(workspace,email){
  validateWorkspace(workspace);
  const address=emailField(email);if(!address)fault(400,'Email required');
  const found=all('SELECT id FROM support_tickets WHERE workspace=? AND email=? ORDER BY created_at DESC LIMIT 1000',workspace,address);
  const leads=all('SELECT * FROM support_leads WHERE workspace=? AND email=? ORDER BY created_at DESC LIMIT 1000',workspace,address).map(leadView);
  return {email:address,tickets:found.map(t=>ticketDetail(workspace,t.id)),leads};
 }
 function eraseEmail(workspace,email){
  validateWorkspace(workspace);
  const address=emailField(email);if(!address)fault(400,'Email required');
  return run('DELETE FROM support_tickets WHERE workspace=? AND email=?',workspace,address).changes;
 }
 function eraseWorkspace(workspace){
  validateWorkspace(workspace);
  db.exec('BEGIN IMMEDIATE');
  try{
   run('DELETE FROM support_tickets WHERE workspace=?',workspace);
   run('DELETE FROM support_articles WHERE workspace=?',workspace);
   run('DELETE FROM support_settings WHERE workspace=?',workspace);
   db.exec('COMMIT');
  }catch(e){db.exec('ROLLBACK');throw e;}
 }
 function expire({days=180}={}){
  if(!Number.isSafeInteger(days)||days<30||days>730)fault(400,'Invalid support retention');
  return run('DELETE FROM support_tickets WHERE updated_at<?',clock()-days*DAY).changes;
 }
 enhanced=extendSupport({settings,updateSettings,listArticles,addArticle,editArticle,removeArticle,receive,requestHandoff,thread,tickets,ticketDetail,updateTicket,staffReply,rate,customers,customerLookup,leads,updateLead,appointments,requestAppointment,updateAppointment,metrics,exportEmail,eraseEmail,eraseWorkspace,expire,emitSupportEvent:notify},db,{clock});
 return enhanced;
}

/**
 * Opt-in provider for knowledge-grounded paraphrases. Structured name/email
 * fields are excluded; free-form text may contain personal information, so
 * explicit customer consent is required per request.
 */
export function createSupportResponder(env=process.env,{fetcher=fetch}={}){
 if(env.SUPPORT_AI_ENABLED!=='true'||env.SUPPORT_AI_DATA_PROCESSING_ACKNOWLEDGED!=='true'||!env.AI_API_KEY)return null;
 const endpoint=new URL(env.AI_BASE_URL||'https://vireonix.ai/v1/chat/completions');
 if(endpoint.protocol!=='https:'||endpoint.username||endpoint.password)throw Error('Support AI endpoint must use HTTPS without embedded credentials');
 return async({message,articles,locale})=>{
  const result=await fetcher(endpoint,{method:'POST',redirect:'error',headers:{
   authorization:'Bearer '+env.AI_API_KEY,'content-type':'application/json'
  },body:JSON.stringify({model:env.AI_MODEL||'auto',temperature:0,max_tokens:450,messages:[
   {role:'system',content:'You are a customer-service assistant. Only paraphrase the supplied approved knowledge answer. Never invent prices, policies, order status, appointments, or actions. If the information is insufficient, answer exactly: I will refer this to the support team.'},
   {role:'user',content:JSON.stringify({locale,customerQuestion:message,approvedKnowledge:articles})}
  ]}),signal:AbortSignal.timeout(12000)});
  if(!result.ok)throw Error('AI provider unavailable');
  const data=await result.json();
  return data?.choices?.[0]?.message?.content;
 };
}
