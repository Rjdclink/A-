import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createRecovery} from '../src/recovery.mjs';
test('recovery isolates sites and follow-up drafts by workspace',async()=>{
 const db=new DatabaseSync(':memory:');
 const r=createRecovery(db,{inspect:async url=>({url,title:'Example',public_contact_emails:['contact@example.com']}),analyze:async()=>({company_name:'Example',priority_score:70,email_subject:'Proposal',email_body:'Hello'})});
 const result=await r.handle('first','scan','POST',{website:'https://example.com'});
 assert.equal(result.site.status,'analyzed');
 assert.equal((await r.handle('second','sites','GET')).sites.length,0);
 const draft=(await r.handle('first','outreach','GET')).outreach[0];
 await assert.rejects(r.handle('first','outreach/'+draft.id+'/send','POST',{confirm:true}),/not configured/);
 assert.equal((await r.handle('first','outreach','GET')).outreach[0].status,'draft');
 r.eraseWorkspace('first');
 assert.equal((await r.handle('first','sites','GET')).sites.length,0);
 db.close();
});
test('recovery schedules only opted-in routines',async()=>{
 const db=new DatabaseSync(':memory:');
 const r=createRecovery(db,{inspect:async url=>({url,title:'Example'}),analyze:async()=>({company_name:'Example'})});
 assert.equal((await r.handle('one','routines','GET')).routine.enabled,0);
 await r.handle('one','routines','POST',{enabled:true,interval_hours:24});
 assert.equal((await r.handle('one','routines','GET')).routine.enabled,1);
 db.close();
});