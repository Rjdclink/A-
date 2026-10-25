import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {complete,analyzeOpportunity} from '../integrations/recovery/src/ai.mjs';
import {createRecovery} from '../src/recovery.mjs';
test('recovery AI uses supplied runtime credentials and rejects insecure transport',async()=>{
 let request;
 const env={AI_BASE_URL:'https://ai.example/v1/chat/completions',AI_API_KEY:'test-key',AI_MODEL:'configured-model'};
 assert.equal(await complete('system','user',{env,fetcher:async(url,options)=>{request={url,options};return Response.json({choices:[{message:{content:'result'}}]});}}),'result');
 assert.equal(request.options.headers.authorization,'Bearer test-key');
 assert.equal(JSON.parse(request.options.body).model,'configured-model');
 assert.equal(request.options.redirect,'error');
 await assert.rejects(complete('s','u',{env:{AI_BASE_URL:'http://ai.example'}}),/HTTPS/);
});
test('unavailable or malformed AI is explicitly recorded as fallback',async()=>{
 for(const content of ['null','[]']){
  const result=await analyzeOpportunity({url:'https://example.com',title:'Example'},{fetcher:async()=>Response.json({choices:[{message:{content}}]})});
  assert.equal(result.analysis_mode,'deterministic_fallback');
 }
});
test('concurrent outreach requests submit once and uncertain delivery is never automatically retried',async()=>{
 const db=new DatabaseSync(':memory:');let release,calls=0;
 const r=createRecovery(db,{inspect:async()=>({public_contact_emails:['person@example.com']}),analyze:async()=>({email_subject:'Subject',email_body:'Body'}),mail:async()=>{calls++;await new Promise(resolve=>{release=resolve});throw Error('SMTP acknowledgement lost');}});
 try{
  await r.scan('one','https://example.com');
  const draft=(await r.handle('one','outreach','GET')).outreach[0];
  const path='outreach/'+draft.id+'/send';
  const sending=r.handle('one',path,'POST',{confirm:true});
  await assert.rejects(r.handle('one',path,'POST',{confirm:true}),/already processed/);
  release();await assert.rejects(sending,/could not be confirmed/);
  assert.equal(calls,1);
  assert.equal((await r.handle('one','outreach','GET')).outreach[0].status,'delivery_unknown');
  await assert.rejects(r.handle('one',path,'POST',{confirm:true}),/already processed/);
 }finally{db.close();}
});
