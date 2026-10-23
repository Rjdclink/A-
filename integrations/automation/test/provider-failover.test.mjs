import test from 'node:test';
import assert from 'node:assert/strict';
import {aiComplete} from '../src/runner.mjs';

const response=(text,status=200)=>new Response(JSON.stringify({choices:[{message:{content:text}}]}),{status});
const env={AI_BASE_URL:'https://primary.example/v1/chat/completions',AI_API_KEY:'primary-secret',AI_MODEL:'auto',AI_FALLBACK_BASE_URL:'https://backup.example/v1/chat/completions',AI_FALLBACK_API_KEY:'backup-secret',AI_FALLBACK_MODEL:'backup-model',AI_TIMEOUT_MS:'5000'};

test('provider failover on HTTP 429 uses separately configured backup credentials and model',async()=>{
 const calls=[];
 const fetchImpl=async(url,options)=>{
  calls.push({url,auth:options.headers.authorization,model:JSON.parse(options.body).model});
  return calls.length===1?new Response('rate limited',{status:429}):response('Recovered answer');
 };
 const answer=await aiComplete('Rules','Question',{env,fetchImpl});
 assert.equal(answer,'Recovered answer');
 assert.deepEqual(calls,[
  {url:env.AI_BASE_URL,auth:'Bearer primary-secret',model:'auto'},
  {url:env.AI_FALLBACK_BASE_URL,auth:'Bearer backup-secret',model:'backup-model'}
 ]);
});

test('provider failover on a timeout/network error works only when a backup is configured',async()=>{
 const calls=[];
 const fetchImpl=async(url)=>{calls.push(url);if(calls.length===1)throw Error('connection reset');return response('Available on backup');};
 assert.equal(await aiComplete('Rules','Question',{env,fetchImpl}),'Available on backup');
 assert.deepEqual(calls,[env.AI_BASE_URL,env.AI_FALLBACK_BASE_URL]);
 let withoutBackup=0;
 await assert.rejects(()=>aiComplete('Rules','Question',{env:{AI_BASE_URL:env.AI_BASE_URL},fetchImpl:async()=>{withoutBackup++;throw Error('connection reset');}}),/connection reset/);
 assert.equal(withoutBackup,1);
});

test('does not silently send prompts to a backup after HTTP 401 authentication errors',async()=>{
 let count=0;
 await assert.rejects(()=>aiComplete('Rules','Question',{env,fetchImpl:async()=>{count++;return new Response('unauthorized',{status:401});}}),/HTTP 401/);
 assert.equal(count,1);
});

test('rejects insecure fallback URL without sending a prompt or credentials',async()=>{
 let count=0;
 await assert.rejects(()=>aiComplete('Rules','Question',{env:{...env,AI_FALLBACK_BASE_URL:'http://backup.example/v1/chat/completions'},fetchImpl:async()=>{count++;return new Response('service down',{status:503});}}),/HTTPS/);
 assert.equal(count,0);
});
