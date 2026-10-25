import {protocolProfile,credentialValues,renderProviderPath} from './profiles.mjs';
// Provider-specific wire formats apply to verification AND workflow requests.
export function providerHeaders(provider,secret,authType='bearer'){
 const p=protocolProfile(provider),v=credentialValues(secret),headers={...p.headers};
 const value=x=>x.startsWith('=')?x.slice(1):v[x]||'';
 if(p.basic)headers.authorization='Basic '+Buffer.from(p.basic.map(value).join(':')).toString('base64');
 else if(p.header)headers[p.header]=v.token;
 else if(!p.query){if(p.prefix!==undefined||authType==='bearer')headers.authorization=(p.prefix??'Bearer ')+v.token;else headers['x-api-key']=v.token;}
 for(const [h,key] of Object.entries(p.extra||{}))headers[h]=v[key];
 return headers;
}
export function providerURL(provider,url,secret){
 const p=protocolProfile(provider),v=credentialValues(secret),u=new URL(renderProviderPath(url,v));
 if(p.query)u.searchParams.set(p.query,v.token);
 for(const [k,field] of Object.entries(p.queryExtra||{}))u.searchParams.set(k,v[field]);
 return u.href;
}
export function providerProbe(provider){
 const p=protocolProfile(provider);
 return {method:p.method||'GET',...(p.method==='POST'?{body:{payload:JSON.stringify(p.body??null)}}:{})};
}
export function validateProbe(provider,reply){
 let data;
 try{data=typeof reply==='string'?JSON.parse(reply):reply;}catch{throw Error('Provider returned invalid JSON');}
 if(!data||typeof data!=='object')throw Error('Provider returned no account verification');
 if(data.Fault||data.errorCode||data.error||data.errors?.length||data.ok===false||data.success===false||Number(data.ErrorCode)>0)throw Error('Provider rejected verification');
 if(provider==='slack'&&data.ok!==true)throw Error('Slack authentication failed');
 if(provider==='shopify'&&!data.data?.shop?.id)throw Error('Shopify shop access was not verified');
 if(provider==='postmark'&&!data.ID)throw Error('Postmark server access was not verified');
}
