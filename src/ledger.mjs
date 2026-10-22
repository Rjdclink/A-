import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {createHash,createHmac} from 'node:crypto';
import {validateEvent} from './analytics.mjs';
import {validateWorkspace} from './security.mjs';
import {experimentVariant,compareRates} from './experiments.mjs';
const DAY=86_400_000;
function fail(status,message){const error=Error(message);error.status=status;throw error;}
function safeId(id){if(typeof id!=='string'||id.length>150||!/^[a-z0-9_:.\/-]+$/i.test(id))fail(400,'Invalid stable event ID');return id;}
function amountCents(value){const cents=Math.round(value*100);if(!Number.isSafeInteger(cents)||Math.abs(cents-value*100)>1e-6)fail(400,'Invalid monetary precision; use 2 decimal places');return cents;}
const schema=
`CREATE TABLE IF NOT EXISTS events (
 workspace TEXT NOT NULL, id TEXT NOT NULL, type TEXT NOT NULL,
 cents INTEGER NOT NULL, campaign TEXT NOT NULL,
 customer_hash TEXT, digest TEXT NOT NULL, occurred_at INTEGER NOT NULL,
 PRIMARY KEY(workspace,id)
);
CREATE INDEX IF NOT EXISTS events_by_workspace_time ON events(workspace,occurred_at);
CREATE INDEX IF NOT EXISTS events_by_customer ON events(workspace,customer_hash);
CREATE TABLE IF NOT EXISTS experiments (
 workspace TEXT NOT NULL, id TEXT NOT NULL, created_at INTEGER NOT NULL,
 PRIMARY KEY(workspace,id)
);
CREATE TABLE IF NOT EXISTS assignments (
 workspace TEXT NOT NULL, experiment_id TEXT NOT NULL, subject_hash TEXT NOT NULL,
 variant TEXT NOT NULL CHECK(variant IN ('control','treatment')),
 assigned_at INTEGER NOT NULL,
 PRIMARY KEY(workspace,experiment_id,subject_hash),
 FOREIGN KEY(workspace,experiment_id) REFERENCES experiments(workspace,id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS assignments_by_workspace ON assignments(workspace,experiment_id,variant);
CREATE TABLE IF NOT EXISTS privacy_requests (
 workspace TEXT NOT NULL, request_id TEXT NOT NULL, customer_hash TEXT NOT NULL,
 created_at INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
 PRIMARY KEY(workspace,request_id)
);
CREATE TABLE IF NOT EXISTS redacted_customers (
 workspace TEXT NOT NULL, subject_hash TEXT NOT NULL, redacted_at INTEGER NOT NULL,
 PRIMARY KEY(workspace,subject_hash)
);
CREATE TABLE IF NOT EXISTS redacted_orders (
 workspace TEXT NOT NULL, id TEXT NOT NULL, redacted_at INTEGER NOT NULL,
 PRIMARY KEY(workspace,id)
);
CREATE TABLE IF NOT EXISTS disabled_shops (
 workspace TEXT NOT NULL, domain TEXT NOT NULL, disabled_at INTEGER NOT NULL,
 PRIMARY KEY(workspace,domain)
);`;
export class Ledger{
 constructor(dbPath=':memory:',{pseudonymKey,maxEvents=500000}={}){
  if(typeof pseudonymKey!=='string'||pseudonymKey.length<24)throw Error('A stable PSEUDONYM_KEY of 24+ characters is required');
  if(!Number.isSafeInteger(maxEvents)||maxEvents<1||maxEvents>10000000)throw Error('Invalid MAX_EVENTS capacity');
  this.key=pseudonymKey;this.maxEvents=maxEvents;
  if(dbPath!==':memory:')mkdirSync(dirname(resolve(dbPath)),{recursive:true});
  this.db=new DatabaseSync(dbPath,{timeout:5000});
  this.db.exec('PRAGMA foreign_keys=ON;');
  if(dbPath!==':memory:')this.db.exec('PRAGMA journal_mode=WAL;');
  this.db.exec(schema);
  this.eventCount=this.db.prepare('SELECT COUNT(*) AS n FROM events').get().n;
 }
 close(){this.db.close();}
 hash(workspace,subject){return createHmac('sha256',this.key).update(JSON.stringify([workspace,String(subject)])).digest('hex');}
 add(workspace,id,input,now=Date.now()){
  validateWorkspace(workspace);safeId(id);
  const e=validateEvent(input);
  const cents=e.type==='purchase'?amountCents(e.value):0;
  const subject=e.customerId?this.hash(workspace,e.customerId):null;
  if(subject&&this.db.prepare('SELECT 1 FROM redacted_customers WHERE workspace=? AND subject_hash=?').get(workspace,subject))return {status:'suppressed'};
  if(this.db.prepare('SELECT 1 FROM redacted_orders WHERE workspace=? AND id=?').get(workspace,id))return {status:'suppressed'};
  const digest=createHash('sha256').update(JSON.stringify([e.type,cents,e.currency,e.campaign,subject,e.consent])).digest('hex');
  this.db.exec('BEGIN IMMEDIATE');
  try{
   const existing=this.db.prepare('SELECT digest FROM events WHERE workspace=? AND id=?').get(workspace,id);
   if(existing){if(existing.digest!==digest)fail(409,'Event ID reused with different details');this.db.exec('COMMIT');return {status:'duplicate'};}
   if(this.eventCount>=this.maxEvents)fail(507,'Event capacity reached');
   this.db.prepare('INSERT INTO events(workspace,id,type,cents,campaign,customer_hash,digest,occurred_at) VALUES (?,?,?,?,?,?,?,?)').run(workspace,id,e.type,cents,e.campaign,subject,digest,now);
   this.db.exec('COMMIT');this.eventCount++;return {status:'created'};
  }catch(err){this.db.exec('ROLLBACK');throw err;}
 }
 overview(workspace,{now=Date.now(),days=30}={}){
  validateWorkspace(workspace);if(!Number.isInteger(days)||days<1||days>366)fail(400,'Invalid reporting window');
  const rows=this.db.prepare('SELECT type,campaign,COUNT(*) AS n,SUM(cents) AS cents FROM events WHERE workspace=? AND occurred_at>=? AND occurred_at<=? GROUP BY type,campaign').all(workspace,now-days*DAY,now);
  const count={visit:0,view:0,cart:0,checkout:0,purchase:0,lead:0};const byCampaign=Object.create(null);let cents=0;
  for(const row of rows){count[row.type]+=row.n;const c=byCampaign[row.campaign]??={visits:0,carts:0,purchases:0,revenue:0};if(row.type==='visit')c.visits+=row.n;if(row.type==='cart')c.carts+=row.n;if(row.type==='purchase'){c.purchases+=row.n;c.revenue+=row.cents/100;cents+=row.cents;}}
  for(const c of Object.values(byCampaign))c.revenue=Math.round(c.revenue*100)/100;
  return {visits:count.visit,views:count.view,carts:count.cart,checkouts:count.checkout,purchases:count.purchase,leads:count.lead,revenue:cents/100,currency:'USD',windowDays:days,conversionRate:count.visit?Math.round(count.purchase/count.visit*10000)/100:null,byCampaign};
 }
 eraseCustomer(workspace,subject){validateWorkspace(workspace);const hash=this.hash(workspace,subject);this.db.exec('BEGIN IMMEDIATE');try{this.db.prepare('INSERT OR IGNORE INTO redacted_customers(workspace,subject_hash,redacted_at) VALUES(?,?,?)').run(workspace,hash,Date.now());const deleted=this.db.prepare('DELETE FROM events WHERE workspace=? AND customer_hash=?').run(workspace,hash).changes;this.db.prepare('DELETE FROM assignments WHERE workspace=? AND subject_hash=?').run(workspace,hash);this.db.exec('COMMIT');this.eventCount-=deleted;return deleted;}catch(e){this.db.exec('ROLLBACK');throw e;}}
 eraseWorkspace(workspace,{shopDomain}={}){validateWorkspace(workspace);this.db.exec('BEGIN IMMEDIATE');try{if(shopDomain)this.db.prepare('INSERT OR IGNORE INTO disabled_shops(workspace,domain,disabled_at) VALUES(?,?,?)').run(workspace,shopDomain,Date.now());this.db.prepare('DELETE FROM redacted_customers WHERE workspace=?').run(workspace);this.db.prepare('DELETE FROM redacted_orders WHERE workspace=?').run(workspace);const deleted=this.db.prepare('DELETE FROM events WHERE workspace=?').run(workspace).changes;this.db.prepare('DELETE FROM assignments WHERE workspace=?').run(workspace);this.db.prepare('DELETE FROM experiments WHERE workspace=?').run(workspace);this.db.prepare('DELETE FROM privacy_requests WHERE workspace=?').run(workspace);this.db.exec('COMMIT');this.eventCount-=deleted;}catch(e){this.db.exec('ROLLBACK');throw e;}}
 redactShopifyOrders(workspace,domain,orderIds){
  validateWorkspace(workspace);
  if(!Array.isArray(orderIds)||orderIds.length>1000)fail(400,'Invalid Shopify redaction order list');
  const ids=new Set(orderIds.map(value=>{
   if(!['number','string'].includes(typeof value)||!Number.isSafeInteger(Number(value))||Number(value)<1)fail(400,'Invalid Shopify order reference');
   return 'shopify:'+domain+':'+String(value);
  }));
  this.db.exec('BEGIN IMMEDIATE');let removed=0;
  try{
   for(const id of ids){this.db.prepare('INSERT OR IGNORE INTO redacted_orders(workspace,id,redacted_at) VALUES(?,?,?)').run(workspace,id,Date.now());removed+=this.db.prepare('DELETE FROM events WHERE workspace=? AND id=?').run(workspace,id).changes;}
   this.db.exec('COMMIT');this.eventCount-=removed;return removed;
  }catch(e){this.db.exec('ROLLBACK');throw e;}
 }
 shopActive(workspace,domain){validateWorkspace(workspace);return !this.db.prepare('SELECT 1 FROM disabled_shops WHERE workspace=? AND domain=?').get(workspace,domain);}
 eraseOld({now=Date.now(),days=180}={}){if(!Number.isInteger(days)||days<30||days>730)fail(400,'Invalid retention period');const edge=now-days*DAY;this.db.exec('BEGIN IMMEDIATE');try{const n=this.db.prepare('DELETE FROM events WHERE occurred_at<?').run(edge).changes;this.db.prepare('DELETE FROM assignments WHERE assigned_at<?').run(edge);this.db.prepare("DELETE FROM privacy_requests WHERE status='completed' AND created_at<?").run(edge);this.db.exec('COMMIT');this.eventCount-=n;return n;}catch(e){this.db.exec('ROLLBACK');throw e;}}
 createExperiment(workspace,id,now=Date.now()){validateWorkspace(workspace);safeId(id);if(id.length>60)fail(400,'Experiment name too long');const out=this.db.prepare('INSERT OR IGNORE INTO experiments(workspace,id,created_at) VALUES (?,?,?)').run(workspace,id,now);return out.changes?'created':'existing';}
 assign(workspace,experiment,subject,{consent,now=Date.now()}={}){
  validateWorkspace(workspace);safeId(experiment);if(consent!==true)fail(400,'Experiment assignment requires consent');if(typeof subject!=='string'||subject.length<1||subject.length>120)fail(400,'Invalid subject token');
  const exp=this.db.prepare('SELECT id FROM experiments WHERE workspace=? AND id=?').get(workspace,experiment);if(!exp)fail(404,'Unknown experiment');
  const hash=this.hash(workspace,subject);const variant=experimentVariant(workspace,experiment,subject,this.key);
  this.db.prepare('INSERT OR IGNORE INTO assignments(workspace,experiment_id,subject_hash,variant,assigned_at) VALUES(?,?,?,?,?)').run(workspace,experiment,hash,variant,now);
  const row=this.db.prepare('SELECT variant FROM assignments WHERE workspace=? AND experiment_id=? AND subject_hash=?').get(workspace,experiment,hash);return row.variant;
 }
 experimentReport(workspace,experiment){validateWorkspace(workspace);safeId(experiment);if(!this.db.prepare('SELECT 1 FROM experiments WHERE workspace=? AND id=?').get(workspace,experiment))fail(404,'Unknown experiment');
  const rows=this.db.prepare(`SELECT a.variant AS variant,COUNT(*) AS n,
   SUM(CASE WHEN EXISTS (SELECT 1 FROM events e WHERE e.workspace=a.workspace AND e.customer_hash=a.subject_hash AND e.type='purchase' AND e.occurred_at>=a.assigned_at AND e.occurred_at<=a.assigned_at+?) THEN 1 ELSE 0 END) AS conversions
   FROM assignments a WHERE a.workspace=? AND a.experiment_id=? GROUP BY a.variant`).all(14*DAY,workspace,experiment);
  const results={control:{n:0,conversions:0},treatment:{n:0,conversions:0}};
  for(const row of rows)results[row.variant]={n:row.n,conversions:row.conversions};
  return {experiment,conversionWindowDays:14,results,analysis:compareRates(results)};
 }
 privacyRequest(workspace,id,customer,now=Date.now()){validateWorkspace(workspace);safeId(id);this.db.prepare('INSERT OR IGNORE INTO privacy_requests(workspace,request_id,customer_hash,created_at) VALUES(?,?,?,?)').run(workspace,id,this.hash(workspace,customer),now);}
 completePrivacyRequest(workspace,id){validateWorkspace(workspace);safeId(id);return this.db.prepare("UPDATE privacy_requests SET status='completed' WHERE workspace=? AND request_id=? AND status='pending'").run(workspace,id).changes>0;}
 pendingPrivacyRequests(workspace){validateWorkspace(workspace);return this.db.prepare('SELECT request_id,status,created_at FROM privacy_requests WHERE workspace=? ORDER BY created_at DESC LIMIT 100').all(workspace);}
 exportCustomer(workspace,customer){validateWorkspace(workspace);return this.db.prepare('SELECT type,cents,campaign,occurred_at FROM events WHERE workspace=? AND customer_hash=? ORDER BY occurred_at DESC LIMIT 1000').all(workspace,this.hash(workspace,customer)).map(e=>({type:e.type,value:e.cents/100,campaign:e.campaign,occurredAt:new Date(e.occurred_at).toISOString()}));}
}
