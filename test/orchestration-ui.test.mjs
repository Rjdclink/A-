import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
test('unified dashboard exposes understandable event-to-workflow connections without leaking credentials',()=>{
 const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
 const js=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
 for(const id of ['triggerEvent','triggerWorkflow','saveTrigger','triggerList'])assert.match(html,new RegExp('id="'+id+'"'));
 assert.match(js,/\/api\/orchestration\/links/);
 assert.doesNotMatch(js,/localStorage|sessionStorage|innerHTML/);
});