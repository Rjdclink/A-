import {randomUUID} from 'node:crypto';
import {inspectWebsite,normalizePublicURL} from '../integrations/recovery/src/scanner.mjs';
import {analyzeOpportunity,draftLeadReply} from '../integrations/recovery/src/ai.mjs';
import {allowRecurse} from '../integrations/recovery/src/workflows.mjs';
function fail(message,status=400){const e=Error(message);e.status=status;throw e;}
const email=/^[^@\s]+@[^@\s]+\.[^@\s]+$/;
export function createRecovery(db,{inspect=inspectWebsite,analyze=analyzeOpportunity,clock=()=>Date.now(),mail=null,onOpportunity=null}={}){
 db.exec("CREATE TABLE IF NOT EXISTS growth_sites(workspace TEXT NOT NULL,id TEXT NOT NULL,website TEXT NOT NULL,title TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'pending',observation TEXT,analysis TEXT,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,PRIMARY KEY(workspace,id),UNIQUE(workspace,website));");
 db.exec("CREATE TABLE IF NOT EXISTS growth_leads(workspace TEXT NOT NULL,id TEXT NOT NULL,name TEXT NOT NULL,email TEXT NOT NULL,inquiry TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'new',created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,PRIMARY KEY(workspace,id));");
 db.exec("CREATE TABLE IF NOT EXISTS growth_outreach(workspace TEXT NOT NULL,id TEXT NOT NULL,site_id TEXT NOT NULL,recipient TEXT NOT NULL,subject TEXT NOT NULL,body TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'draft',sent_at INTEGER,created_at INTEGER NOT NULL,PRIMARY KEY(workspace,id));");
 db.exec("CREATE INDEX IF NOT EXISTS growth_outreach_site ON growth_outreach(workspace,site_id);");
 db.exec("CREATE TABLE IF NOT EXISTS growth_routines(workspace TEXT PRIMARY KEY,enabled INTEGER NOT NULL DEFAULT 0,interval_hours INTEGER NOT NULL DEFAULT 24,next_run_at INTEGER NOT NULL DEFAULT 0,discover_enabled INTEGER NOT NULL DEFAULT 0);");
 if(!db.prepare('PRAGMA table_info(growth_routines)').all().some(c=>c.name==='discover_enabled'))db.exec('ALTER TABLE growth_routines ADD COLUMN discover_enabled INTEGER NOT NULL DEFAULT 0');
 const one=(sql,...args)=>db.prepare(sql).get(...args);
 const all=(sql,...args)=>db.prepare(sql).all(...args);
 const run=(sql,...args)=>db.prepare(sql).run(...args);
 const site=row=>row?{...row,observation:row.observation?JSON.parse(row.observation):null,analysis:row.analysis?JSON.parse(row.analysis):null}:null;
 async function scan(workspace,website){
  let url;try{url=normalizePublicURL(website).origin;}catch{fail('Provide a public HTTP(S) website');}
  const existing=one('SELECT * FROM growth_sites WHERE workspace=? AND website=?',workspace,url);
  const id=existing?.id||randomUUID(),stamp=clock();
  if(!existing)run('INSERT INTO growth_sites(workspace,id,website,created_at,updated_at) VALUES(?,?,?,?,?)',workspace,id,url,stamp,stamp);
  run('UPDATE growth_sites SET status=?,updated_at=? WHERE workspace=? AND id=?','scanning',stamp,workspace,id);
  try{
   const observation=await inspect(url,{maxSupporting:4});
   const analysis=await analyze(observation);
   const updated=clock();
   const routine=one('SELECT discover_enabled FROM growth_routines WHERE workspace=?',workspace);
   if(routine?.discover_enabled){
    const host=new URL(url).hostname;
    let count=one('SELECT COUNT(*) AS n FROM growth_sites WHERE workspace=?',workspace).n;
    for(const link of (observation.external_links||[]).slice(0,20)){
     if(count>=50)break;
     if(!allowRecurse(link.url,host,link.label))continue;
     let candidate;try{candidate=normalizePublicURL(link.url).origin;}catch{continue;}
     if(candidate===url)continue;
     if(run('INSERT OR IGNORE INTO growth_sites(workspace,id,website,created_at,updated_at) VALUES(?,?,?,?,?)',workspace,randomUUID(),candidate,updated,updated).changes)count++;
    }
   }
   run('UPDATE growth_sites SET title=?,status=?,observation=?,analysis=?,updated_at=? WHERE workspace=? AND id=?',String(analysis.company_name||observation.title||url).slice(0,180),'analyzed',JSON.stringify(observation),JSON.stringify(analysis),updated,workspace,id);
   const recipient=observation.public_contact_emails?.[0];
   if(recipient&&email.test(recipient)&&analysis.email_subject&&analysis.email_body&&!one("SELECT id FROM growth_outreach WHERE workspace=? AND site_id=? AND status='draft'",workspace,id)){
    run('INSERT INTO growth_outreach VALUES (?,?,?,?,?,?,?,?,?)',workspace,randomUUID(),id,recipient,String(analysis.email_subject).slice(0,150),String(analysis.email_body).slice(0,4500),'draft',null,updated);
   }
   const current=site(one('SELECT * FROM growth_sites WHERE workspace=? AND id=?',workspace,id));
   if(onOpportunity)try{await onOpportunity(workspace,current);}catch(e){console.warn('Opportunity trigger failed:',String(e.message).slice(0,120));}
   return current;
  }catch(e){run('UPDATE growth_sites SET status=?,updated_at=? WHERE workspace=? AND id=?','failed',clock(),workspace,id);throw e;}
 }
 async function handle(workspace,path,method,payload={}){
  if(path==='overview'&&method==='GET'){
   const sites=one('SELECT COUNT(*) AS n FROM growth_sites WHERE workspace=?',workspace).n;
   const analyzed=one("SELECT COUNT(*) AS n FROM growth_sites WHERE workspace=? AND status='analyzed'",workspace).n;
   const leads=one('SELECT COUNT(*) AS n FROM growth_leads WHERE workspace=?',workspace).n;
   const drafts=one("SELECT COUNT(*) AS n FROM growth_outreach WHERE workspace=? AND status='draft'",workspace).n;
   return {sites,analyzed,leads,drafts};
  }
  if(path==='sites'&&method==='GET')return {sites:all('SELECT * FROM growth_sites WHERE workspace=? ORDER BY updated_at DESC LIMIT 100',workspace).map(site)};
  if(path==='scan'&&method==='POST'){if(typeof payload.website!=='string'||payload.website.length>2048)fail('Website URL required');return {site:await scan(workspace,payload.website)};}
  if(path==='leads'&&method==='GET')return {leads:all('SELECT * FROM growth_leads WHERE workspace=? ORDER BY created_at DESC LIMIT 100',workspace)};
  if(path==='leads'&&method==='POST'){
   if(typeof payload.name!=='string'||!payload.name.trim()||payload.name.length>120||typeof payload.email!=='string'||!email.test(payload.email)||payload.email.length>254||typeof payload.inquiry!=='string'||!payload.inquiry.trim()||payload.inquiry.length>4000)fail('Invalid lead details');
   const id=randomUUID(),stamp=clock();
   run('INSERT INTO growth_leads VALUES (?,?,?,?,?,?,?,?)',workspace,id,payload.name.trim(),payload.email.toLowerCase().trim(),payload.inquiry,'new',stamp,stamp);
   return {lead:one('SELECT * FROM growth_leads WHERE workspace=? AND id=?',workspace,id)};
  }
  const status=path.match(/^leads\/([0-9a-f-]{36})\/status$/i);
  if(status&&method==='POST'){
   if(!['new','contacted','qualified','won','closed'].includes(payload.status))fail('Invalid lead status');
   if(!run('UPDATE growth_leads SET status=?,updated_at=? WHERE workspace=? AND id=?',payload.status,clock(),workspace,status[1]).changes)fail('Lead not found',404);
   return {lead:one('SELECT * FROM growth_leads WHERE workspace=? AND id=?',workspace,status[1])};
  }
  const reply=path.match(/^leads\/([0-9a-f-]{36})\/reply$/i);
  if(reply&&method==='POST'){
   const lead=one('SELECT * FROM growth_leads WHERE workspace=? AND id=?',workspace,reply[1]);if(!lead)fail('Lead not found',404);
   return {draft:await draftLeadReply(lead,{name:String(payload.business_name||workspace).slice(0,120),services:String(payload.services||'').slice(0,2000),faq:String(payload.faq||'').slice(0,2000)})};
  }
  if(path==='outreach'&&method==='GET')return {outreach:all('SELECT * FROM growth_outreach WHERE workspace=? ORDER BY created_at DESC LIMIT 100',workspace)};
  const sending=path.match(/^outreach\/([0-9a-f-]{36})\/send$/i);
  if(sending&&method==='POST'){
   const row=one('SELECT * FROM growth_outreach WHERE workspace=? AND id=?',workspace,sending[1]);if(!row)fail('Draft not found',404);
   if(row.status!=='draft')fail('Message already processed',409);
   if(payload.confirm!==true)fail('Explicit confirmation required');
   if(!mail)fail('Mail transport is not configured',503);
   await mail({to:row.recipient,subject:row.subject,text:row.body});
   run("UPDATE growth_outreach SET status='sent',sent_at=? WHERE workspace=? AND id=? AND status='draft'",clock(),workspace,row.id);
   return {sent:true,id:row.id};
  }
  if(path==='routines'&&method==='GET')return {routine:one('SELECT * FROM growth_routines WHERE workspace=?',workspace)||{workspace,enabled:0,interval_hours:24,discover_enabled:0}};
  if(path==='routines'&&method==='POST'){
   if(typeof payload.enabled!=='boolean'||!Number.isInteger(payload.interval_hours)||payload.interval_hours<1||payload.interval_hours>168||payload.discover!==undefined&&typeof payload.discover!=='boolean')fail('Invalid schedule');
   run('INSERT INTO growth_routines(workspace,enabled,interval_hours,next_run_at,discover_enabled) VALUES (?,?,?,?,?) ON CONFLICT(workspace) DO UPDATE SET enabled=excluded.enabled,interval_hours=excluded.interval_hours,next_run_at=excluded.next_run_at,discover_enabled=excluded.discover_enabled',workspace,Number(payload.enabled),payload.interval_hours,clock()+payload.interval_hours*3600000,Number(payload.discover===true));
   return {routine:one('SELECT * FROM growth_routines WHERE workspace=?',workspace)};
  }
  fail('Recovery route not found',404);
 }
 let busy=false;
 async function tick(){
  if(busy)return 0;busy=true;
  try{
   let count=0;
   for(const r of all('SELECT * FROM growth_routines WHERE enabled=1 AND next_run_at<=? LIMIT 3',clock())){
    run('UPDATE growth_routines SET next_run_at=? WHERE workspace=?',clock()+r.interval_hours*3600000,r.workspace);
    const s=one("SELECT website FROM growth_sites WHERE workspace=? AND status!='scanning' ORDER BY CASE WHEN status='pending' THEN 0 ELSE 1 END,updated_at ASC LIMIT 1",r.workspace);
    if(s){try{await scan(r.workspace,s.website);count++;}catch(e){console.warn('Recovery scan failed:',String(e.message).slice(0,130));}}
   }
   return count;
  }finally{busy=false;}
 }
 function eraseWorkspace(workspace){for(const table of ['growth_sites','growth_leads','growth_outreach','growth_routines'])run('DELETE FROM '+table+' WHERE workspace=?',workspace);}
 return {handle,tick,scan,eraseWorkspace};
}
