import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createCatalogIntelligence} from '../src/catalog-intelligence.mjs';
function fixture(){
 const db=new DatabaseSync(':memory:');let now=1700000000000;
 const ledger={hash:(w,id)=>w+':hash:'+id};
 const catalog=createCatalogIntelligence(db,{ledger,clock:()=>now});
 return {db,catalog,advance:n=>{now+=n;}};
}
function product(c,id,title,price_cents,cost_cents,inventory=10){
 return c.catalog.handle('w','products','POST',{id,title,price_cents,cost_cents,inventory,currency:'USD',category:'test'});
}
function event(c,event_id,product_id,type,customer_id){
 return c.catalog.handle('w','events','POST',{event_id,product_id,type,customer_id,consent:true});
}
test('catalog validates products, deduplicates events, and rejects conflicting event IDs',()=>{
 const f=fixture();try{
  product(f,'p1','Product One',1000,800);
  assert.equal(event(f,'e1','p1','view','customer-1').created,true);
  assert.equal(event(f,'e1','p1','view','customer-1').duplicate,true);
  assert.throws(()=>event(f,'e1','p1','purchase','customer-1'),/Event ID reused/);
  assert.throws(()=>f.catalog.handle('w','products','POST',{id:'bad',title:'Invalid URL',price_cents:100,cost_cents:50,url:'http://example.com'}),/HTTPS/);
 }finally{f.db.close();}
});
test('catalog recommendations use consented customer hashes and pricing returns review-only margin guidance',()=>{
 const f=fixture();try{
  product(f,'p1','Product One',1000,800);
  product(f,'p2','Product Two',1000,500);
  product(f,'p3','Product Three',1000,1200,0);
  event(f,'a1','p1','purchase','customer-a');event(f,'a2','p2','purchase','customer-a');
  event(f,'b1','p1','purchase','customer-b');event(f,'b2','p2','purchase','customer-b');
  event(f,'c1','p1','cart','customer-c');
  const recs=f.catalog.handle('w','recommendations','POST',{customer_id:'customer-c',consent:true}).recommendations;
  assert.ok(recs.some(p=>p.id==='p2'));
  assert.throws(()=>f.catalog.handle('w','recommendations','POST',{customer_id:'customer-c',consent:false}),/explicit consent/);
  const pricing=f.catalog.handle('w','pricing','GET',{});
  assert.ok(pricing.recommendations.some(p=>p.product_id==='p3'&&p.type==='margin_protection'));
  assert.equal(pricing.policy.includes('does not change storefront prices'),true);
  assert.equal(f.catalog.handle('w','products','GET',{}).products.length,3);
 }finally{f.db.close();}
});
test('customer erasure removes linked catalog events without returning customer identifiers',()=>{
 const f=fixture();try{
  product(f,'p1','Product One',1000,500);event(f,'e1','p1','purchase','customer-1');
  f.catalog.eraseCustomer('w','customer-1');
  assert.equal(f.catalog.handle('w','recommendations','GET',{}).recommendations.length,0);
 }finally{f.db.close();}
});
