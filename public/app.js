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
 const url=path+(path.includes('?')?'&':'?')+'workspace='+encodeURIComponent(workspace)+'&release=recovery-11';
 const response=await fetch(url,{cache:'no-store',method,headers:{...(S.public?{}:{authorization:'Bearer '+token}),...(payload!==undefined?{'content-type':'application/json'}:{})},body:payload===undefined?undefined:JSON.stringify(payload)});
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
 await loadRecoveryEngine();
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
 for(const app of apps){
  const disclosure=node('details');disclosure.append(node('summary','Set up '+app.name));
  const inputs={};
  for(const f of app.fields||[{key:'token',label:'Provider API token',secret:true}]){const label=node('label',f.label),input=node('input',undefined,'field');input.type=f.secret?'password':'text';input.autocomplete='off';label.append(input);disclosure.append(label);inputs[f.key]=input;}
  let host;
  if(app.requires_instance_host){host=node('input',undefined,'field');host.placeholder='Your instance hostname';disclosure.append(host);}
  disclosure.append(btn('Connect',async()=>{try{await api('/api/growth/integrations/connect','POST',{provider_id:app.id,credentials:Object.fromEntries(Object.entries(inputs).map(([k,input])=>[k,input.value])),...(host?{host:host.value}:{})});for(const input of Object.values(inputs))input.value='';await loadApps();}catch(e){notice(e);}},'primary'));
  $('appCatalog').append(line(app.name,app.category+' · Requires configuration',[disclosure]));
 }
 $('connectedApps').replaceChildren();if(!connections.length)blank('connectedApps','No connected services.');
 for(const c of connections)$('connectedApps').append(line(c.name,c.host+' · '+c.status,[btn('Update credentials',async()=>{const app=apps.find(a=>a.id===c.provider_id)|| (await api('/api/growth/integrations/catalog')).find(a=>a.id===c.provider_id);if(!app)return;const form=node('div');const values={};for(const f of app.fields){const label=node('label',f.label),input=node('input',undefined,'field');input.type=f.secret?'password':'text';input.autocomplete='off';label.append(input);form.append(label);values[f.key]=input;}form.append(btn('Save credentials',async()=>{try{await api('/api/growth/connections/'+c.id,'PATCH',{credentials:Object.fromEntries(Object.entries(values).map(([k,v])=>[k,v.value]))});await loadApps();}catch(e){notice(e);}},'primary'));$('connectedApps').prepend(form);}),btn('Use in workflow',async()=>{try{const out=await api('/api/growth/integrations/'+c.id+'/workflow','POST',{});show('studio');alert('Created '+out.name+'. Open it in Workflow Studio to choose the data or action you need.');}catch(e){notice(e);}}),btn('Verify',async()=>{try{await api('/api/growth/integrations/'+c.id+'/test','POST',{});await loadApps();}catch(e){notice(e);}}),btn('Disconnect',async()=>{if(!confirm('Disconnect '+c.name+'?'))return;try{await api('/api/growth/connections/'+c.id,'DELETE');await loadApps();}catch(e){notice(e);}})]));
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
 const configuration=await api('/api/integrations/settings');
 $('serviceSettings').replaceChildren();
 for(const field of configuration.fields){const label=node('label',field.label),input=node('input',undefined,'field');input.type=field.secret?'password':'text';input.autocomplete='off';input.dataset.setting=field.name;input.value=field.value;input.placeholder=field.secret&&field.configured?'Saved · leave blank to keep':'';label.append(input);$('serviceSettings').append(label);}
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
  const res=await fetch('/api/dashboard-config?release=recovery-11',{cache:'no-store'});
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
 const summary=await api('/api/advanced/summary');
 const keys=['workflows','privacy','plans','billing','audit','history','maintenance','connections'];
 const val=i=>summary[keys[i]]??null;
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

$('saveServices').addEventListener('click',async()=>{try{const values={};for(const input of document.querySelectorAll('[data-setting]'))if(input.value)values[input.dataset.setting]=input.value;await api('/api/integrations/settings','POST',{values});txt('serviceSettingsStatus','Saved. Connected features use these settings immediately.');await loadSettings();}catch(e){txt('serviceSettingsStatus',e.message);}});

