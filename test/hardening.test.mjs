import test from 'node:test';import assert from 'node:assert/strict';
import {Ledger} from '../src/ledger.mjs';
import {experimentVariant,compareRates} from '../src/experiments.mjs';
import {verifyShopify,shopifyOrder} from '../src/shopify.mjs';
import {loadTenants} from '../src/security.mjs';
import {createHmac} from 'node:crypto';
const key='this-is-an-adequately-long-privacy-key';
test('SQLite is durable, deduplicated, and workspace isolated',()=>{
 const l=new Ledger(':memory:',{pseudonymKey:key});
 assert.equal(l.add('one','order-1',{type:'purchase',value:12.34,consent:true,campaign:'__proto__',customerId:'abc'},1_000).status,'created');
 assert.equal(l.add('one','order-1',{type:'purchase',value:12.34,consent:true,campaign:'__proto__',customerId:'abc'},1_005).status,'duplicate');
 assert.throws(()=>l.add('one','order-1',{type:'purchase',value:100,consent:true,campaign:'__proto__',customerId:'abc'},1_010),e=>e.status===409);
 assert.equal(l.overview('one',{now:2_000,days:30}).revenue,12.34);
 assert.equal(l.overview('two',{now:2_000,days:30}).revenue,0);
 assert.equal(l.overview('one',{now:2_000,days:30}).byCampaign['__proto__'].revenue,12.34);
 assert.equal(l.eraseCustomer('one','abc'),1);
 assert.equal(l.overview('one',{now:2_000,days:30}).purchases,0);
 l.close();
});
test('rejects lossy decimal amounts and unsupported currency',()=>{
 const l=new Ledger(':memory:',{pseudonymKey:key});
 assert.throws(()=>l.add('default','p',{type:'purchase',value:1.234,consent:true}),/precision/);
 assert.throws(()=>l.add('default','p',{type:'purchase',value:1,currency:'EUR',consent:true}),/USD/);l.close();
});
test('experiment allocations are deterministic and stable',()=>{
 assert.equal(experimentVariant('a','exp','visitor','salt'),experimentVariant('a','exp','visitor','salt'));
 const v=new Set(Array.from({length:200},(_,i)=>experimentVariant('a','exp','visitor'+i,'salt')));
 assert.deepEqual([...v].sort(),['control','treatment']);
});
test('inconclusive experiments never assert a winner',()=>{
 assert.equal(compareRates({control:{n:2,conversions:2},treatment:{n:2,conversions:0}}).status,'insufficient_data');
 assert.equal(compareRates({control:{n:200,conversions:30},treatment:{n:200,conversions:30}}).status,'inconclusive');
});
test('HMAC verifies raw Shopify bytes and rejects tampering',()=>{
 const raw=Buffer.from('{"id":123,"total_price":"21.00"}');const secret='shopify_shared_secret';const mac=createHmac('sha256',secret).update(raw).digest('base64');
 assert.equal(verifyShopify(raw,mac,secret),true);assert.equal(verifyShopify(Buffer.from('not the same'),mac,secret),false);assert.equal(verifyShopify(raw,'bad',secret),false);
 assert.equal(shopifyOrder(JSON.parse(raw)).value,21);
});
test('legacy workspace token cannot access arbitrary tenants',()=>{
 const t=loadTenants({ADMIN_TOKEN:'a'.repeat(25),INGEST_TOKEN:'b'.repeat(25)});assert.deepEqual(Object.keys(t),['default']);
});
test('tokens cannot be shared across tenants',()=>{
 const a='a'.repeat(32),b='b'.repeat(32),c='c'.repeat(32);
 assert.throws(()=>loadTenants({WORKSPACES_JSON:JSON.stringify({first:{adminToken:a,ingestToken:b},second:{adminToken:c,ingestToken:b}})}),/globally unique/);
});
test('privacy redaction prevents later reingestion of the same customer',()=>{
 const l=new Ledger(':memory:',{pseudonymKey:key});
 l.add('shop','a',{type:'purchase',value:10,consent:true,customerId:'redact-me'});
 l.eraseCustomer('shop','redact-me');
 assert.equal(l.add('shop','b',{type:'purchase',value:10,consent:true,customerId:'redact-me'}).status,'suppressed');
 assert.equal(l.overview('shop').purchases,0);l.close();
});
test('uninstalled shops remain disabled across later webhook deliveries',()=>{
 const l=new Ledger(':memory:',{pseudonymKey:key});
 l.eraseWorkspace('shop',{shopDomain:'redact.myshopify.com'});
 assert.equal(l.shopActive('shop','redact.myshopify.com'),false);
 l.close();
});
test('privacy requests remain pending until a merchant explicitly confirms completion',()=>{
 const l=new Ledger(':memory:',{pseudonymKey:key});
 l.privacyRequest('shop','request:112','person-1',1000);
 l.eraseOld({now:2000+200*86_400_000,days:180});
 assert.equal(l.pendingPrivacyRequests('shop')[0].status,'pending');
 assert.equal(l.completePrivacyRequest('shop','request:112'),true);
 assert.equal(l.pendingPrivacyRequests('shop')[0].status,'completed');
 l.close();
});
test('event capacity cannot be disabled by invalid environment values',()=>{
 assert.throws(()=>new Ledger(':memory:',{pseudonymKey:key,maxEvents:NaN}),/MAX_EVENTS/);
 const l=new Ledger(':memory:',{pseudonymKey:key,maxEvents:1});
 l.add('shop','first',{type:'visit',consent:true});
 assert.throws(()=>l.add('shop','second',{type:'visit',consent:true}),e=>e.status===507);
 l.close();
});
