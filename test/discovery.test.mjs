import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createRecovery} from '../src/recovery.mjs';
test('business research only discovers new public sites after workspace opt-in',async()=>{
 const db=new DatabaseSync(':memory:');
 const r=createRecovery(db,{inspect:async website=>({url:website,public_contact_emails:[],external_links:[{url:'https://small-business-demo.com/about',label:'Partner'},{url:'https://facebook.com/',label:'Facebook'}]}),analyze:async()=>({company_name:'Example',summary:'Possible follow-up improvements'})});
 try{
  await r.handle('one','scan','POST',{website:'https://example.com'});
  assert.equal((await r.handle('one','sites','GET')).sites.length,1);
  await r.handle('one','routines','POST',{enabled:true,interval_hours:24,discover:true});
  await r.handle('one','scan','POST',{website:'https://example.com'});
  const all=(await r.handle('one','sites','GET')).sites;
  assert.equal(all.length,2);
  assert.ok(all.some(s=>s.website==='https://small-business-demo.com'));
  assert.ok(!all.some(s=>s.website.includes('facebook.com')));
  assert.equal((await r.handle('two','sites','GET')).sites.length,0);
 }finally{db.close();}
});