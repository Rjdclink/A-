import assert from 'node:assert/strict';
import {createApp} from '../src/server.mjs';

let app,started=false;
try{
 app=createApp({dbPath:':memory:',autoStart:false,
  env:{ALLOW_SIGNUP:'true',SESSION_COOKIE_SECURE:'false',AUTO_BACKUP_HOURS:'0'}});
 await new Promise((resolve,reject)=>app.server.listen(0,'127.0.0.1',error=>error?reject(error):resolve()));
 started=true;
 const origin='http://127.0.0.1:'+app.server.address().port;
 let cookie='';
 async function api(path,method='GET',body){
  const response=await fetch(origin+path,{method,headers:{origin,
   ...(cookie?{cookie}:{}),...(body===undefined?{}:{'content-type':'application/json'})},
   body:body===undefined?undefined:JSON.stringify(body)});
  const setCookie=response.headers.get('set-cookie');if(setCookie)cookie=setCookie.split(';')[0];
  const data=await response.json();return {status:response.status,data};
 }
 assert.equal((await api('/api/health')).status,200);
 const registered=await api('/api/auth/register','POST',
  {name:'Self-check workspace',email:'local-check@example.invalid',password:'a long smoke-test-only password'});
 assert.equal(registered.status,201);
 const workflow=await api('/api/workflows','POST',
  {name:'Smoke check',spec:{start:'draft',
   steps:[{id:'draft',type:'template',template:'Hello {{input.name}}',next:'finish'},
    {id:'finish',type:'end'}]},trigger:{type:'manual'}});
 assert.equal(workflow.status,201,JSON.stringify(workflow.data));
 const queued=await api('/api/workflows/'+workflow.data.id+'/run','POST',{input:{name:'GrowthVeyra'}});
 assert.equal(queued.status,202);
 await app.tick();
 const finished=await api('/api/runs/'+queued.data.id);
 assert.equal(finished.status,200);
 assert.equal(finished.data.status,'completed',JSON.stringify(finished.data));
 assert.equal(finished.data.state.steps.draft,'Hello GrowthVeyra');
 const maintenance=await api('/api/maintenance');
 assert.equal(maintenance.status,200);
 assert.equal(maintenance.data.automatic_backups.enabled,false);
 process.stdout.write('Smoke test passed: authentication, workflow execution, monitoring and maintenance status.\n');
}catch(error){
 process.stderr.write('Smoke test failed: '+String(error.message||error)+'\n');process.exitCode=1;
}finally{
 if(app){app.stop();if(started)await new Promise(resolve=>app.server.close(resolve));app.db.close();}
}
