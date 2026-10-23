import test from 'node:test';
import assert from 'node:assert/strict';
import {Ledger} from '../src/ledger.mjs';

const key='a-stable-pseudonym-key-for-privacy-tests';

test('erased customers cannot rejoin A/B experiments, including after a prior assignment',()=>{
 const ledger=new Ledger(':memory:',{pseudonymKey:key});
 try{
  ledger.createExperiment('shop','checkout');
  assert.ok(['control','treatment'].includes(ledger.assign('shop','checkout','customer-1',{consent:true})));
  ledger.eraseCustomer('shop','customer-1');
  const afterErasure=ledger.experimentReport('shop','checkout').results;
  assert.equal(afterErasure.control.n+afterErasure.treatment.n,0);
  assert.throws(()=>ledger.assign('shop','checkout','customer-1',{consent:true}),error=>error.status===410);
  ledger.eraseCustomer('shop','customer-2');
  assert.throws(()=>ledger.assign('shop','checkout','customer-2',{consent:true}),error=>error.status===410);
  const afterRetries=ledger.experimentReport('shop','checkout').results;
  assert.equal(afterRetries.control.n+afterRetries.treatment.n,0);
 }finally{ledger.close();}
});
