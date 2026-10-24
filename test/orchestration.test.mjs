import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createUnified} from '../src/unified.mjs';
test('opportunity workflow bindings are scoped, reviewable, and reject unsafe outbound runs',async()=>{
 const db=new DatabaseSync(':memory:');
 const app=createUnified({ledger:{db,overview:()=>({revenue:0,purchases:0})},automationDbPath:':memory:',env:{SESSION_COOKIE_SECURE:'false',AUTO_BACKUP_HOURS:'0'}});
 try{
  const spec={start:'note',steps:[{id:'note',type:'template',template:'Reviewed {{input.opportunity.website}}',next:'done'},{id:'done',type:'end'}]};
  const created=await app.handle('first','growth/workflows','POST',{name:'Assess opportunities',spec,trigger:{type:'manual'},enabled:true});
  assert.equal(created.status,201);
  const workflow=created.data;
  const linked=await app.handle('first','orchestration/links','POST',{event:'recovery.analysis',workflow_id:workflow.id,enabled:true});
  assert.equal(linked.status,201);
  assert.equal((await app.handle('second','orchestration/links','GET')).data.links.length,0);
  const blocked=await app.handle('second','orchestration/links','POST',{event:'recovery.analysis',workflow_id:workflow.id});
  assert.equal(blocked.status,404);
  await app.emit('first','recovery.analysis',{opportunity:{website:'https://example.com'}});
  const events=await app.handle('first','growth/runs','GET');
  assert.equal(events.data.length,1);
  await app.growth.tick();
  const done=await app.handle('first','growth/runs','GET');
  assert.equal(done.data[0].status,'completed');
  const duplicate=await app.handle('first','orchestration/links','POST',{event:'recovery.analysis',workflow_id:workflow.id});
  assert.equal(duplicate.status,409);
  const remove=await app.handle('first','orchestration/links/'+linked.data.link.id,'DELETE');
  assert.equal(remove.status,200);
 }finally{await app.close();db.close();}
});
test('external-action workflows cannot be attached to unattended growth triggers',async()=>{
 const db=new DatabaseSync(':memory:');
 const app=createUnified({ledger:{db},automationDbPath:':memory:',env:{SESSION_COOKIE_SECURE:'false',AUTO_BACKUP_HOURS:'0'}});
 try{
  const created=await app.handle('first','growth/workflows','POST',{name:'External workflow',spec:{start:'done',steps:[{id:'done',type:'end'}]},allow_external:true,enabled:true});
  assert.equal(created.status,201);
  const linked=await app.handle('first','orchestration/links','POST',{event:'commerce.purchase',workflow_id:created.data.id});
  assert.equal(linked.status,409);
 }finally{await app.close();db.close();}
});
test('support handoff workflows enqueue only sanitized ticket metadata and no customer content',async()=>{
 const {createSupport}=await import('../src/support.mjs');
 const db=new DatabaseSync(':memory:');
 const app=createUnified({ledger:{db},automationDbPath:':memory:',env:{SESSION_COOKIE_SECURE:'false',AUTO_BACKUP_HOURS:'0'},autoStart:false});
 try{
  const workflow=await app.handle('merchant','growth/workflows','POST',{
   name:'Review customer support handoff',
   spec:{start:'note',steps:[{id:'note',type:'template',template:'Review ticket {{input.ticket.id}}',next:'done'},{id:'done',type:'end'}]},
   enabled:true
  });
  assert.equal(workflow.status,201);
  const binding=await app.handle('merchant','orchestration/links','POST',{event:'support.handoff_required',workflow_id:workflow.data.id});
  assert.equal(binding.status,201);
  const support=createSupport(db,{onEvent:(...args)=>app.emit(...args)});
  const visitor=await support.receive('merchant',{message:'I need help with a private matter',name:'Private User',email:'private.user@example.org'});
  assert.equal(visitor.needsHuman,true);
  const runs=await app.handle('merchant','growth/runs','GET');
  assert.equal(runs.status,200);
  assert.equal(runs.data.length,1);
  assert.doesNotMatch(JSON.stringify(runs.data),/Private User|private\.user@example\.org|private matter/);
  const others=await app.handle('other','growth/runs','GET');
  assert.equal(others.data.length,0);
  await app.growth.tick();
  assert.equal((await app.handle('merchant','growth/runs','GET')).data[0].status,'completed');
 }finally{await app.close();db.close();}
});
