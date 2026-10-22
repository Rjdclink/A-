import {backup} from 'node:sqlite';
import {mkdir,readdir,chmod,unlink} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {Ledger} from '../src/ledger.mjs';
import {DatabaseSync} from 'node:sqlite';
export async function backupLedger(db,folder,{retain=7}={}){
 if(!Number.isInteger(retain)||retain<1||retain>90)throw Error('Invalid backup retention');
 const directory=resolve(folder);await mkdir(directory,{recursive:true,mode:0o700});
 const name='a-plus-'+new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID()+'.sqlite';
 const target=join(directory,name);
 try{
  await backup(db,target);
  await chmod(target,0o600);
  const check=new DatabaseSync(target);
  try{if(check.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw Error('Backup integrity check failed');}
  finally{check.close();}
  const files=(await readdir(directory)).filter(x=>/^a-plus-.*\.sqlite$/.test(x)).sort().reverse();
  for(const old of files.slice(retain))await unlink(join(directory,old));
  return target;
 }catch(e){await unlink(target).catch(()=>{});throw e;}
}
if(process.argv[1]&&import.meta.url===new URL('file://'+resolve(process.argv[1])).href){
 const db=new Ledger(process.env.DB_PATH||'data/a-plus.sqlite',{pseudonymKey:process.env.PSEUDONYM_KEY});
 try{console.log(await backupLedger(db.db,process.env.BACKUP_DIR||'data/backups',{retain:Number(process.env.BACKUP_RETAIN||7)}));}
 finally{db.close();}
}
