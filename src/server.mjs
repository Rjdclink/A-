import {Ledger} from './ledger.mjs';
import {loadTenants} from './security.mjs';
import {createHandler} from './api.mjs';
import {advisory} from './ai.mjs';
import {createServer} from 'node:http';
import {createUnified} from './unified.mjs';
import {bootstrapRuntimeSecrets} from './bootstrap.mjs';
bootstrapRuntimeSecrets(process.env);
import {backupLedger} from '../scripts/backup.mjs';
const tenants=loadTenants();
const ledger=new Ledger(process.env.DB_PATH||'data/a-plus.sqlite',{pseudonymKey:process.env.PSEUDONYM_KEY,maxEvents:Number(process.env.MAX_EVENTS||500000)});
const shops=process.env.SHOPIFY_SHOPS_JSON?JSON.parse(process.env.SHOPIFY_SHOPS_JSON):{};
const unified=createUnified({ledger});
const handler=createHandler({ledger,tenants,unified,publicDashboard:process.env.PUBLIC_DASHBOARD==='true',publicWorkspace:process.env.PUBLIC_WORKSPACE||'default',adviser:advisory,shopify:{secret:process.env.SHOPIFY_SECRET,shops,allowOrders:process.env.SHOPIFY_ANALYTICS_BASIS_ACKNOWLEDGED==='true'}});
const server=createServer(handler);
const host=process.env.HOST||'127.0.0.1';
server.requestTimeout=15000;server.headersTimeout=10000;server.keepAliveTimeout=5000;
const daily=setInterval(()=>{try{ledger.eraseOld({days:Number(process.env.RETENTION_DAYS||180)});}catch{console.error('Retention cleanup failed');}},86400000);daily.unref();
ledger.eraseOld({days:Number(process.env.RETENTION_DAYS||180)});
const backupHours=Number(process.env.AUTO_BACKUP_HOURS||0);
if(Number.isInteger(backupHours)&&backupHours>=1&&backupHours<=720){
 const snapshot=()=>backupLedger(ledger.db,process.env.BACKUP_DIR||'data/backups',{retain:Number(process.env.BACKUP_RETAIN||7)})
  .catch(error=>console.error('A+ automatic backup failed:',error?.code||error?.name||'Error'));
 const initial=setTimeout(snapshot,20000);initial.unref();
 const timer=setInterval(snapshot,backupHours*3600000);timer.unref();
}
server.listen(Number(process.env.PORT||3000),host,()=>console.log('A+ listening on '+host));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(async()=>{await unified.close();ledger.close();process.exit(0);}));
