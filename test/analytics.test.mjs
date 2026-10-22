import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreLead, summarize, recommend, validateEvent } from '../src/analytics.mjs';

test('scores declared buying intent without inventing signals', () => {
 assert.equal(scoreLead({email:'a@example.com',events:['view','cart','purchase']}),100);
 assert.equal(scoreLead({events:['view']}),10);
});
test('summaries avoid double counting duplicate events and constrain workspace',()=>{
 const data=[{id:'1',workspace:'a',type:'purchase',value:20},{id:'1',workspace:'a',type:'purchase',value:20},{id:'2',workspace:'b',type:'purchase',value:999},{id:'3',workspace:'a',type:'visit',value:0}];
 assert.deepEqual(summarize(data,'a').revenue,20);
 assert.equal(summarize(data,'a').purchases,1);
});
test('recommendations do not invent a conversion lift',()=>{
 const result=recommend({visits:100,carts:20,purchases:2,revenue:80});
 assert.ok(result.some(x=>x.includes('checkout')));
 assert.ok(result.every(x=>!x.includes('% lift')));
});
test('event input requires consent and valid value',()=>{
 assert.throws(()=>validateEvent({type:'purchase',value:10,consent:false}));
 assert.throws(()=>validateEvent({type:'purchase',value:-1,consent:true}));
 assert.equal(validateEvent({type:'purchase',value:10,consent:true}).type,'purchase');
});
