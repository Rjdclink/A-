import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Ledger} from '../src/ledger.mjs';
import {createSupport} from '../src/support.mjs';
const files=name=>readFileSync(new URL('../public/'+name,import.meta.url),'utf8');
test('merchant branding and locale-specific greeting settings persist across restart',()=>{
 const ledger=new Ledger(':memory:',{pseudonymKey:'brand-test-key-123456789012345678901'});
 const first=createSupport(ledger.db);
 const changed=first.updateSettings('shop',{businessName:'Example Service',logoText:'ES',greetingEs:'Buenos días, ¿cómo podemos ayudar?',greetingFr:'Bonjour ! Comment pouvons-nous aider ?'});
 assert.equal(changed.logoText,'ES');
 const again=createSupport(ledger.db);
 const config=again.settings('shop');
 assert.equal(config.logoText,'ES');
 assert.match(config.greetingEs,/Buenos días/);
 assert.match(config.greetingFr,/Bonjour/);
 assert.equal(again.settings('different').logoText,'A+');
 ledger.close();
});
test('customer fallback responses reflect selected article locale without provider access',async()=>{
 const ledger=new Ledger(':memory:',{pseudonymKey:'locale-test-key-1234567890123456789'});
 const service=createSupport(ledger.db);
 const spanish=await service.receive('shop',{message:'¿Dónde está mi pedido?',locale:'es'});
 const french=await service.receive('shop',{message:'Où est ma commande ?',locale:'fr'});
 assert.match(spanish.reply,/No puedo verificar/i);assert.equal(spanish.needsHuman,true);
 assert.match(french.reply,/Je ne peux pas vérifier/i);assert.equal(french.needsHuman,true);
 ledger.close();
});
test('customer widget and staff settings include white-label identity and translated UI labels',()=>{
 const html=files('support.html'),admin=files('support-admin.html');
 const customerJS=files('support.js'),adminJS=files('support-admin.js');
 assert.match(html,/id="brandLogo"/);assert.match(admin,/id="logoTextInput"/);
 assert.match(admin,/id="greetingEsInput"/);assert.match(admin,/id="greetingFrInput"/);
 assert.match(customerJS,/updateLanguage/);
 assert.match(customerJS,/brandLogo/);assert.match(adminJS,/logoTextInput/);
});
