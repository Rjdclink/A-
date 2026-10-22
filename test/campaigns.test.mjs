import test from 'node:test';import assert from 'node:assert/strict';
import {Ledger} from '../src/ledger.mjs';
const key='this-is-a-stable-32-character-test-key';
test('paid campaign benchmarks are deduplicated by day and workspace',()=>{
 const l=new Ledger(':memory:',{pseudonymKey:key});const now=Date.parse('2026-10-22T18:00:00.000Z');
 l.add('one','order_1',{type:'purchase',value:100,consent:true,campaign:'search'},now);
 l.recordSpend('one',{campaign:'search',date:'2026-10-22',spend:25,clicks:50,impressions:1000});
 l.recordSpend('one',{campaign:'search',date:'2026-10-22',spend:25,clicks:50,impressions:1000});
 assert.equal(l.overview('one',{now}).byCampaign.search.roas,4);
 assert.equal(l.overview('one',{now}).byCampaign.search.cpa,25);
 assert.equal(l.overview('one',{now}).byCampaign.search.ctr,5);
 assert.equal(l.overview('two',{now}).byCampaign.search,undefined);
 l.close();
});
test('campaign performance avoids invented ROAS when spend is unmeasured',()=>{
 const l=new Ledger(':memory:',{pseudonymKey:key});const now=Date.parse('2026-10-22T18:00:00Z');
 l.add('one','order_1',{type:'purchase',value:100,consent:true,campaign:'organic'},now);
 assert.equal(l.overview('one',{now}).byCampaign.organic.roas,null);
 assert.throws(()=>l.recordSpend('one',{campaign:'email',date:'2026-10-22',spend:-5}),/Invalid/);
 assert.throws(()=>l.recordSpend('one',{campaign:'email',date:'2026-02-30',spend:5}),/Invalid/);
 l.close();
});
