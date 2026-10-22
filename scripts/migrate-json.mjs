import {readFile} from 'node:fs/promises';
import {Ledger} from '../src/ledger.mjs';
import {fileURLToPath} from 'node:url';
export async function migrate(oldPath,newPath,{pseudonymKey,maxEvents=500000}={}){
 if(!oldPath||!newPath||oldPath===newPath)throw Error('OLD_DB_PATH and DB_PATH must point to separate files');
 const rows=JSON.parse(await readFile(oldPath,'utf8'));
 if(!Array.isArray(rows))throw Error('Legacy database must be a JSON array');
 const ledger=new Ledger(newPath,{pseudonymKey,maxEvents});
 let created=0,duplicate=0;
 try{
  for(const [index,event] of rows.entries()){
   try{
    const occurredAt=Date.parse(event.createdAt);
    if(!Number.isFinite(occurredAt))throw Error('Missing event timestamp');
    const result=ledger.add(event.workspace,event.id,event,occurredAt);
    if(result.status==='created')created++;else duplicate++;
   }catch(e){throw Error('Migration stopped at row '+(index+1)+': '+e.message);}
  }
  return {created,duplicate,total:rows.length};
 }finally{ledger.close();}
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
 try{const out=await migrate(process.env.OLD_DB_PATH,process.env.DB_PATH,{pseudonymKey:process.env.PSEUDONYM_KEY,maxEvents:Number(process.env.MAX_EVENTS||500000)});console.log(JSON.stringify(out));}
 catch(e){console.error(e.message);process.exitCode=1;}
}
