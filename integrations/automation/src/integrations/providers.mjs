// Provider-specific wire formats apply to verification AND workflow requests.
export function providerHeaders(provider,secret,authType='bearer'){
 switch(provider){
  case 'shopify':return {'X-Shopify-Access-Token':secret};
  case 'brevo':return {'api-key':secret};
  case 'postmark':return {'X-Postmark-Server-Token':secret};
  default:return authType==='bearer'?{authorization:'Bearer '+secret}:{'x-api-key':secret};
 }
}
export function providerProbe(provider){
 if(provider==='shopify')return {method:'POST',body:{payload:JSON.stringify({query:'query { shop { id name } }'})}};
 if(provider==='slack')return {method:'POST',body:{payload:'{}'}};
 return {method:'GET'};
}
export function validateProbe(provider,reply){
 let data;
 try{data=typeof reply==='string'?JSON.parse(reply):reply;}catch{throw Error('Provider returned invalid JSON');}
 if(!data||typeof data!=='object'||Array.isArray(data))throw Error('Provider returned no account verification');
 if(data.error||data.errors?.length||data.ok===false||data.success===false||Number(data.ErrorCode)>0)throw Error('Provider rejected verification');
 if(provider==='slack'&&data.ok!==true)throw Error('Slack authentication failed');
 if(provider==='shopify'&&!data.data?.shop?.id)throw Error('Shopify shop access was not verified');
 if(provider==='postmark'&&!data.ID)throw Error('Postmark server access was not verified');
}
