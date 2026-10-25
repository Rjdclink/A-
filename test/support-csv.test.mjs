import test from 'node:test';
import assert from 'node:assert/strict';
import {parseSupportCsv} from '../src/support-csv.mjs';
import {Ledger} from '../src/ledger.mjs';
import {createSupport} from '../src/support.mjs';
test('quoted CSV knowledge input supports commas and newlines without losing structure',()=>{
 const csv='question,answer,locale,category,active\r\n"Return, policy","Bring receipt, within 30 days",en,Returns,true\r\n"¿Dónde?","Estamos aquí,\npara ayudar",es,Service,false\r\n';
 const result=parseSupportCsv(csv);
 assert.deepEqual(result,[
  {question:'Return, policy',answer:'Bring receipt, within 30 days',locale:'en',category:'Returns',active:true},
  {question:'¿Dónde?',answer:'Estamos aquí,\npara ayudar',locale:'es',category:'Service',active:false}
 ]);
});
test('malformed knowledge CSV aborts before writing any articles',()=>{
 const ledger=new Ledger(':memory:',{pseudonymKey:'csv-test-key-for-a-plus-12345678'});
 const support=createSupport(ledger.db);
 assert.throws(()=>parseSupportCsv('question,answer\n"unclosed,missing'),/CSV/i);
 assert.throws(()=>parseSupportCsv('question,answer\nQ,A\nQ2'),/CSV/i);
 assert.equal(support.listArticles('shop').length,0);
 const result=support.bulkArticles('shop',{articles:parseSupportCsv('answer,question\n"24 hours","Service response?"')});
 assert.equal(result.imported,1);
 assert.equal(support.listArticles('shop').length,1);
 ledger.close();
});
