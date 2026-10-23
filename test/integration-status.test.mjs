import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createUnified} from '../src/unified.mjs';

test('integration diagnostics distinguish configured providers from verified connections without exposing secrets',async()=>{
 const db=new DatabaseSync(':memory:');
 const ledger={db};
 const env={AUTOMATION_DB_PATH:':memory:',AUTO_BACKUP_HOURS:'0',AI_API_KEY:'test_sensitive_ai_key',RECOVERY_SMTP_HOST:'smtp.example.com',RECOVERY_SMTP_USER:'smtp-user',RECOVERY_SMTP_PASS:'test_sensitive_smtp_password',RECOVERY_SMTP_FROM:'help@example.com',SQUARE_ACCESS_TOKEN:'test_sensitive_square',SQUARE_LOCATION_ID:'loc_abc',SHOPIFY_SECRET:'test_sensitive_shopify',SHOPIFY_SHOPS_JSON:'{"shop.myshopify.com":"default"}'};
 const app=createUnified({ledger,env,autoStart:false});
 try{
  const status=await app.handle('default','integrations/status','GET',null);
  assert.equal(status.status,200);
  assert.equal(status.data.providers.email,'configured');
  assert.equal(status.data.providers.ai,'configured');
  assert.equal(status.data.providers.square,'configured');
  assert.equal(status.data.providers.shopify,'configuration_incomplete');
  assert.equal(status.data.providers.neon,'not_configured');
  const response=JSON.stringify(status);
  for(const secret of ['test_sensitive_ai_key','test_sensitive_smtp_password','test_sensitive_square','test_sensitive_shopify'])assert.ok(!response.includes(secret));
 }finally{await app.close();db.close();}
});
