import {createBackup} from './backup.mjs';

/**
 * Runs local, integrity-checked snapshots within the application's existing
 * durable single-worker loop. No GitHub Actions or external scheduler needed.
 * Production deployments still require independent encrypted off-host copies.
 */
export function maintenanceConfig(databasePath,env={}){
 const raw=String(env.AUTO_BACKUP_HOURS??'0').trim();
 if(!/^(0|[1-9][0-9]{0,2})$/.test(raw))throw Error('AUTO_BACKUP_HOURS must be 0 or an integer between 1 and 720');
 const intervalHours=Number(raw);
 if(intervalHours>720)throw Error('AUTO_BACKUP_HOURS must be no greater than 720');
 if(intervalHours>0&&(!databasePath||databasePath===':memory:'))
  throw Error('Automatic backups require a persistent database path');
 const retain=Number(env.BACKUP_RETAIN??7);
 if(intervalHours>0&&(!Number.isInteger(retain)||retain<1||retain>90))
  throw Error('BACKUP_RETAIN must be between 1 and 90');
 return {enabled:intervalHours>0,intervalHours,databasePath,
  backupDir:env.BACKUP_DIR||'data/backups',retain};
}

export function createMaintenance(db,configuration,{backupFn=createBackup}={}){
 if(!configuration.enabled){
  return {enabled:false,tick:async()=>false,
   status:()=>({enabled:false,interval_hours:0,last_attempt_ms:null,last_success_ms:null,next_due_ms:null,last_size_bytes:0,last_error:null})};
 }
 db.exec(`
 CREATE TABLE IF NOT EXISTS maintenance_backup(
   name TEXT PRIMARY KEY,
   last_attempt INTEGER,
   last_success INTEGER,
   next_due INTEGER NOT NULL,
   last_error TEXT NOT NULL DEFAULT '',
   last_size_bytes INTEGER NOT NULL DEFAULT 0
 );
 `);
 db.prepare("INSERT OR IGNORE INTO maintenance_backup(name,next_due) VALUES ('local_database',0)").run();
 const row=()=>db.prepare("SELECT * FROM maintenance_backup WHERE name='local_database'").get();
 let working=false;
 const intervalMs=configuration.intervalHours*3600_000;
 const retryMs=5*60_000;

 async function tick(stamp=Date.now()){
  if(working)return false;
  const state=row();
  if(!state||state.next_due>stamp)return false;
  // This persistent claim also avoids restarting a just-claimed backup
  // immediately if the worker exits in the middle of a backup.
  const claim=db.prepare("UPDATE maintenance_backup SET last_attempt=?,next_due=? WHERE name='local_database' AND next_due<=?")
   .run(stamp,stamp+retryMs,stamp);
  if(!claim.changes)return false;
  working=true;
  try{
   const info=await backupFn({databasePath:configuration.databasePath,
    backupDir:configuration.backupDir,retain:configuration.retain});
   if(!info||!Number.isFinite(info.bytes)||info.bytes<=0||(info.integrity&&info.integrity!=='ok'))
    throw Error('Backup validation did not succeed');
   db.prepare("UPDATE maintenance_backup SET last_success=?,next_due=?,last_error='',last_size_bytes=? WHERE name='local_database'")
    .run(stamp,stamp+intervalMs,Math.floor(info.bytes));
   return true;
  }catch(e){
   // Keep file paths and sensitive exception text out of dashboard responses.
   const hint=typeof e?.code==='string'&&/^[A-Z0-9_]{2,30}$/.test(e.code)?' ('+e.code+')':'';
   db.prepare("UPDATE maintenance_backup SET next_due=?,last_error=? WHERE name='local_database'")
    .run(stamp+retryMs,'Backup failed'+hint+'. Check the server logs.');
   console.error('Automatic database backup failed:',e?.code||e?.name||'Error');
   return false;
  }finally{working=false;}
 }
 function status(){
  const item=row();
  return {enabled:true,interval_hours:configuration.intervalHours,
   last_attempt_ms:item.last_attempt??null,last_success_ms:item.last_success??null,
   next_due_ms:item.next_due,last_size_bytes:item.last_size_bytes,
   last_error:item.last_error||null};
 }
 return {enabled:true,tick,status};
}
