import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const commerce=readFileSync(new URL('../public/commerce.js',import.meta.url),'utf8');
test('minimal dashboard retains three metrics and keeps subscription and app setup separate',()=>{
 const overview=html.split('<section id="dashboard"')[1].split('<section id="workflows"')[0];
 assert.equal((overview.match(/class="metric"/g)||[]).length,3);
 for(const token of ['id="app-catalog-search"','id="catalog-results"','id="billing-status"','id="billing-plans"','data-nav="billing"'])
  assert.ok(html.includes(token),'Missing '+token);
});
test('connection status is explicit and Square checkout never collects raw card numbers',()=>{
 for(const token of ['/api/integrations/catalog','/api/integrations/connect','/api/billing/checkout','/api/billing/cancel','c.status===\'verified\''])
  assert.ok(commerce.includes(token),'Missing action '+token);
 assert.ok(html.includes('src="/commerce.js"'));
 assert.ok(html.includes('href="/commerce.css"'));
 assert.doesNotMatch(html+commerce,/id="card-number"|id="card-cvv"|card_number|card_cvv/);
});
