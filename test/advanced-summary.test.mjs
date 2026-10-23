import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {Ledger} from '../src/ledger.mjs';
import {createUnified} from '../src/unified.mjs';
import {createHandler} from '../src/api.mjs';

test('Advanced Controls retrieves all live sections in one authorized server request',async()=>{
 const ledger=new Ledger(':memory:',{pseudonymKey:'stable-key-for-advanced-summary-tests'});
 const unified=createUnified({ledger,automationDbPath:':memory:',env:{AUTO_BACKUP_HOURS:'0'},autoStart:false});
 const tenants={default:{adminToken:'a'.repeat(32),ingestToken:'b'.repeat(32)}};
 const server=createServer(createHandler({ledger,unified,tenants,shopify:{},adviser:async()=>'',publicDashboard:true,publicWorkspace:'default'}));
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base='http://127.0.0.1:'+server.address().port;
 try{
  const response=await fetch(base+'/api/advanced/summary');
  assert.equal(response.status,200);
  const result=await response.json();
  assert.deepEqual(result.workflows,[]);
  assert.deepEqual(result.privacy.requests,[]);
  assert.ok(Array.isArray(result.plans));
  assert.equal(result.billing.status,'free');
  assert.ok(Array.isArray(result.audit));
  assert.ok(Array.isArray(result.history.events));
  assert.ok(result.maintenance.automatic_backups);
  assert.equal(result.connections.providers.email,'not_configured');
  assert.equal((await fetch(base+'/api/advanced/summary?workspace=other')).status,403);
 }finally{await new Promise(r=>server.close(r));await unified.close();ledger.close();}
});
