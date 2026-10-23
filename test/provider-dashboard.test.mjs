import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
test('Advanced Controls exposes provider diagnostics and meaningful setup states',async()=>{
 const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
 const app=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
 assert.match(html,/id="view-advanced"/);
 assert.match(html,/id="providerStatus"/);
 assert.match(html,/id="refreshConnections"/);
 assert.match(app,/\/api\/integrations\/status/);
 assert.match(app,/configuration_incomplete/);
 assert.match(app,/Configured means|live provider verification required/);
 assert.doesNotMatch(app,/localStorage|sessionStorage|innerHTML/);
});