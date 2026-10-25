import {randomBytes,randomUUID,createHash,scryptSync,timingSafeEqual} from 'node:crypto';
import {validateWorkspace} from './security.mjs';

const HOUR=3600000;
const DAY=24*HOUR;
const ID=/^[a-f0-9-]{36}$/i;
const EMAIL=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function error(code,reason){const e=Error(reason);e.status=code;throw e;}
function id(value){if(typeof value!=='string'||!ID.test(value))error(400,'Invalid identifier');return value;}
function field(value,max,name,required=true){
 if(typeof value!=='string'||value.length>max||(required&&!value.trim()))error(400,'Invalid '+name);
 return value.trim();
}
function optional(value,max,name){return value===undefined?'':field(value,max,name,false);}
function email(value){const e=field(value,254,'email').toLowerCase();if(!EMAIL.test(e))error(400,'Invalid email');return e;}
function hash(token){return createHash('sha256').update(token).digest('hex');}
function safeTime(value,now){
 if(typeof value!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(value))error(400,'Valid ISO timestamp with timezone required');
 const ms=Date.parse(value);
 if(!Number.isFinite(ms)||ms<=now||ms>now+366*DAY)error(400,'Choose a future date within one year');
 return new Date(ms).toISOString();
}
function articleRow(row){return {id:row.id,question:row.question,answer:row.answer,locale:row.locale,category:row.category||'',active:!!row.active,createdAt:row.created_at,updatedAt:row.updated_at};}
function macroRow(row){return {id:row.id,title:row.title,body:row.body,createdAt:row.created_at,updatedAt:row.updated_at};}
function staffRow(row){return {id:row.id,name:row.name,email:row.email,role:row.role,active:!!row.active,createdAt:row.created_at};}
function slotRow(row,remaining){return {id:row.id,service:row.service,startAt:row.starts_at,durationMinutes:row.duration_minutes,capacity:row.capacity,enabled:!!row.enabled,remaining};}
function bookingRow(row){return {id:row.id,ticketId:row.ticket_id,slotId:row.slot_id,service:row.service,startAt:row.starts_at,durationMinutes:row.duration_minutes,status:row.status,confirmedExternally:false,createdAt:row.created_at};}

const schema=`CREATE TABLE IF NOT EXISTS support_team (
 workspace TEXT NOT NULL,id TEXT NOT NULL,name TEXT NOT NULL,email TEXT NOT NULL,
 password_salt TEXT NOT NULL,password_hash TEXT NOT NULL,
 role TEXT NOT NULL CHECK(role IN ('manager','agent')),active INTEGER NOT NULL DEFAULT 1,
 created_at INTEGER NOT NULL,PRIMARY KEY(workspace,id),UNIQUE(workspace,email));
CREATE TABLE IF NOT EXISTS support_team_sessions(
 workspace TEXT NOT NULL,token_hash TEXT NOT NULL,member_id TEXT NOT NULL,
 expires_at INTEGER NOT NULL,PRIMARY KEY(workspace,token_hash),
 FOREIGN KEY(workspace,member_id) REFERENCES support_team(workspace,id) ON DELETE CASCADE);
CREATE INDEX IF NOT EXISTS support_team_sessions_expire ON support_team_sessions(expires_at);
CREATE TABLE IF NOT EXISTS support_macros(
 workspace TEXT NOT NULL,id TEXT NOT NULL,title TEXT NOT NULL,body TEXT NOT NULL,
 created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,PRIMARY KEY(workspace,id));
CREATE TABLE IF NOT EXISTS support_internal_notes(
 workspace TEXT NOT NULL,id TEXT NOT NULL,ticket_id TEXT NOT NULL,
 body TEXT NOT NULL,author TEXT NOT NULL DEFAULT '',created_at INTEGER NOT NULL,
 PRIMARY KEY(workspace,id),
 FOREIGN KEY(workspace,ticket_id) REFERENCES support_tickets(workspace,id) ON DELETE CASCADE);
CREATE INDEX IF NOT EXISTS support_internal_notes_ticket ON support_internal_notes(workspace,ticket_id,created_at);
CREATE TABLE IF NOT EXISTS support_notifications(
 workspace TEXT NOT NULL,id TEXT NOT NULL,ticket_id TEXT NOT NULL,
 kind TEXT NOT NULL,seen INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL,
 PRIMARY KEY(workspace,id),
 FOREIGN KEY(workspace,ticket_id) REFERENCES support_tickets(workspace,id) ON DELETE CASCADE);
CREATE INDEX IF NOT EXISTS support_notifications_read ON support_notifications(workspace,seen,created_at);
CREATE TABLE IF NOT EXISTS support_sla(
 workspace TEXT PRIMARY KEY,first_response_minutes INTEGER NOT NULL DEFAULT 60,
 resolution_minutes INTEGER NOT NULL DEFAULT 1440);
CREATE TABLE IF NOT EXISTS support_audit(
 workspace TEXT NOT NULL,id TEXT NOT NULL,action TEXT NOT NULL,
 actor TEXT NOT NULL,subject_id TEXT NOT NULL DEFAULT '',created_at INTEGER NOT NULL,
 PRIMARY KEY(workspace,id));
CREATE INDEX IF NOT EXISTS support_audit_time ON support_audit(workspace,created_at);
CREATE TABLE IF NOT EXISTS support_slots(
 workspace TEXT NOT NULL,id TEXT NOT NULL,service TEXT NOT NULL,
 starts_at TEXT NOT NULL,duration_minutes INTEGER NOT NULL,capacity INTEGER NOT NULL,
 enabled INTEGER NOT NULL DEFAULT 1,created_at INTEGER NOT NULL,
 PRIMARY KEY(workspace,id),UNIQUE(workspace,service,starts_at));
CREATE TABLE IF NOT EXISTS support_bookings(
 workspace TEXT NOT NULL,id TEXT NOT NULL,slot_id TEXT NOT NULL,ticket_id TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('confirmed_local','cancelled')),
 created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,
 PRIMARY KEY(workspace,id),
 FOREIGN KEY(workspace,slot_id) REFERENCES support_slots(workspace,id) ON DELETE CASCADE,
 FOREIGN KEY(workspace,ticket_id) REFERENCES support_tickets(workspace,id) ON DELETE CASCADE);
CREATE INDEX IF NOT EXISTS support_bookings_slot ON support_bookings(workspace,slot_id,status);
CREATE TABLE IF NOT EXISTS support_attachments(
 workspace TEXT NOT NULL,id TEXT NOT NULL,ticket_id TEXT NOT NULL,
 name TEXT NOT NULL,mime TEXT NOT NULL,content BLOB NOT NULL,bytes_count INTEGER NOT NULL,
 uploaded_by TEXT NOT NULL CHECK(uploaded_by IN ('customer','agent')),
 created_at INTEGER NOT NULL,PRIMARY KEY(workspace,id),
 FOREIGN KEY(workspace,ticket_id) REFERENCES support_tickets(workspace,id) ON DELETE CASCADE);
CREATE INDEX IF NOT EXISTS support_attachments_ticket ON support_attachments(workspace,ticket_id);
CREATE TABLE IF NOT EXISTS support_routing_rules(
 workspace TEXT NOT NULL,id TEXT NOT NULL,phrase TEXT NOT NULL,priority TEXT NOT NULL
 CHECK(priority IN ('low','normal','high','urgent')),
 active INTEGER NOT NULL DEFAULT 1,created_at INTEGER NOT NULL,
 PRIMARY KEY(workspace,id),UNIQUE(workspace,phrase));`;

