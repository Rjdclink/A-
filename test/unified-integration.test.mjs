import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createUnified} from '../src/unified.mjs';
test('automation bridge provisions a separate tenant for each authenticated A+ workspace',async()=>{
 const db=new DatabaseSync(':memory:');
 const unified=createUnified({ledger:{db},automationDbPath:':memory:',env:{SESSION_COOKIE_SECURE:'false',ALLOW_SIGNUP:'false',AUTO_BACKUP_HOURS:'0'}});
 try{
  const first=await unified.handle('merchant_a','growth/overview','GET');
  const second=await unified.handle('merchant_b','growth/overview','GET');
  assert.equal(first.status,200);assert.equal(second.status,200);
  assert.equal(first.data.workflows,0);
  assert.equal(unified.growth.db.prepare('SELECT COUNT(*) AS n FROM tenants').get().n,2);
  const secret=await unified.handle('merchant_a','growth/auth/register','POST',{name:'Ignore'});
  assert.equal(secret.status,404);
 }finally{await unified.close();db.close();}
});