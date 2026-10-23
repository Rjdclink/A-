import {DatabaseSync,backup} from 'node:sqlite';
import {stat,mkdir,readdir,rename,rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {join,resolve} from 'node:path';

/**
 * Online SQLite backup that honors WAL snapshots and validates the result.
 * Never copies a live .sqlite file directly: doing so could omit uncheckpointed WAL data.
 */
export async function createBackup({databasePath,backupDir,retain=7,clock=()=>Date.now()}={}){
 if(typeof databasePath!=='string'||!databasePath.trim()||databasePath===':memory:')throw Error('Source database path is required');
 if(typeof backupDir!=='string'||!backupDir.trim())throw Error('Backup directory is required');
 const source=resolve(databasePath),dir=resolve(backupDir);
 let input;
 try{input=await stat(source);}catch{throw Error('Source database does not exist');}
 if(!input.isFile())throw Error('Source database must be a regular file');
 if(!Number.isInteger(retain)||retain<1||retain>90)throw Error('Backup retention must be 1-90');
 await mkdir(dir,{recursive:true,mode:0o700});
 const stamp=new Date(clock()).toISOString().replace(/[-:.]/g,'');
 const basename=`growthveyra-${stamp}-${randomUUID().slice(0,8)}.sqlite`;
 const final=join(dir,basename),temporary=join(dir,'.'+basename+'.pending');
 let db;
 try{
  db=new DatabaseSync(source,{readOnly:true});
  await backup(db,temporary);
  db.close();db=null;
  const verify=new DatabaseSync(temporary,{readOnly:true});
  try{
   if(verify.prepare('PRAGMA integrity_check').get()?.integrity_check!=='ok')throw Error('Backup failed SQLite integrity validation');
   if(!verify.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='workflows'").get())
    throw Error('Backup does not contain GrowthVeyra tables');
  }finally{verify.close();}
  // SQLite can leave empty temp -wal/-shm sidecars after an integrity check.
  // Checkpointing/closing has completed before removing only these temp files.
  await rm(temporary+'-wal',{force:true});
  await rm(temporary+'-shm',{force:true});
  await rename(temporary,final);
  const names=(await readdir(dir)).filter(f=>/^growthveyra-\d{8}T\d{9}Z-[0-9a-f]{8}\.sqlite$/.test(f)).sort().reverse();
  for(const older of names.slice(retain))await rm(join(dir,older));
  return {file:final,bytes:(await stat(final)).size,integrity:'ok',retained:Math.min(names.length,retain)};
 }catch(error){
  for(const suffix of ['', '-wal','-shm'])await rm(temporary+suffix,{force:true}).catch(()=>{});
  throw error;
 }finally{if(db)db.close();}
}
