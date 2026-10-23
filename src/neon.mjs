/**
 * Optional Neon PostgreSQL history. A+ remains usable while Neon is unavailable.
 * Stores only intentionally reduced operational signals, never customer identifiers,
 * access tokens, raw scanned HTML, provider credentials, or email bodies.
 */
export function createNeonIntegration({env=process.env,Pool}={}){
 const url=env.NEON_DATABASE_URL||env.DATABASE_URL;
 if(!url)return {
  configured:false,record:async()=>({stored:false}),
  status:async()=>({connected:false,configured:false,events:0}),
  history:async()=>({events:[]}),close:async()=>{}
 };
 let instance=null;
 let initialized=null;
 async function getPool(){
  if(!instance){const Driver=Pool||(await import('pg')).Pool;
   instance=new Driver({connectionString:url,max:2,connectionTimeoutMillis:5000,idleTimeoutMillis:15000});
  }
  return instance;
 }
 async function init(){
  if(!initialized)initialized=(async()=>{
   const p=await getPool();
   await p.query('CREATE TABLE IF NOT EXISTS aplus_integration_events (workspace TEXT NOT NULL,id TEXT NOT NULL,kind TEXT NOT NULL,payload JSONB NOT NULL DEFAULT \'{}\'::jsonb,created_at BIGINT NOT NULL,PRIMARY KEY(workspace,id))');
   return p;
  })().catch(e=>{initialized=null;throw e;});
  return initialized;
 }
 async function record(workspace,kind,id,payload={}){
  if(!/^[a-z0-9_-]{1,60}$/i.test(workspace)||!/^[a-z0-9_:.\/-]{1,160}$/i.test(id)||!['commerce.purchase','commerce.lead','commerce.cart','commerce.checkout','commerce.visit','recovery.analysis'].includes(kind))return {stored:false};
  const data=JSON.stringify(payload);
  if(data.length>4000)return {stored:false};
  try{
   const pool=await init();
   await pool.query('INSERT INTO aplus_integration_events(workspace,id,kind,payload,created_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT (workspace,id) DO NOTHING',[workspace,id,kind,data,Date.now()]);
   return {stored:true};
  }catch(e){console.warn('Neon integration unavailable:',String(e.code||e.name).slice(0,40));return {stored:false};}
 }
 async function status(workspace){
  try{
   const pool=await init();
   const data=await pool.query('SELECT COUNT(*)::integer AS n FROM aplus_integration_events WHERE workspace=$1',[workspace]);
   return {connected:true,configured:true,events:Number(data.rows[0]?.n||0)};
  }catch(e){return {connected:false,configured:true,events:null,error:'Neon database unavailable'};}
 }
 async function history(workspace){
  const pool=await init();
  const data=await pool.query('SELECT id,kind,payload,created_at FROM aplus_integration_events WHERE workspace=$1 ORDER BY created_at DESC LIMIT 50',[workspace]);
  return {events:data.rows};
 }
 async function close(){if(instance)await instance.end();}
 return {configured:true,record,status,history,close};
}
