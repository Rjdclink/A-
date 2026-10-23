import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import * as mailConfig from '../src/mail_config.mjs';
const {BADBLUE_EMAIL,sealMailPassword,openMailPassword,normalizeGmailAppPassword}=mailConfig;
globalThis.__mailDiagnosticExports=mailConfig;

test('Gmail credentials encrypt at rest with random AES-GCM nonces',()=>{
 const old=process.env.MAIL_ENCRYPTION_KEY;
 process.env.MAIL_ENCRYPTION_KEY=randomBytes(32).toString('hex');
 try {
  const password='abcdefghijklmnop';
  const first=sealMailPassword(password),second=sealMailPassword(password);
  assert.notEqual(first,second);
  assert.ok(!first.includes(password));
  assert.equal(openMailPassword(first),password);
  assert.equal(openMailPassword(second),password);
  const parts=first.split('.');parts[2]=(parts[2][0]==='A'?'B':'A')+parts[2].slice(1);assert.throws(()=>openMailPassword(parts.join('.')));
 }finally{
  if(old===undefined)delete process.env.MAIL_ENCRYPTION_KEY;
  else process.env.MAIL_ENCRYPTION_KEY=old;
 }
});
test('mail connects only to the intended Bad Blue account',()=>{
 assert.equal(BADBLUE_EMAIL,'contact.badblue@gmail.com');
 assert.equal(normalizeGmailAppPassword('abcd efgh ijkl mnop'),'abcdefghijklmnop');
 assert.throws(()=>normalizeGmailAppPassword('normalpassword'));
 assert.throws(()=>normalizeGmailAppPassword(''));
});
test('email encryption refuses missing server-only encryption key',()=>{
 const old=process.env.MAIL_ENCRYPTION_KEY;
 delete process.env.MAIL_ENCRYPTION_KEY;
 try{assert.throws(()=>sealMailPassword('abcdefghijklmnop'),/not configured/);}
 finally{if(old!==undefined)process.env.MAIL_ENCRYPTION_KEY=old;}
});

test('credential encryption requires a dedicated key even when DATABASE_URL is set',()=>{
 const oldKey=process.env.MAIL_ENCRYPTION_KEY,oldDb=process.env.DATABASE_URL;
 delete process.env.MAIL_ENCRYPTION_KEY;
 process.env.DATABASE_URL='postgresql://internal_user:test_db_secret@localhost/recovery';
 try{assert.throws(()=>sealMailPassword('abcdefghijklmnop'),/not configured/);}
 finally{
  if(oldKey===undefined)delete process.env.MAIL_ENCRYPTION_KEY;else process.env.MAIL_ENCRYPTION_KEY=oldKey;
  if(oldDb===undefined)delete process.env.DATABASE_URL;else process.env.DATABASE_URL=oldDb;
 }
});


test('SMTP wrong app password has an actionable safe error, not connection-error',()=>{
 const {classifyGmailFailure}=globalThis.__mailDiagnosticExports;
 const result=classifyGmailFailure({code:'EAUTH',responseCode:535,response:'535-5.7.8 Username and Password not accepted'},'smtp');
 assert.equal(result.code,'smtp_auth_rejected');
 assert.match(result.message,/app password/i);
 assert.ok(!result.message.includes('535-5.7.8'));
});
test('IMAP rejected credentials are distinguished from SMTP failures',()=>{
 const {classifyGmailFailure}=globalThis.__mailDiagnosticExports;
 const result=classifyGmailFailure({responseText:'NO [AUTHENTICATIONFAILED] Invalid credentials'},'imap');
 assert.equal(result.code,'imap_auth_rejected');
 assert.match(result.message,/incoming/i);
});
test('network timeout and connectivity errors identify the failing protocol',()=>{
 const {classifyGmailFailure}=globalThis.__mailDiagnosticExports;
 const result=classifyGmailFailure({code:'ETIMEDOUT',message:'user secret should never surface'},'smtp');
 assert.equal(result.code,'smtp_timeout');
 assert.equal(result.message.includes('user secret'),false);
});
test('safe Gmail diagnostic redacts raw error details',()=>{
 const {describeGmailFailure}=globalThis.__mailDiagnosticExports;
 const result=describeGmailFailure(new Error('Sensitive credentials potentially present'));
 assert.equal(result.code,'verification_error');
 assert.equal(result.message.includes('Sensitive credentials'),false);
});
