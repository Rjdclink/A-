const DAY=86_400_000;
function fail(message,status=400){throw Object.assign(Error(message),{status});}
function productId(v){if(typeof v!=='string'||! /^[a-z0-9_-]{1,80}$/i.test(v))fail('Product ID must use letters, numbers, underscores, or hyphens');return v;}
function price(v,label='Price'){if(!Number.isSafeInteger(v)||v<0||v>100_000_000_000)fail(label+' must be a non-negative integer in cents');return v;}
function safeUrl(v){if(v===undefined||v===null||v==='')return '';if(typeof v!=='string'||v.length>2048)fail('Product URL is invalid');let u;try{u=new URL(v)}catch{fail('Product URL must be HTTPS')};if(u.protocol!=='https:'||u.username||u.password)fail('Product URL must be HTTPS');return u.href;}
export function createCatalogIntelligence(db,{ledger,clock=()=>Date.now()}={}){
 if(!ledger||typeof ledger.hash!=='function')throw Error('Commerce ledger with workspace hashing required');
 db.exec(`CREATE TABLE IF NOT EXISTS catalog_products(workspace TEXT NOT NULL,id TEXT NOT NULL,title TEXT NOT NULL,price_cents INTEGER NOT NULL,cost_cents INTEGER,inventory INTEGER,currency TEXT NOT NULL DEFAULT 'USD',url TEXT NOT NULL DEFAULT '',category TEXT NOT NULL DEFAULT '',updated_at INTEGER NOT NULL,PRIMARY KEY(workspace,id));
 CREATE TABLE IF NOT EXISTS catalog_events(workspace TEXT NOT NULL,event_id TEXT NOT NULL,product_id TEXT NOT NULL,type TEXT NOT NULL CHECK(type IN ('view','cart','purchase')),customer_hash TEXT,price_cents INTEGER NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(workspace,event_id),FOREIGN KEY(workspace,product_id) REFERENCES catalog_products(workspace,id));
 CREATE INDEX IF NOT EXISTS catalog_events_customer ON catalog_events(workspace,customer_hash,created_at);
 CREATE INDEX IF NOT EXISTS catalog_events_product ON catalog_events(workspace,product_id,type,created_at);
 CREATE TABLE IF NOT EXISTS catalog_price_tests(workspace TEXT NOT NULL,id TEXT NOT NULL,product_id TEXT NOT NULL,control_price_cents INTEGER NOT NULL,treatment_price_cents INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'active',created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,PRIMARY KEY(workspace,id),FOREIGN KEY(workspace,product_id) REFERENCES catalog_products(workspace,id));
 CREATE TABLE IF NOT EXISTS catalog_price_assignments(workspace TEXT NOT NULL,experiment_id TEXT NOT NULL,customer_hash TEXT NOT NULL,variant TEXT NOT NULL CHECK(variant IN ('control','treatment')),price_cents INTEGER NOT NULL,assigned_at INTEGER NOT NULL,PRIMARY KEY(workspace,experiment_id,customer_hash),FOREIGN KEY(workspace,experiment_id) REFERENCES catalog_price_tests(workspace,id));
 CREATE TABLE IF NOT EXISTS catalog_price_test_events(workspace TEXT NOT NULL,event_id TEXT NOT NULL,experiment_id TEXT NOT NULL,variant TEXT NOT NULL,product_id TEXT NOT NULL,type TEXT NOT NULL,customer_hash TEXT NOT NULL,price_cents INTEGER NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(workspace,event_id),FOREIGN KEY(workspace,event_id) REFERENCES catalog_events(workspace,event_id),FOREIGN KEY(workspace,experiment_id) REFERENCES catalog_price_tests(workspace,id));
 CREATE INDEX IF NOT EXISTS catalog_price_test_events_by_test ON catalog_price_test_events(workspace,experiment_id,variant,type);`);
 const one=(q,...a)=>db.prepare(q).get(...a),all=(q,...a)=>db.prepare(q).all(...a),run=(q,...a)=>db.prepare(q).run(...a);
 function saveProduct(w,p){
  const id=productId(p.id),title=typeof p.title==='string'?p.title.trim():'';
  if(!title||title.length>180)fail('Product title must be 1–180 characters');
  const priceCents=price(p.price_cents),costCents=p.cost_cents===undefined||p.cost_cents===null||p.cost_cents===''?null:price(p.cost_cents,'Cost');
  const inventory=p.inventory===undefined||p.inventory===null||p.inventory===''?null:p.inventory;
  if(inventory!==null&&(!Number.isSafeInteger(inventory)||inventory<0||inventory>1_000_000_000))fail('Inventory must be a non-negative integer');
  const currency=p.currency===undefined?'USD':p.currency;
  if(currency!=='USD')fail('Only USD product pricing is currently supported');
  const category=typeof p.category==='string'?p.category.trim():'';
  if(category.length>100)fail('Category must be 100 characters or fewer');
  const url=safeUrl(p.url);
  run('INSERT INTO catalog_products(workspace,id,title,price_cents,cost_cents,inventory,currency,url,category,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(workspace,id) DO UPDATE SET title=excluded.title,price_cents=excluded.price_cents,cost_cents=excluded.cost_cents,inventory=excluded.inventory,currency=excluded.currency,url=excluded.url,category=excluded.category,updated_at=excluded.updated_at',w,id,title,priceCents,costCents,inventory,currency,url,category,clock());
  return {product:one('SELECT * FROM catalog_products WHERE workspace=? AND id=?',w,id)};
 }
 function createPriceTest(w,p){
  const id=productId(p.id),pid=productId(p.product_id);
  const product=one('SELECT cost_cents,inventory FROM catalog_products WHERE workspace=? AND id=?',w,pid);
  if(!product)fail('Product not found',404);
  const control=price(p.control_price_cents,'Control price'),treatment=price(p.treatment_price_cents,'Treatment price');
  if(control===treatment)fail('Control and treatment prices must differ');
  if(product.cost_cents!==null&&(control<product.cost_cents||treatment<product.cost_cents))fail('Price-test variants cannot undercut recorded unit cost');
  if(product.inventory===0)fail('Product is out of stock',409);
  if(one('SELECT id FROM catalog_price_tests WHERE workspace=? AND id=?',w,id))fail('Price-test ID already exists',409);
  run("INSERT INTO catalog_price_tests VALUES(?,?,?,?,?,'active',?,?)",w,id,pid,control,treatment,clock(),clock());
  return {price_test:one('SELECT * FROM catalog_price_tests WHERE workspace=? AND id=?',w,id)};
 }
 function assignPriceTest(w,p){
  const id=productId(p.experiment_id);
  if(typeof p.customer_id!=='string'||!p.customer_id.trim()||p.customer_id.length>150)fail('Valid customer_id required');
  if(p.consent!==true)fail('Price-test assignment requires explicit personalization consent');
  const test=one('SELECT * FROM catalog_price_tests WHERE workspace=? AND id=?',w,id);
  if(!test)fail('Price test not found',404);
  const hash=ledger.hash(w,p.customer_id);
  const existing=one('SELECT variant,price_cents FROM catalog_price_assignments WHERE workspace=? AND experiment_id=? AND customer_hash=?',w,id,hash);
  if(existing)return {experiment_id:id,product_id:test.product_id,...existing,reused_assignment:true};
  if(test.status!=='active')fail('Price test is not accepting new assignments',409);
  const product=one('SELECT title,inventory FROM catalog_products WHERE workspace=? AND id=?',w,test.product_id);
  if(!product)fail('Product not found',404);
  if(product.inventory===0)fail('Product is out of stock',409);
  const variant=Number.parseInt(hash.slice(-2),16)%2===0?'control':'treatment';
  const priceCents=variant==='control'?test.control_price_cents:test.treatment_price_cents;
  run('INSERT INTO catalog_price_assignments VALUES(?,?,?,?,?,?)',w,id,hash,variant,priceCents,clock());
  return {experiment_id:id,product_id:test.product_id,title:product.title,variant,price_cents:priceCents,reused_assignment:false};
 }
 function recordEvent(w,p){
  const eventId=typeof p.event_id==='string'&&p.event_id.trim()&&p.event_id.length<=150?p.event_id.trim():null;
  if(!eventId||!/^[a-z0-9_:.\/-]+$/i.test(eventId))fail('A stable event_id is required');
  const pid=productId(p.product_id);
  if(!['view','cart','purchase'].includes(p.type))fail('Event type must be view, cart, or purchase');
  const product=one('SELECT price_cents FROM catalog_products WHERE workspace=? AND id=?',w,pid);
  if(!product)fail('Product not found',404);
  let customerHash=null,test=null,variant=null,priceCents=product.price_cents;
  if(p.price_test_id!==undefined&&p.price_test_id!==null&&p.price_test_id!==''){
   if(typeof p.customer_id!=='string'||!p.customer_id.trim()||p.customer_id.length>150||p.consent!==true)fail('Price-test events require a consented customer_id');
   test=one('SELECT * FROM catalog_price_tests WHERE workspace=? AND id=?',w,productId(p.price_test_id));
   if(!test)fail('Price test not found',404);
   if(test.product_id!==pid)fail('Price test does not match product',409);
   customerHash=ledger.hash(w,p.customer_id);
   const assignment=one('SELECT variant,price_cents FROM catalog_price_assignments WHERE workspace=? AND experiment_id=? AND customer_hash=?',w,test.id,customerHash);
   if(!assignment)fail('Assign this customer to the price test before recording events',409);
   variant=assignment.variant;priceCents=assignment.price_cents;
  }else if(p.customer_id!==undefined&&p.customer_id!==null&&p.customer_id!==''){
   if(p.consent!==true)fail('Customer-linked product events require explicit consent');
   if(typeof p.customer_id!=='string'||p.customer_id.length>150)fail('Invalid customer identifier');
   customerHash=ledger.hash(w,p.customer_id);
  }
  db.exec('BEGIN IMMEDIATE');
  try{
   const existing=one('SELECT product_id,type,customer_hash,price_cents FROM catalog_events WHERE workspace=? AND event_id=?',w,eventId);
   const existingTest=one('SELECT experiment_id,variant FROM catalog_price_test_events WHERE workspace=? AND event_id=?',w,eventId);
   if(existing){
    if(existing.product_id!==pid||existing.type!==p.type||existing.customer_hash!==customerHash||existing.price_cents!==priceCents)fail('Event ID reused with different details',409);
    if((test&&(!existingTest||existingTest.experiment_id!==test.id||existingTest.variant!==variant))||(!test&&existingTest))fail('Event ID reused with different price-test details',409);
    db.exec('COMMIT');return {created:false,duplicate:true};
   }
   if(existingTest)fail('Price-test event already exists without its catalog event',409);
   run('INSERT INTO catalog_events(workspace,event_id,product_id,type,customer_hash,price_cents,created_at) VALUES(?,?,?,?,?,?,?)',w,eventId,pid,p.type,customerHash,priceCents,clock());
   if(test)run('INSERT INTO catalog_price_test_events VALUES(?,?,?,?,?,?,?,?,?)',w,eventId,test.id,variant,pid,p.type,customerHash,priceCents,clock());
   db.exec('COMMIT');return {created:true,duplicate:false,price_cents:priceCents,...(test?{price_test_id:test.id,variant}:{})};
  }catch(e){try{db.exec('ROLLBACK')}catch{}throw e;}
 }
 function priceTestReport(w){
  const tests=all('SELECT t.*,p.title FROM catalog_price_tests t JOIN catalog_products p ON p.workspace=t.workspace AND p.id=t.product_id WHERE t.workspace=? ORDER BY t.created_at DESC',w);
  const rows=all("SELECT experiment_id,variant,COUNT(DISTINCT CASE WHEN type='view' THEN customer_hash END) AS views,COUNT(DISTINCT CASE WHEN type='cart' THEN customer_hash END) AS carts,COUNT(DISTINCT CASE WHEN type='purchase' THEN customer_hash END) AS purchasers,SUM(CASE WHEN type='purchase' THEN price_cents ELSE 0 END) AS revenue_cents FROM catalog_price_test_events WHERE workspace=? GROUP BY experiment_id,variant",w);
  return {price_tests:tests.map(t=>{
   const cohort=variant=>{const r=rows.find(x=>x.experiment_id===t.id&&x.variant===variant);const views=Number(r?.views)||0,purchasers=Number(r?.purchasers)||0;return {variant,price_cents:variant==='control'?t.control_price_cents:t.treatment_price_cents,views,carts:Number(r?.carts)||0,purchasers,revenue_cents:Number(r?.revenue_cents)||0,conversion_rate:views?Math.round(purchasers/views*10000)/100:null};};
   const control=cohort('control'),treatment=cohort('treatment'),ready=control.views>=100&&treatment.views>=100;
   return {...t,control,treatment,conversion_difference_percentage_points:control.conversion_rate===null||treatment.conversion_rate===null?null:Math.round((treatment.conversion_rate-control.conversion_rate)*100)/100,interpretation:ready?'Both variants have at least 100 distinct viewers; evaluate uncertainty and business guardrails before choosing.':'Insufficient sample: aim for at least 100 distinct viewers per variant before drawing conclusions.'};
  }),note:'Randomized customer-level price assignment. Rates are exploratory; no statistical-significance claim is made and storefront price changes are not published by A+.'};
 }
 function productStats(w,days=30){
  if(![7,30,90].includes(days))fail('Reporting window must be 7, 30, or 90 days');
  const since=clock()-days*DAY;
  return all('SELECT p.*,SUM(CASE WHEN e.type=\'view\' THEN 1 ELSE 0 END) AS views,SUM(CASE WHEN e.type=\'cart\' THEN 1 ELSE 0 END) AS carts,SUM(CASE WHEN e.type=\'purchase\' THEN 1 ELSE 0 END) AS purchases,COALESCE(SUM(CASE WHEN e.type=\'purchase\' THEN e.price_cents ELSE 0 END),0) AS observed_revenue_cents FROM catalog_products p LEFT JOIN catalog_events e ON e.workspace=p.workspace AND e.product_id=p.id AND e.created_at>=? WHERE p.workspace=? GROUP BY p.workspace,p.id ORDER BY p.updated_at DESC',since,w).map(p=>{
   const views=Number(p.views)||0,purchases=Number(p.purchases)||0;
   const margin=p.cost_cents===null?null:(p.price_cents?p.price_cents-p.cost_cents:p.cost_cents===0?0:null);
   return {...p,views,carts:Number(p.carts)||0,purchases,observed_revenue_cents:Number(p.observed_revenue_cents)||0,conversion_rate:views?Math.round(purchases/views*10000)/100:null,gross_margin_percent:margin===null||!p.price_cents?null:Math.round(margin/p.price_cents*10000)/100};
  });
 }
 function pricing(w,days=30){
  const products=productStats(w,days),recommendations=[];
  for(const p of products){
   if(p.cost_cents!==null&&p.price_cents<=p.cost_cents)recommendations.push({product_id:p.id,title:p.title,priority:'high',type:'margin_protection',reason:'Listed price is at or below recorded unit cost.',suggested_price_floor_cents:Math.ceil(p.cost_cents/0.7),action:'Review cost and test a price that preserves at least a 30% gross margin; no price is changed automatically.'});
   else if(p.cost_cents!==null&&p.gross_margin_percent!==null&&p.gross_margin_percent<30)recommendations.push({product_id:p.id,title:p.title,priority:'medium',type:'margin_test',reason:'Recorded gross margin is below the default 30% review threshold.',suggested_price_floor_cents:Math.ceil(p.cost_cents/0.7),action:'Test a bounded price change and monitor conversion and contribution margin.'});
   else if(p.views>=20&&p.conversion_rate!==null&&p.conversion_rate<2)recommendations.push({product_id:p.id,title:p.title,priority:'medium',type:'conversion_test',reason:'At least 20 views are recorded and purchase conversion is below 2%; price is only one possible cause.',suggested_price_floor_cents:null,action:'Test price, product page, shipping, and offer presentation separately.'});
   if(p.inventory===0)recommendations.push({product_id:p.id,title:p.title,priority:'high',type:'out_of_stock',reason:'Inventory is recorded as zero.',action:'Check stock sync before promoting this product.'});
  }
  const since=clock()-days*DAY;
  const cohortRows=all("SELECT product_id,price_cents,SUM(CASE WHEN type='view' THEN 1 ELSE 0 END) AS views,SUM(CASE WHEN type='cart' THEN 1 ELSE 0 END) AS carts,SUM(CASE WHEN type='purchase' THEN 1 ELSE 0 END) AS purchases FROM catalog_events WHERE workspace=? AND created_at>=? GROUP BY product_id,price_cents ORDER BY product_id,price_cents",w,since);
  const price_cohorts=cohortRows.map(r=>({product_id:r.product_id,price_cents:r.price_cents,views:Number(r.views)||0,carts:Number(r.carts)||0,purchases:Number(r.purchases)||0,conversion_rate:Number(r.views)?Math.round((Number(r.purchases)||0)/Number(r.views)*10000)/100:null}));
  const grouped=new Map();for(const row of price_cohorts){if(!grouped.has(row.product_id))grouped.set(row.product_id,[]);grouped.get(row.product_id).push(row);}
  const price_comparisons=[...grouped.entries()].filter(([,rows])=>rows.length>1).map(([product_id,rows])=>({product_id,cohorts:rows,interpretation:'Observed price cohorts are not randomized. Do not declare a winning price without a controlled test and adequate sample size.'}));
  return {window_days:days,products,recommendations,price_cohorts,price_comparisons,policy:'Recommendations only. A+ does not change storefront prices or inventory automatically.'};
 }
 function recommendations(w,customerId=null,consent=false){
  const since=clock()-90*DAY;
  let seedIds=[];
  if(customerId!==null){
   if(typeof customerId!=='string'||!customerId.trim()||customerId.length>150)fail('Valid customer_id required');
   if(consent!==true)fail('Personalized recommendations require explicit consent');
   const hash=ledger.hash(w,customerId);
   seedIds=all("SELECT DISTINCT product_id FROM catalog_events WHERE workspace=? AND customer_hash=? AND type IN ('cart','purchase') AND created_at>=?",w,hash,since).map(r=>r.product_id);
  }
  const events=all("SELECT customer_hash,product_id FROM catalog_events WHERE workspace=? AND customer_hash IS NOT NULL AND type='purchase' AND created_at>=? ORDER BY created_at DESC LIMIT 10000",w,since);
  const byCustomer=new Map();
  for(const e of events){if(!byCustomer.has(e.customer_hash))byCustomer.set(e.customer_hash,new Set());byCustomer.get(e.customer_hash).add(e.product_id);}
  const scores=new Map();
  for(const ids of byCustomer.values()){
   if(seedIds.length&&!seedIds.some(id=>ids.has(id)))continue;
   for(const id of ids){if(seedIds.includes(id))continue;scores.set(id,(scores.get(id)||0)+1);}
  }
  if(!seedIds.length){
   for(const e of all("SELECT product_id,COUNT(*) AS n FROM catalog_events WHERE workspace=? AND type='purchase' AND created_at>=? GROUP BY product_id",w,since))scores.set(e.product_id,Number(e.n)||0);
  }
  const products=all('SELECT * FROM catalog_products WHERE workspace=?',w);
  const map=new Map(products.map(p=>[p.id,p]));
  return [...scores.entries()].filter(([id])=>map.has(id)).sort((a,b)=>b[1]-a[1]).slice(0,20).map(([id,score])=>({...map.get(id),recommendation_score:score,reason:seedIds.length?'Frequently purchased alongside products in the consented customer journey.':'Popular by recorded purchase events.'}));
 }
 function eraseCustomer(w,customerId){const hash=ledger.hash(w,customerId);run('DELETE FROM catalog_price_test_events WHERE workspace=? AND customer_hash=?',w,hash);run('DELETE FROM catalog_price_assignments WHERE workspace=? AND customer_hash=?',w,hash);run('DELETE FROM catalog_events WHERE workspace=? AND customer_hash=?',w,hash);}
 function handle(w,path,method,p={}){
  if(path==='products'&&method==='GET')return {products:productStats(w,30)};
  if(path==='products'&&method==='POST')return saveProduct(w,p);
  if(path==='events'&&method==='POST')return recordEvent(w,p);
  if(path==='recommendations'&&method==='GET')return {recommendations:recommendations(w)};
  if(path==='recommendations'&&method==='POST')return {recommendations:recommendations(w,p.customer_id,p.consent)};
  if(path==='pricing'&&method==='GET')return pricing(w,Number(p.days||30));
  if(path==='price-tests'&&method==='GET')return {price_tests:all('SELECT * FROM catalog_price_tests WHERE workspace=? ORDER BY created_at DESC',w)};
  if(path==='price-tests'&&method==='POST')return createPriceTest(w,p);
  if(path==='price-tests/assign'&&method==='POST')return assignPriceTest(w,p);
  if(path==='price-tests/report'&&method==='GET')return priceTestReport(w);
  if(path==='price-tests/status'&&method==='POST'){if(!['active','paused','closed'].includes(p.status))fail('Status must be active, paused, or closed');const id=productId(p.id);if(!run('UPDATE catalog_price_tests SET status=?,updated_at=? WHERE workspace=? AND id=?',p.status,clock(),w,id).changes)fail('Price test not found',404);return {price_test:one('SELECT * FROM catalog_price_tests WHERE workspace=? AND id=?',w,id)};}
  fail('Catalog intelligence route not found',404);
 }
 function eraseOld(days=180){if(!Number.isInteger(days)||days<1||days>3650)fail('Retention days must be 1–3650');const cutoff=clock()-days*DAY;run('DELETE FROM catalog_price_test_events WHERE created_at<?',cutoff);run('DELETE FROM catalog_price_assignments WHERE assigned_at<?',cutoff);return run('DELETE FROM catalog_events WHERE created_at<?',cutoff).changes;}
 function eraseWorkspace(w){run('DELETE FROM catalog_price_test_events WHERE workspace=?',w);run('DELETE FROM catalog_price_assignments WHERE workspace=?',w);run('DELETE FROM catalog_price_tests WHERE workspace=?',w);run('DELETE FROM catalog_events WHERE workspace=?',w);run('DELETE FROM catalog_products WHERE workspace=?',w);}
 return {handle,productStats,pricing,recommendations,priceTestReport,createPriceTest,assignPriceTest,eraseCustomer,eraseWorkspace,eraseOld};
}
