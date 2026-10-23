import test from 'node:test';
import assert from 'node:assert/strict';
import {createNeonIntegration} from '../src/neon.mjs';
class FakePool{
 constructor(){this.rows=[];}
 async query(sql,params=[]){
  if(sql.includes('CREATE TABLE'))return {rows:[],rowCount:0};
  if(sql.includes('INSERT INTO aplus_integration_events')){if(!this.rows.some(x=>x.workspace===params[0]&&x.id===params[1]))this.rows.push({workspace:params[0],id:params[1],kind:params[2],payload:params[3],created_at:params[4]});return {rows:[],rowCount:1};}
  if(sql.includes('COUNT(*)'))return {rows:[{n:this.rows.filter(x=>x.workspace===params[0]).length}]};
  if(sql.includes('WHERE workspace'))return {rows:this.rows.filter(x=>x.workspace===params[0])};
  return {rows:[{ok:1}]};
 }
 async end(){}
}
test('Neon integration persists a scoped, idempotent audit stream when connected',async()=>{
 const bridge=createNeonIntegration({env:{NEON_DATABASE_URL:'postgresql://readonly:temporary@localhost:5432/sample'},Pool:FakePool});
 try{
  assert.equal((await bridge.record('alpha','commerce.purchase','order:1',{value:25})).stored,true);
  await bridge.record('alpha','commerce.purchase','order:1',{value:25});
  await bridge.record('beta','recovery.analysis','site:1',{website:'https://example.com'});
  assert.equal((await bridge.status('alpha')).events,1);
  assert.equal((await bridge.status('beta')).events,1);
  assert.equal((await bridge.history('alpha')).events.length,1);
 }finally{await bridge.close();}
});
test('unconfigured Neon storage does not affect A+ local operation',async()=>{
 const bridge=createNeonIntegration({env:{}});
 assert.equal((await bridge.status('alpha')).connected,false);
 assert.equal((await bridge.record('alpha','commerce.purchase','x',{})).stored,false);
 await bridge.close();
});