import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const section=(id)=>html.match(new RegExp(`<section[^>]*id="${id}"[^>]*>([\\s\\S]*?)<\\/section>`))?.[1]||'';

test('overview presents three essentials and a clear first action',()=>{
 const home=section('dashboard');
 assert.match(home,/Your work, on autopilot\./);
 assert.match(home,/data-action="open-builder"[^>]*>\+?\s*New automation/);
 assert.equal((home.match(/class="metric"/g)||[]).length,3);
 assert.match(home,/id="home-attention"/);
 assert.doesNotMatch(home,/Total workflows|Configured agents|Intelligence that gets work done/);
});

test('advanced workflow configuration is collapsed by default, not required for a template',()=>{
 const workflows=section('workflows');
 assert.match(workflows,/<details[^>]*id="advanced-builder"/);
 assert.match(workflows,/id="wf-json"/);
 assert.match(workflows,/id="wf-template"/);
 assert.match(workflows,/id="wf-name"/);
 assert.doesNotMatch(workflows,/Workflow steps: template, AI, branch/);
});

test('running a workflow uses a guided input form rather than a raw JSON prompt',()=>{
 assert.match(html,/id="run-input-form"/);
 assert.match(html,/function inputFieldsForWorkflow\(/);
 assert.doesNotMatch(html,/\bprompt\(/);
 assert.match(html,/function statusLabel\(/);
});

test('dashboard uses accessible status messaging and avoids false worker-ready claims',()=>{
 assert.match(html,/id="toast"[^>]*role="status"/);
 assert.match(html,/id="dashboard-status"/);
 assert.doesNotMatch(html,/Persistent worker enabled/);
});

test('connections are managed through a short private setup form, never a member management screen',()=>{
 assert.match(html,/data-nav="connections"/);
 assert.match(html,/<section[^>]+id="connections"/);
 assert.match(html,/id="connection-form"/);
 assert.match(html,/id="connection-secret"[^>]*type="password"|type="password"[^>]*id="connection-secret"/);
 assert.doesNotMatch(html,/data-nav="members"|Member invitations|User permissions/);
});
