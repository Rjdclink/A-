import test from 'node:test';import assert from 'node:assert/strict';import {validateEvent,summarize} from '../src/analytics.mjs';
test('prototype-like campaign labels never alter lookup prototypes',()=>{const s=summarize([{id:'x',workspace:'a',type:'visit',campaign:'__proto__'}],'a');assert.equal(s.byCampaign['__proto__'].visits,1);assert.equal(Object.getPrototypeOf(s.byCampaign),null);});
test('reject mixed-currency purchases before aggregating totals',()=>{assert.throws(()=>validateEvent({type:'purchase',currency:'EUR',value:20,consent:true}),/USD/);});
