import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {load} from 'cheerio';
const file=(p)=>readFileSync(new URL('../public/'+p,import.meta.url),'utf8');
test('staff console exposes team login and all local service operating functions',()=>{
 const h=file('support-admin.html'),js=file('support-admin.js'),$=load(h);
 for(const name of ['staffLoginForm','staffEmail','staffPassword','section-team','teamList',
  'section-calendar','calendarSlots','calendarBookings','slotForm',
  'section-operations','supportNotifications','slaForm','trendList',
  'macroForm','macroList','routingForm','routingList','knowledgeImportForm','articleImportFile','ticketQuery',
  'ticketNotes','noteForm','replyMacro'])assert.equal($('#'+name).length,1,name);
 assert.match(js,/team\/login/);
 assert.match(js,/loadTeam/);
 assert.match(js,/loadCalendar/);
 assert.match(js,/loadOperations/);
 assert.match(js,/loadMacros/);
 assert.match(js,/articles\/import/);
 assert.match(js,/tickets\/search/);
 assert.match(js,/tickets\/.*notes/);
});
test('visitor widget supports local booking, self-service export and erasure and same-tab recovery',()=>{
 const h=file('support.html'),js=file('support.js'),$=load(h);
 for(const name of ['availableSlots','bookSlot','myBookings','selfExport','selfErase'])assert.equal($('#'+name).length,1,name);
 assert.match(js,/calendar\/slots/);assert.match(js,/calendar\/book/);assert.match(js,/privacy\/self\/export/);
 assert.match(js,/privacy\/self\/erase/);assert.match(js,/sessionStorage/);
 assert.equal($('form form').length,0,'forms are not nested');
});

test('customer and staff consoles offer authenticated file attachments without an outside storage service',()=>{
 const visitor=file('support.html'),admin=file('support-admin.html'),client=file('support.js'),agent=file('support-admin.js');
 const $=load(visitor),other=load(admin);
 for(const x of ['customerFile','uploadFile','customerFiles'])assert.equal($('#'+x).length,1,x);
 for(const x of ['staffFile','staffUpload','ticketFiles'])assert.equal(other('#'+x).length,1,x);
 assert.match(client,/files\/read/);assert.match(agent,/files\//);
 assert.equal($('form form').length,0);
 assert.equal(other('form form').length,0);
});
