import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {createApp} from '../src/server.mjs';

const settings={ALLOW_SIGNUP:'true',SESSION_COOKIE_SECURE:'false',AUTO_BACKUP_HOURS:'1'};
async function fixture(env={},backupFn=async()=>({file:'/private/unexposed.sqlite',bytes:512,integrity:'ok'})){
 const dir=await mkdtemp(join(tmpdir(),'gv-scheduled-maintenance-'));
 const dbPath=join(dir,'growthveyra.sqlite');
 const app=createApp({dbPath,autoStart:false,env:{...settings,BACKUP_DIR:join(dir,'backups'),...env},backupFn});
 const close=async()=>{app.stop();app.db.close();await rm(dir,{recursive:true,force:true});};
 return {app,close,dir,dbPath};
}

test('automatic backup executes unattended, honors cadence, and persists schedule across restart',async()=>{
 let calls=0;
 const backupFn=async()=>{calls++;return {file:'/sensitive/path/backup.sqlite',bytes:2048,integrity:'ok'};};
 const f=await fixture({},backupFn);
 let next;
 try{
  const t0=Date.now();
  await f.app.tick(t0);
  assert.equal(calls,1,'first due backup must execute without an API request or GitHub workflow');
  await f.app.tick(t0+30*60*1000);
  assert.equal(calls,1,'must not repeat before interval elapses');
  next=f.app.db.prepare("SELECT * FROM maintenance_backup WHERE name='local_database'").get();
  assert.equal(next.last_success,t0);
  assert.equal(next.last_size_bytes,2048);
  assert.equal(next.next_due,t0+60*60*1000);
  f.app.stop();f.app.db.close();
  const restart=createApp({dbPath:f.dbPath,autoStart:false,env:{...settings,BACKUP_DIR:join(f.dir,'backups')},backupFn});
  await restart.tick(t0+31*60*1000);
  assert.equal(calls,1,'restart must not reset next scheduled backup');
  await restart.tick(t0+60*60*1000+1);
  assert.equal(calls,2);
  restart.stop();restart.db.close();
 }finally{await rm(f.dir,{recursive:true,force:true});}
});

test('failed scheduled backup records operator-visible error and retries after backoff without crashing workflow scheduling',async()=>{
 let attempts=0;
 const f=await fixture({},async()=>{attempts++;if(attempts===1)throw Error('Disk unavailable');return {file:'ignored',bytes:1024};});
 try{
  const t0=Date.now();
  await f.app.tick(t0);
  assert.equal(attempts,1);
  const failed=f.app.db.prepare("SELECT * FROM maintenance_backup WHERE name='local_database'").get();
  assert.match(failed.last_error,/Backup failed|Disk unavailable/);
  assert.equal(failed.last_success,null);
  await f.app.tick(t0+4*60*1000);
  assert.equal(attempts,1);
  await f.app.tick(t0+6*60*1000);
  assert.equal(attempts,2);
  const good=f.app.db.prepare("SELECT * FROM maintenance_backup WHERE name='local_database'").get();
  assert.equal(good.last_error,'');
  assert.equal(good.last_size_bytes,1024);
 }finally{await f.close();}
});

test('maintenance status is private, readable by the owner, and does not expose backup paths',async()=>{
 const f=await fixture();
 const app=f.app;
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
 const origin='http://127.0.0.1:'+app.server.address().port;
 let cookie='';
 const request=async(path,method='GET',body)=>{
  const r=await fetch(origin+path,{method,headers:{origin,...(cookie?{cookie}:{}),...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
  if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];
  return {status:r.status,data:await r.json()};
 };
 try{
  assert.equal((await request('/api/maintenance')).status,401);
  assert.equal((await request('/api/auth/register','POST',{name:'Workspace',email:'backup@example.com',password:'long test password 2026'})).status,201);
  await app.tick(Date.now());
  const status=await request('/api/maintenance');
  assert.equal(status.status,200);
  assert.equal(status.data.automatic_backups.enabled,true);
  assert.equal(status.data.automatic_backups.last_size_bytes,512);
  assert.equal(status.data.automatic_backups.last_error,null);
  assert.doesNotMatch(JSON.stringify(status.data),/private\/unexposed|\/backups\/|INTEGRATION_MASTER_KEY|file:/);
 }finally{app.stop();await new Promise(resolve=>app.server.close(resolve));app.db.close();await rm(f.dir,{recursive:true,force:true});}
});

test('backup scheduler rejects invalid configuration and file-free automatic backups',()=>{
 assert.throws(()=>createApp({dbPath:':memory:',autoStart:false,env:{...settings,AUTO_BACKUP_HOURS:'1'}}),/persistent database/i);
 assert.throws(()=>createApp({dbPath:':memory:',autoStart:false,env:{...settings,AUTO_BACKUP_HOURS:'abc'}}),/AUTO_BACKUP_HOURS/);
 const app=createApp({dbPath:':memory:',autoStart:false,env:{...settings,AUTO_BACKUP_HOURS:'0'}});
 assert.equal(app.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='maintenance_backup'").get(),undefined);
 app.stop();app.db.close();
});

test('standalone smoke verification runs without GitHub Actions or production services',()=>{
 const result=spawnSync(process.execPath,['scripts/smoke.mjs'],{cwd:new URL('..',import.meta.url),encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);
 assert.match(result.stdout,/Smoke test passed/);
});

test('GitHub Actions workflow is absent from the shipped product',async()=>{
 assert.equal(existsSync(new URL('../.github/workflows/ci.yml',import.meta.url)),false);
 const readme=await readFile(new URL('../README.md',import.meta.url),'utf8');
 assert.doesNotMatch(readme,/GitHub Actions runs/i);
});

test('unattended worker produces a real restorable SQLite snapshot without a hosted scheduler',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'gv-real-auto-backup-'));
 const dbPath=join(dir,'source.sqlite'),backupDir=join(dir,'backups');
 const app=createApp({dbPath,autoStart:false,env:{...settings,BACKUP_DIR:backupDir,BACKUP_RETAIN:'2'}});
 try{
  await app.tick(Date.now());
  const {readdir}=await import('node:fs/promises');
  const {DatabaseSync}=await import('node:sqlite');
  const files=(await readdir(backupDir)).filter(file=>file.endsWith('.sqlite'));
  assert.equal(files.length,1,'the first worker cycle must create a physical snapshot');
  const restored=new DatabaseSync(join(backupDir,files[0]),{readOnly:true});
  assert.equal(restored.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
  assert.ok(restored.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='workflows'").get());
  restored.close();
  const state=app.db.prepare("SELECT last_success,last_size_bytes,last_error FROM maintenance_backup WHERE name='local_database'").get();
  assert.ok(state.last_success>0);
  assert.ok(state.last_size_bytes>0);
  assert.equal(state.last_error,'');
 }finally{app.stop();app.db.close();await rm(dir,{recursive:true,force:true});}
});

test('backup status is visible only in the advanced Insights view, not on the three-metric dashboard',async()=>{
 const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
 const home=html.split('<section id="dashboard"')[1]?.split('<section id="workflows"')[0];
 assert.ok(home,'the overview section must exist');
 assert.equal((home.match(/class="metric"/g)||[]).length,3);
 assert.match(html,/api\('\/api\/maintenance'\)/);
 assert.match(html,/Automatic backups:/);
});
