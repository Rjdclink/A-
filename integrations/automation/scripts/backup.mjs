import {createBackup} from '../src/backup.mjs';

try{
 const info=await createBackup({
  databasePath:process.env.DB_PATH||'data/growthveyra.sqlite',
  backupDir:process.env.BACKUP_DIR||'data/backups',
  retain:Number(process.env.BACKUP_RETAIN||7)
 });
 process.stdout.write(JSON.stringify(info)+'\n');
}catch(error){
 process.stderr.write('Backup unsuccessful: '+String(error.message||error).slice(0,180)+'\n');
 process.exitCode=1;
}
