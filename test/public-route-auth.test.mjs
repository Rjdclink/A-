import test from 'node:test';
import assert from 'node:assert/strict';
import {publicRouteNeedsAdmin} from '../src/security.mjs';

test('public dashboard permits only explicitly reviewed aggregate GET routes',()=>{
 for(const path of ['/api/overview','/api/recovery/overview']){
  assert.equal(publicRouteNeedsAdmin('GET',path),false,`${path} should remain publicly readable`);
 }
 for(const path of [
  '/api/privacy/requests','/api/privacy/export','/api/recovery/leads',
  '/api/recovery/outreach','/api/growth/workflows','/api/growth/billing',
  '/api/advanced/summary','/api/catalog/products','/api/new-feature'
 ]){
  assert.equal(publicRouteNeedsAdmin('GET',path),true,`${path} must require owner credentials`);
 }
});

test('public dashboard cannot mutate or spend API resources anonymously',()=>{
 for(const [method,path] of [
  ['POST','/api/privacy/erase'],['POST','/api/privacy/export'],
  ['POST','/api/events'],['POST','/api/recovery/leads'],
  ['POST','/api/recovery/outreach/123/send'],['POST','/api/advice'],
  ['POST','/api/campaigns/spend'],['POST','/api/experiments'],
  ['POST','/api/growth-agent/run'],['PATCH','/api/support/settings'],
  ['DELETE','/api/catalog/products'],['POST','/api/new-feature']
 ]){
  assert.equal(publicRouteNeedsAdmin(method,path),true,`${method} ${path} must require a token`);
 }
});
