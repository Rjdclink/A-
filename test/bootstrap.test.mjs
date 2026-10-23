import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {bootstrapRuntimeSecrets} from '../src/bootstrap.mjs';
test('public hosting generates stable server-only secrets without visitor passwords',()=>{
 const folder=mkdtempSync(join(tmpdir(),'aplus-bootstrap-'));const file=join(folder,'secrets.json');
 try{
  const one={PUBLIC_DASHBOARD:'true',DB_PATH:join(folder,'events.sqlite')};
  bootstrapRuntimeSecrets(one,{file});
  assert.ok(one.ADMIN_TOKEN.length>=32);
  assert.ok(one.INGEST_TOKEN.length>=32);
  assert.ok(one.PSEUDONYM_KEY.length>=32);
  assert.equal(new Set([one.ADMIN_TOKEN,one.INGEST_TOKEN,one.PSEUDONYM_KEY]).size,3);
  assert.equal(statSync(file).mode&0o777,0o600);
  const two={PUBLIC_DASHBOARD:'true',DB_PATH:one.DB_PATH};
  bootstrapRuntimeSecrets(two,{file});
  assert.equal(two.ADMIN_TOKEN,one.ADMIN_TOKEN);
  assert.equal(two.INGEST_TOKEN,one.INGEST_TOKEN);
  assert.equal(two.PSEUDONYM_KEY,one.PSEUDONYM_KEY);
  const three={PUBLIC_DASHBOARD:'true',DB_PATH:one.DB_PATH,ADMIN_TOKEN:'z'.repeat(34)};
  bootstrapRuntimeSecrets(three,{file});
  assert.equal(three.ADMIN_TOKEN,'z'.repeat(34));
  assert.equal(readFileSync(file,'utf8').includes('ADMIN_TOKEN'),true);
 }finally{rmSync(folder,{force:true,recursive:true});}
});
test('private deployment does not generate access tokens',()=>{
 const env={PUBLIC_DASHBOARD:'false'};
 bootstrapRuntimeSecrets(env,{file:'/not-a-real-location'});
 assert.equal(env.ADMIN_TOKEN,undefined);
});