const $=id=>document.getElementById(id);
const S={view:'overview',connected:false,busy:false,metrics:null,templates:[],selectedOpportunity:null,public:false,publicWorkspace:'default'};
const txt=(id,v)=>$(id).textContent=String(v??'—');
const node=(tag,value,cls='')=>{const el=document.createElement(tag);el.className=cls;if(value!==undefined)el.textContent=String(value);return el;};
const btn=(title,fn,cls='secondary')=>{const el=node('button',title,cls);el.type='button';el.addEventListener('click',fn);return el;};
const blank=(id,message)=>$(id).replaceChildren(node('div',message,'empty'));
const line=(label,info,buttons=[],note='')=>{const el=node('div',undefined,'item'),main=node('div');main.append(node('h3',label),node('p',info));if(note)main.append(node('small',note));el.append(main);if(buttons.length){const actions=node('div',undefined,'actions');for(const b of buttons)actions.append(b);el.append(actions);}return el;};
function notice(err){alert(String(err?.message||err));}
function money(x){return new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(Number(x)||0);}
function identity(){return S.public?{workspace:S.publicWorkspace,token:''}:{workspace:$('workspace').value.trim(),token:$('token').value};}
async function api(path,method='GET',payload){
 const {workspace,token}=identity();if(!workspace||(!S.public&&!token))throw Error('Connect your workspace first.');
 const url=path+(path.includes('?')?'&':'?')+'workspace='+encodeURIComponent(workspace);
 const response=await fetch(url,{method,headers:{...(S.public?{}:{authorization:'Bearer '+token}),...(payload!==undefined?{'content-type':'application/json'}:{})},body:payload===undefined?undefined:JSON.stringify(payload)});
 let result;try{result=await response.json();}catch{throw Error('Invalid server response');}
 if(!response.ok)throw Error(result.error||'Request failed ('+response.status+')');return result;
}
function show(view){
 S.view=view;document.querySelectorAll('.view').forEach(x=>x.classList.toggle('hidden',x.id!=='view-'+view));
 document.querySelectorAll('.nav').forEach(x=>{x.classList.toggle('active',x.dataset.view===view);x.setAttribute('aria-current',x.dataset.view===view?'page':'false');});
 txt('currentView',({overview:'Overview',commerce:'Commerce',recovery:'Revenue recovery',automations:'Automations',apps:'Connected apps',advanced:'Advanced Controls',studio:'Workflow Studio',activity:'Activity & insights',settings:'Settings'})[view]);
 if(view==='studio')sendStudioAuth();if(!S.connected)return;
 const loads={recovery:loadRecovery,automations:loadAutomation,apps:loadApps,advanced:loadAdvanced,activity:loadActivity,settings:loadSettings};
 loads[view]?.().catch(notice);
}
function workspacePanel(open){if(!$('workspacePanel'))return;$('workspacePanel').classList.toggle('hidden',!open);$('toggleWorkspace')?.setAttribute('aria-expanded',String(open));}
function sendStudioAuth(){if(!S.connected)return;const frame=$('studioFrame');frame?.contentWindow?.postMessage({type:'aplus:auth',...identity()},location.origin);}
$('studioFrame').addEventListener('load',sendStudioAuth);
document.querySelectorAll('.nav').forEach(x=>x.addEventListener('click',()=>show(x.dataset.view)));
document.querySelectorAll('[data-go]').forEach(x=>x.addEventListener('click',()=>show(x.dataset.go)));
document.querySelectorAll('[data-action=openWorkspace]').forEach(x=>x.addEventListener('click',()=>workspacePanel(true)));
$('toggleWorkspace')?.addEventListener('click',()=>workspacePanel($('workspacePanel').classList.contains('hidden')));
$('hideWorkspace')?.addEventListener('click',()=>workspacePanel(false));
for(const id of ['workspace','token'])$(id)?.addEventListener('input',()=>{S.connected=false;S.metrics=null;txt('connectionIndicator','Connect workspace');txt('status','Connection changed. Reconnect to view data.');});
function renderCommerce(metrics){
 S.metrics=metrics;txt('commerceVisits',metrics.visits);txt('commerceCarts',metrics.carts);txt('commerceLeads',metrics.leads);
 const campaigns=Object.entries(metrics.byCampaign||{}).sort((a,b)=>b[1].revenue-a[1].revenue);
 $('commerceCampaigns').replaceChildren();if(!campaigns.length)blank('commerceCampaigns','No campaigns recorded.');
 for(const [name,v] of campaigns.slice(0,20))$('commerceCampaigns').append(line(name,money(v.revenue)+' attributed revenue · '+v.purchases+' orders',[],typeof v.roas==='number'?v.roas.toFixed(2)+'× indicative ROAS':''));
}
async function overview(){
 const {metrics,recommendations}=await api('/api/overview');S.connected=true;S.metrics=metrics;
 txt('connectionIndicator','Workspace connected');
 const mk=(name,value)=>{const item=node('div',undefined,'metric');item.append(node('span',name),node('strong',value));return item;};
 $('cards').replaceChildren(mk('Revenue*',money(metrics.revenue)),mk('Orders',metrics.purchases),mk('Conversion*',metrics.conversionRate===null?'—':metrics.conversionRate+'%'));
 txt('opportunity',recommendations?.[0]||'Keep measuring and experimenting.');
 $('recommendations').replaceChildren(...(recommendations||[]).map(x=>node('li',x)));
 $('campaigns').replaceChildren(...Object.entries(metrics.byCampaign||{}).slice(0,8).map(([name,c])=>line(name,c.purchases+' orders'+(typeof c.roas==='number'?' · '+c.roas.toFixed(2)+'× attributed ROAS':''))));
 renderCommerce(metrics);
 const extras=await Promise.allSettled([api('/api/recovery/overview'),api('/api/growth/overview')]);
 if(extras[0].status==='fulfilled')txt('overviewRecoveryCount',extras[0].value.analyzed);
 if(extras[1].status==='fulfilled')txt('overviewWorkflowCount',extras[1].value.active_workflows);
 return metrics;
}
$('load')?.addEventListener('click',async()=>{if(S.busy)return;S.busy=true;$('load').disabled=true;txt('status','Connecting…');try{await overview();workspacePanel(false);sendStudioAuth();txt('status','Connected.');}catch(e){txt('status',e.message);workspacePanel(true);}finally{S.busy=false;$('load').disabled=false;}});
$('refreshOverview').addEventListener('click',()=>overview().catch(notice));
$('advise').addEventListener('click',async()=>{if(S.busy)return;S.busy=true;$('advise').disabled=true;$('resultPanel').classList.remove('hidden');txt('advice','Preparing grounded recommendations…');try{const r=await api('/api/advice','POST',{objective:'Prioritize measurable commerce and customer growth.'});txt('advice',r.advice);}catch(e){txt('advice',e.message);}finally{S.busy=false;$('advise').disabled=false;}});
$('closeAdvice').addEventListener('click',()=>$('resultPanel').classList.add('hidden'));
$('spendForm').addEventListener('submit',async event=>{event.preventDefault();const f=new FormData(event.currentTarget);try{await api('/api/campaigns/spend','POST',{campaign:f.get('campaign'),date:f.get('date'),spend:Number(f.get('spend')),clicks:Number(f.get('clicks')||0),impressions:Number(f.get('impressions')||0)});await overview();alert('Campaign spend saved.');}catch(e){notice(e);}});
$('experimentForm').addEventListener('submit',async event=>{event.preventDefault();try{const id=new FormData(event.currentTarget).get('experimentId');const r=await api('/api/experiments','POST',{id});txt('experimentOutput','Experiment '+id+': '+r.status);}catch(e){txt('experimentOutput',e.message);}});
$('reportForm').addEventListener('submit',async event=>{event.preventDefault();try{const id=new FormData(event.currentTarget).get('reportId');const r=await api('/api/experiments/'+encodeURIComponent(id));txt('experimentOutput',JSON.stringify(r,null,2));}catch(e){txt('experimentOutput',e.message);}});
async function loadRecovery(){
 const [summary,sites,drafts,leads,routines]=await Promise.all([api('/api/recovery/overview'),api('/api/recovery/sites'),api('/api/recovery/outreach'),api('/api/recovery/leads'),api('/api/recovery/routines')]);
 txt('recoverySites',summary.analyzed);txt('recoveryLeads',summary.leads);txt('recoveryDrafts',summary.drafts);
 $('discoveryEnabled').checked=!!routines.routine.discover_enabled;
 $('routineEnabled').checked=!!routines.routine.enabled;$('routineHours').value=String(routines.routine.interval_hours||24);
 $('sitesList').replaceChildren();
 if(!sites.sites.length)blank('sitesList','Analyze a public website to discover opportunities.');
 for(const s of sites.sites){
  $('sitesList').append(line(s.title||s.website,s.analysis?.summary||s.website,
   [btn('Review',()=>txt('recoveryScanOutput',JSON.stringify(s.analysis||s.observation,null,2))),
   btn('Use in workflow',()=>{S.selectedOpportunity=s.analysis;show('automations');})],s.status+' · '+s.website));
 }
 $('outreachList').replaceChildren();if(!drafts.outreach.length)blank('outreachList','No outreach drafts.');
 for(const draft of drafts.outreach){
  const actions=[btn('Read draft',()=>txt('recoveryScanOutput','To: '+draft.recipient+'\nSubject: '+draft.subject+'\n\n'+draft.body))];
  if(draft.status==='draft')actions.push(btn('Confirm & send',async()=>{if(!confirm('Send this message to '+draft.recipient+'?'))return;try{await api('/api/recovery/outreach/'+draft.id+'/send','POST',{confirm:true});await loadRecovery();}catch(e){notice(e);}},'primary'));
  $('outreachList').append(line(draft.subject,draft.recipient,actions,draft.status));
 }
 $('leadList').replaceChildren();if(!leads.leads.length)blank('leadList','No leads yet.');
 for(const lead of leads.leads){
  const select=node('select',undefined,'field');select.setAttribute('aria-label','Status for '+lead.name);
  for(const name of ['new','contacted','qualified','won','closed']){const option=node('option',name);option.value=name;option.selected=name===lead.status;select.append(option);}
  select.addEventListener('change',async()=>{try{await api('/api/recovery/leads/'+lead.id+'/status','POST',{status:select.value});}catch(e){notice(e);}});
  $('leadList').append(line(lead.name,lead.email+' · '+lead.inquiry.slice(0,120),[select,btn('Draft reply',async()=>{try{const r=await api('/api/recovery/leads/'+lead.id+'/reply','POST',{business_name:identity().workspace});txt('recoveryScanOutput',r.draft);}catch(e){notice(e);}})],lead.status));
 }
}
$('scanForm').addEventListener('submit',async event=>{event.preventDefault();const button=event.currentTarget.querySelector('button');button.disabled=true;txt('recoveryScanOutput','Reviewing public website evidence…');try{const r=await api('/api/recovery/scan','POST',{website:new FormData(event.currentTarget).get('website')});txt('recoveryScanOutput',r.site.analysis?.summary||'Review complete.');await loadRecovery();}catch(e){txt('recoveryScanOutput',e.message);}finally{button.disabled=false;}});
$('refreshSites').addEventListener('click',()=>loadRecovery().catch(notice));
$('refreshOutreach').addEventListener('click',()=>loadRecovery().catch(notice));
$('saveRoutine').addEventListener('click',async()=>{try{await api('/api/recovery/routines','POST',{enabled:$('routineEnabled').checked,interval_hours:Number($('routineHours').value),discover:$('discoveryEnabled').checked});alert('Schedule saved.');}catch(e){notice(e);}});
$('leadForm').addEventListener('submit',async event=>{event.preventDefault();const f=new FormData(event.currentTarget);try{await api('/api/recovery/leads','POST',{name:f.get('name'),email:f.get('email'),inquiry:f.get('inquiry')});event.currentTarget.reset();await loadRecovery();}catch(e){notice(e);}});
async function loadAutomation(){
 const [overview,workflows,templates,approvals,knowledge,links]=await Promise.all([api('/api/growth/overview'),api('/api/growth/workflows'),api('/api/growth/templates'),api('/api/growth/approvals'),api('/api/growth/knowledge'),api('/api/orchestration/links')]);
 txt('autoActive',overview.active_workflows);txt('autoWorkflows',overview.workflows);txt('autoApprovals',approvals.length);
 $('triggerWorkflow').replaceChildren(node('option','Choose an automation'));
 for(const wf of workflows.filter(x=>x.enabled&&!x.allow_external)){
  const option=node('option',wf.name);option.value=wf.id;$('triggerWorkflow').append(option);
 }
 $('triggerList').replaceChildren();
 if(!links.links.length)blank('triggerList','No cross-platform triggers connected yet.');
 for(const link of links.links){
  const name=workflows.find(w=>w.id===link.workflow_id)?.name||'Missing workflow';
  $('triggerList').append(line(name,link.event,[btn('Disconnect',async()=>{
   if(!confirm('Remove this automatic trigger?'))return;
   try{await api('/api/orchestration/links/'+link.id,'DELETE');await loadAutomation();}catch(e){notice(e);}
  })]));
 }
 S.templates=templates;$('templates').replaceChildren(...templates.map((t,i)=>{const option=node('option',t.name);option.value=String(i);return option;}));
 $('workflowsList').replaceChildren();if(!workflows.length)blank('workflowsList','Create your first AI automation.');
 for(const wf of workflows){
  $('workflowsList').append(line(wf.name,(wf.enabled?'Active':'Paused')+' · '+(wf.trigger?.type||'manual'),
   [btn('Run',async()=>{try{const input={commerce:S.metrics?{revenue:S.metrics.revenue,orders:S.metrics.purchases,conversionRate:S.metrics.conversionRate}:null,opportunity:S.selectedOpportunity||null,request:'Review these signals and recommend next steps.'};const r=await api('/api/growth/workflows/'+wf.id+'/run','POST',{input});alert('Run queued: '+r.id);}catch(e){notice(e);}}),btn('Design',()=>show('studio'))],'Version '+(wf.revision||1)));
 }
 $('approvalList').replaceChildren();if(!approvals.length)blank('approvalList','No approvals pending.');
 for(const a of approvals)$('approvalList').append(line(a.step_id||'Approval',String(a.message||a.id).slice(0,140),[btn('Approve',()=>decision(a.id,'approve'),'primary'),btn('Reject',()=>decision(a.id,'reject'))]));
 $('knowledgeList').replaceChildren();if(!knowledge.length)blank('knowledgeList','Add reference documents to inform AI workflows.');
 for(const k of knowledge)$('knowledgeList').append(line(k.name,k.excerpt||'',[btn('Remove',async()=>{if(confirm('Remove source?'))try{await api('/api/growth/knowledge/'+k.id,'DELETE');await loadAutomation();}catch(e){notice(e);}})]));
}
async function decision(id,action){try{await api('/api/growth/approvals/'+id+'/'+action,'POST',{});await loadAutomation();}catch(e){notice(e);}}
$('saveTrigger').addEventListener('click',async()=>{
 const workflow_id=$('triggerWorkflow').value;
 if(!workflow_id)return alert('Choose an automation first.');
 try{await api('/api/orchestration/links','POST',{event:$('triggerEvent').value,workflow_id,enabled:true});await loadAutomation();}catch(e){notice(e);}
});
$('createTemplate').addEventListener('click',async()=>{const t=S.templates[Number($('templates').value)];if(!t)return;try{await api('/api/growth/workflows','POST',{name:$('workflowName').value.trim()||t.name,spec:t.spec,trigger:t.trigger,enabled:true,allow_external:false});await loadAutomation();}catch(e){notice(e);}});
$('generateBlueprint').addEventListener('click',async()=>{txt('blueprintOutput','Generating a reviewable workflow…');try{const r=await api('/api/growth/blueprints','POST',{goal:$('blueprintGoal').value.trim()});txt('blueprintOutput','Reviewable draft created: '+JSON.stringify(r).slice(0,850));}catch(e){txt('blueprintOutput',e.message);}});
$('refreshApprovals').addEventListener('click',()=>loadAutomation().catch(notice));
$('addKnowledge').addEventListener('click',async()=>{try{await api('/api/growth/knowledge','POST',{name:$('knowledgeName').value,content:$('knowledgeContent').value});$('knowledgeName').value='';$('knowledgeContent').value='';await loadAutomation();}catch(e){notice(e);}});
async function loadApps(){
 const [apps,connections]=await Promise.all([api('/api/growth/integrations/catalog?search='+encodeURIComponent($('appSearch').value)),api('/api/growth/connections')]);
 $('appCatalog').replaceChildren();if(!apps.length)blank('appCatalog','No integrations match your search.');
 for(const app of apps.slice(0,16)){
  const disclosure=node('details');disclosure.append(node('summary','Set up '+app.name));
  const input=node('input',undefined,'field');input.type='password';input.autocomplete='off';input.placeholder='Provider-issued API token';
  disclosure.append(input);let host;
  if(app.requires_instance_host){host=node('input',undefined,'field');host.placeholder='Your instance hostname';disclosure.append(host);}
  disclosure.append(btn('Connect',async()=>{try{await api('/api/growth/integrations/connect','POST',{provider_id:app.id,credential:input.value,...(host?{host:host.value}:{})});input.value='';await loadApps();}catch(e){notice(e);}},'primary'));
  $('appCatalog').append(line(app.name,app.category+' · Requires configuration',[disclosure]));
 }
 $('connectedApps').replaceChildren();if(!connections.length)blank('connectedApps','No connected services.');
 for(const c of connections)$('connectedApps').append(line(c.name,c.host+' · '+c.status,[btn('Verify',async()=>{try{await api('/api/growth/integrations/'+c.id+'/test','POST',{});await loadApps();}catch(e){notice(e);}}),btn('Disconnect',async()=>{if(!confirm('Disconnect '+c.name+'?'))return;try{await api('/api/growth/connections/'+c.id,'DELETE');await loadApps();}catch(e){notice(e);}})]));
}
$('appSearch').addEventListener('change',()=>{if(S.connected)loadApps().catch(notice);});
async function loadActivity(){
 const [insights,runs]=await Promise.all([api('/api/growth/insights'),api('/api/growth/runs')]);
 txt('insightCompleted',insights.completed);txt('insightFailed',insights.failed);txt('insightRate',insights.success_rate_percent===null?'—':insights.success_rate_percent+'%');
 $('runsList').replaceChildren();if(!runs.length)blank('runsList','No workflow executions yet.');
 for(const r of runs)$('runsList').append(line(r.workflow_id,r.status+(r.error?' · '+r.error:''),[btn('Details',async()=>{try{const result=await api('/api/growth/runs/'+r.id);alert(JSON.stringify(result,null,2).slice(0,2000));}catch(e){notice(e);}})],new Date(r.created_at).toLocaleString()));
}
$('refreshActivity').addEventListener('click',()=>loadActivity().catch(notice));
async function loadSettings(){
 const [billing,neon]=await Promise.allSettled([api('/api/growth/billing'),api('/api/neon/status')]);
 txt('billingState',billing.status==='fulfilled'?JSON.stringify(billing.value):billing.reason.message);
 if(neon.status==='rejected')txt('neonStatus',neon.reason.message);
 else if(neon.value.connected)txt('neonStatus','Connected to Neon · '+neon.value.events+' scoped events archived');
 else txt('neonStatus',neon.value.configured?'Neon unavailable · Check database connectivity':'Not connected · Add NEON_DATABASE_URL to hosting secrets');
}
$('billingRefresh').addEventListener('click',()=>loadSettings().catch(notice));
$('neonRefresh').addEventListener('click',()=>loadSettings().catch(notice));
async function start(){
 try{
  const res=await fetch('/api/dashboard-config',{cache:'no-store'});
  if(!res.ok)throw Error('Unable to load dashboard configuration');
  const config=await res.json();
  S.public=config.public===true;
  if(S.public){
   S.publicWorkspace=config.workspace||'default';
   try{await overview();sendStudioAuth();}catch(e){txt('connectionIndicator','Unavailable');console.error('Dashboard loading failed:',e.message);}
  }else workspacePanel(true);
 }catch(e){console.error('Dashboard startup failed:',e.message);workspacePanel(true);}
}
start();


