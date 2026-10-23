// Self-contained, optional billing and integrations UI. Keeps the overview clean.
const $=selector=>document.querySelector(selector);
const create=(tag,className='',label='')=>{
 const element=document.createElement(tag);
 if(className)element.className=className;
 if(label)element.textContent=label;
 return element;
};
const errorMessage=e=>typeof e?.message==='string'?e.message:'Request failed';
async function request(path,method='GET',payload){
 const result=await fetch(path,{method,credentials:'same-origin',
  headers:{'content-type':'application/json'},
  ...(payload===undefined?{}:{body:JSON.stringify(payload)})});
 const body=await result.json().catch(()=>({error:'Invalid server response'}));
 if(!result.ok)throw Error(body.error||'Service unavailable');
 return body;
}
const state={catalog:[],connections:[],selected:null,loaded:false};
function status(where,message){where.replaceChildren(create('p','commerce-message',message));}
function control(name,action,id,primary=false){
 const button=create('button',primary?'btn primary small':'btn small',name);
 button.type='button';button.dataset.commerceAction=action;if(id)button.dataset.id=id;return button;
}
function appCard(app){
 const card=create('div','commerce-card'),label=create('div','commerce-label');
 label.append(create('strong','commerce-name',app.name),create('small','commerce-category',app.category));
 card.append(label,control('Connect','connect',app.id));
 return card;
}
function renderCatalog(){
 const query=$('#app-catalog-search').value.trim().toLowerCase();
 const found=state.catalog.filter(item=>(item.name+' '+item.id+' '+item.category).toLowerCase().includes(query));
 const region=$('#catalog-results');region.replaceChildren();
 for(const app of found.slice(0,query?16:12))region.append(appCard(app));
 if(!found.length)region.append(create('p','commerce-message','No matching apps.'));
 $('#catalog-count').textContent=state.catalog.length+' setup profiles';
}
function renderConnected(){
 const region=$('#catalog-connected');region.replaceChildren();
 const connected=state.connections.filter(c=>c.provider_id);
 if(!connected.length){region.append(create('p','commerce-message','No business apps configured yet.'));return;}
 for(const c of connected){
  const card=create('div','commerce-installed');
  const title=create('div','commerce-label');
  title.append(create('strong','commerce-name',c.name),create('small','commerce-category',c.host));
  const actions=create('div','row');
  const passed=c.status==='verified';
  actions.append(create('span',passed?'commerce-state verified':'commerce-state',passed?'Verified':'Configured'));
  const provider=state.catalog.find(p=>p.id===c.provider_id);
  if(!passed&&provider?.probe_path)actions.append(control('Verify','verify',c.id));
  actions.append(control('Remove','remove',c.id));
  card.append(title,actions);region.append(card);
 }
}
async function loadApps(){
 try{
  if(!state.loaded){
   state.catalog=await request('/api/integrations/catalog');state.loaded=true;
  }
  state.connections=await request('/api/connections');
  renderCatalog();renderConnected();
 }catch(e){status($('#catalog-results'),errorMessage(e));}
}
function selectApp(id){
 const app=state.catalog.find(item=>item.id===id);
 if(!app)return;
 state.selected=app;
 const pane=$('#catalog-connect-pane');
 $('#catalog-connect-heading').textContent='Connect '+app.name;
 $('#catalog-host-wrapper').classList.toggle('hidden',!app.requires_instance_host);
 $('#catalog-connect-host').required=Boolean(app.requires_instance_host);
 $('#catalog-connect-host').value='';
 $('#catalog-connect-secret').value='';
 pane.classList.remove('hidden');
 pane.scrollIntoView({behavior:'smooth',block:'nearest'});
 $('#catalog-connect-secret').focus();
}
$('#app-catalog-search').addEventListener('input',renderCatalog);
$('#catalog-connect-cancel').addEventListener('click',()=>{
 state.selected=null;$('#catalog-connect-pane').classList.add('hidden');
 $('#catalog-connect-form').reset();
});
$('#catalog-connect-form').addEventListener('submit',async e=>{
 e.preventDefault();if(!state.selected)return;
 const submit=e.target.querySelector('[type=submit]');submit.disabled=true;
 try{
  const payload={provider_id:state.selected.id,credential:$('#catalog-connect-secret').value};
  if(state.selected.requires_instance_host)payload.host=$('#catalog-connect-host').value.trim();
  await request('/api/integrations/connect','POST',payload);
  $('#catalog-connect-form').reset();$('#catalog-connect-pane').classList.add('hidden');
  state.selected=null;await loadApps();
 }catch(error){status($('#catalog-connected'),errorMessage(error));}
 finally{submit.disabled=false;}
});
$('#catalog-results').addEventListener('click',e=>{
 const button=e.target.closest('[data-commerce-action=connect]');
 if(button)selectApp(button.dataset.id);
});
$('#catalog-connected').addEventListener('click',async e=>{
 const button=e.target.closest('[data-commerce-action]');if(!button)return;
 const {commerceAction:action,id}=button.dataset;
 if(action==='remove'&&!confirm('Remove this app connection? Any automation using it may stop.'))return;
 button.disabled=true;
 try{
  if(action==='verify')await request('/api/integrations/'+id+'/test','POST',{});
  if(action==='remove')await request('/api/connections/'+id,'DELETE');
  await loadApps();
 }catch(error){status($('#catalog-connected'),errorMessage(error));}
 finally{button.disabled=false;}
});
async function loadBilling(){
 const info=$('#billing-status'),plans=$('#billing-plans');
 try{
  const [subscription,available]=await Promise.all([request('/api/billing'),request('/api/billing/plans')]);
  info.replaceChildren();
  const subscriptionCard=create('div','commerce-installed');
  const title=create('div','commerce-label');
  title.append(create('strong','commerce-name',subscription.plan||'Free workspace'),
   create('small','commerce-category','Subscription status: '+String(subscription.status||'free').replaceAll('_',' ')));
  subscriptionCard.append(title);
  if(['active','paused'].includes(subscription.status))subscriptionCard.append(control('Cancel renewal','cancel-billing'));
  info.append(subscriptionCard);
  plans.replaceChildren();
  if(!available.length){plans.append(create('p','commerce-message','Subscription plans have not been configured.'));return;}
  for(const tier of available){
   const card=create('div','commerce-plan'),cost='$'+(tier.amount_cents/100).toFixed(2)+'/month';
   card.append(create('strong','commerce-name',tier.name),create('p','commerce-price',cost),
    create('p','commerce-category','Recurring plan, managed through Square.'),
    control('Choose plan','choose-billing',tier.id,true));
   plans.append(card);
  }
 }catch(error){status(info,errorMessage(error));}
}
$('#billing-plans').addEventListener('click',async e=>{
 const button=e.target.closest('[data-commerce-action=choose-billing]');
 if(!button)return;
 button.disabled=true;
 try{
  const result=await request('/api/billing/checkout','POST',{plan:button.dataset.id});
  const url=new URL(result.url);
  if(url.protocol!=='https:'||!['square.link','sandbox.square.link','checkout.square.site','squareup.com','www.squareup.com'].includes(url.hostname))
   throw Error('Square checkout destination could not be verified');
  window.location.assign(url.href);
 }catch(error){status($('#billing-status'),errorMessage(error));button.disabled=false;}
});
$('#billing-status').addEventListener('click',async e=>{
 const button=e.target.closest('[data-commerce-action=cancel-billing]');
 if(!button||!confirm('Request cancellation of your recurring subscription?'))return;
 button.disabled=true;
 try{await request('/api/billing/cancel','POST',{});await loadBilling();}
 catch(error){status($('#billing-status'),errorMessage(error));button.disabled=false;}
});
document.addEventListener('click',e=>{
 const nav=e.target.closest('[data-nav]');
 if(!nav)return;
 if(nav.dataset.nav==='connections')void loadApps();
 if(nav.dataset.nav==='billing')void loadBilling();
});
