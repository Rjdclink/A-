import {DatabaseSync} from 'node:sqlite';
import {randomBytes,randomUUID,createHash,scryptSync,timingSafeEqual} from 'node:crypto';

export const id=()=>randomUUID();
export const sha256=x=>createHash('sha256').update(String(x)).digest('hex');
export const json=x=>JSON.stringify(x);
export const parse=(x,alternative={})=>{try{return JSON.parse(x)}catch{return alternative}};
export const now=()=>Date.now();
export function hashPassword(password){
 if(typeof password!=='string'||password.length<12||password.length>256)throw Error('Password must contain 12-256 characters');
 const salt=randomBytes(16).toString('hex');return `scrypt:${salt}:${scryptSync(password,salt,64).toString('hex')}`;
}
export function passwordMatches(password,hash){
 try{const [kind,salt,hex]=hash.split(':');if(kind!=='scrypt')return false;
 const original=Buffer.from(hex,'hex'),computed=scryptSync(String(password),salt,64);
 return original.length===computed.length&&timingSafeEqual(original,computed);
 }catch{return false;}
}
export function openDatabase(path='data/growthveyra.sqlite'){
 const db=new DatabaseSync(path);
 db.exec(`PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS tenants(id TEXT PRIMARY KEY,name TEXT NOT NULL,created_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL REFERENCES tenants(id),email TEXT NOT NULL UNIQUE,password_hash TEXT NOT NULL,role TEXT NOT NULL DEFAULT 'admin',created_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),expires_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS connections(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL REFERENCES tenants(id),name TEXT NOT NULL,host TEXT NOT NULL,auth_type TEXT NOT NULL,secret_cipher TEXT NOT NULL,created_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS billing_accounts(tenant_id TEXT PRIMARY KEY REFERENCES tenants(id),plan TEXT NOT NULL,status TEXT NOT NULL,reference_id TEXT UNIQUE,checkout_order_id TEXT UNIQUE,checkout_link_id TEXT,square_customer_id TEXT,subscription_id TEXT UNIQUE,updated_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS billing_events(event_id TEXT PRIMARY KEY,provider TEXT NOT NULL,created_at INTEGER NOT NULL);

 CREATE INDEX IF NOT EXISTS connections_tenant ON connections(tenant_id,name);
 CREATE TABLE IF NOT EXISTS webhook_events(workflow_id TEXT NOT NULL REFERENCES workflows(id),event_hash TEXT NOT NULL,run_id TEXT NOT NULL REFERENCES runs(id),created_at INTEGER NOT NULL,PRIMARY KEY(workflow_id,event_hash));
 CREATE TABLE IF NOT EXISTS workflows(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL REFERENCES tenants(id),name TEXT NOT NULL,spec TEXT NOT NULL,trigger TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 1,next_run_at INTEGER,hook_hash TEXT,allow_external INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL REFERENCES tenants(id),workflow_id TEXT NOT NULL REFERENCES workflows(id),status TEXT NOT NULL,input TEXT NOT NULL,state TEXT NOT NULL,cursor TEXT,attempts INTEGER NOT NULL DEFAULT 0,available_at INTEGER NOT NULL,leased_at INTEGER,error TEXT NOT NULL DEFAULT '',created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,spec_snapshot TEXT,allow_external_snapshot INTEGER,manual_retries INTEGER NOT NULL DEFAULT 0,ai_invocations INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS action_receipts(run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,step_id TEXT NOT NULL,response TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(run_id,step_id));
 CREATE TABLE IF NOT EXISTS child_runs(parent_run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,parent_step_id TEXT NOT NULL,child_run_id TEXT NOT NULL UNIQUE REFERENCES runs(id) ON DELETE CASCADE,created_at INTEGER NOT NULL,PRIMARY KEY(parent_run_id,parent_step_id));
 CREATE INDEX IF NOT EXISTS child_runs_parent ON child_runs(parent_run_id,created_at);
 CREATE TABLE IF NOT EXISTS ai_calls(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL REFERENCES tenants(id),run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,step_id TEXT NOT NULL,agent_name TEXT,provider TEXT NOT NULL,model TEXT NOT NULL,prompt_tokens INTEGER,completion_tokens INTEGER,total_tokens INTEGER,created_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS blueprint_requests(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL REFERENCES tenants(id),created_at INTEGER NOT NULL);
 CREATE INDEX IF NOT EXISTS blueprint_requests_tenant ON blueprint_requests(tenant_id,created_at);
 CREATE INDEX IF NOT EXISTS ai_calls_run ON ai_calls(run_id,created_at);
 CREATE INDEX IF NOT EXISTS ai_calls_tenant ON ai_calls(tenant_id,created_at);
 CREATE INDEX IF NOT EXISTS runs_tenant_time ON runs(tenant_id,created_at DESC);
 CREATE INDEX IF NOT EXISTS runs_ready ON runs(status,available_at);
 CREATE INDEX IF NOT EXISTS workflows_schedule ON workflows(enabled,next_run_at);
 CREATE TABLE IF NOT EXISTS approvals(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL REFERENCES tenants(id),run_id TEXT NOT NULL REFERENCES runs(id),step_id TEXT NOT NULL,message TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',actor TEXT,created_at INTEGER NOT NULL,resolved_at INTEGER,UNIQUE(run_id,step_id));
 CREATE TABLE IF NOT EXISTS knowledge(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL REFERENCES tenants(id),name TEXT NOT NULL,content TEXT NOT NULL,created_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS logs(id TEXT PRIMARY KEY,run_id TEXT NOT NULL REFERENCES runs(id),tenant_id TEXT NOT NULL,step_id TEXT,event TEXT NOT NULL,detail TEXT NOT NULL,created_at INTEGER NOT NULL);
 CREATE INDEX IF NOT EXISTS logs_run ON logs(run_id,created_at);
 CREATE TABLE IF NOT EXISTS audit(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL REFERENCES tenants(id),actor TEXT NOT NULL,action TEXT NOT NULL,target TEXT,details TEXT NOT NULL,created_at INTEGER NOT NULL);
 CREATE INDEX IF NOT EXISTS audit_tenant ON audit(tenant_id,created_at);
 `);
 // Upgrade existing installations in place without dropping durable queues.
 const connectionColumns=new Set(db.prepare('PRAGMA table_info(connections)').all().map(row=>row.name));
 if(!connectionColumns.has('provider_id'))db.exec('ALTER TABLE connections ADD COLUMN provider_id TEXT');
 if(!connectionColumns.has('verified_at'))db.exec('ALTER TABLE connections ADD COLUMN verified_at INTEGER');
 const runColumns=new Set(db.prepare('PRAGMA table_info(runs)').all().map(row=>row.name));
 if(!runColumns.has('spec_snapshot'))db.exec('ALTER TABLE runs ADD COLUMN spec_snapshot TEXT');
 if(!runColumns.has('allow_external_snapshot'))db.exec('ALTER TABLE runs ADD COLUMN allow_external_snapshot INTEGER');
 if(!runColumns.has('manual_retries'))db.exec('ALTER TABLE runs ADD COLUMN manual_retries INTEGER NOT NULL DEFAULT 0');
 if(!runColumns.has('ai_invocations'))db.exec('ALTER TABLE runs ADD COLUMN ai_invocations INTEGER NOT NULL DEFAULT 0');
 db.exec(`UPDATE runs SET spec_snapshot=(SELECT spec FROM workflows WHERE workflows.id=runs.workflow_id) WHERE spec_snapshot IS NULL;
 UPDATE runs SET allow_external_snapshot=(SELECT allow_external FROM workflows WHERE workflows.id=runs.workflow_id)
 WHERE allow_external_snapshot IS NULL;`);
 // Built-in FTS5 indexes every tenant-scoped knowledge source. All returned rows
 // are joined back to the authorized tenant; the index itself never grants access.
 db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_search
 USING fts5(name,content,tokenize='unicode61 remove_diacritics 2');
 CREATE TRIGGER IF NOT EXISTS knowledge_index_insert AFTER INSERT ON knowledge
 BEGIN INSERT INTO knowledge_search(rowid,name,content) VALUES(new.rowid,new.name,new.content); END;
 CREATE TRIGGER IF NOT EXISTS knowledge_index_delete AFTER DELETE ON knowledge
 BEGIN DELETE FROM knowledge_search WHERE rowid=old.rowid; END;
 CREATE TRIGGER IF NOT EXISTS knowledge_index_update AFTER UPDATE OF name,content ON knowledge
 BEGIN UPDATE knowledge_search SET name=new.name,content=new.content WHERE rowid=old.rowid; END;
 INSERT INTO knowledge_search(rowid,name,content)
 SELECT k.rowid,k.name,k.content FROM knowledge k
 WHERE NOT EXISTS (SELECT 1 FROM knowledge_search f WHERE f.rowid=k.rowid);
 `);
 if(path!==':memory:')db.exec('PRAGMA journal_mode=WAL');
 return db;
}
export function first(db,sql,...args){return db.prepare(sql).get(...args)||null;}
export function all(db,sql,...args){return db.prepare(sql).all(...args);}
export function run(db,sql,...args){return db.prepare(sql).run(...args);}
export function publicUser(user){return {id:user.id,tenant_id:user.tenant_id,email:user.email};}
export function register(db,{name,email,password}){
 if(typeof name!=='string'||name.trim().length<2||name.length>120)throw Error('Workspace name must contain 2-120 characters');
 if(typeof email!=='string'||!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)||email.length>254)throw Error('Invalid email address');
 const emailValue=email.toLowerCase().trim(),hashed=hashPassword(password),stamp=now();
 if(first(db,'SELECT id FROM users WHERE email=?',emailValue))throw Error('An account already exists for this email');
 const tenant=id(),uid=id();db.exec('BEGIN IMMEDIATE');
 try{run(db,'INSERT INTO tenants VALUES (?,?,?)',tenant,name.trim(),stamp);
 run(db,'INSERT INTO users VALUES (?,?,?,?,?,?)',uid,tenant,emailValue,hashed,'admin',stamp);
 db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
 return first(db,'SELECT * FROM users WHERE id=?',uid);
}
export function createSession(db,user){
 const secret=randomBytes(32).toString('base64url');
 run(db,'INSERT INTO sessions VALUES (?,?,?)',sha256(secret),user.id,now()+7*86400_000);
 return secret;
}
export function authenticated(db,token){
 if(!token||typeof token!=='string'||token.length>150)return null;
 return first(db,"SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.role='admin'",sha256(token),now());
}
export function audit(db,tenant,actor,action,target='',details={}){
 run(db,'INSERT INTO audit VALUES (?,?,?,?,?,?,?)',id(),tenant,actor,action,target,json(details),now());
}
export function enqueue(db,workflow,input={},stamp=now()){
 const rid=id();
 const definition=typeof workflow.spec==='string'?workflow.spec:json(workflow.spec);
 const outboundAllowed=Number(workflow.allow_external)===1?1:0;
 run(db,'INSERT INTO runs (id,tenant_id,workflow_id,status,input,state,cursor,attempts,available_at,created_at,updated_at,spec_snapshot,allow_external_snapshot) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',rid,workflow.tenant_id,workflow.id,'queued',json(input),json({steps:{},approvals:{}}),parse(definition).start,0,stamp,stamp,stamp,definition,outboundAllowed);
 return first(db,'SELECT * FROM runs WHERE id=?',rid);
}
export function logEvent(db,execution,step,event,detail={}){
 run(db,'INSERT INTO logs VALUES (?,?,?,?,?,?,?)',id(),execution.id,execution.tenant_id,step,event,json(detail),now());
}
export function queryKnowledge(db,tenant,query){
 // The FTS expression is built exclusively from Unicode alphanumeric tokens,
 // never raw supplied syntax (e.g., embedded operators or quotes).
 const words=String(query||'').normalize('NFKD').replace(/\p{M}/gu,'')
  .toLowerCase().match(/[\p{L}\p{N}]{2,}/gu)||[];
 const tokens=[...new Set(words)].slice(0,12);
 if(!tokens.length)return [];
 const match=tokens.map(term=>'"'+term+'"*').join(' OR ');
 const hits=all(db,`SELECT k.id,k.name,
  snippet(knowledge_search,1,'','',' … ',45) AS excerpt,
  bm25(knowledge_search,2.0,1.0) AS rank
  FROM knowledge_search JOIN knowledge k ON k.rowid=knowledge_search.rowid
  WHERE knowledge_search MATCH ? AND k.tenant_id=?
  ORDER BY rank ASC,k.created_at DESC LIMIT 5`,match,tenant);
 return hits.map(hit=>({id:hit.id,source:hit.name,text:String(hit.excerpt||'').slice(0,1500)}));
}
