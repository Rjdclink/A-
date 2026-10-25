// Credentials are supplied by the account owner and encrypted as one record.
// A connection is reusable by verification, requests, and workflow execution.
const token={key:'token',label:'API key or access token',secret:true};
const field=(key,label,secret=false)=>({key,label,secret});
const profiles={
 customerio:{path:'/v1/campaigns'},
 snowflake:{path:'/api/v2/databases'},
 mixpanel:{path:'/api/app/me',basic:['username','password'],fields:[field('username','Service account username'),field('password','Service account secret',true)]},
 amplitude:{path:'/api/2/taxonomy/event',basic:['api_key','secret_key'],fields:[field('api_key','Project API key',true),field('secret_key','Project secret key',true)]},
 plausible:{path:'/api/v1/sites'},
 bamboohr:{path:'/api/gateway.php/{company}/v1/meta/fields',basic:['token','=x'],fields:[token,field('company','Company subdomain')]},
 vonage:{path:'/account/get-balance',query:'api_key',queryExtra:{api_secret:'api_secret'},fields:[token,field('api_secret','API secret',true)]},
 docusign:{path:'/restapi/v2.1/accounts/{account_id}/users?current_user=true',fields:[token,field('account_id','Account ID')]},
 workday:{path:'/{endpoint_path}',fields:[token,field('endpoint_path','Tenant REST resource path (from Workday API client)')]},
 rippling:{path:'/users/'},
 bill:{path:'/connect/v3/login/session',header:'sessionId',extra:{devKey:'dev_key'},fields:[token,field('dev_key','Developer key',true)]},
 shopify:{path:'/admin/api/2026-10/graphql.json',header:'X-Shopify-Access-Token',method:'POST',body:{query:'query { shop { id name } }'}},
 woocommerce:{path:'/wp-json/wc/v3/products?per_page=1',basic:['consumer_key','consumer_secret'],fields:[field('consumer_key','Consumer key',true),field('consumer_secret','Consumer secret',true)]},
 bigcommerce:{path:'/stores/{store_hash}/v3/catalog/products?limit=1',header:'X-Auth-Token',fields:[token,field('store_hash','Store hash')]},
 salesforce:{path:'/services/oauth2/userinfo'},
 zoho:{path:'/crm/v8/org',prefix:'Zoho-oauthtoken '},
 mailchimp:{path:'/3.0/ping',basic:['=aplus','token']},
 klaviyo:{path:'/api/accounts/',prefix:'Klaviyo-API-Key ',headers:{revision:'2026-01-15'}},
 paypal:{path:'/v1/identity/oauth2/userinfo?schema=paypalv1.1'},
 quickbooks:{path:'/v3/company/{realm_id}/companyinfo/{realm_id}',fields:[token,field('realm_id','Company / realm ID')]},
 xero:{path:'/api.xro/2.0/Organisation',fields:[token,field('tenant_id','Xero tenant ID')],extra:{'xero-tenant-id':'tenant_id'}},
 twilio:{headers:{'content-type':'application/x-www-form-urlencoded'},path:'/2010-04-01/Accounts/{account_sid}.json',basic:['account_sid','auth_token'],fields:[field('account_sid','Account SID'),field('auth_token','Auth token',true)]},
 notion:{path:'/v1/users/me',headers:{'Notion-Version':'2025-09-03'}},
 zendesk:{path:'/api/v2/users/me.json'},
 slack:{path:'/api/auth.test',method:'POST',body:{}},
 brevo:{path:'/v3/account',header:'api-key'},
 postmark:{path:'/server',header:'X-Postmark-Server-Token'},
 pipedrive:{path:'/v1/users/me',header:'x-api-token'},
 freshsales:{path:'/crm/sales/api/sales_accounts?per_page=1',prefix:'Token token='},
 close:{path:'/api/v1/me/',basic:['token','=']},
 insightly:{path:'/v3.1/Users/Me',basic:['token','=']},
 copper:{path:'/developer_api/v1/account',header:'X-PW-AccessToken',extra:{'X-PW-UserEmail':'email'},headers:{'X-PW-Application':'developer_api'},fields:[token,field('email','Account email')]},
 'hubspot-marketing':{path:'/crm/v3/objects/contacts?limit=1'},
 activecampaign:{path:'/api/3/users/me',header:'Api-Token'},
 constantcontact:{path:'/v3/account/summary'},
 mailgun:{path:'/v4/domains?limit=1',basic:['=api','token']},
 resend:{path:'/domains'},
 discord:{path:'/api/v10/users/@me',prefix:'Bot '},
 confluence:{path:'/wiki/rest/api/user/current',basic:['email','token'],fields:[field('email','Account email'),token]},
 dropbox:{path:'/2/users/get_current_account',method:'POST',body:null},
 coda:{path:'/apis/v1/whoami'},
 supabase:{path:'/rest/v1/',extra:{apikey:'token'}},
 neon:{path:'/api/v2/projects'},
 databricks:{path:'/api/2.0/preview/scim/v2/Me'},
 trello:{path:'/1/members/me',query:'token',queryExtra:{key:'api_key'},fields:[token,field('api_key','API key',true)]},
 clickup:{path:'/api/v2/user',prefix:''},
 monday:{path:'/v2',prefix:'',method:'POST',body:{query:'{ me { id name } }'}},
 jira:{path:'/rest/api/3/myself',basic:['email','token'],fields:[field('email','Account email'),token]},
 linear:{path:'/graphql',prefix:'',method:'POST',body:{query:'{ viewer { id name } }'}},
 basecamp:{path:'/{account_id}/projects.json',fields:[token,field('account_id','Account ID')]},
 wrike:{path:'/api/v4/contacts?me=true'},
 gitlab:{path:'/api/v4/user',header:'PRIVATE-TOKEN'},
 bitbucket:{path:'/2.0/user'},
 railway:{path:'/graphql/v2',method:'POST',body:{query:'{ me { id name } }'}},
 sentry:{path:'/api/0/organizations/'},
 datadog:{path:'/api/v1/validate',header:'DD-API-KEY',extra:{'DD-APPLICATION-KEY':'application_key'},fields:[token,field('application_key','Application key',true)]},
 segment:{path:'/v1/workspaces'},
 freshdesk:{path:'/api/v2/agents/me',basic:['token','=X']},
 gorgias:{path:'/api/account',basic:['email','token'],fields:[field('email','Account email'),token]},
 wave:{path:'/graphql/public',method:'POST',body:{query:'{ user { id } }'}},
 gusto:{path:'/v1/me'},
 deel:{path:'/rest/v2/contracts?limit=1'},
 harvest:{path:'/v2/users/me',extra:{'Harvest-Account-ID':'account_id'},fields:[token,field('account_id','Account ID')]},
 toggl:{path:'/api/v9/me',basic:['token','=api_token']},
 clockify:{path:'/api/v1/user',header:'X-Api-Key'},
 acuity:{path:'/api/v1/me',basic:['user_id','token'],fields:[field('user_id','User ID'),token]},
 jotform:{path:'/user',header:'APIKEY'},
 pandadoc:{path:'/public/v1/documents?count=1',prefix:'API-Key '},
 'dropbox-sign':{path:'/v3/account',basic:['token','=']},
 anthropic:{path:'/v1/models',header:'x-api-key',headers:{'anthropic-version':'2023-06-01'}},
 cohere:{path:'/v1/check-api-key',method:'POST',body:{}},
 fireworks:{path:'/v1/models'}
};
export function protocolProfile(id){return profiles[id]||{};}
export function connectionFields(id){return protocolProfile(id).fields||[token];}
export function packCredential(id,input){
 const fields=connectionFields(id),supplied=input.credentials||{token:input.credential};
 if(!supplied||Array.isArray(supplied)||typeof supplied!=='object')throw Error('Provider credentials required');
 const values={};
 for(const f of fields){const v=supplied[f.key];if(typeof v!=='string'||!v.trim()||v.length>4096||/[\r\n\0]/.test(v))throw Error(f.label+' required');values[f.key]=v.trim();}
 return JSON.stringify({aplus_credentials:1,values});
}
export function credentialValues(secret){try{const parsed=JSON.parse(secret);if(parsed.aplus_credentials===1&&parsed.values)return parsed.values;}catch{}return {token:secret};}
export function renderProviderPath(path,values){return path.replace(/\{([a-z_]+)\}/g,(_,key)=>{if(!values[key])throw Error('Missing provider field: '+key);if(key==='endpoint_path'){if(!values[key].startsWith('/')||values[key].startsWith('//')||/[#\\]/.test(values[key]))throw Error('Provider path must be relative to its API host');return values[key].replace(/^\//,'');}return encodeURIComponent(values[key]);});}
