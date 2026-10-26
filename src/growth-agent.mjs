import {randomUUID} from 'node:crypto';
const DAY=86_400_000;
const DEFAULTS={enabled:false,objective:'Increase profitable revenue',reporting_days:30};
function fail(message,status=400){throw Object.assign(Error(message),{status});}
function validateSettings(input,current){
 const next={...current,...input};
 if(typeof next.enabled!=='boolean')fail('enabled must be true or false');
 if(typeof next.objective!=='string'||!next.objective.trim()||next.objective.length>240)fail('Objective must be 1–240 characters');
 if(![7,30,90].includes(next.reporting_days))fail('Reporting window must be 7, 30, or 90 days');
 return {enabled:next.enabled,objective:next.objective.trim(),reporting_days:next.reporting_days};
}
export function buildGrowthPlan(metrics,objective='Increase profitable revenue'){
 const actions=[];
 const campaigns=Object.entries(metrics.byCampaign||{});
 if(metrics.visits>0&&metrics.purchases===0){
  actions.push({id:'conversion-baseline',priority:'high',area:'Conversion',title:'Establish a measurable conversion baseline',reason:'Visits are recorded but no purchases appear in this reporting window.',next_step:'Verify purchase-event tracking, then run a controlled landing-page or checkout experiment.',automation:'requires_review'});
 }
 if(metrics.carts>0&&metrics.checkouts<metrics.carts){
  actions.push({id:'cart-friction',priority:'high',area:'Sales',title:'Investigate cart-to-checkout friction',reason:'Cart events exceed checkout events; this is a directional signal, not a measured abandonment rate.',next_step:'Check shipping costs, checkout errors, payment availability, and mobile usability.',automation:'requires_review'});
 }
 for(const [name,c] of campaigns){
  if(!(Number(c.spend)>0))continue;
  if(Number(c.purchases)===0){
   actions.push({id:'campaign-'+name,priority:'high',area:'Marketing',title:'Review spend with no attributed purchases',reason:'The campaign has recorded spend but no purchases attributed in this window.',next_step:'Validate attribution and tracking before changing or pausing spend.',campaign:name,automation:'requires_review'});
  }else if(Number.isFinite(Number(c.roas))&&Number(c.roas)>=2){
   actions.push({id:'scale-'+name,priority:'medium',area:'Marketing',title:'Evaluate a controlled budget increase',reason:'Reported ROAS is at least 2×; this does not establish profitability or causation.',next_step:'Check contribution margin and attribution, then test a small budget increase with a stop-loss.',campaign:name,automation:'requires_review'});
  }
 }
 if(metrics.leads>0)actions.push({id:'lead-followup',priority:'medium',area:'Sales',title:'Improve lead follow-up speed',reason:metrics.leads+' lead event(s) recorded in this window.',next_step:'Connect a consent-aware CRM or workflow and measure lead-to-sale conversion.',automation:'workflow_setup'});
 if(metrics.purchases>0)actions.push({id:'retention',priority:'medium',area:'Retention',title:'Measure repeat-purchase opportunities',reason:metrics.purchases+' purchase event(s) recorded; repeat-customer status is not inferred from aggregate counts.',next_step:'Connect consented customer-level purchase events before building retention segments.',automation:'data_needed'});
 if(!campaigns.some(([,c])=>Number(c.spend)>0))actions.push({id:'campaign-economics',priority:'medium',area:'Analytics',title:'Connect campaign cost data',reason:'No campaign spend is recorded, so return on ad spend and acquisition efficiency cannot be calculated.',next_step:'Import campaign spend, clicks, and impressions before reallocating marketing budgets.',automation:'data_needed'});
 if(!actions.length)actions.push({id:'measurement-quality',priority:'medium',area:'Analytics',title:'Validate tracking and measurement quality',reason:'Current aggregate signals do not identify a clear next action.',next_step:'Confirm visits, carts, checkouts, purchases, campaign spend, and attribution are consistently recorded.',automation:'requires_review'});
 const rank={high:0,medium:1,low:2};
 actions.sort((a,b)=>rank[a.priority]-rank[b.priority]);
 return {objective:String(objective).trim(),generated_at:new Date().toISOString(),window_days:metrics.windowDays,metrics:{visits:metrics.visits,carts:metrics.carts,checkouts:metrics.checkouts,purchases:metrics.purchases,leads:metrics.leads,revenue:metrics.revenue,currency:metrics.currency},actions:actions.slice(0,10),execution_policy:'Recommendations are evidence-based and review-gated. A+ does not autonomously change ad budgets, prices, publish campaigns, or contact customers from this plan.'};
}
export function createGrowthAgent(db,{ledger,engine,clock=()=>Date.now()}={}){
 if(!ledger||typeof ledger.overview!=='function')throw Error('Commerce ledger required');
 db.exec(`CREATE TABLE IF NOT EXISTS growth_agent_settings(workspace TEXT PRIMARY KEY,json TEXT NOT NULL,updated_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS growth_agent_runs(workspace TEXT NOT NULL,id TEXT NOT NULL,created_at INTEGER NOT NULL,objective TEXT NOT NULL,window_days INTEGER NOT NULL,plan_json TEXT NOT NULL,recovery_processed INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(workspace,id));
 CREATE INDEX IF NOT EXISTS growth_agent_runs_recent ON growth_agent_runs(workspace,created_at DESC);`);
 const one=(q,...a)=>db.prepare(q).get(...a),all=(q,...a)=>db.prepare(q).all(...a),run=(q,...a)=>db.prepare(q).run(...a);
 const settings=w=>({...DEFAULTS,...JSON.parse(one('SELECT json FROM growth_agent_settings WHERE workspace=?',w)?.json||'{}')});
 function save(w,input){const next=validateSettings(input,settings(w));run('INSERT INTO growth_agent_settings VALUES(?,?,?) ON CONFLICT(workspace) DO UPDATE SET json=excluded.json,updated_at=excluded.updated_at',w,JSON.stringify(next),clock());return {settings:next};}
 function segments(w,days=90){
  if(![7,30,90].includes(days))fail('Segment window must be 7, 30, or 90 days');
  const now=clock(),start=now-days*DAY,recent=now-7*DAY;
  const sql="SELECT customer_hash, SUM(CASE WHEN type='purchase' THEN 1 ELSE 0 END) AS purchases, SUM(CASE WHEN type='purchase' THEN cents ELSE 0 END) AS revenue_cents, SUM(CASE WHEN type='lead' THEN 1 ELSE 0 END) AS leads, SUM(CASE WHEN type='cart' AND occurred_at>=? THEN 1 ELSE 0 END) AS recent_carts, SUM(CASE WHEN type='checkout' AND occurred_at>=? THEN 1 ELSE 0 END) AS recent_checkouts, MAX(CASE WHEN type='purchase' THEN occurred_at ELSE 0 END) AS last_purchase FROM events WHERE workspace=? AND customer_hash IS NOT NULL AND occurred_at>=? GROUP BY customer_hash";
  const rows=all(sql,recent,recent,w,start);
  const buyers=rows.filter(r=>r.purchases>0).sort((a,b)=>b.revenue_cents-a.revenue_cents);
  const highValueCount=buyers.length?Math.max(1,Math.ceil(buyers.length*.1)):0;
  const highValue=new Set(buyers.slice(0,highValueCount).map(r=>r.customer_hash));
  const result={observed_customers:rows.length,high_value:{count:0,revenue:0},repeat_buyers:{count:0},high_intent_no_recent_purchase:{count:0},lead_no_purchase:{count:0},lapsed_buyers:{count:0},window_days:days,definitions:'Rule-based observed segments, not trained predictions. Customer identities are not returned.'};
  for(const r of rows){
   if(highValue.has(r.customer_hash)){result.high_value.count++;result.high_value.revenue+=r.revenue_cents/100;}
   if(r.purchases>=2)result.repeat_buyers.count++;
   if((r.recent_carts>0||r.recent_checkouts>0)&&r.last_purchase<recent)result.high_intent_no_recent_purchase.count++;
   if(r.leads>0&&r.purchases===0)result.lead_no_purchase.count++;
   if(r.purchases>0&&r.last_purchase>0&&r.last_purchase<now-30*DAY)result.lapsed_buyers.count++;
  }
  result.high_value.revenue=Math.round(result.high_value.revenue*100)/100;
  return result;
 }
 function plan(w){const s=settings(w),metrics=ledger.overview(w,{now:clock(),days:s.reporting_days});return {...buildGrowthPlan(metrics,s.objective),customer_segments:segments(w,s.reporting_days)};}
 async function execute(w){
  const s=settings(w),p=plan(w);let processed=0;
  // Only run the existing, merchant-enabled recovery queue. The recovery engine independently
  // enforces recorded channel consent, holdouts, stop conditions, and sequence settings.
  if(s.enabled&&engine?.tick)processed=await engine.tick(w);
  const id=randomUUID();
  run('INSERT INTO growth_agent_runs(workspace,id,created_at,objective,window_days,plan_json,recovery_processed) VALUES(?,?,?,?,?,?,?)',w,id,clock(),s.objective,s.reporting_days,JSON.stringify(p),processed);
  return {run_id:id,enabled:s.enabled,plan:p,recovery_processed:processed,executed_actions:s.enabled?['process_eligible_recovery_queue']:[],note:s.enabled?'Only the existing consent-gated recovery queue was processed. Other recommendations require a configured workflow or explicit review.':'Autopilot is off; this run only generated a plan.'};
 }
 function history(w){return {runs:all('SELECT id,created_at,objective,window_days,recovery_processed FROM growth_agent_runs WHERE workspace=? ORDER BY created_at DESC LIMIT 25',w).map(r=>({...r,created_at:new Date(r.created_at).toISOString()}))};}
 async function handle(w,path,method,p={}){
  if(path==='settings'&&method==='GET')return {settings:settings(w)};
  if(path==='settings'&&method==='POST')return save(w,p);
  if(path==='plan'&&method==='GET')return {plan:plan(w),settings:settings(w)};
  if(path==='run'&&method==='POST')return await execute(w);
  if(path==='runs'&&method==='GET')return history(w);
  fail('Growth agent route not found',404);
 }
 function erase(w){run('DELETE FROM growth_agent_settings WHERE workspace=?',w);run('DELETE FROM growth_agent_runs WHERE workspace=?',w);}
 return {handle,plan,execute,settings,segments,erase};
}
