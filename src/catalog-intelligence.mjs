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
 CREATE INDEX IF NOT EXISTS catalog_events_product ON catalog_events(workspace,product_id,type,created_at);`);
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
 function recordEvent(w,p){
  const eventId=typeof p.event_id==='string'&&p.event_id.trim()&&p.event_id.length<=150?p.event_id.trim():null;
  if(!eventId||!/^[a-z0-9_:.\/-]+$/i.test(eventId))fail('A stable event_id is required');
  const pid=productId(p.product_id);
  if(!['view','cart','purchase'].includes(p.type))fail('Event type must be view, cart, or purchase');
  const product=one('SELECT price_cents FROM catalog_products WHERE workspace=? AND id=?',w,pid);
  if(!product)fail('Product not found',404);
  let customerHash=null;
  if(p.customer_id!==undefined&&p.customer_id!==null&&p.customer_id!==''){
   if(p.consent!==true)fail('Customer-linked product events require explicit consent');
   if(typeof p.customer_id!=='string'||p.customer_id.length>150)fail('Invalid customer identifier');
   customerHash=ledger.hash(w,p.customer_id);
  }
  const existing=one('SELECT product_id,type,customer_hash,price_cents FROM catalog_events WHERE workspace=? AND event_id=?',w,eventId);
  if(existing){if(existing.product_id!==pid||existing.type!==p.type||existing.customer_hash!==customerHash||existing.price_cents!==product.price_cents)fail('Event ID reused with different details',409);return {created:false,duplicate:true};}
  run('INSERT INTO catalog_events(workspace,event_id,product_id,type,customer_hash,price_cents,created_at) VALUES(?,?,?,?,?,?,?)',w,eventId,pid,p.type,customerHash,product.price_cents,clock());
  return {created:true,duplicate:false};
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
  return {window_days:days,products,recommendations,policy:'Recommendations only. A+ does not change storefront prices or inventory automatically.'};
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
 function eraseCustomer(w,customerId){const hash=ledger.hash(w,customerId);run('DELETE FROM catalog_events WHERE workspace=? AND customer_hash=?',w,hash);}
 function handle(w,path,method,p={}){
  if(path==='products'&&method==='GET')return {products:productStats(w,30)};
  if(path==='products'&&method==='POST')return saveProduct(w,p);
  if(path==='events'&&method==='POST')return recordEvent(w,p);
  if(path==='recommendations'&&method==='GET')return {recommendations:recommendations(w)};
  if(path==='recommendations'&&method==='POST')return {recommendations:recommendations(w,p.customer_id,p.consent)};
  if(path==='pricing'&&method==='GET')return pricing(w,Number(p.days||30));
  fail('Catalog intelligence route not found',404);
 }
 function eraseWorkspace(w){run('DELETE FROM catalog_events WHERE workspace=?',w);run('DELETE FROM catalog_products WHERE workspace=?',w);}
 return {handle,productStats,pricing,recommendations,eraseCustomer,eraseWorkspace};
}