async function loadRecoveryEngine(){
 const [policy,cases,report,deliveries,invoices,readiness]=await Promise.all(['settings','cases','report','deliveries','invoices','readiness'].map(p=>api('/api/recovery/engine/'+p)));
 const f=$('recoveryPolicyForm');for(const key of ['copy_mode','experiment','holdout_percent','window_days','min_gap_hours'])f.elements[key].value=policy.settings[key];
 f.elements.enabled.checked=policy.settings.enabled;for(const [i,key]of ['first','second','third'].entries())f.elements[key].value=policy.settings.steps[i]?.delay_hours||[2,24,48][i];
 txt('recoveryEngineStatus',policy.settings.enabled?'Automatic follow-ups enabled. Consent, holdouts and frequency limits apply.':'Automatic follow-ups paused. Review cases and configure your sequence.');
 $('recoveryEngineStatus').append(document.createTextNode(' Setup: '+['email','sms','ai','stripe','unsubscribe'].map(k=>k+' '+(readiness[k]?'configured':'not configured')).join(' · ')));
 $('recoveryCaseList').replaceChildren();if(!cases.cases.length)blank('recoveryCaseList','No customer signals yet. Add a consented contact and a cart, checkout or inquiry event.');
 for(const c of cases.cases){const actions=[btn('Preview & evidence',async()=>{try{const d=await api('/api/recovery/engine/cases/'+c.id+'/preview');txt('recoveryPreview',(d.proposed_copy?'Proposed copy ('+d.proposed_copy.mode+', '+d.proposed_copy.status+'):\n'+d.proposed_copy.subject+'\n'+d.proposed_copy.body+'\n\nDefault sequence copy:\n':'')+d.email.subject+'\n\n'+d.email.body+'\n\nSMS: '+d.sms.body+'\n\nEvidence: '+JSON.stringify(c.evidence,null,2));}catch(e){notice(e);}})];
  if(c.status==='active'&&c.arm==='treatment'){
   actions.push(btn('Draft with AI',async()=>{try{const r=await api('/api/recovery/engine/cases/'+c.id+'/draft','POST',{});txt('recoveryPreview','REVIEW REQUIRED · '+r.draft.mode+'\n'+r.draft.subject+'\n\n'+r.draft.body+'\n\nEvidence: '+JSON.stringify(r.draft.evidence,null,2));}catch(e){notice(e);}}));
   actions.push(btn('Review & approve draft',async()=>{try{const r=await api('/api/recovery/engine/cases/'+c.id+'/preview');if(!r.proposed_copy)throw Error('Generate a draft first.');txt('recoveryPreview',r.proposed_copy.subject+'\n\n'+r.proposed_copy.body+'\n\nEvidence: '+JSON.stringify(c.evidence,null,2));if(!confirm('Approve this email for scheduled follow-ups?\n\n'+r.proposed_copy.subject+'\n\n'+r.proposed_copy.body))return;await api('/api/recovery/engine/cases/'+c.id+'/approve','POST',{confirm:true});txt('recoveryEngineStatus','Draft approved. Sending still follows consent, timing and holdout rules.');}catch(e){notice(e);}}));
  }
  if(c.status==='active'){actions.push(btn('Stop follow-ups',async()=>{try{await api('/api/recovery/engine/cases/'+c.id+'/stop','POST',{});await loadRecoveryEngine();}catch(e){notice(e);}}));if(c.arm==='treatment')actions.push(btn('Send due message',async()=>{if(!confirm('Send the next due, consented message for '+c.customer_id+'?'))return;try{const r=await api('/api/recovery/engine/cases/'+c.id+'/send','POST',{confirm:true});await loadRecoveryEngine();txt('recoveryEngineStatus',r.accepted?'Provider accepted message.':r.review_required?'Delivery unknown. Check your provider; no automatic resend.':'Message not sent: '+r.skipped);}catch(e){notice(e);}}));}
  $('recoveryCaseList').append(line(c.customer_id+' · '+c.kind+' · Priority '+c.score,(c.amount_cents/100).toFixed(2)+' '+c.currency+' opportunity value',actions,c.status+' · '+c.arm+' · '+c.experiment+' · Copy '+c.variant));
 }
 $('recoveryLift').replaceChildren();if(!report.cohorts.length)blank('recoveryLift','Experiments will appear after the first customer signal.');
 for(const g of report.cohorts){const mature=g.treatment.mature+g.holdout.mature;const lift=g.incremental_revenue_cents===null?'Awaiting mature treatment and holdout groups':(g.incremental_revenue_cents/100).toFixed(2)+' '+g.currency+' estimated incremental revenue';
  $('recoveryLift').append(line(g.experiment+' · '+g.currency,lift,[],`${mature} mature / ${g.treatment.enrolled+g.holdout.enrolled} enrolled · Treatment ${g.treatment.conversions}/${g.treatment.mature} converted · Holdout ${g.holdout.conversions}/${g.holdout.mature} · ${g.window_days}-day window`));
  const a=g.variants.A,b=g.variants.B;const note=g.copy_comparison.status==='insufficient_data'?'More mature customers and conversions needed before choosing a copy winner.':'Exploratory copy comparison: '+g.copy_comparison.status+'. Choose A or B in a new experiment; repeated looks are not confirmatory evidence.';
  $('recoveryLift').append(line('Copy comparison',`A: ${a.conversions}/${a.mature} · B: ${b.conversions}/${b.mature}`,[],note));
 }
 $('recoveryDeliveryList').replaceChildren();if(!deliveries.deliveries.length)blank('recoveryDeliveryList','No recovery messages attempted.');for(const d of deliveries.deliveries.slice(0,20))$('recoveryDeliveryList').append(line(d.channel+' · '+d.status,d.subject||'Channel skipped',[],new Date(d.created_at).toLocaleString()));
 $('recoveryInvoiceList').replaceChildren();if(!invoices.invoices.length)blank('recoveryInvoiceList','Connect Stripe recovery access, then sync failed invoices.');for(const i of invoices.invoices){const actions=[btn('Refresh invoice',async()=>{try{await api('/api/recovery/engine/invoices/sync','POST',{invoice_id:i.id});await loadRecoveryEngine();}catch(e){notice(e);}})];const row=line(i.id+' · '+i.status,(i.amount_cents/100).toFixed(2)+' '+i.currency+' remaining',actions,i.next_attempt?'Next provider retry: '+new Date(i.next_attempt).toLocaleString():'No next retry reported; check Stripe settings or payment method.');if(i.hosted_url){const link=node('a','Open secure invoice ↗','secondary');link.href=i.hosted_url;link.target='_blank';link.rel='noopener noreferrer';row.append(link);}$('recoveryInvoiceList').append(row);}
}
$('refreshRecoveryEngine').addEventListener('click',()=>loadRecoveryEngine().catch(notice));
$('recoveryPolicyForm').addEventListener('submit',async e=>{e.preventDefault();const f=new FormData(e.currentTarget);try{await api('/api/recovery/engine/settings','POST',{copy_mode:f.get('copy_mode'),enabled:f.has('enabled'),experiment:f.get('experiment'),holdout_percent:Number(f.get('holdout_percent')),window_days:Number(f.get('window_days')),min_gap_hours:Number(f.get('min_gap_hours')),max_messages:3,steps:['first','second','third'].map((k,i)=>({channel:i===2?'sms':'email',delay_hours:Number(f.get(k))}))});await loadRecoveryEngine();}catch(err){notice(err);}});
$('recoverySignalForm').addEventListener('submit',async e=>{e.preventDefault();const f=new FormData(e.currentTarget);try{await api('/api/recovery/engine/contacts','POST',{customer_id:f.get('customer_id'),email:f.get('email'),phone:f.get('phone'),email_consent:f.has('email_consent'),sms_consent:f.has('sms_consent'),consent_source:f.get('consent_source')});await api('/api/recovery/engine/signals','POST',{id:f.get('id'),customer_id:f.get('customer_id'),type:f.get('type'),amount_cents:Number(f.get('amount_cents')),currency:f.get('currency'),return_url:f.get('return_url'),evidence:f.get('evidence')});await loadRecoveryEngine();}catch(err){notice(err);}});
$('recoveryOutcomeForm').addEventListener('submit',async e=>{e.preventDefault();const f=new FormData(e.currentTarget);try{await api('/api/recovery/engine/signals','POST',{id:f.get('id'),customer_id:f.get('customer_id'),type:f.get('type'),amount_cents:Number(f.get('amount_cents')),currency:f.get('currency')});await loadRecoveryEngine();}catch(err){notice(err);}});
$('syncRecoveryInvoices').addEventListener('click',async()=>{try{const r=await api('/api/recovery/engine/invoices/sync','POST',{});await loadRecoveryEngine();txt('recoveryEngineStatus',`Synced ${r.synced} failed invoices.`+(r.note?' '+r.note:''));}catch(e){notice(e);}});

