import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:net';
async function freePort(){
 const s=createServer();await new Promise(done=>s.listen(0,'127.0.0.1',done));
 const p=s.address().port;await new Promise(done=>s.close(done));return p;
}
test('Nixpacks starts without configured keys, responds to health checks and opens the public dashboard',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'aplus-nixpacks-')),port=await freePort();
 const env={...process.env,PORT:String(port),DB_PATH:join(dir,'commerce.sqlite'),AUTOMATION_DB_PATH:join(dir,'automation.sqlite'),AUTO_BACKUP_HOURS:'0'};
 for(const name of ['ADMIN_TOKEN','INGEST_TOKEN','PSEUDONYM_KEY','PUBLIC_DASHBOARD','HOST','WORKSPACES_JSON'])delete env[name];
 const worker=spawn(process.execPath,['src/server.mjs'],{env,stdio:['ignore','pipe','pipe']});
 let logs='';worker.stderr.on('data',x=>logs+=x.toString().slice(0,4000));
 try{
  let status;
  for(let i=0;i<45;i++){
   if(worker.exitCode!==null)break;
   try{status=await fetch('http://127.0.0.1:'+port+'/health',{signal:AbortSignal.timeout(300)});if(status.ok)break;}catch{}
   await new Promise(done=>setTimeout(done,100));
  }
  assert.ok(status?.ok,'Startup and health check must succeed: '+logs);
  assert.deepEqual(await status.json(),{status:'ok'});
  const config=await fetch('http://127.0.0.1:'+port+'/api/dashboard-config');
  assert.equal((await config.json()).public,true);
  const page=await fetch('http://127.0.0.1:'+port+'/');
  assert.equal(page.status,200);assert.doesNotMatch(await page.text(),/id="token"/);
  assert.ok(JSON.parse(readFileSync(join(dir,'aplus-private-secrets.json'),'utf8')).PSEUDONYM_KEY.length>=32);
 }finally{worker.kill('SIGTERM');rmSync(dir,{recursive:true,force:true});}
});