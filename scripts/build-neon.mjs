import {mkdirSync,rmSync,cpSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {build} from 'esbuild';

const root=resolve(import.meta.dirname,'..');
const out=join(root,'dist'),stage=join(out,'neon-stage');
rmSync(stage,{recursive:true,force:true});mkdirSync(stage,{recursive:true});
for(const name of ['src','integrations','functions'])cpSync(join(root,name),join(stage,name),{recursive:true});
const assetNames=['index.html','dashboard.css','designer.css','designer.js','commerce.css','commerce.js'];
const assets={
 aplusHtml:readFileSync(join(root,'public/index.html'),'utf8'),
 aplusJs:readFileSync(join(root,'public/app.js'),'utf8'),
 supportFiles:Object.fromEntries(['support.html','support-admin.html','support.js','support-admin.js','support.css'].map(n=>[n,readFileSync(join(root,'public',n),'utf8')])),
 automationFiles:Object.fromEntries(assetNames.map(n=>[n,readFileSync(join(root,'integrations/automation/public',n),'utf8')]))
};
writeFileSync(join(stage,'functions/aplus/assets.generated.mjs'),'export const assets='+JSON.stringify(assets)+';\n');
let text=readFileSync(join(stage,'src/api.mjs'),'utf8');
const replace=(from,to)=>{
 if(!text.includes(from))throw Error('Expected server asset reference not found: '+from);
 text=text.replace(from,to);
};
text="import {assets as functionAssets} from '../functions/aplus/assets.generated.mjs';\n"+text;
replace("let output=await readFile(new URL(file,import.meta.url));","let output=Buffer.from(isScript?functionAssets.aplusJs:functionAssets.aplusHtml);");
replace("let html=await readFile(new URL('../integrations/automation/public/index.html',import.meta.url),'utf8');","let html=functionAssets.automationFiles['index.html'];");
replace("const file=await readFile(new URL('../integrations/automation/public/'+filename,import.meta.url));","const file=Buffer.from(functionAssets.automationFiles[filename]);");
replace("const asset=await readFile(new URL('../public/'+path,import.meta.url));","const asset=Buffer.from(functionAssets.supportFiles[path]);");
writeFileSync(join(stage,'src/api.mjs'),text);
const file=join(stage,'integrations/automation/src/server.mjs');
let automation=readFileSync(file,'utf8'),n=0;
automation="import {assets as functionAssets} from '../../../functions/aplus/assets.generated.mjs';\n"+automation;
automation=automation.replace(/readFileSync\(new URL\('\.\.\/public\/([^']+)',import\.meta\.url\)\)/g,(_,filename)=>{
 n++;return "Buffer.from(functionAssets.automationFiles["+JSON.stringify(filename)+"])";
});
if(n!==6)throw Error('Expected six embedded enterprise studio assets, got '+n);
writeFileSync(file,automation);
const banner="import{createRequire as ___cr}from'module';import{fileURLToPath as ___f}from'url';import{dirname as ___d}from'path';const require=___cr(import.meta.url);const __filename=___f(import.meta.url);const __dirname=___d(__filename);";
await build({entryPoints:[join(stage,'functions/aplus/index.mjs')],bundle:true,platform:'node',target:'node24',format:'esm',minify:true,external:['pg-native'],banner:{js:banner},outfile:join(out,'index.mjs')});
console.log('Neon bundle generated: dist/index.mjs');
