import test from 'node:test';
import assert from 'node:assert/strict';
import {providerHeaders,providerProbe,validateProbe} from '../src/integrations/providers.mjs';
import {getAppDefinition,resolveAppHost} from '../src/integrations/catalog.mjs';
test('provider requests use the required authentication wire formats',()=>{
 assert.deepEqual(providerHeaders('shopify','secret'),{'X-Shopify-Access-Token':'secret'});
 assert.deepEqual(providerHeaders('brevo','secret'),{'api-key':'secret'});
 assert.deepEqual(providerHeaders('postmark','secret'),{'X-Postmark-Server-Token':'secret'});
 assert.equal(resolveAppHost(getAppDefinition('postmark')),'api.postmarkapp.com');
 assert.equal(providerProbe('shopify').method,'POST');
 assert.equal(JSON.parse(providerProbe('shopify').body.payload).query,'query { shop { id name } }');
});
test('HTTP success alone cannot verify a failed provider authentication response',()=>{
 for(const [provider,body] of [['slack',{ok:false,error:'invalid_auth'}],['shopify',{errors:[{message:'Access denied'}]}],['postmark',{ErrorCode:10}],['hubspot','not JSON']])assert.throws(()=>validateProbe(provider,typeof body==='string'?body:JSON.stringify(body)));
 assert.doesNotThrow(()=>validateProbe('shopify',JSON.stringify({data:{shop:{id:'gid://shopify/Shop/1'}}})));
 assert.doesNotThrow(()=>validateProbe('slack','{"ok":true}'));
});
