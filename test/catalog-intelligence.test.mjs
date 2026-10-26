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

test('catalog exposes observed price cohorts without claiming a causal winner',()=>{
 const f=fixture();try{
  product(f,'p1','Product One',1000,500);
  event(f,'view-at-10','p1','view','customer-1');
  product(f,'p1','Product One',1200,500);
  event(f,'purchase-at-12','p1','purchase','customer-1');
  const result=f.catalog.handle('w','pricing','GET',{});
  assert.equal(result.price_cohorts.length,2);
  assert.equal(result.price_comparisons.length,1);
  assert.match(result.price_comparisons[0].interpretation,/not randomized/);
 }finally{f.db.close();}
});

test('price tests keep customer assignments stable, require consent, and report observed variants',()=>{
 const f=fixture();try{
  product(f,'p1','Product One',1000,500,100);
  const created=f.catalog.handle('w','price-tests','POST',{id:'price-v1',product_id:'p1',control_price_cents:1000,treatment_price_cents:1200});
  assert.equal(created.price_test.status,'active');
  assert.throws(()=>f.catalog.handle('w','price-tests','POST',{id:'below-cost',product_id:'p1',control_price_cents:400,treatment_price_cents:1200}),/cannot undercut/);
  assert.throws(()=>f.catalog.handle('w','price-tests/assign','POST',{experiment_id:'price-v1',customer_id:'customer-a',consent:false}),/explicit/);
  const a=f.catalog.handle('w','price-tests/assign','POST',{experiment_id:'price-v1',customer_id:'customer-a',consent:true});
  const b=f.catalog.handle('w','price-tests/assign','POST',{experiment_id:'price-v1',customer_id:'customer-b',consent:true});
  assert.notEqual(a.variant,b.variant);
  assert.deepEqual(f.catalog.handle('w','price-tests/assign','POST',{experiment_id:'price-v1',customer_id:'customer-a',consent:true}).variant,a.variant);
  const av=f.catalog.handle('w','events','POST',{event_id:'price-view-a',product_id:'p1',type:'view',customer_id:'customer-a',consent:true,price_test_id:'price-v1'});
  const bv=f.catalog.handle('w','events','POST',{event_id:'price-view-b',product_id:'p1',type:'view',customer_id:'customer-b',consent:true,price_test_id:'price-v1'});
  const bp=f.catalog.handle('w','events','POST',{event_id:'price-purchase-b',product_id:'p1',type:'purchase',customer_id:'customer-b',consent:true,price_test_id:'price-v1'});
  assert.equal(av.price_cents,a.price_cents);
  assert.equal(bv.price_cents,b.price_cents);
  assert.equal(bp.price_cents,b.price_cents);
  const report=f.catalog.handle('w','price-tests/report','GET',{}).price_tests[0];
  assert.equal(report.control.views,1);
  assert.equal(report.treatment.views,1);
  assert.equal(report.treatment.purchasers,1);
  assert.match(report.interpretation,/Insufficient sample/);
  f.catalog.handle('w','price-tests/status','POST',{id:'price-v1',status:'paused'});
  assert.throws(()=>f.catalog.handle('w','price-tests/assign','POST',{experiment_id:'price-v1',customer_id:'customer-c',consent:true}),/not accepting/);
 }finally{f.db.close();}
});

test('anonymous event replay remains idempotent after a product price update',()=>{
 const f=fixture();try{
  product(f,'p1','Product One',1000,500);
  const first=f.catalog.handle('w','events','POST',{event_id:'stable-view',product_id:'p1',type:'view'});
  assert.equal(first.created,true);
  product(f,'p1','Product One',1200,500);
  const replay=f.catalog.handle('w','events','POST',{event_id:'stable-view',product_id:'p1',type:'view'});
  assert.equal(replay.duplicate,true);
 }finally{f.db.close();}
});