// Advanced tools are grouped in one section to avoid burdening the main dashboard.
async function loadAdvanced(){
 const result=await Promise.allSettled([
  api('/api/growth/workflows'),api('/api/privacy/requests'),
  api('/api/growth/billing/plans'),api('/api/growth/billing'),
  api('/api/growth/audit'),api('/api/neon/history'),
  api('/api/growth/maintenance'),api('/api/integrations/status')
 ]);
 const val=i=>result[i].status==='fulfilled'?result[i].value:null;
 const provider=val(7);
 $('providerStatus').replaceChildren();
 if(!provider?.providers)blank('providerStatus','Provider status currently unavailable.');
 else {
  const titles={email:'Email & outreach',ai:'AI services',square:'Square payments',shopify:'Shopify commerce',neon:'Neon data'};
  const descriptions={configured:'Credentials configured · live provider verification required',connected:'Connected to database',configuration_incomplete:'Additional setup required',not_configured:'Not configured',unavailable:'Configured but unavailable'};
  for(const [key,name] of Object.entries(titles)){
   const state=provider.providers[key]||'not_configured';
   $('providerStatus').append(line(name,descriptions[state]||state));
  }
 }
 const workflows=val(0);
 const selector=$('workflowTransferId');selector.replaceChildren();
 const defaultOption=node('option','Choose a workflow');defaultOption.value='';selector.append(defaultOption);
 if(Array.isArray(workflows))for(const w of workflows){
  const option=node('option',w.name);option.value=w.id;selector.append(option);
 }
 const privacy=val(1);
 $('privacyRequests').replaceChildren();
 if(!privacy?.requests?.length)blank('privacyRequests',privacy?'No pending data requests.':'Data requests currently unavailable.');
 else for(const item of privacy.requests){
  const requestId=item.request_id||item.id;
  $('privacyRequests').append(line('Customer data request',String(requestId),[btn('Mark delivered',async()=>{
   if(!confirm('Have you already provided the requested data to the merchant/customer?'))return;
   try{await api('/api/privacy/requests/complete','POST',{requestId,deliveryConfirmed:true});await loadAdvanced();}
   catch(e){notice(e);}
  })]));
 }
 const plans=val(2);
 $('billingSelect').replaceChildren();
 const placeholder=node('option','Choose a plan');placeholder.value='';$('billingSelect').append(placeholder);
 if(Array.isArray(plans)&&plans.length){
  for(const plan of plans){const opt=node('option',plan.name||plan.id);opt.value=plan.id;$('billingSelect').append(opt);}
  txt('billingPlans',plans.length+' subscription plan'+(plans.length===1?'':'s')+' available.');
 }else txt('billingPlans','No paid subscription plan is configured.');
 const billing=val(3);
 if(billing)txt('billingActionStatus','Current status: '+(billing.status||'free')+(billing.plan?' · '+billing.plan:''));
 $('auditTrail').replaceChildren();
 const audits=val(4);
 if(!Array.isArray(audits)||!audits.length)blank('auditTrail','No recorded administrative actions.');
 else for(const a of audits.slice(0,30))$('auditTrail').append(line(String(a.action||'Activity'),String(a.target||'')+(a.actor?' · '+a.actor:''),[],a.created_at?new Date(a.created_at).toLocaleString():''));
 $('neonHistory').replaceChildren();
 const history=val(5);
 if(!history?.events?.length)blank('neonHistory',history?'No archived activity yet.':'Neon activity history is not available.');
 else for(const e of history.events.slice(0,30))$('neonHistory').append(line(e.kind||'Event',e.id||'',[],e.created_at?new Date(Number(e.created_at)).toLocaleString():''));
 const maintenance=val(6);
 txt('advancedBackup',maintenance?.automatic_backups?.enabled
  ?'Automatic snapshots are configured. Last successful backup: '+(maintenance.automatic_backups.last_success_ms?new Date(maintenance.automatic_backups.last_success_ms).toLocaleString():'Not yet completed')
  : 'Local backup automation is not enabled. Neon PostgreSQL retains the application state for this deployment.');
}
$('refreshAdvanced').addEventListener('click',()=>loadAdvanced().catch(notice));
$('refreshConnections').addEventListener('click',()=>loadAdvanced().catch(notice));
$('leadScoreForm').addEventListener('submit',async event=>{
 event.preventDefault();
 try{
  const events=[...new FormData(event.currentTarget).getAll('events')];
  const r=await api('/api/score','POST',{email:$('leadScoreEmail').value.trim(),events});
  txt('leadScoreResult','Buying-intent score: '+r.score+' / 100');
 }catch(e){txt('leadScoreResult',e.message);}
});
$('workflowExport').addEventListener('click',async()=>{
 const id=$('workflowTransferId').value;
 if(!id)return txt('workflowTransferStatus','Choose a workflow.');
 try{
  const exported=await api('/api/growth/workflows/'+encodeURIComponent(id)+'/export');
  $('workflowExportData').value=JSON.stringify(exported,null,2);
  txt('workflowTransferStatus','Workflow definition ready to copy.');
 }catch(e){txt('workflowTransferStatus',e.message);}
});
$('workflowImport').addEventListener('click',async()=>{
 let data;
 try{data=JSON.parse($('workflowExportData').value);}catch{return txt('workflowTransferStatus','Paste a valid workflow JSON definition.');}
 try{
  const r=await api('/api/growth/workflows/import','POST',data);
  txt('workflowTransferStatus','Imported '+r.name+'. Review and enable the disabled workflow when ready.');
  await loadAdvanced();
 }catch(e){txt('workflowTransferStatus',e.message);}
});
$('privacyExport').addEventListener('click',async()=>{
 const subjectId=$('privacySubject').value.trim();
 if(!subjectId)return txt('privacyResult','Enter the exact customer identifier.');
 try{
  const result=await api('/api/privacy/export','POST',{subjectId});
  txt('privacyResult',JSON.stringify(result,null,2));
 }catch(e){txt('privacyResult',e.message);}
});
$('privacyErase').addEventListener('click',async()=>{
 const subjectId=$('privacySubject').value.trim();
 if(!subjectId)return txt('privacyResult','Enter the exact customer identifier.');
 if(!confirm('Permanently erase records belonging to this customer? This cannot be undone.'))return;
 try{
  const result=await api('/api/privacy/erase','POST',{subjectId});
  txt('privacyResult','Customer erasure completed. Matching records deleted: '+result.deleted);
 }catch(e){txt('privacyResult',e.message);}
});
$('billingCheckout').addEventListener('click',async()=>{
 const plan=$('billingSelect').value;
 if(!plan)return txt('billingActionStatus','Choose a plan first.');
 try{
  const result=await api('/api/growth/billing/checkout','POST',{plan});
  if(!result.url)throw Error('Checkout link unavailable.');
  const target=new URL(result.url);
  if(target.protocol!=='https:')throw Error('Invalid checkout destination.');
  location.assign(target.href);
 }catch(e){txt('billingActionStatus',e.message);}
});
$('billingCancel').addEventListener('click',async()=>{
 if(!confirm('Cancel the active subscription?'))return;
 try{
  const result=await api('/api/growth/billing/cancel','POST',{});
  txt('billingActionStatus','Subscription cancellation status: '+result.status);
 }catch(e){txt('billingActionStatus',e.message);}
});
