import test from 'node:test';
import assert from 'node:assert/strict';
import {SMTPServer} from 'smtp-server';

test('outbound email is delivered to a controlled local SMTP server',async()=>{
 const messages=[];
 const server=new SMTPServer({
  banner:'Local test SMTP only',
  disabledCommands:['STARTTLS'],
  authMethods:['PLAIN'],
  onAuth(auth,session,callback){
   if(auth.username==='local-user'&&auth.password==='local-test-secret')callback(null,{user:'local-user'});
   else callback(new Error('Rejected'));
  },
  onData(stream,session,callback){
   const parts=[];
   stream.on('data',chunk=>parts.push(Buffer.from(chunk)));
   stream.on('end',()=>{messages.push(Buffer.concat(parts).toString('utf8'));callback(null,'queued locally');});
  }
 });
 await new Promise((resolve,reject)=>{server.listen(0,'127.0.0.1',resolve);server.once('error',reject);});
 const port=server.server.address().port;
 process.env.SMTP_HOST='127.0.0.1';
 process.env.SMTP_PORT=String(port);
 process.env.SMTP_USER='local-user';
 process.env.SMTP_PASSWORD='local-test-secret';
 process.env.SENDER_EMAIL='contact.badblue@gmail.com';
 try{
  const {sendMail,closeMailTransport}=await import('../src/mail.mjs');
  globalThis.__closeTestTransport=closeMailTransport;
  const id=await sendMail({to:'customer@example.test',subject:'Test response',body:'Your inquiry was received.'});
  assert.ok(id);
  assert.equal(messages.length,1);
  assert.match(messages[0],/Your inquiry was received/);
  assert.match(messages[0],/contact\.badblue@gmail\.com/);
 }finally{
  globalThis.__closeTestTransport?.();
  await new Promise(resolve=>server.close(resolve));
 }
});