async function loadGrowthAgent(){
 const [settingsResult,planResult]=await Promise.all([api('/api/growth-agent/settings'),api('/api/growth-agent/plan')]);
 const s=settingsResult.settings,p=planResult.plan;
 $('growthAgentObjective').value=s.objective;
 $('growthAgentDays').value=String(s.reporting_days);
 $('growthAgentEnabled').checked=s.enabled;
 $('growthAgentEnabled').disabled=S.public;$('saveGrowthAgent').disabled=S.public;$('runGrowthAgent').disabled=S.public;
 $('growthAgentPlan').replaceChildren();
 $('growthAgentSegments').replaceChildren();
 if(!p.actions.length)blank('growthAgentPlan','No actions available yet.');
 for(const a of p.actions){
  const note=a.area+' · '+a.priority.toUpperCase()+' priority · '+a.automation.replaceAll('_',' ');
  $('growthAgentPlan').append(line(a.title,a.reason+' Next: '+a.next_step,[],note));
 }
 const seg=p.customer_segments||{};
 const segmentItems=[['High-value customers',seg.high_value?.count||0,'Top 10% of observed purchasers by recorded revenue; descriptive only.'],['Repeat buyers',seg.repeat_buyers?.count||0,'At least two purchase events in the reporting window.'],['High-intent, no recent purchase',seg.high_intent_no_recent_purchase?.count||0,'Cart/checkout event in the last 7 days without a purchase in that period.'],['Leads without purchases',seg.lead_no_purchase?.count||0,'Lead events and no purchase event in the reporting window.'],['Lapsed buyers',seg.lapsed_buyers?.count||0,'A recorded purchase in the window, with last purchase over 30 days ago.']];
 for(const [name,count,note] of segmentItems)$('growthAgentSegments').append(line(name,String(count)+' customer(s)',[],note));
 txt('growthAgentStatus',S.public?'Read-only public dashboard. An administrator must connect a private workspace to change settings or run guarded actions.':`Reviewed ${p.window_days}-day window: ${p.metrics.visits} visits, ${p.metrics.purchases} purchases, ${money(p.metrics.revenue)} recorded revenue. Recommendations are directional and require validation.`);
}
$('refreshGrowthAgent').addEventListener('click',()=>loadGrowthAgent().catch(notice));
$('saveGrowthAgent').addEventListener('click',async()=>{
 try{
  const result=await api('/api/growth-agent/settings','POST',{enabled:$('growthAgentEnabled').checked,objective:$('growthAgentObjective').value,reporting_days:Number($('growthAgentDays').value)});
  txt('growthAgentStatus',result.settings.enabled?'Guarded recovery processing enabled. External marketing, pricing and campaign changes remain review-gated.':'Growth agent saved in review-only mode.');
  await loadGrowthAgent();
 }catch(e){notice(e);}
});
$('runGrowthAgent').addEventListener('click',async()=>{
 try{
  const result=await api('/api/growth-agent/run','POST',{});
  await loadGrowthAgent();
  txt('growthAgentStatus',result.note+` Recovery messages accepted by providers: ${result.recovery_processed}. Accepted does not mean delivered.`);
 }catch(e){notice(e);}
});

