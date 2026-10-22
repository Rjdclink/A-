import test from 'node:test';import assert from 'node:assert/strict';
import {writeFileSync,readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {migrate} from '../scripts/migrate-json.mjs';
import {Ledger} from '../src/ledger.mjs';
test('legacy JSON migration is replay-safe and retains the original data',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'a-plus-migration-'));const old=join(dir,'old.json'),db=join(dir,'new.sqlite');
 const rows=[{id:'p-1',workspace:'default',type:'purchase',value:23.95,currency:'USD',consent:true,campaign:'search',createdAt:'2026-10-15T12:00:00Z'}];
 try{
  writeFileSync(old,JSON.stringify(rows));
  assert.deepEqual(await migrate(old,db,{pseudonymKey:'a stable secret that must not change'}),{created:1,duplicate:0,total:1});
  assert.deepEqual(await migrate(old,db,{pseudonymKey:'a stable secret that must not change'}),{created:0,duplicate:1,total:1});
  assert.deepEqual(JSON.parse(readFileSync(old,'utf8')),rows);
  const ledger=new Ledger(db,{pseudonymKey:'a stable secret that must not change'});
  assert.equal(ledger.overview('default',{now:Date.parse('2026-10-22T12:00:00Z')}).revenue,23.95);
  ledger.close();
 }finally{rmSync(dir,{recursive:true,force:true});}
});
