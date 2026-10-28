import test from 'node:test';
import assert from 'node:assert/strict';
import {createSupportResponder} from '../src/support.mjs';

const config={SUPPORT_AI_ENABLED:'true',SUPPORT_AI_DATA_PROCESSING_ACKNOWLEDGED:'true',AI_API_KEY:'test-key'};
const request={message:'When will my order arrive?',articles:[{answer:'Orders usually ship in two days.'}],locale:'en'};

test('support AI rejects credential-bearing endpoint URLs before sending customer content',()=>{
 let requests=0;
 assert.throws(()=>createSupportResponder({...config,AI_BASE_URL:'https://operator:password@vireonix.ai/v1/chat/completions'},{fetcher:async()=>{requests++;}}),/credential/i);
 assert.equal(requests,0);
});

test('support AI forbids HTTP redirects while preserving the Vireonix auto request',async()=>{
 let calls=0;
 const responder=createSupportResponder(config,{fetcher:async(url,options)=>{
  calls++;
  assert.equal(url.href,'https://vireonix.ai/v1/chat/completions');
  assert.equal(options.redirect,'error');
  assert.equal(options.headers.authorization,'Bearer test-key');
  const payload=JSON.parse(options.body);
  assert.equal(payload.model,'auto');
  assert.equal(JSON.parse(payload.messages[1].content).customerQuestion,request.message);
  return {ok:true,json:async()=>({choices:[{message:{content:'Orders usually ship in two days.'}}]})};
 }});
 assert.equal(await responder(request),'Orders usually ship in two days.');
 assert.equal(calls,1);
});

test('support AI refuses non-HTTPS endpoints and remains opt-in',()=>{
 assert.throws(()=>createSupportResponder({...config,AI_BASE_URL:'http://vireonix.ai/v1/chat/completions'}),/HTTPS/);
 assert.equal(createSupportResponder({...config,SUPPORT_AI_ENABLED:'false'}),null);
 assert.equal(createSupportResponder({...config,SUPPORT_AI_DATA_PROCESSING_ACKNOWLEDGED:'false'}),null);
});