async function loadCatalog(){
 const [productsResult,recommendationsResult,pricingResult]=await Promise.all([api('/api/catalog/products'),api('/api/catalog/recommendations'),api('/api/catalog/pricing')]);
 $('catalogProducts').replaceChildren();if(!productsResult.products.length)blank('catalogProducts','Add products to start measuring product performance.');
 for(const p of productsResult.products){
  const priceText=money(p.price_cents/100);
  const detail=priceText+' · '+p.views+' views · '+p.carts+' carts · '+p.purchases+' purchases;
  const margin=p.gross_margin_percent===null?'Unit cost not supplied':p.gross_margin_percent+'% gross margin';
  $('catalogProducts').append(line(p.title+' · '+p.id,detail,[],margin));
 }
 $('catalogRecommendations').replaceChildren();if(!recommendationsResult.recommendations.length)blank('catalogRecommendations','Record consented customer-linked purchases or aggregate purchases.');
 for(const p of recommendationsResult.recommendations)$('catalogRecommendations').append(line(p.title,p.reason,[], 'Score '+p.recommendation_score+' · '+money(p.price_cents/100)));
 $('catalogPricing').replaceChildren();if(!pricingResult.recommendations.length)blank('catalogPricing','No pricing alerts from the recorded product data.');
 for(const p of pricingResult.recommendations)$('catalogPricing').append(line(p.title,p.reason+' '+p.action,[],p.suggested_price_floor_cents===null||p.suggested_price_floor_cents===undefined?'Review recommendation': 'Suggested test floor: '+money(p.suggested_price_floor_cents/100)));
 txt('catalogStatus','Loaded '+productsResult.products.length+' products. Recommendations and pricing alerts are based on recorded events, not guaranteed outcomes.');
}
$('refreshCatalog').addEventListener('click',()=>loadCatalog().catch(notice));
$('productForm').addEventListener('submit',async e=>{
 e.preventDefault();const f=new FormData(e.currentTarget);
 try{
  await api('/api/catalog/products','POST',{id:f.get('id'),title:f.get('title'),price_cents:Math.round(Number(f.get('price'))*100),cost_cents:f.get('cost')===''?null:Math.round(Number(f.get('cost'))*100),inventory:f.get('inventory')===''?null:Number(f.get('inventory')),category:f.get('category'),url:f.get('url'),currency:'USD'});
  await loadCatalog();e.currentTarget.reset();
 }catch(err){notice(err);}
});
$('catalogEventForm').addEventListener('submit',async e=>{
 e.preventDefault();const f=new FormData(e.currentTarget),customer=f.get('customer_id');
 try{
  await api('/api/catalog/events','POST',{event_id:f.get('event_id'),product_id:f.get('product_id'),type:f.get('type'),...(customer?{customer_id:customer,consent:f.has('consent')}:{})});
  await loadCatalog();e.currentTarget.reset();
 }catch(err){notice(err);}
});
