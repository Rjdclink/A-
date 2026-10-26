import test from 'node:test';
import assert from 'node:assert/strict';
import {publicRouteNeedsAdmin} from '../src/security.mjs';
test('public dashboard requires admin authorization for growth-agent mutations',()=>{
 assert.equal(publicRouteNeedsAdmin('GET','/api/growth-agent/plan'),false);
 assert.equal(publicRouteNeedsAdmin('GET','/api/growth-agent/settings'),false);
 assert.equal(publicRouteNeedsAdmin('POST','/api/growth-agent/settings'),true);
 assert.equal(publicRouteNeedsAdmin('POST','/api/growth-agent/run'),true);
 assert.equal(publicRouteNeedsAdmin('POST','/api/growth-agent/runs'),true);
});
