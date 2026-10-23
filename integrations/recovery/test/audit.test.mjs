import test from 'node:test';
import assert from 'node:assert/strict';
import {auditPage,auditWebsitePages,chooseAuditLinks} from '../src/audit.mjs';
import {slotEligibility} from '../src/booking.mjs';
import robotsParser from 'robots-parser';
const example='https://www.independent-shop.example.com';
test('audits product JSON-LD, accessible purchase controls and truthful evidence',()=>{
 const html='<html lang="en"><head><title>Handmade Cup</title><meta name="description" content="Handmade ceramic cup"><meta name="viewport" content="width=device-width, initial-scale=1"><script type="application/ld+json">{"@type":"Product","name":"Handmade Cup","offers":{"price":"40","priceCurrency":"USD"}}</script></head><body><h1>Handmade Cup</h1><img src="/cup.jpg"><button aria-label="Add to cart">Add to cart</button><form><label for="email">Email</label><input id="email" name="email" type="email"></form></body></html>';
 const p=auditPage({url:example+'/products/cup',html});
 assert.equal(p.kind,'product');
 assert.equal(p.meta.json_ld[0].type,'Product');
 assert.equal(p.meta.json_ld[0].offers,true);
 assert.equal(p.cta_count,1);
 assert.equal(p.forms[0].unlabeled,0);
 const findings=auditWebsitePages([p]).findings;
 assert.ok(findings.some(f=>f.code==='missing-image-alternatives'));
 assert.ok(!findings.some(f=>f.code==='unclear-form-labels'));
 assert.equal(auditWebsitePages([p]).method.includes('no access to analytics'),true);
});
test('groups template findings without reporting the same issue as many new opportunities',()=>{
 const page='<html><body><h1>Sale</h1><img src="/missing.jpg"><a href="/pages/contact">Contact</a></body></html>';
 const p1=auditPage({url:example,html:page});
 const p2=auditPage({url:example+'/products/cup',html:page});
 const audit=auditWebsitePages([p1,p2]);
 assert.equal(audit.pages_audited,2);
 assert.equal(audit.findings.filter(x=>x.code==='missing-image-alternatives').length,1);
 assert.equal(audit.findings.find(x=>x.code==='missing-image-alternatives').occurrences,2);
 assert.ok(audit.findings.every(x=>x.note.includes('no proof of lost sales')));
});
test('selects product and policy pages rather than payment, gift-card and legal URLs',()=>{
 const html='<a href="/products/coffee">Coffee</a><a href="/products/gift-card">Gift Card</a><a href="/pages/shipping">Shipping</a><a href="/policies/terms-of-service">Terms</a><a href="/pages/contact">Contact</a><a href="/checkout">Checkout</a>';
 const p=auditPage({url:example,html});
 const links=chooseAuditLinks(p,example,5);
 assert.ok(links.some(x=>x.type==='product'&&x.url.includes('coffee')));
 assert.ok(links.some(x=>x.type==='shipping'));
 assert.ok(links.some(x=>x.type==='contact'));
 assert.equal(links.some(x=>/gift-card|checkout|terms-of/.test(x.url)),false);
});
test('honors explicit robots user agent and wildcard path rules',()=>{
 const r=robotsParser(example+'/robots.txt','User-agent: *\nDisallow: /private\nAllow: /private/public\n');
 assert.equal(r.isAllowed(example+'/private/sales','AIRevenueRecoveryBot/1.0'),false);
 assert.equal(r.isAllowed(example+'/private/public/products','AIRevenueRecoveryBot/1.0'),true);
});
test('internal booking confirms only configured UTC business slots',()=>{
 const b={booking_enabled:true,booking_weekdays:'1,2,3,4,5',booking_start_hour:9,booking_end_hour:17,booking_slot_minutes:30};
 assert.equal(slotEligibility(b,'2026-10-26T10:30:00Z').available,true);
 assert.equal(slotEligibility(b,'2026-10-25T10:30:00Z').reason,'closed-day');
 assert.equal(slotEligibility(b,'2026-10-26T10:20:00Z').reason,'not-a-slot');
 assert.equal(slotEligibility({...b,booking_enabled:false},'2026-10-26T10:30:00Z').reason,'confirmation-disabled');
});

test('sitemap parsing filters cross-domain URLs and selects purchase, shipping, and contact pages',async()=>{
 const {parseSitemap,prioritizeSitemapUrls}=await import('../src/sitemap.mjs');
 const xml='<urlset><url><loc>https://www.independent-shop.example.com/products/mug</loc></url>'+
 '<url><loc>https://www.independent-shop.example.com/pages/shipping</loc></url>'+
 '<url><loc>https://www.independent-shop.example.com/pages/contact</loc></url>'+
 '<url><loc>https://analytics.example.com/internal</loc></url>'+
 '<url><loc>http://127.0.0.1/admin</loc></url>'+
 '<url><loc>https://www.independent-shop.example.com/checkout</loc></url></urlset>';
 const parsed=parseSitemap(xml,'https://www.independent-shop.example.com/sitemap.xml');
 assert.equal(parsed.type,'urls');
 assert.equal(parsed.urls.length,4);
 const links=prioritizeSitemapUrls(parsed.urls,'https://www.independent-shop.example.com',5);
 assert.equal(links.length,3);
 assert.ok(links.some(l=>l.type==='product'));
 assert.ok(links.some(l=>l.type==='shipping'));
 assert.ok(links.some(l=>l.type==='contact'));
 assert.equal(links.some(l=>l.url.includes('checkout')),false);
});
test('sitemap indices remain bounded to the original host',async()=>{
 const {parseSitemap}=await import('../src/sitemap.mjs');
 const xml='<sitemapindex><sitemap><loc>https://example.org/secret.xml</loc></sitemap>'+
 '<sitemap><loc>https://www.independent-shop.example.com/products-sitemap.xml</loc></sitemap></sitemapindex>';
 const parsed=parseSitemap(xml,'https://www.independent-shop.example.com/sitemap.xml');
 assert.equal(parsed.type,'index');
 assert.equal(parsed.urls.length,1);
});
