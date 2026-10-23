import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizePublicURL,isGlobalIP,summarizePage} from '../src/scanner.mjs';
import {passwordHash,passwordMatches,escapeHtml} from '../src/security.mjs';
import {VENMO_PROFILE,MONTHLY_PRICE} from '../src/payments.mjs';
test('private IPs blocked',()=>{for(const ip of ['127.0.0.1','10.0.0.1','192.168.0.1','::1'])assert.equal(isGlobalIP(ip),false);});
test('unsafe URL rejected',()=>{for(const u of ['http://localhost','http://127.0.0.1','file:///etc/passwd','https://user:pass@example.com'])assert.throws(()=>normalizePublicURL(u));});
test('password verification',()=>{const hash=passwordHash('a long example password');assert.equal(passwordMatches('a long example password',hash),true);assert.equal(passwordMatches('incorrect',hash),false);});
test('HTML escaped',()=>assert.equal(escapeHtml('<script>'),'&lt;script&gt;'));
test('public page parsed',()=>{const x=summarizePage('https://example.org','<title>Shop</title><a href="mailto:hello@example.org">Email</a>');assert.equal(x.title,'Shop');assert.equal(x.public_contact_emails[0],'hello@example.org');});
test('Venmo merchant and price',()=>{assert.equal(VENMO_PROFILE,'https://venmo.com/u/bad-blue');assert.equal(MONTHLY_PRICE,299);});

test('blocks additional private and documentation address ranges',()=>{
 for(const ip of ['169.254.4.1','172.17.0.1','192.0.2.1','198.51.100.22','203.0.113.4','fc00::1','fe80::abcd'])assert.equal(isGlobalIP(ip),false,ip);
});
test('drops URL fragments and refuses credentials',()=>{
 assert.equal(normalizePublicURL('https://store.example.org/products?sku=1#hidden').href,'https://store.example.org/products?sku=1');
 assert.throws(()=>normalizePublicURL('https://user:password@store.example.org/'));
});
test('website summaries include specific public supporting links',()=>{
 const page=summarizePage('https://store.example.org/','<title>Store</title><a href="/pages/contact">Contact us</a><a href="/pages/shipping">Shipping details</a>');
 assert.equal(page.related_links.length,2);
});
test('AI JSON is extracted from fenced output',async()=>{
 const {extractJson}=await import('../src/ai.mjs');
 const fence=String.fromCharCode(96).repeat(3);
 assert.equal(extractJson(fence+'json\n{"status":"ready"}\n'+fence).status,'ready');
});
test('business Venmo payment QR emits a PNG',async()=>{
 const {venmoQR}=await import('../src/payments.mjs');
 const png=await venmoQR();
 assert.equal(png.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
});
test('unconfigured mail transport is reported accurately',async()=>{
 const {smtpReady,imapReady}=await import('../src/mail.mjs');
 if(!process.env.SMTP_PASSWORD)assert.equal(smtpReady(),false);
 if(!process.env.IMAP_PASSWORD&&!process.env.SMTP_PASSWORD)assert.equal(imapReady(),false);
});

test('recursive prospecting excludes social networks, support subdomains and giant services',async()=>{
 const {allowRecurse,STARTING_BUSINESSES}=await import('../src/workflows.mjs');
 assert.equal(allowRecurse('https://instagram.com','https://www.blueland.com','Follow us'),false);
 assert.equal(allowRecurse('https://threads.com','https://www.blueland.com','Threads'),false);
 assert.equal(allowRecurse('https://help.blueland.com','https://www.blueland.com','Support'),false);
 assert.equal(allowRecurse('https://www.amazon.com','https://www.blueland.com','Partner'),false);
 assert.equal(allowRecurse('https://partner-store.com','https://www.blueland.com','Partner brand'),true);
 assert.equal(STARTING_BUSINESSES.some(x=>/amazon\.com|microsoft\.com|walmart\.com|etsy\.com/i.test(x[0])),false);
});
