import test from 'node:test';
import assert from 'node:assert/strict';
import {advisory} from '../src/ai.mjs';

test('Vireonix auto-compatible AI requests reject redirects without changing advice',async()=>{
 let calls=0;
 const result=await advisory({metrics:{revenue:10,purchases:1},objective:'Improve conversions',env:{AI_API_KEY:'test-only-api-key'},fetcher:async(url,options)=>{
  calls++;
  assert.equal(url.href,'https://vireonix.ai/v1/chat/completions');
  assert.equal(options.method,'POST');
  assert.equal(options.redirect,'error','prevent upstream redirects from reaching unintended hosts');
  assert.equal(options.headers.authorization,'Bearer test-only-api-key');
  const body=JSON.parse(options.body);
  assert.equal(body.model,'auto');
  assert.equal(body.temperature,0.2);
  assert.deepEqual(JSON.parse(body.messages[1].content).metrics,{revenue:10,purchases:1});
  return Response.json({choices:[{message:{content:'Test the checkout layout.'}}]});
 }});
 assert.equal(result,'Test the checkout layout.');
 assert.equal(calls,1);
});

test('custom HTTPS model selection is supported, but URL credentials and HTTP are rejected before fetch',async()=>{
 let calls=0;
 const fetcher=async(url,options)=>{calls++;assert.equal(url.href,'https://provider.example/v1/chat/completions');assert.equal(JSON.parse(options.body).model,'custom-model');return Response.json({choices:[{message:{content:'Prioritize A/B tests.'}}]});};
 const env={AI_BASE_URL:'https://provider.example/v1/chat/completions',AI_MODEL:'custom-model'};
 assert.equal(await advisory({metrics:{},env,fetcher}),'Prioritize A/B tests.');
 for(const endpoint of ['http://provider.example/v1/chat/completions','https://user:password@provider.example/v1/chat/completions','https://user@provider.example/v1/chat/completions']){
  await assert.rejects(advisory({metrics:{},env:{AI_BASE_URL:endpoint},fetcher}),/HTTPS|credentials/);
 }
 assert.equal(calls,1,'invalid endpoints must not be contacted');
});

test('unavailable AI and malformed completions do not masquerade as successful guidance',async()=>{
 await assert.rejects(advisory({metrics:{},env:{},fetcher:async()=>Response.json({error:'denied'},{status:403})}),/unavailable/);
 await assert.rejects(advisory({metrics:{},env:{},fetcher:async()=>Response.json({choices:[{message:{content:''}}]})}),/no usable advice/);
});
