import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {Ledger} from '../src/ledger.mjs';
import {createSupport} from '../src/support.mjs';
import {createHandler} from '../src/api.mjs';

const tokens={alpha:{adminToken:'a'.repeat(32),ingestToken:'b'.repeat(32)},beta:{adminToken:'c'.repeat(32),ingestToken:'d'.repeat(32)}};
async function harness(){
 const ledger=new Ledger(':memory:',{pseudonymKey:'document-private-32-character-key'});
 const support=createSupport(ledger.db);
 const server=createServer(createHandler({ledger,support,tenants:tokens,adviser:async()=>''}));
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 return {base:'http://127.0.0.1:'+server.address().port,close:()=>new Promise(resolve=>server.close(()=>{ledger.close();resolve();}))};
}
async function api(root,route,{workspace='alpha',token,method='GET',body}={}){
 const r=await fetch(root+'/api/support/'+route+'?workspace='+workspace,{
  method,headers:{...(token?{authorization:'Bearer '+token}:{}),...(body!==undefined?{'content-type':'application/json'}:{})},
  body:body===undefined?undefined:JSON.stringify(body)});
 return {status:r.status,data:await r.json()};
}
test('support attachments require a valid customer session or staff role and preserve content byte-for-byte',async()=>{
 const h=await harness();
 try{
  const newChat=await api(h.base,'chat',{method:'POST',body:{message:'Please review this document'}});
  const ticketId=newChat.data.ticketId,sessionToken=newChat.data.sessionToken;
  const bytes=Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n');
  const file={ticketId,sessionToken,name:'reference.pdf',mime:'application/pdf',contentBase64:bytes.toString('base64')};
  assert.equal((await api(h.base,'files',{method:'POST',body:{...file,sessionToken:'invalid'}})).status,403);
  assert.equal((await api(h.base,'files',{workspace:'beta',method:'POST',body:file})).status,403);
  assert.equal((await api(h.base,'files',{method:'POST',body:{...file,mime:'image/png'}})).status,400);
  const stored=await api(h.base,'files',{method:'POST',body:file});
  assert.equal(stored.status,201);assert.equal(stored.data.file.name,'reference.pdf');
  assert.ok(!JSON.stringify(stored.data).includes('contentBase64'));
  const wrong=await api(h.base,'files/read',{method:'POST',body:{ticketId,sessionToken:'invalid',fileId:stored.data.file.id}});
  assert.equal(wrong.status,403);
  const read=await api(h.base,'files/read',{method:'POST',body:{ticketId,sessionToken,fileId:stored.data.file.id}});
  assert.equal(read.status,200);assert.equal(read.data.file.contentBase64,bytes.toString('base64'));
  assert.equal((await api(h.base,'tickets/'+ticketId+'/files')).status,401);
  const staff=await api(h.base,'tickets/'+ticketId+'/files',{token:tokens.alpha.adminToken});
  assert.equal(staff.status,200);assert.equal(staff.data.files.length,1);
  assert.equal((await api(h.base,'tickets/'+ticketId+'/files',{workspace:'beta',token:tokens.beta.adminToken})).status,404);
  assert.equal((await api(h.base,'tickets/'+ticketId+'/files/'+stored.data.file.id,{token:tokens.alpha.adminToken})).data.file.contentBase64,bytes.toString('base64'));
  const staffUpload=await api(h.base,'tickets/'+ticketId+'/files',{token:tokens.alpha.adminToken,method:'POST',body:{
   name:'staff-notes.txt',mime:'text/plain',contentBase64:Buffer.from('A staff-provided reference.').toString('base64')
  }});
  assert.equal(staffUpload.status,201);assert.equal(staffUpload.data.file.uploadedBy,'agent');
  assert.equal((await api(h.base,'files/list',{method:'POST',body:{ticketId,sessionToken}})).data.files.length,2);

  assert.equal((await api(h.base,'privacy/self/erase',{method:'POST',body:{ticketId,sessionToken}})).status,200);
  assert.equal((await api(h.base,'files/read',{method:'POST',body:{ticketId,sessionToken,fileId:stored.data.file.id}})).status,403);
 }finally{await h.close();}
});
test('support attachments enforce upload limits, restricted types and valid UTF-8',async()=>{
 const h=await harness();
 try{
  const chat=await api(h.base,'chat',{method:'POST',body:{message:'Support file safety'}});
  const file={ticketId:chat.data.ticketId,sessionToken:chat.data.sessionToken,name:'notes.txt',mime:'text/plain'};
  assert.equal((await api(h.base,'files',{method:'POST',body:{...file,contentBase64:Buffer.from('<script>alert(1)</script>').toString('base64')}})).status,400);
  assert.equal((await api(h.base,'files',{method:'POST',body:{...file,name:'../secret.txt',contentBase64:Buffer.from('A note').toString('base64')}})).status,400);
  assert.equal((await api(h.base,'files',{method:'POST',body:{...file,contentBase64:Buffer.from([0xff,0xfe]).toString('base64')}})).status,400);
  assert.equal((await api(h.base,'files',{method:'POST',body:{...file,contentBase64:Buffer.alloc(1024*1024+1,65).toString('base64')}})).status,413);
  const doc={...file,contentBase64:Buffer.from('A readable note.').toString('base64')};
  assert.equal((await api(h.base,'files',{method:'POST',body:doc})).status,201);
 }finally{await h.close();}
});
