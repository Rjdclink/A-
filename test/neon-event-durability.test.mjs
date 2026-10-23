import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createUnified} from '../src/unified.mjs';

test('Neon event archival finishes before a commerce request acknowledges completion',async()=>{
 const db=new DatabaseSync(':memory:');const stored=[];
 const neon={
  configured:true,
  record:async(workspace,event,id,data)=>{await new Promise(r=>setTimeout(r,8));stored.push({workspace,event,id,data});return {stored:true};},
  status:async()=>({connected:true,configured:true,events:stored.length}),
  history:async()=>({events:stored}),close:async()=>{}
 };
 const app=createUnified({ledger:{db},automationDbPath:':memory:',env:{AUTO_BACKUP_HOURS:'0'},autoStart:false,neonIntegration:neon});
 try{
  await app.emit('default','commerce.purchase',{event_id:'new-order-7',commerce:{revenue:21.99}});
  assert.equal(stored.length,1);
  assert.equal(stored[0].id,'commerce:new-order-7');
  assert.equal(stored[0].data.event_id,undefined);
 }finally{await app.close();db.close();}
});