import {createCipheriv,createDecipheriv,randomBytes,createHmac} from 'node:crypto';
export const SERVICE_FIELDS={
 RECOVERY_PUBLIC_URL:{label:'Public dashboard HTTPS URL (unsubscribe links)'},
 RECOVERY_STRIPE_KEY:{label:'Stripe recovery read access key',secret:true},RECOVERY_STRIPE_WEBHOOK_SECRET:{label:'Stripe recovery webhook signing secret',secret:true},
 RECOVERY_TWILIO_SID:{label:'Recovery SMS Twilio Account SID'},RECOVERY_TWILIO_TOKEN:{label:'Recovery SMS Twilio auth token',secret:true},RECOVERY_TWILIO_FROM:{label:'Recovery SMS sender (E.164)'},RECOVERY_TWILIO_WEBHOOK_URL:{label:'Recovery SMS inbound webhook HTTPS URL'},
 AI_BASE_URL:{label:'AI chat-completions HTTPS endpoint'},AI_MODEL:{label:'AI model'},AI_API_KEY:{label:'AI API key',secret:true},
 RECOVERY_SMTP_HOST:{label:'SMTP hostname'},RECOVERY_SMTP_PORT:{label:'SMTP port (465 or 587)'},RECOVERY_SMTP_USER:{label:'SMTP username'},RECOVERY_SMTP_PASS:{label:'SMTP password / app password',secret:true},RECOVERY_SMTP_FROM:{label:'Sender email address'},
 SHOPIFY_SECRET:{label:'Shopify webhook signing secret',secret:true},SHOPIFY_SHOPS_JSON:{label:'Shopify store → workspace mapping (JSON)'},SHOPIFY_ANALYTICS_BASIS_ACKNOWLEDGED:{label:'Import approved Shopify orders (true/false)'},
 SUPPORT_EMBED_ORIGINS_JSON:{label:'Chat embed origins by workspace (JSON)'},
 SQUARE_WEBHOOK_URL:{label:'Square webhook HTTPS URL'},SQUARE_WEBHOOK_SIGNATURE_KEY:{label:'Square webhook signature key',secret:true},
 SQUARE_PLAN_STARTER_VARIATION_ID:{label:'Starter plan variation ID'},SQUARE_PLAN_STARTER_CENTS:{label:'Starter plan monthly price in cents'},SQUARE_PLAN_PRO_VARIATION_ID:{label:'Pro plan variation ID'},SQUARE_PLAN_PRO_CENTS:{label:'Pro plan monthly price in cents'},SQUARE_PLAN_ENTERPRISE_VARIATION_ID:{label:'Enterprise plan variation ID'},SQUARE_PLAN_ENTERPRISE_CENTS:{label:'Enterprise plan monthly price in cents'},
 SQUARE_ACCESS_TOKEN:{label:'Square access token',secret:true},SQUARE_LOCATION_ID:{label:'Square location ID'},SQUARE_ENVIRONMENT:{label:'Square environment (sandbox/production)'}
};
export function serviceSettings(db,env){
 db.exec('CREATE TABLE IF NOT EXISTS installation_settings(id INTEGER PRIMARY KEY CHECK(id=1),cipher TEXT NOT NULL)');
 const key=()=>{if(!env.PSEUDONYM_KEY||env.PSEUDONYM_KEY.length<24)throw Error('Stable server key is unavailable');return createHmac('sha256',env.PSEUDONYM_KEY).update('aplus:service-settings:v1').digest();};
 const initial={...env};
 function read(){const row=db.prepare('SELECT cipher FROM installation_settings WHERE id=1').get();if(!row)return {};const [iv,tag,value]=row.cipher.split('.').map(x=>Buffer.from(x,'base64url'));const d=createDecipheriv('aes-256-gcm',key(),iv);d.setAAD(Buffer.from('aplus:installation-settings'));d.setAuthTag(tag);return JSON.parse(Buffer.concat([d.update(value),d.final()]).toString());}
 Object.assign(env,read());
 function status(){return {fields:Object.entries(SERVICE_FIELDS).map(([name,f])=>({name,...f,configured:Boolean(env[name]),value:f.secret?'':env[name]||''}))};}
 function save(values){
  if(!values||Array.isArray(values)||typeof values!=='object')throw Error('Settings object required');
  const saved=read();
  for(const [name,value] of Object.entries(values)){
   if(!Object.hasOwn(SERVICE_FIELDS,name)||typeof value!=='string'||value.length>8000||/[\r\n\0]/.test(value))throw Error('Invalid service setting');
   if(value===''){delete saved[name];continue;}
   if(name==='AI_BASE_URL'||name==='SQUARE_WEBHOOK_URL'||name==='RECOVERY_PUBLIC_URL'||name==='RECOVERY_TWILIO_WEBHOOK_URL'){const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password)throw Error('AI endpoint requires HTTPS');}
   if(name==='RECOVERY_TWILIO_SID'&&!/^AC[a-fA-F0-9]{32}$/.test(value))throw Error('Twilio Account SID required');
   if(name==='RECOVERY_TWILIO_FROM'&&!/^\+[1-9]\d{7,14}$/.test(value))throw Error('E.164 sender required');
   if(name==='RECOVERY_SMTP_HOST'&&!/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(value))throw Error('SMTP hostname required');
   if(name==='RECOVERY_SMTP_PORT'&&!['465','587','2525'].includes(value))throw Error('Unsupported SMTP port');
   if(name==='RECOVERY_SMTP_FROM'&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))throw Error('Sender email address required');
   if(name==='SHOPIFY_ANALYTICS_BASIS_ACKNOWLEDGED'&&!['true','false'].includes(value))throw Error('Use true or false');
   if(name==='SHOPIFY_SHOPS_JSON'){const shops=JSON.parse(value);if(!shops||Array.isArray(shops)||typeof shops!=='object'||Object.entries(shops).some(([shop,w])=>!/^[a-z0-9-]+\.myshopify\.com$/.test(shop)||!/^[a-z0-9_-]{1,60}$/i.test(w)))throw Error('Invalid Shopify mapping');if(new Set(Object.values(shops)).size!==Object.values(shops).length)throw Error('Each shop requires a separate workspace');}
   if(name==='SQUARE_ENVIRONMENT'&&!['sandbox','production'].includes(value))throw Error('Invalid Square environment');
   if(name.endsWith('_CENTS')&&!/^[1-9]\d{0,7}$/.test(value))throw Error('Plan amount must be positive integer cents');
   if(name==='SUPPORT_EMBED_ORIGINS_JSON'){const entries=JSON.parse(value);if(!entries||Array.isArray(entries)||typeof entries!=='object'||Object.values(entries).some(origins=>!Array.isArray(origins)||origins.some(o=>{try{return new URL(o).origin!==o||!o.startsWith('https://');}catch{return true;}})))throw Error('Use workspace names mapped to HTTPS origin lists');}
   saved[name]=value;
  }
  const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',key(),iv);c.setAAD(Buffer.from('aplus:installation-settings'));const encrypted=Buffer.concat([c.update(JSON.stringify(saved)),c.final()]);
  db.prepare('INSERT INTO installation_settings VALUES(1,?) ON CONFLICT(id) DO UPDATE SET cipher=excluded.cipher').run([iv,c.getAuthTag(),encrypted].map(b=>b.toString('base64url')).join('.'));
  for(const name of Object.keys(SERVICE_FIELDS)){if(Object.hasOwn(saved,name))env[name]=saved[name];else if(Object.hasOwn(initial,name))env[name]=initial[name];else delete env[name];}
  return status();
 }
 return {status,save};
}
