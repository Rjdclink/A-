import {randomBytes} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync,chmodSync} from 'node:fs';
import {dirname,resolve} from 'node:path';

const NAMES=['ADMIN_TOKEN','INGEST_TOKEN','PSEUDONYM_KEY'];
function valid(data){return data&&typeof data==='object'&&NAMES.every(k=>typeof data[k]==='string'&&data[k].length>=32)&&new Set(NAMES.map(k=>data[k])).size===3;}
export function bootstrapRuntimeSecrets(env=process.env,{file}={}){
 if(env.PUBLIC_DASHBOARD!=='true')return;
 const pathname=resolve(file||env.PUBLIC_SECRETS_FILE||dirname(env.DB_PATH||'data/a-plus.sqlite')+'/aplus-private-secrets.json');
 mkdirSync(dirname(pathname),{recursive:true,mode:0o700});
 let data;
 try{data=JSON.parse(readFileSync(pathname,'utf8'));}
 catch(e){
  if(e.code!=='ENOENT')throw Error('Configured secret store is unreadable');
  data=Object.fromEntries(NAMES.map(k=>[k,randomBytes(32).toString('base64url')]));
  try{writeFileSync(pathname,JSON.stringify(data),{flag:'wx',mode:0o600});}
  catch(err){if(err.code!=='EEXIST')throw err;data=JSON.parse(readFileSync(pathname,'utf8'));}
 }
 if(!valid(data))throw Error('Invalid server secret store; restore the original file');
 chmodSync(pathname,0o600);
 for(const name of NAMES)if(!env[name])env[name]=data[name];
}
