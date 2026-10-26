import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createGrowthAgent,buildGrowthPlan} from '../src/growth-agent.mjs';

const metrics={
 visits:100,carts:30,checkouts:12,purchases:4,leads:6,revenue:240,currency:'USD',windowDays:30,
 byCampaign:{
  'untracked-spend':{visits:20,carts:4,purchases:0,revenue:0,spend:40,roas:0,cpa:null,ctr:1},
  'healthy-campaign':{visits:30,carts:8,purchases:2,revenue:120,spend:40,roas:3,cpa:20,ctr:2}
 }
};
test('growth plan ranks evidence-based actions and avoids claiming causal or exact abandonment rates',()=>{
 const p=buildGrowthPlan(metrics,'Improve profitable revenue');
 assert.equal(p.objective,'Improve profitable revenue');
 assert.ok(p.actions.some(a=>a.id==='cart-friction'));
 assert.ok(p.actions.some(a=>a.id==='campaign-untracked-spend'));
 assert.ok(p.actions.some(a=>a.id==='scale-healthy-campaign'));
 assert.match(p.actions.find(a=>a.id==='cart-friction').reason,/directional signal/);
 assert.match(p.execution_policy,/does not autonomously change ad budgets/);
});
test('growth agent persists settings, records runs, and only processes recovery when explicitly enabled',async()=>{
 const db=new DatabaseSync(':memory:');
 let processed=[];
 const ledger={overview:(_w,{days})=>({...metrics,windowDays:days})};
 const engine={tick:async workspace=>{processed.push(workspace);return 2;}};
 let now=1700000000000;
 const agent=createGrowthAgent(db,{ledger,engine,clock:()=>now});
 try{
  assert.equal(agent.settings('alpha').enabled,false);
  const disabled=await agent.handle('alpha','run','POST',{});
  assert.equal(disabled.recovery_processed,0);
  assert.deepEqual(processed,[]);
  await agent.handle('alpha','settings','POST',{enabled:true,objective:'Recover profitable growth',reporting_days:7});
  now+=1000;
  const enabled=await agent.handle('alpha','run','POST',{});
  assert.equal(enabled.recovery_processed,2);
  assert.deepEqual(processed,['alpha']);
  assert.equal(enabled.plan.window_days,7);
  const history=await agent.handle('alpha','runs','GET');
  assert.equal(history.runs.length,2);
  await assert.rejects(agent.handle('alpha','settings','POST',{reporting_days:14}),/Reporting window/);
 }finally{db.close();}
});

test('customer segments are aggregate-only and use explicit observed-event rules',()=>{
 const db=new DatabaseSync(':memory:');
 db.exec("CREATE TABLE events(workspace TEXT,id TEXT,type TEXT,cents INTEGER,campaign TEXT,customer_hash TEXT,digest TEXT,occurred_at INTEGER,PRIMARY KEY(workspace,id))");
 const now=1700000000000;
 const ins=db.prepare('INSERT INTO events VALUES(?,?,?,?,?,?,?,?)');
 const event=(id,type,cents,customer,at)=>ins.run('w',id,type,cents,'',customer,id,at);
 event('p1','purchase',10000,'buyer1',now-2*86400000);
 event('p2','purchase',10000,'buyer1',now-86400000);
 event('c1','cart',0,'intent1',now-86400000);
 event('l1','lead',0,'lead1',now-86400000);
 const agent=createGrowthAgent(db,{ledger:{overview:()=>metrics},engine:{tick:async()=>0},clock:()=>now});
 try{
  const s=agent.segments('w',30);
  assert.equal(s.observed_customers,3);
  assert.equal(s.repeat_buyers.count,1);
  assert.equal(s.high_intent_no_recent_purchase.count,1);
  assert.equal(s.lead_no_purchase.count,1);
  assert.equal(s.high_value.count,1);
  assert.equal(Object.hasOwn(s,'customers'),false);
 }finally{db.close();}
});

test('enabled growth agent publishes a safe plan event at most every 15 minutes',async()=>{
 const db=new DatabaseSync(':memory:');
 db.exec('CREATE TABLE events(workspace TEXT,id TEXT,type TEXT,cents INTEGER,campaign TEXT,customer_hash TEXT,digest TEXT,occurred_at INTEGER,PRIMARY KEY(workspace,id))');
 let now=1700000000000;const events=[];
 const agent=createGrowthAgent(db,{ledger:{overview:(_w,{days})=>({...metrics,windowDays:days})},engine:{tick:async()=>0},clock:()=>now,emit:async(w,event,data)=>{events.push({w,event,data});return {queued:1};}});
 try{
  await agent.handle('alpha','settings','POST',{enabled:true,objective:'Grow profitably',reporting_days:30});
  assert.equal(await agent.tick(),1);
  assert.equal(events[0].event,'growth.agent_plan');
  assert.equal(events[0].w,'alpha');
  assert.equal(events[0].data.action_count>0,true);
  now+=14*60*1000;
  assert.equal(await agent.tick(),0);
  now+=2*60*1000;
  assert.equal(await agent.tick(),1);
  assert.equal(events.length,2);
 }finally{db.close();}
});
