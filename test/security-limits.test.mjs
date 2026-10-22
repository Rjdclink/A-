import test from 'node:test';
import assert from 'node:assert/strict';
import {createLimiter, safeEventIdentity, validateWorkspace} from '../src/security.mjs';

test('workspace identifiers are constrained',()=>{
 assert.equal(validateWorkspace('store_1'),'store_1');
 assert.throws(()=>validateWorkspace('__proto__/../other'));
});
test('limiter rejects bursts and permits calls after its window',()=>{
 const limit=createLimiter({windowMs:1000,max:2,maxKeys:10});
 assert.equal(limit('a',100),true);
 assert.equal(limit('a',110),true);
 assert.equal(limit('a',120),false);
 assert.equal(limit('a',1201),true);
 assert.equal(limit('b',1201),true);
});
test('idempotency distinguishes identical retries from conflicting reuse',()=>{
 const first={id:'order-1',workspace:'a',type:'purchase',value:10,campaign:'email'};
 assert.equal(safeEventIdentity(first,{...first}),'duplicate');
 assert.equal(safeEventIdentity(first,{...first,value:50}),'conflict');
 assert.equal(safeEventIdentity(first,{...first,id:'order-2'}),'distinct');
});
test('limiter bounds tracked sources under untrusted IP cardinality',()=>{
 const limit=createLimiter({windowMs:500,max:1,maxKeys:2});
 assert.equal(limit('a',0),true);assert.equal(limit('b',0),true);
 assert.equal(limit('c',0),false);
 assert.equal(limit('a',1000),true);
});
