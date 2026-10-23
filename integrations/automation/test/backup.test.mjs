import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {openDatabase} from '../src/core.mjs';
import {mkdtemp,rm,readdir,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';

test('backup command creates an integrity-checked restorable SQLite snapshot with no credentials in logs',async()=>{
 const folder=await mkdtemp(join(tmpdir(),'gv-backup-'));
 try{
  const dbPath=join(folder,'live.sqlite'),backupDir=join(folder,'backups');
  const db=openDatabase(dbPath);
  db.exec("CREATE TABLE sample(value TEXT); INSERT INTO sample VALUES ('persisted');");db.close();
  const result=spawnSync(process.execPath,['scripts/backup.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,DB_PATH:dbPath,BACKUP_DIR:backupDir},encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  const files=(await readdir(backupDir)).filter(n=>n.endsWith('.sqlite'));assert.equal(files.length,1);
  const target=join(backupDir,files[0]);
  assert.ok((await stat(target)).size>0);
  const restored=new DatabaseSync(target,{readOnly:true});
  assert.equal(restored.prepare('SELECT value FROM sample').get().value,'persisted');
  assert.equal(restored.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
  restored.close();
  assert.doesNotMatch(result.stdout,/password|token|secret/i);
 }finally{await rm(folder,{recursive:true,force:true});}
});

test('backup command refuses absent source and does not create an empty backup',async()=>{
 const folder=await mkdtemp(join(tmpdir(),'gv-backup-missing-'));
 try{
  const target=join(folder,'backups');
  const result=spawnSync(process.execPath,['scripts/backup.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,DB_PATH:join(folder,'missing.sqlite'),BACKUP_DIR:target},encoding:'utf8'});
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/missing|not found|does not exist/i);
  assert.deepEqual(await readdir(folder),[]);
 }finally{await rm(folder,{recursive:true,force:true});}
});

test('retention keeps the newest validated snapshots without touching unrelated files',async()=>{
 const folder=await mkdtemp(join(tmpdir(),'gv-retain-'));
 try{
  const dbPath=join(folder,'live.sqlite'),backups=join(folder,'backups');
  const db=openDatabase(dbPath);db.close();
  const {createBackup}=await import('../src/backup.mjs');
  for(let i=0;i<4;i++)await createBackup({databasePath:dbPath,backupDir:backups,retain:2,
   clock:()=>Date.UTC(2026,9,21,9,i)});
  const files=await readdir(backups);
  assert.equal(files.length,2);
  assert.ok(files.every(f=>/20261021T090[23]/.test(f)));
  const original=openDatabase(dbPath);
  assert.equal(original.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
  original.close();
 }finally{await rm(folder,{recursive:true,force:true});}
});
