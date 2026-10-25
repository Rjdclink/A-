import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {load} from 'cheerio';
const read=(file)=>readFileSync(new URL('../public/'+file,import.meta.url),'utf8');
test('visitor support interface provides consent-gated lead intake and a clearly unconfirmed appointment request',()=>{
 const html=read('support.html'),js=read('support.js');
 for(const id of ['leadConsent','appointmentPanel','appointmentForm','appointmentService','appointmentTime','appointmentNotes'])assert.match(html,new RegExp('id="'+id+'"'));
 assert.match(html,/not a confirmed booking/i);
 assert.match(js,/leadConsent/);assert.match(js,/appointmentForm/);
});
test('staff dashboard includes opt-in lead reviews and nonbooking appointment management',()=>{
 const html=read('support-admin.html'),js=read('support-admin.js');
 for(const id of ['section-leads','section-appointments','leadsList','appointmentsList'])assert.match(html,new RegExp('id="'+id+'"'));
 assert.match(js,/loadLeads/);assert.match(js,/loadAppointments/);
});

test('customers can explicitly request a human and staff can access self-declared customer histories',()=>{
 const visitor=read('support.html'),admin=read('support-admin.html'),agent=read('support-admin.js');
 assert.match(visitor,/id="humanButton"/);
 assert.match(admin,/id="section-customers"/);
 assert.match(admin,/id="customersList"/);
 assert.match(admin,/id="customerHistory"/);
 assert.match(agent,/loadCustomers/);
});

test('visitor rating and appointment forms are separate valid forms, not nested inside message composition',()=>{
 const $=load(read('support.html'));
 assert.equal($('#chatForm').length,1);
 assert.equal($('#ratingForm').length,1);
 assert.equal($('#appointmentForm').length,1);
 assert.equal($('#chatForm').find('form').length,0);
 assert.equal($('#ratingForm').closest('#chatForm').length,0);
 assert.equal($('#appointmentForm').closest('#chatForm').length,0);
});
