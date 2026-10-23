import test from 'node:test';
import assert from 'node:assert/strict';
import {shouldTickWorkers} from '../functions/aplus/index.mjs';

test('loading dashboard and reports never starts background actions',()=>{
 for(const method of ['GET','HEAD']){
  for(const route of ['/','/health','/api/growth/workflows','/api/recovery/overview','/api/overview','/studio/']){
   assert.equal(shouldTickWorkers(method,route,false),false,method+' '+route);
  }
 }
});
test('scheduled triggers and explicit mutation requests advance work',()=>{
 assert.equal(shouldTickWorkers('POST','/tasks',true),true);
 assert.equal(shouldTickWorkers('POST','/api/events',false),true);
 assert.equal(shouldTickWorkers('POST','/api/growth/workflows',false),true);
 assert.equal(shouldTickWorkers('DELETE','/api/growth/connections/id',false),false);
 assert.equal(shouldTickWorkers('POST','/tasks',false),false);
});
