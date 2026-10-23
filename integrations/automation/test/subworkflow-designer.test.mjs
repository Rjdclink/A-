import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {insertStep,graphLayout} from '../public/designer.js';

test('subworkflow nodes can be placed in a visual graph without corrupting its direction',()=>{
 const spec={start:'first',steps:[{id:'first',type:'template',template:'Ready',next:'finish'},{id:'finish',type:'end'}]};
 const next=insertStep(spec,'first','subworkflow');
 assert.equal(next.steps.at(-1).type,'subworkflow');
 assert.equal(next.steps.at(-1).next,'finish');
 assert.equal(graphLayout(next).nodes.length,3);
});

test('designer makes selecting a saved automation possible without exposing multiuser features',()=>{
 const source=readFileSync(new URL('../public/designer.js',import.meta.url),'utf8');
 const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
 assert.match(source,/subworkflow:\{label:'Call automation'/);
 assert.match(source,/Select automation/);
 assert.match(source,/deps.workflows/);
 assert.match(html,/awaiting_child:'Waiting on automation'/);
 assert.doesNotMatch(html,/data-nav="members"/);
});
