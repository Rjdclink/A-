import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../src/server.mjs';
const env={ALLOW_SIGNUP:'true',SESSION_COOKIE_SECURE:'false',INTEGRATION_MASTER_KEY:'a'.repeat(64)};
async function app(){
 const requests=[],application=createApp({dbPath:':memory:',autoStart:false,env,
  httpRequest:async args=>{requests.push(args);return '{"authenticated":true}';}});
 await new Promise(done=>application.server.listen(0,'127.0.0.1',done));
 const root='http://127.0.0.1:'+application.server.address().port;let cookie='';
 async function api(path,method='GET',data){
  const res=await fetch(root+path,{method,headers:{origin:root,...(cookie?{cookie}:{}),...(data===undefined?{}:{'content-type':'application/json'})},body:data===undefined?undefined:JSON.stringify(data)});
  if(res.headers.get('set-cookie'))cookie=res.headers.get('set-cookie').split(';')[0];
  return {status:res.status,data:await res.json()};
 }
 async function register(email){return api('/api/auth/register','POST',{name:'Marketplace test',email,password:'secure test password 123456'});}
 async function close(){application.stop();await new Promise(done=>application.server.close(done));application.db.close();}
 return {api,register,close,db:application.db,requests};
}
test('searchable curated catalog provides at least 65 distinct setup profiles, not fake ready connections',async()=>{
 const h=await app();try{
  await h.register('marketplace@example.com');
  const catalog=await h.api('/api/integrations/catalog');
  assert.equal(catalog.status,200);
  assert.ok(catalog.data.length>=65);
  assert.equal(new Set(catalog.data.map(x=>x.id)).size,catalog.data.length);
  assert.ok(catalog.data.every(x=>x.status==='requires_credentials'));
  assert.ok(catalog.data.every(x=>x.name&&x.category&&/^[a-z0-9.-]+\.[a-z]{2,}$/.test(x.hostname)));
  const filtered=await h.api('/api/integrations/catalog?search=hubspot');
  assert.ok(filtered.data.some(x=>x.id==='hubspot'));
  assert.ok(filtered.data.every(x=>x.id.includes('hubspot')));
 }finally{await h.close();}
});
test('catalog quick-connect uses AES-GCM encryption, validates provider hosts and never exposes secrets',async()=>{
 const h=await app();try{
  await h.register('connect@example.com');
  const invalid=await h.api('/api/integrations/connect','POST',{provider_id:'hubspot',credential:'secret',host:'localhost'});
  assert.equal(invalid.status,400);
  const stored=await h.api('/api/integrations/connect','POST',{provider_id:'hubspot',credential:'MY_SUPER_SECRET_API_KEY'});
  assert.equal(stored.status,201,JSON.stringify(stored.data));
  assert.equal(stored.data.provider_id,'hubspot');
  assert.equal(stored.data.status,'configured');
  assert.doesNotMatch(JSON.stringify(stored.data),/MY_SUPER_SECRET/);
  const row=h.db.prepare('SELECT * FROM connections WHERE id=?').get(stored.data.id);
  assert.ok(row.secret_cipher&&!row.secret_cipher.includes('MY_SUPER_SECRET'));
  assert.equal(row.provider_id,'hubspot');
  const listed=await h.api('/api/connections');
  assert.equal(listed.data[0].status,'configured');
  assert.equal(listed.data[0].host,'api.hubapi.com');
  const checked=await h.api('/api/integrations/'+stored.data.id+'/test','POST',{});
  assert.equal(checked.status,200,JSON.stringify(checked.data));
  assert.equal(checked.data.status,'verified');
  assert.equal(h.requests.length,1);
  assert.equal(h.requests[0].method,'GET');
  assert.equal(h.requests[0].headers.authorization,'Bearer MY_SUPER_SECRET_API_KEY');
  assert.deepEqual(h.requests[0].allowedHosts,['api.hubapi.com']);
  assert.equal((await h.api('/api/connections')).data[0].status,'verified');
  await h.register('other@example.com');
  assert.equal((await h.api('/api/connections')).data.length,0);
  assert.equal((await h.api('/api/integrations/'+stored.data.id+'/test','POST',{})).status,404);
 }finally{await h.close();}
});
