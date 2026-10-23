// Curated integration setup profiles. These are NOT live connected applications.
// OAuth authorization, token lifecycle and provider-specific setup remain operator tasks.
const records = [
 ['hubspot','HubSpot','CRM','api.hubapi.com','bearer','/crm/v3/objects/contacts?limit=1'],
 ['salesforce','Salesforce','CRM','salesforce.com','bearer'],
 ['pipedrive','Pipedrive','CRM','api.pipedrive.com','bearer'],
 ['zoho','Zoho CRM','CRM','www.zohoapis.com','bearer'],
 ['freshsales','Freshsales','CRM','freshsales.io','bearer'],
 ['close','Close','CRM','api.close.com','api_key'],
 ['insightly','Insightly','CRM','api.insightly.com','api_key'],
 ['copper','Copper','CRM','api.copper.com','bearer'],
 ['hubspot-marketing','HubSpot Marketing','Marketing','api.hubapi.com','bearer'],
 ['mailchimp','Mailchimp','Marketing','api.mailchimp.com','api_key'],
 ['klaviyo','Klaviyo','Marketing','a.klaviyo.com','api_key'],
 ['brevo','Brevo','Marketing','api.brevo.com','api_key','/v3/account'],
 ['customerio','Customer.io','Marketing','api.customer.io','bearer'],
 ['activecampaign','ActiveCampaign','Marketing','activehosted.com','api_key'],
 ['constantcontact','Constant Contact','Marketing','api.cc.email','bearer'],
 ['sendgrid','SendGrid','Email','api.sendgrid.com','bearer','/v3/user/account'],
 ['mailgun','Mailgun','Email','api.mailgun.net','api_key'],
 ['postmark','Postmark','Email','api.postmarkapp.com','api_key'],
 ['resend','Resend','Email','api.resend.com','bearer'],
 ['slack','Slack','Collaboration','slack.com','bearer','/api/auth.test'],
 ['discord','Discord','Collaboration','discord.com','bearer'],
 ['microsoft-graph','Microsoft Graph','Collaboration','graph.microsoft.com','bearer','/v1.0/me'],
 ['google-drive','Google Drive','Collaboration','www.googleapis.com','bearer','/drive/v3/about?fields=user'],
 ['google-calendar','Google Calendar','Collaboration','www.googleapis.com','bearer','/calendar/v3/users/me/calendarList'],
 ['gmail','Gmail','Collaboration','gmail.googleapis.com','bearer','/gmail/v1/users/me/profile'],
 ['notion','Notion','Knowledge','api.notion.com','bearer','/v1/users/me'],
 ['confluence','Confluence','Knowledge','atlassian.net','bearer'],
 ['dropbox','Dropbox','Knowledge','api.dropboxapi.com','bearer'],
 ['box','Box','Knowledge','api.box.com','bearer','/2.0/users/me'],
 ['coda','Coda','Knowledge','coda.io','bearer'],
 ['airtable','Airtable','Database','api.airtable.com','bearer','/v0/meta/bases'],
 ['supabase','Supabase','Database','supabase.co','bearer'],
 ['neon','Neon','Database','console.neon.tech','bearer'],
 ['snowflake','Snowflake','Database','snowflakecomputing.com','bearer'],
 ['databricks','Databricks','Database','databricks.com','bearer'],
 ['asana','Asana','Projects','app.asana.com','bearer','/api/1.0/users/me'],
 ['trello','Trello','Projects','api.trello.com','api_key'],
 ['clickup','ClickUp','Projects','api.clickup.com','bearer','/api/v2/user'],
 ['monday','Monday.com','Projects','api.monday.com','bearer'],
 ['jira','Jira','Projects','atlassian.net','bearer'],
 ['linear','Linear','Projects','api.linear.app','bearer'],
 ['basecamp','Basecamp','Projects','3.basecampapi.com','bearer'],
 ['smartsheet','Smartsheet','Projects','api.smartsheet.com','bearer','/2.0/users/me'],
 ['wrike','Wrike','Projects','www.wrike.com','bearer'],
 ['github','GitHub','Developer','api.github.com','bearer','/user'],
 ['gitlab','GitLab','Developer','gitlab.com','bearer','/api/v4/user'],
 ['bitbucket','Bitbucket','Developer','api.bitbucket.org','bearer'],
 ['vercel','Vercel','Developer','api.vercel.com','bearer','/v2/user'],
 ['railway','Railway','Developer','backboard.railway.com','bearer'],
 ['cloudflare','Cloudflare','Developer','api.cloudflare.com','bearer','/client/v4/user'],
 ['sentry','Sentry','Developer','sentry.io','bearer'],
 ['datadog','Datadog','Analytics','api.datadoghq.com','bearer'],
 ['mixpanel','Mixpanel','Analytics','mixpanel.com','bearer'],
 ['amplitude','Amplitude','Analytics','amplitude.com','bearer'],
 ['segment','Segment','Analytics','api.segment.io','bearer'],
 ['plausible','Plausible','Analytics','plausible.io','bearer'],
 ['intercom','Intercom','Support','api.intercom.io','bearer','/me'],
 ['zendesk','Zendesk','Support','zendesk.com','bearer'],
 ['freshdesk','Freshdesk','Support','freshdesk.com','api_key'],
 ['helpscout','Help Scout','Support','api.helpscout.net','bearer','/v2/users/me'],
 ['gorgias','Gorgias','Support','gorgias.com','api_key'],
 ['front','Front','Support','api2.frontapp.com','bearer','/me'],
 ['shopify','Shopify','Commerce','myshopify.com','bearer'],
 ['bigcommerce','BigCommerce','Commerce','api.bigcommerce.com','bearer'],
 ['woocommerce','WooCommerce','Commerce','woocommerce.com','api_key'],
 ['square','Square','Commerce','connect.squareup.com','bearer','/v2/locations'],
 ['stripe','Stripe','Commerce','api.stripe.com','bearer','/v1/account'],
 ['paypal','PayPal','Commerce','api-m.paypal.com','bearer'],
 ['quickbooks','QuickBooks Online','Finance','quickbooks.api.intuit.com','bearer'],
 ['xero','Xero','Finance','api.xero.com','bearer','/api.xro/2.0/Organisation'],
 ['wave','Wave','Finance','gql.waveapps.com','bearer'],
 ['bill','BILL','Finance','api.bill.com','bearer'],
 ['gusto','Gusto','Human Resources','api.gusto.com','bearer'],
 ['bamboohr','BambooHR','Human Resources','api.bamboohr.com','api_key'],
 ['deel','Deel','Human Resources','api.letsdeel.com','bearer'],
 ['rippling','Rippling','Human Resources','api.rippling.com','bearer'],
 ['workday','Workday','Human Resources','workday.com','bearer'],
 ['harvest','Harvest','Time','api.harvestapp.com','bearer','/v2/users/me'],
 ['toggl','Toggl','Time','api.track.toggl.com','bearer'],
 ['clockify','Clockify','Time','api.clockify.me','api_key'],
 ['calendly','Calendly','Scheduling','api.calendly.com','bearer','/users/me'],
 ['acuity','Acuity','Scheduling','acuityscheduling.com','api_key'],
 ['zoom','Zoom','Meetings','api.zoom.us','bearer','/v2/users/me'],
 ['webex','Webex','Meetings','webexapis.com','bearer','/v1/people/me'],
 ['twilio','Twilio','Communications','api.twilio.com','api_key'],
 ['vonage','Vonage','Communications','api.nexmo.com','api_key'],
 ['typeform','Typeform','Forms','api.typeform.com','bearer','/me'],
 ['jotform','Jotform','Forms','api.jotform.com','api_key'],
 ['docusign','DocuSign','Documents','demo.docusign.net','bearer'],
 ['pandadoc','PandaDoc','Documents','api.pandadoc.com','bearer'],
 ['dropbox-sign','Dropbox Sign','Documents','api.hellosign.com','api_key'],
 ['openai','OpenAI API','Artificial Intelligence','api.openai.com','bearer','/v1/models'],
 ['anthropic','Anthropic API','Artificial Intelligence','api.anthropic.com','api_key'],
 ['cohere','Cohere','Artificial Intelligence','api.cohere.com','bearer'],
 ['fireworks','Fireworks AI','Artificial Intelligence','api.fireworks.ai','bearer']
];
const instanceHosts=new Set(['salesforce','freshsales','mailchimp','postmark','mailgun','supabase','snowflake','databricks','confluence','jira','zendesk','freshdesk','gorgias','shopify','woocommerce','quickbooks','bamboohr','workday','docusign']);
export const APP_CATALOG=Object.freeze(records.map(([id,name,category,hostname,auth_type,probe_path])=>Object.freeze({
 id,name,category,hostname,auth_type,status:'requires_credentials',requires_instance_host:instanceHosts.has(id),
 ...(probe_path?{probe_path}:{}),
 setup:'Provider-issued API token required; OAuth enrollment and scopes are not automated.'
})));
const lookup=new Map(APP_CATALOG.map(x=>[x.id,x]));
if(lookup.size!==APP_CATALOG.length)throw Error('Duplicate app catalog IDs');
export const getAppDefinition=id=>lookup.get(id)||null;
export function getCatalog({search='',category=''}={}){
 const term=String(search||'').trim().toLowerCase().slice(0,80),group=String(category||'').trim().toLowerCase();
 return APP_CATALOG.filter(x=>(!group||x.category.toLowerCase()===group)&&
  (!term||(x.id+' '+x.name+' '+x.category).toLowerCase().includes(term)));
}
export function resolveAppHost(app,host){
 if(!app)throw Error('Unknown integration');
 if(!app.requires_instance_host){
  if(host!==undefined&&host!==app.hostname)throw Error('Provider hostname cannot be overridden');
  return app.hostname;
 }
 const val=String(host||'').trim().toLowerCase();
 if(val.length>253||!/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(val))throw Error('Valid provider instance hostname required');
 const suffix={
  salesforce:'.salesforce.com',freshsales:'.freshsales.io',mailchimp:'.api.mailchimp.com',
  postmark:'.postmarkapp.com',mailgun:'.mailgun.net',supabase:'.supabase.co',
  snowflake:'.snowflakecomputing.com',databricks:'.azuredatabricks.net',
  confluence:'.atlassian.net',jira:'.atlassian.net',zendesk:'.zendesk.com',
  freshdesk:'.freshdesk.com',gorgias:'.gorgias.com',shopify:'.myshopify.com',
  woocommerce:'.com',quickbooks:'.intuit.com',bamboohr:'.bamboohr.com',
  workday:'.workday.com',docusign:'.docusign.net'
 }[app.id];
 if(!suffix||!val.endsWith(suffix)||val===suffix.slice(1))throw Error('Unapproved provider instance');
 return val;
}