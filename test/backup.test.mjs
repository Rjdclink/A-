import test from 'node:test';import assert from 'node:assert/strict';
import {stat,readFile,mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';import {tmpdir} from 'node:os';
import {Ledger} from '../src/ledger.mjs';
import {backupLedger} from '../scripts/backup.mjs';
const KEY='long stable secret with enough entropy';
test('consistent, private SQLite backup can be restored independently',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'aplus-bak-'));
 try{
  const source=join(dir,'original.sqlite'),backups=join(dir,'backup');
  const ledger=new Ledger(source,{pseudonymKey:KEY});
  ledger.add('default','order_1',{type:'purchase',value:21.45,consent:true});
  const target=await backupLedger(ledger.db,backups,{retain:2});
  assert.equal((await stat(target)).mode&0o777,0o600);
  const restored=new Ledger(target,{pseudonymKey:KEY});
  assert.equal(restored.overview('default').revenue,21.45);
  restored.close();ledger.close();
 }finally{await rm(dir,{recursive:true,force:true});}
});