export function extendSupport(base,db,{clock=()=>Date.now()}={}){
 db.exec(schema);
 const articleColumns=db.prepare('PRAGMA table_info(support_articles)').all();
 if(!articleColumns.some(c=>c.name==='category'))db.exec("ALTER TABLE support_articles ADD COLUMN category TEXT NOT NULL DEFAULT ''");
 const one=(q,...args)=>db.prepare(q).get(...args);
 const many=(q,...args)=>db.prepare(q).all(...args);
 const run=(q,...args)=>db.prepare(q).run(...args);
 function audit(workspace,action,actor='system',subjectId=''){
  validateWorkspace(workspace);
  run('INSERT INTO support_audit(workspace,id,action,actor,subject_id,created_at) VALUES(?,?,?,?,?,?)',
   workspace,randomUUID(),field(action,100,'audit action'),field(actor,120,'audit actor'),optional(subjectId,100,'subject'),clock());
 }
 function onSupportEvent(workspace,event,ticketId){
  if(event==='support.handoff_required')routeTicket(workspace,ticketId);
  if(!['support.ticket_created','support.handoff_required','support.lead_captured','support.appointment_requested','support.customer_replied','support.booking_confirmed','support.booking_cancelled'].includes(event))return;
  audit(workspace,event,'system',ticketId);
  if(['support.handoff_required','support.lead_captured','support.appointment_requested','support.customer_replied','support.booking_confirmed','support.booking_cancelled'].includes(event)){
   run('INSERT INTO support_notifications(workspace,id,ticket_id,kind,created_at) VALUES(?,?,?,?,?)',
    workspace,randomUUID(),ticketId,event,clock());
  }
 }
 function routingRules(workspace){
  validateWorkspace(workspace);
  return many('SELECT id,phrase,priority,active,created_at AS createdAt FROM support_routing_rules WHERE workspace=? ORDER BY created_at DESC LIMIT 30',workspace)
   .map(row=>({...row,active:!!row.active}));
 }
 function createRoutingRule(workspace,payload){
  validateWorkspace(workspace);
  const phrase=field(payload?.phrase,80,'routing phrase').toLowerCase();
  const priority=payload?.priority;
  if(!['low','normal','high','urgent'].includes(priority))error(400,'Invalid routing priority');
  if(one('SELECT COUNT(*) AS n FROM support_routing_rules WHERE workspace=?',workspace).n>=30)error(409,'Routing rule limit reached');
  if(one('SELECT id FROM support_routing_rules WHERE workspace=? AND phrase=?',workspace,phrase))error(409,'Rule already exists');
  const ruleId=randomUUID(),time=clock();
  run('INSERT INTO support_routing_rules VALUES(?,?,?,?,?,?)',workspace,ruleId,phrase,priority,1,time);
  audit(workspace,'support.routing_rule_created','staff',ruleId);
  return routingRules(workspace).find(x=>x.id===ruleId);
 }
 function deleteRoutingRule(workspace,ruleId){
  validateWorkspace(workspace);id(ruleId);
  if(!run('DELETE FROM support_routing_rules WHERE workspace=? AND id=?',workspace,ruleId).changes)error(404,'Routing rule not found');
  audit(workspace,'support.routing_rule_deleted','staff',ruleId);
  return {deleted:true};
 }
 function routeTicket(workspace,ticketId){
  validateWorkspace(workspace);id(ticketId);
  const ticket=one('SELECT subject,assigned_to,priority FROM support_tickets WHERE workspace=? AND id=?',workspace,ticketId);
  if(!ticket)return;
  const rules=many('SELECT phrase,priority FROM support_routing_rules WHERE workspace=? AND active=1 ORDER BY length(phrase) DESC',workspace);
  const matched=rules.find(x=>ticket.subject.toLowerCase().includes(x.phrase));
  if(matched&&ticket.priority!==matched.priority)run('UPDATE support_tickets SET priority=? WHERE workspace=? AND id=?',matched.priority,workspace,ticketId);
  if(ticket.assigned_to)return;
  const staff=many('SELECT email FROM support_team WHERE workspace=? AND active=1 ORDER BY email LIMIT 100',workspace);
  if(!staff.length)return;
  const loads=staff.map(s=>({
   email:s.email,open:one("SELECT COUNT(*) AS n FROM support_tickets WHERE workspace=? AND assigned_to=? AND status!='resolved'",workspace,s.email).n
  })).sort((a,b)=>a.open-b.open||a.email.localeCompare(b.email));
  run("UPDATE support_tickets SET assigned_to=? WHERE workspace=? AND id=? AND assigned_to=''",loads[0].email,workspace,ticketId);
  audit(workspace,'support.ticket_auto_assigned','system',ticketId);
 }
 function listNotifications(workspace){
  validateWorkspace(workspace);
  return many('SELECT id,ticket_id AS ticketId,kind,seen,created_at AS createdAt FROM support_notifications WHERE workspace=? ORDER BY created_at DESC LIMIT 100',workspace)
   .map(item=>({...item,seen:!!item.seen}));
 }
 function markNotification(workspace,notificationId){
  validateWorkspace(workspace);id(notificationId);
  if(!run('UPDATE support_notifications SET seen=1 WHERE workspace=? AND id=?',workspace,notificationId).changes)error(404,'Notification not found');
  return {read:true};
 }
 function sla(workspace){
  validateWorkspace(workspace);
  const row=one('SELECT first_response_minutes AS firstResponseMinutes,resolution_minutes AS resolutionMinutes FROM support_sla WHERE workspace=?',workspace);
  return row||{firstResponseMinutes:60,resolutionMinutes:1440};
 }
 function updateSla(workspace,input){
  validateWorkspace(workspace);
  const old=sla(workspace);
  const first=input?.firstResponseMinutes===undefined?old.firstResponseMinutes:input.firstResponseMinutes;
  const resolution=input?.resolutionMinutes===undefined?old.resolutionMinutes:input.resolutionMinutes;
  if(!Number.isInteger(first)||first<1||first>10080||!Number.isInteger(resolution)||resolution<first||resolution>43200)error(400,'Invalid SLA minutes');
  run('INSERT INTO support_sla VALUES(?,?,?) ON CONFLICT(workspace) DO UPDATE SET first_response_minutes=excluded.first_response_minutes,resolution_minutes=excluded.resolution_minutes',
   workspace,first,resolution);
  audit(workspace,'support.sla_updated');
  return sla(workspace);
 }
 function alerts(workspace){
  const rule=sla(workspace),time=clock();
  const tickets=many("SELECT id,status,created_at,first_agent_at FROM support_tickets WHERE workspace=? AND status!='resolved' ORDER BY created_at LIMIT 500",workspace);
  const list=[];
  for(const t of tickets){
   if(t.first_agent_at===null&&time-t.created_at>=rule.firstResponseMinutes*60000)list.push({ticketId:t.id,type:'first_response_overdue',minutesLate:Math.floor((time-t.created_at)/60000)-rule.firstResponseMinutes});
   if(time-t.created_at>=rule.resolutionMinutes*60000)list.push({ticketId:t.id,type:'resolution_overdue',minutesLate:Math.floor((time-t.created_at)/60000)-rule.resolutionMinutes});
  }
  return {rules:rule,alerts:list.slice(0,200)};
 }
 function createStaff(workspace,input){
  validateWorkspace(workspace);
  if(!input||typeof input!=='object'||Array.isArray(input))error(400,'Invalid staff member');
  const name=field(input.name,120,'name'),address=email(input.email),password=field(input.password,200,'password');
  if(password.length<12)error(400,'Staff password must contain at least 12 characters');
  if(!['manager','agent'].includes(input.role))error(400,'Invalid role');
  if(one('SELECT COUNT(*) AS n FROM support_team WHERE workspace=?',workspace).n>=100)error(409,'Staff seat limit reached');
  if(one('SELECT 1 FROM support_team WHERE workspace=? AND email=?',workspace,address))error(409,'Staff member exists');
  const salt=randomBytes(16).toString('hex');
  const secret=scryptSync(password,Buffer.from(salt,'hex'),64).toString('hex');
  const memberId=randomUUID();
  run('INSERT INTO support_team(workspace,id,name,email,password_salt,password_hash,role,created_at) VALUES(?,?,?,?,?,?,?,?)',
   workspace,memberId,name,address,salt,secret,input.role,clock());
  audit(workspace,'support.team_created','owner',memberId);
  return staffRow(one('SELECT * FROM support_team WHERE workspace=? AND id=?',workspace,memberId));
 }
 function team(workspace){
  validateWorkspace(workspace);
  return many('SELECT * FROM support_team WHERE workspace=? ORDER BY created_at LIMIT 100',workspace).map(staffRow);
 }
 function editStaff(workspace,staffId,payload){
  validateWorkspace(workspace);id(staffId);
  const row=one('SELECT * FROM support_team WHERE workspace=? AND id=?',workspace,staffId);
  if(!row)error(404,'Staff member not found');
  if(!payload||typeof payload!=='object'||Array.isArray(payload))error(400,'Invalid staff changes');
  const active=payload.active===undefined?!!row.active:payload.active;
  if(typeof active!=='boolean')error(400,'Invalid active flag');
  const role=payload.role===undefined?row.role:payload.role;
  if(!['manager','agent'].includes(role))error(400,'Invalid staff role');
  let secret=row.password_hash,salt=row.password_salt;
  if(payload.password!==undefined){
   const password=field(payload.password,200,'password');if(password.length<12)error(400,'Password too short');
   salt=randomBytes(16).toString('hex');
   secret=scryptSync(password,Buffer.from(salt,'hex'),64).toString('hex');
  }
  db.exec('BEGIN IMMEDIATE');
  try{
   run('UPDATE support_team SET role=?,active=?,password_salt=?,password_hash=? WHERE workspace=? AND id=?',
    role,Number(active),salt,secret,workspace,staffId);
   if(!active||payload.password!==undefined||role!==row.role)run('DELETE FROM support_team_sessions WHERE workspace=? AND member_id=?',workspace,staffId);
   db.exec('COMMIT');
  }catch(e){db.exec('ROLLBACK');throw e;}
  audit(workspace,'support.team_updated','owner',staffId);
  return staffRow(one('SELECT * FROM support_team WHERE workspace=? AND id=?',workspace,staffId));
 }
 function login(workspace,input){
  validateWorkspace(workspace);
  if(!input||typeof input!=='object')error(401,'Invalid staff credentials');
  const address=typeof input.email==='string'?input.email.toLowerCase().trim():'';
  const password=typeof input.password==='string'?input.password:'';
  if(address.length>254||password.length>200||!password)error(401,'Invalid staff credentials');
  const row=one('SELECT * FROM support_team WHERE workspace=? AND email=? AND active=1',workspace,address);
  // A constant hash computation avoids returning an immediate answer for nonexistent users.
  const salt=row?.password_salt||'0123456789abcdef0123456789abcdef';
  const expected=Buffer.from(row?.password_hash||'00'.repeat(64),'hex');
  const actual=scryptSync(password,Buffer.from(salt,'hex'),64);
  if(!timingSafeEqual(expected,actual)||!row)error(401,'Invalid staff credentials');
  const token=randomBytes(32).toString('base64url'),expiresAt=clock()+8*HOUR;
  run('INSERT INTO support_team_sessions(workspace,token_hash,member_id,expires_at) VALUES(?,?,?,?)',workspace,hash(token),row.id,expiresAt);
  audit(workspace,'support.staff_login','staff:'+row.id,row.id);
  return {token,role:row.role,name:row.name,expiresAt};
 }
 function roleOf(workspace,authorization){
  if(typeof authorization!=='string'||!authorization.startsWith('Bearer '))return null;
  const token=authorization.slice(7);
  if(token.length<32||token.length>150)return null;
  const row=one('SELECT s.member_id,m.role,m.name FROM support_team_sessions s JOIN support_team m ON m.workspace=s.workspace AND m.id=s.member_id WHERE s.workspace=? AND s.token_hash=? AND s.expires_at>? AND m.active=1',
   workspace,hash(token),clock());
  return row?{memberId:row.member_id,role:row.role,name:row.name}:null;
 }
 function logout(workspace,authorization){
  if(typeof authorization!=='string'||!authorization.startsWith('Bearer '))error(401,'Staff session required');
  const token=authorization.slice(7);
  if(token.length<32||token.length>150)error(401,'Staff session required');
  return {loggedOut:run('DELETE FROM support_team_sessions WHERE workspace=? AND token_hash=?',workspace,hash(token)).changes>0};
 }
 function macros(workspace){
  validateWorkspace(workspace);
  return many('SELECT * FROM support_macros WHERE workspace=? ORDER BY title LIMIT 100',workspace).map(macroRow);
 }
 function createMacro(workspace,input){
  validateWorkspace(workspace);
  const title=field(input?.title,100,'macro title'),body=field(input?.body,4000,'macro body');
  if(one('SELECT COUNT(*) AS n FROM support_macros WHERE workspace=?',workspace).n>=100)error(409,'Macro limit reached');
  const macroId=randomUUID(),time=clock();
  run('INSERT INTO support_macros VALUES(?,?,?,?,?,?)',workspace,macroId,title,body,time,time);
  audit(workspace,'support.macro_created','staff',macroId);
  return macroRow(one('SELECT * FROM support_macros WHERE workspace=? AND id=?',workspace,macroId));
 }
 function updateMacro(workspace,macroId,input){
  validateWorkspace(workspace);id(macroId);
  const existing=one('SELECT * FROM support_macros WHERE workspace=? AND id=?',workspace,macroId);
  if(!existing)error(404,'Macro not found');
  const title=input?.title===undefined?existing.title:field(input.title,100,'macro title');
  const body=input?.body===undefined?existing.body:field(input.body,4000,'macro body');
  run('UPDATE support_macros SET title=?,body=?,updated_at=? WHERE workspace=? AND id=?',title,body,clock(),workspace,macroId);
  audit(workspace,'support.macro_updated','staff',macroId);
  return macroRow(one('SELECT * FROM support_macros WHERE workspace=? AND id=?',workspace,macroId));
 }
 function deleteMacro(workspace,macroId){
  validateWorkspace(workspace);id(macroId);
  const deleted=run('DELETE FROM support_macros WHERE workspace=? AND id=?',workspace,macroId).changes>0;
  if(deleted)audit(workspace,'support.macro_deleted','staff',macroId);
  return deleted;
 }
 function notes(workspace,ticketId){
  validateWorkspace(workspace);id(ticketId);
  base.ticketDetail(workspace,ticketId);
  return many('SELECT id,body,author,created_at AS createdAt FROM support_internal_notes WHERE workspace=? AND ticket_id=? ORDER BY created_at,id LIMIT 100',workspace,ticketId);
 }
 function addNote(workspace,ticketId,input,actor='staff'){
  validateWorkspace(workspace);id(ticketId);
  base.ticketDetail(workspace,ticketId);
  const body=field(input?.body,4000,'note');
  const noteId=randomUUID();
  run('INSERT INTO support_internal_notes VALUES(?,?,?,?,?,?)',workspace,noteId,ticketId,body,field(actor,120,'actor'),clock());
  audit(workspace,'support.note_created',actor,ticketId);
  return many('SELECT id,body,author,created_at AS createdAt FROM support_internal_notes WHERE workspace=? AND id=?',workspace,noteId)[0];
 }
 function ticketDetail(workspace,ticketId){
  return {...base.ticketDetail(workspace,ticketId),notes:notes(workspace,ticketId),bookings:bookings(workspace,{ticketId}),files:attachments(workspace,ticketId)};
 }
 function exportEmail(workspace,address){
  const record=base.exportEmail(workspace,address);
  return {...record,tickets:record.tickets.map(t=>({...t,notes:notes(workspace,t.ticket.id),bookings:bookings(workspace,{ticketId:t.ticket.id}),files:attachments(workspace,t.ticket.id)}))};
 }
 function bulkArticles(workspace,input){
  validateWorkspace(workspace);
  const items=input?.articles;
  if(!Array.isArray(items)||!items.length||items.length>100)error(400,'Import 1–100 knowledge entries');
  const entries=items.map(row=>{
   if(!row||typeof row!=='object'||Array.isArray(row))error(400,'Invalid knowledge row');
   const question=field(row.question,500,'question'),answer=field(row.answer,4000,'answer');
   const locale=row.locale===undefined?'en':field(row.locale,10,'locale');
   if(!/^[a-z]{2}(?:-[A-Z]{2})?$/.test(locale))error(400,'Invalid locale');
   const category=row.category===undefined?'':field(row.category,80,'category',false);
   if(row.active!==undefined&&typeof row.active!=='boolean')error(400,'Invalid active flag');
   return {question,answer,locale,category,active:row.active!==false};
  });
  const existing=one('SELECT COUNT(*) AS n FROM support_articles WHERE workspace=?',workspace).n;
  if(existing+entries.length>500)error(409,'Knowledge capacity exceeded');
  const stamp=clock();
  db.exec('BEGIN IMMEDIATE');
  try{
   for(const entry of entries){
    run('INSERT INTO support_articles(workspace,id,question,answer,locale,category,active,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)',
     workspace,randomUUID(),entry.question,entry.answer,entry.locale,entry.category,Number(entry.active),stamp,stamp);
   }
   db.exec('COMMIT');
  }catch(e){db.exec('ROLLBACK');throw e;}
  audit(workspace,'support.knowledge_imported','staff');
  return {imported:entries.length};
 }
 function articleSearch(workspace,{q='',locale='',category='',active}={}){
  validateWorkspace(workspace);
  if(typeof q!=='string'||q.length>200||typeof locale!=='string'||locale.length>10||typeof category!=='string'||category.length>80)error(400,'Invalid knowledge search');
  if(active!==undefined&&!['true','false'].includes(active))error(400,'Invalid active filter');
  const rows=many(`SELECT * FROM support_articles WHERE workspace=? AND (?='' OR instr(lower(question||' '||answer),lower(?))>0) AND (?='' OR locale=?) AND (?='' OR category=?) AND (? IS NULL OR active=?) ORDER BY updated_at DESC LIMIT 100`,
   workspace,q,q,locale,locale,category,category,active===undefined?null:Number(active==='true'),active===undefined?null:Number(active==='true'));
  return rows.map(articleRow);
 }
 function ticketSearch(workspace,{q='',status='',priority='',assignedTo=''}={}){
  validateWorkspace(workspace);
  if(typeof q!=='string'||q.length>200||typeof status!=='string'||(status&&!['open','pending','resolved'].includes(status))||
   typeof priority!=='string'||(priority&&!['low','normal','high','urgent'].includes(priority))||typeof assignedTo!=='string'||assignedTo.length>120)error(400,'Invalid ticket filters');
  return many(`SELECT * FROM support_tickets WHERE workspace=? AND (?='' OR instr(lower(subject||' '||name||' '||email),lower(?))>0) AND (?='' OR status=?) AND (?='' OR priority=?) AND (?='' OR assigned_to=?) ORDER BY updated_at DESC LIMIT 100`,
   workspace,q,q,status,status,priority,priority,assignedTo,assignedTo)
   .map(row=>({id:row.id,name:row.name,email:row.email,subject:row.subject,status:row.status,priority:row.priority,assignedTo:row.assigned_to,updatedAt:row.updated_at,createdAt:row.created_at}));
 }
 function slots(workspace,{includeDisabled=false}={}){
  validateWorkspace(workspace);
  return many(`SELECT s.*,(SELECT COUNT(*) FROM support_bookings b WHERE b.workspace=s.workspace AND b.slot_id=s.id AND b.status='confirmed_local') AS booked FROM support_slots s WHERE s.workspace=? AND starts_at>? ORDER BY starts_at LIMIT 100`,workspace,new Date(clock()).toISOString())
   .filter(row=>includeDisabled||row.enabled).map(row=>slotRow(row,Math.max(0,row.capacity-row.booked)));
 }
 function createSlot(workspace,input){
  validateWorkspace(workspace);
  const service=field(input?.service,140,'service');
  const start=safeTime(input?.startAt,clock());
  const duration=input?.durationMinutes,capacity=input?.capacity;
  if(!Number.isInteger(duration)||duration<15||duration>480||!Number.isInteger(capacity)||capacity<1||capacity>20)error(400,'Invalid slot duration or capacity');
  if(one('SELECT COUNT(*) AS n FROM support_slots WHERE workspace=?',workspace).n>=1000)error(409,'Calendar capacity reached');
  if(one('SELECT id FROM support_slots WHERE workspace=? AND service=? AND starts_at=?',workspace,service,start))error(409,'Slot already exists');
  const slotId=randomUUID();
  run('INSERT INTO support_slots VALUES(?,?,?,?,?,?,?,?)',workspace,slotId,service,start,duration,capacity,1,clock());
  audit(workspace,'support.slot_created','staff',slotId);
  return slotRow(one('SELECT * FROM support_slots WHERE workspace=? AND id=?',workspace,slotId),capacity);
 }
 function updateSlot(workspace,slotId,input){
  validateWorkspace(workspace);id(slotId);
  const row=one('SELECT * FROM support_slots WHERE workspace=? AND id=?',workspace,slotId);
  if(!row)error(404,'Slot not found');
  const enabled=input?.enabled===undefined?Boolean(row.enabled):input.enabled;
  if(typeof enabled!=='boolean')error(400,'Invalid enabled flag');
  const capacity=input?.capacity===undefined?row.capacity:input.capacity;
  const booked=one(`SELECT COUNT(*) AS n FROM support_bookings WHERE workspace=? AND slot_id=? AND status='confirmed_local'`,workspace,slotId).n;
  if(!Number.isInteger(capacity)||capacity<booked||capacity>20)error(409,'Capacity cannot be below confirmed bookings');
  run('UPDATE support_slots SET enabled=?,capacity=? WHERE workspace=? AND id=?',Number(enabled),capacity,workspace,slotId);
  audit(workspace,'support.slot_updated','staff',slotId);
  return slotRow(one('SELECT * FROM support_slots WHERE workspace=? AND id=?',workspace,slotId),capacity-booked);
 }
 function bookings(workspace,{ticketId}={}){
  validateWorkspace(workspace);
  if(ticketId)id(ticketId);
  const rows=ticketId?
   many('SELECT b.*,s.service,s.starts_at,s.duration_minutes FROM support_bookings b JOIN support_slots s ON s.workspace=b.workspace AND s.id=b.slot_id WHERE b.workspace=? AND b.ticket_id=? ORDER BY b.created_at DESC LIMIT 100',workspace,ticketId):
   many('SELECT b.*,s.service,s.starts_at,s.duration_minutes FROM support_bookings b JOIN support_slots s ON s.workspace=b.workspace AND s.id=b.slot_id WHERE b.workspace=? ORDER BY b.created_at DESC LIMIT 100',workspace);
  return rows.map(bookingRow);
 }
 function book(workspace,input){
  validateWorkspace(workspace);
  if(!input||typeof input!=='object'||Array.isArray(input))error(400,'Invalid booking');
  id(input.slotId);
  base.thread(workspace,{ticketId:input.ticketId,sessionToken:input.sessionToken});
  let result;
  db.exec('BEGIN IMMEDIATE');
  try{
   const slot=one('SELECT * FROM support_slots WHERE workspace=? AND id=? AND enabled=1',workspace,input.slotId);
   if(!slot||Date.parse(slot.starts_at)<=clock())error(404,'Available slot not found');
   const existing=one(`SELECT * FROM support_bookings WHERE workspace=? AND slot_id=? AND ticket_id=? AND status='confirmed_local'`,workspace,input.slotId,input.ticketId);
   if(existing){result=existing;}
   else{
    const booked=one(`SELECT COUNT(*) AS n FROM support_bookings WHERE workspace=? AND slot_id=? AND status='confirmed_local'`,workspace,input.slotId).n;
    if(booked>=slot.capacity)error(409,'Slot is full');
    // A ticket may not hold two bookings for overlapping times.
    const conflicts=many(`SELECT s.starts_at,s.duration_minutes FROM support_bookings b JOIN support_slots s ON s.workspace=b.workspace AND s.id=b.slot_id WHERE b.workspace=? AND b.ticket_id=? AND b.status='confirmed_local'`,workspace,input.ticketId);
    const start=Date.parse(slot.starts_at),end=start+slot.duration_minutes*60000;
    if(conflicts.some(x=>Date.parse(x.starts_at)<end&&Date.parse(x.starts_at)+x.duration_minutes*60000>start))error(409,'Overlapping appointment for this conversation');
    const bookingId=randomUUID();
    run('INSERT INTO support_bookings VALUES(?,?,?,?,?,?,?)',workspace,bookingId,input.slotId,input.ticketId,'confirmed_local',clock(),clock());
    result=one('SELECT * FROM support_bookings WHERE workspace=? AND id=?',workspace,bookingId);
   }
   db.exec('COMMIT');
  }catch(e){db.exec('ROLLBACK');throw e;}
  audit(workspace,'support.booking_confirmed','customer',result.id);
  base.emitSupportEvent?.(workspace,'support.booking_confirmed',input.ticketId);
  return bookings(workspace,{ticketId:input.ticketId}).find(b=>b.id===result.id);
 }
 function cancelBooking(workspace,input){
  validateWorkspace(workspace);
  if(!input||typeof input!=='object')error(400,'Invalid booking');
  id(input.bookingId);
  base.thread(workspace,{ticketId:input.ticketId,sessionToken:input.sessionToken});
  const booking=one('SELECT * FROM support_bookings WHERE workspace=? AND id=? AND ticket_id=?',workspace,input.bookingId,input.ticketId);
  if(!booking)error(404,'Booking not found');
  if(booking.status==='confirmed_local'){
   run(`UPDATE support_bookings SET status='cancelled',updated_at=? WHERE workspace=? AND id=?`,clock(),workspace,input.bookingId);
   audit(workspace,'support.booking_cancelled','customer',booking.id);
   base.emitSupportEvent?.(workspace,'support.booking_cancelled',input.ticketId);
  }
  return {cancelled:true};
 }
 function selfExport(workspace,input){
  const record=base.thread(workspace,input);
  const detail=base.ticketDetail(workspace,record.ticketId);
  return {ticket:detail.ticket,messages:record.messages,appointments:detail.appointments,bookingHistory:bookings(workspace,{ticketId:record.ticketId}),rating:detail.rating,files:attachments(workspace,record.ticketId)};
 }
 function selfErase(workspace,input){
  const record=base.thread(workspace,input);
  run('DELETE FROM support_tickets WHERE workspace=? AND id=?',workspace,record.ticketId);
  audit(workspace,'support.customer_self_erased','customer',record.ticketId);
  return {erased:true};
 }
 function reports(workspace,days=7){
  validateWorkspace(workspace);
  if(![7,30,90].includes(days))error(400,'Invalid reporting window');
  const now=clock(),baseDay=Math.floor(now/DAY)*DAY;
  const daily=[];
  for(let i=days-1;i>=0;i--){
   const from=baseDay-i*DAY,to=from+DAY;
   daily.push({date:new Date(from).toISOString().slice(0,10),
    tickets:one('SELECT COUNT(*) AS n FROM support_tickets WHERE workspace=? AND created_at>=? AND created_at<?',workspace,from,to).n,
    resolved:one("SELECT COUNT(*) AS n FROM support_tickets WHERE workspace=? AND status='resolved' AND updated_at>=? AND updated_at<?",workspace,from,to).n,
    ratings:one('SELECT COUNT(*) AS n FROM support_ratings WHERE workspace=? AND updated_at>=? AND updated_at<?',workspace,from,to).n});
  }
  return {days,daily,metrics:base.metrics(workspace)};
 }
 function auditEvents(workspace){
  validateWorkspace(workspace);
  return many('SELECT id,action,actor,subject_id AS subjectId,created_at AS createdAt FROM support_audit WHERE workspace=? ORDER BY created_at DESC LIMIT 100',workspace);
 }
 function attachments(workspace,ticketId){
  validateWorkspace(workspace);id(ticketId);
  base.ticketDetail(workspace,ticketId);
  return many('SELECT id,name,mime,bytes_count AS size,uploaded_by AS uploadedBy,created_at AS createdAt FROM support_attachments WHERE workspace=? AND ticket_id=? ORDER BY created_at,id LIMIT 20',workspace,ticketId);
 }
 function sessionAttachments(workspace,input){
  const record=base.thread(workspace,input);
  return attachments(workspace,record.ticketId);
 }
 function uploadAttachment(workspace,input,{staff=false}={}){
  validateWorkspace(workspace);
  if(!input||typeof input!=='object'||Array.isArray(input))error(400,'Invalid attachment request');
  id(input.ticketId);
  if(staff)base.ticketDetail(workspace,input.ticketId);
  else base.thread(workspace,{ticketId:input.ticketId,sessionToken:input.sessionToken});
  const name=field(input.name,120,'file name');
  if(!/^[\p{L}\p{N}][\p{L}\p{N}._ ()-]*$/u.test(name)||name.includes('..'))error(400,'Invalid file name');
  const mime=field(input.mime,60,'content type').toLowerCase();
  const allowed={'application/pdf':['pdf'],'image/png':['png'],'image/jpeg':['jpg','jpeg'],'text/plain':['txt'],'text/csv':['csv']};
  if(!allowed[mime]||!allowed[mime].includes(name.split('.').at(-1).toLowerCase()))error(400,'File type does not match extension');
  const encoded=field(input.contentBase64,1500000,'file content');
  if(!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded))error(400,'Invalid file encoding');
  const buffer=Buffer.from(encoded,'base64');
  if(buffer.toString('base64')!==encoded||!buffer.length)error(400,'Invalid file encoding');
  if(buffer.length>1024*1024)error(413,'File exceeds 1 MiB limit');
  if(mime==='application/pdf'&&!buffer.subarray(0,5).equals(Buffer.from('%PDF-')))error(400,'Invalid PDF signature');
  if(mime==='image/png'&&!buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))error(400,'Invalid PNG signature');
  if(mime==='image/jpeg'&&!buffer.subarray(0,3).equals(Buffer.from([255,216,255])))error(400,'Invalid JPEG signature');
  if(mime==='text/plain'||mime==='text/csv'){
   let text;
   try{text=new TextDecoder('utf-8',{fatal:true}).decode(buffer);}catch{error(400,'Text file must be UTF-8');}
   if(text.includes('\0')||/<\s*(?:script|iframe|svg|html)[\s>]/i.test(text))error(400,'Active HTML content is not permitted as a text attachment');
  }
  if(one('SELECT COUNT(*) AS n FROM support_attachments WHERE workspace=? AND ticket_id=?',workspace,input.ticketId).n>=8)error(409,'At most eight attachments per ticket');
  if(one('SELECT COALESCE(SUM(bytes_count),0) AS total FROM support_attachments WHERE workspace=?',workspace).total+buffer.length>32*1024*1024)error(409,'Workspace file capacity reached');
  const fileId=randomUUID();
  run('INSERT INTO support_attachments(workspace,id,ticket_id,name,mime,content,bytes_count,uploaded_by,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
   workspace,fileId,input.ticketId,name,mime,buffer,buffer.length,staff?'agent':'customer',clock());
  audit(workspace,'support.attachment_uploaded',staff?'staff':'customer',fileId);
  if(!staff)base.emitSupportEvent?.(workspace,'support.customer_replied',input.ticketId);
  return attachments(workspace,input.ticketId).find(file=>file.id===fileId);
 }
 function readAttachment(workspace,fileId,{ticketId,sessionToken,staff=false}={}){
  validateWorkspace(workspace);id(fileId);
  if(staff){
   if(!ticketId)error(400,'Ticket required');
   base.ticketDetail(workspace,id(ticketId));
  }else base.thread(workspace,{ticketId,sessionToken});
  const row=one('SELECT * FROM support_attachments WHERE workspace=? AND id=? AND ticket_id=?',workspace,fileId,ticketId);
  if(!row)error(404,'Attachment not found');
  return {id:row.id,name:row.name,mime:row.mime,size:row.bytes_count,contentBase64:Buffer.from(row.content).toString('base64')};
 }
 function eraseWorkspace(workspace){
  validateWorkspace(workspace);
  base.eraseWorkspace(workspace);
  for(const table of ['support_team_sessions','support_team','support_macros','support_notifications','support_sla','support_audit','support_bookings','support_slots','support_routing_rules'])
   run('DELETE FROM '+table+' WHERE workspace=?',workspace);
 }
 function expire({days=180}={}){
  const removed=base.expire({days});
  run('DELETE FROM support_team_sessions WHERE expires_at<?',clock());
  run('DELETE FROM support_audit WHERE created_at<?',clock()-days*DAY);
  return removed;
 }
 return {...base,createStaff,team,editStaff,login,roleOf,logout,macros,createMacro,updateMacro,deleteMacro,
  notes,addNote,ticketDetail,exportEmail,bulkArticles,articleSearch,ticketSearch,
  listNotifications,markNotification,sla,updateSla,alerts,slots,createSlot,updateSlot,bookings,book,cancelBooking,
  attachments,sessionAttachments,uploadAttachment,readAttachment,selfExport,selfErase,reports,auditEvents,audit,onSupportEvent,routingRules,createRoutingRule,deleteRoutingRule,eraseWorkspace,expire};
}
