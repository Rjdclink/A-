import test from 'node:test';
import assert from 'node:assert/strict';
import {validateWorkflow, render, evaluate} from '../src/engine.mjs';

const simple={start:'first',steps:[{id:'first',type:'template',template:'Hello {{input.name}}',next:'done'},{id:'done',type:'end'}]};

test('workflow validation accepts a reachable graph and rejects cycles or dangling edges',()=>{
  assert.equal(validateWorkflow(simple).start,'first');
  assert.throws(()=>validateWorkflow({start:'a',steps:[{id:'a',type:'template',template:'x',next:'b'}]}),/unknown step/i);
  assert.throws(()=>validateWorkflow({start:'a',steps:[{id:'a',type:'template',template:'x',next:'a'}]}),/cycle/i);
});

test('templates interpolate nested contextual fields without resolving prototype properties',()=>{
  assert.equal(render('Hello {{input.name}}: {{steps.a}}', {input:{name:'Ada'},steps:{a:'ready'}}),'Hello Ada: ready');
  assert.equal(render('{{input.__proto__.constructor}}', {input:{}}),'');
});

test('branch expressions select the matching output step',()=>{
  assert.equal(evaluate({path:'input.score',operator:'gte',value:70},{input:{score:80}}),true);
  assert.equal(evaluate({path:'input.score',operator:'gte',value:70},{input:{score:20}}),false);
});
