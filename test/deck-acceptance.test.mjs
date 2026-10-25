import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {Ledger} from '../src/ledger.mjs';
import {createHandler} from '../src/api.mjs';
import {createUnified} from '../src/unified.mjs';
import {serviceSettings} from '../src/service-settings.mjs';
test('public deck workflow connects recovery analysis to automation and support with no app credentials',async()=>{
 const ledger=new Ledger(':memory:',{pseudonymKey:'stable-test-pseudonym-key-123456789'});
 const env={PSEUDONYM_KEY:'stable-test-pseudonym-key-123456789',AUTO_BACKUP_HOURS:'0'};
 const app=createUnified({ledger,automationDbPath:':memory:',env,autoStart:false,recoveryOptions:{inspect:async url=>({url,title:'Fixture shop',public_contact_emails:['owner@example.com']}),analyze:async()=>({summary:'Observed missing contact link',email_subject:'Review',email_body:'Fixture outreach draft'})}});
 const server=createServer(createHandler({ledger,unified:app,tenants:{default:{adminToken:'a'.repeat(32),ingestToken:'b'.repeat(32)}},adviser:async()=>'',publicDashboard:true}));
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 const api=async(path,data,method=data?'POST':'GET')=>{const r=await fetch(base+path,{method,headers:{'content-type':'application/json'},body:data?JSON.stringify(data):undefined});const body=await r.json();assert.ok(r.ok,path+': '+JSON.stringify(body));return body;};
 try{
  const flow=await api('/api/growth/workflows',{name:'Deck recovery workflow',enabled:true,trigger:{type:'manual'},spec:{start:'summarize',steps:[{id:'summarize',type:'template',template:'{{input.opportunity.summary}}',next:'done'},{id:'done',type:'end'}]}});
  await api('/api/orchestration/links',{event:'recovery.analysis',workflow_id:flow.id});
  await api('/api/recovery/scan',{website:'https://example.com'});
  assert.equal((await api('/api/recovery/overview')).analyzed,1);
  assert.equal((await api('/api/recovery/outreach')).outreach.length,1);
  await app.growth.tick();
  assert.equal((await api('/api/growth/runs'))[0].status,'completed');
  await api('/api/recovery/routines',{enabled:true,interval_hours:24,discover:false});
  assert.equal((await api('/api/recovery/routines')).routine.enabled,1);
  await api('/api/support/articles',{question:'How long does shipping take?',answer:'Two business days.',locale:'en'});
  const chat=await api('/api/support/chat',{message:'How long does shipping take?'});
  assert.ok(chat.ticketId||chat.ticket||chat.id,JSON.stringify(chat));
  assert.equal((await api('/api/support/tickets')).tickets.length,1);
  await api('/api/integrations/settings',{values:{AI_API_KEY:'fixture-ai-secret',AI_BASE_URL:'https://ai.example/v1/chat/completions',AI_MODEL:'fixture-model'}});
  const settings=await api('/api/integrations/settings');assert.doesNotMatch(JSON.stringify(settings),/fixture-ai-secret/);
  assert.equal((await api('/api/integrations/status')).providers.ai,'configured');
  assert.equal((await api('/api/growth/integrations/catalog')).length,95);
 }finally{await new Promise(r=>server.close(r));await app.close();ledger.close();}
});
test('service credentials persist encrypted and reload into all consumers without returning secrets',()=>{
 const ledger=new Ledger(':memory:',{pseudonymKey:'stable-test-pseudonym-key-123456789'});
 try{
  const env={PSEUDONYM_KEY:'stable-test-pseudonym-key-123456789'};const settings=serviceSettings(ledger.db,env);
  settings.save({AI_API_KEY:'secret-fixture-key',RECOVERY_SMTP_PASS:'secret-fixture-password',RECOVERY_SMTP_HOST:'smtp.example.com'});
  assert.doesNotMatch(ledger.db.prepare('SELECT cipher FROM installation_settings').get().cipher,/secret-fixture/);
  const restarted={PSEUDONYM_KEY:env.PSEUDONYM_KEY};const loaded=serviceSettings(ledger.db,restarted);
  assert.equal(restarted.AI_API_KEY,'secret-fixture-key');assert.equal(restarted.RECOVERY_SMTP_PASS,'secret-fixture-password');
  assert.doesNotMatch(JSON.stringify(loaded.status()),/secret-fixture/);
  assert.throws(()=>loaded.save({AI_BASE_URL:'http://insecure.example'}),/HTTPS/);
 }finally{ledger.close();}
});
