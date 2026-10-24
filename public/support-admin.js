(() => {
 'use strict';
 const id=x=>document.getElementById(x);
 const state={token:'',workspace:'',selected:null};
 const feedback=message=>{id('feedback').textContent=message;};
 function node(tag,text,className){
  const x=document.createElement(tag);if(text!==undefined)x.textContent=String(text);if(className)x.className=className;return x;
 }
 async function api(path,{method='GET',body}={}){
  const separator=path.includes('?')?'&':'?';
  const res=await fetch('/api/support/'+path+separator+'workspace='+encodeURIComponent(state.workspace),{
   method,headers:{authorization:'Bearer '+state.token,...(body?{'content-type':'application/json'}:{})},
   body:body?JSON.stringify(body):undefined});
  const data=await res.json();
  if(!res.ok)throw Error(data.error||'Request unsuccessful');
  return data;
 }
 async function loadMetrics(){
  const m=await api('metrics');const host=id('metrics');host.replaceChildren();
  for(const [label,value] of [['Total tickets',m.total],['Open',m.open],['Needs attention',m.pending],['Resolved',m.resolved],['Automated answers',m.automatedResponses]]){
   const box=node('div',undefined,'kpi');box.append(node('span',label),node('strong',value));host.append(box);
  }
 }
 async function loadTickets(){
  const query=id('ticketFilter').value;
  const list=await api('tickets'+(query?'?status='+encodeURIComponent(query):''));
  const host=id('tickets');host.replaceChildren();
  for(const t of list.tickets){
   const button=node('button',undefined,'ticket-item'+(state.selected===t.id?' active':''));
   button.type='button';button.append(node('strong',t.name||t.email||'Anonymous customer'),node('small',t.status+' · '+t.priority),node('small',t.subject));
   button.addEventListener('click',()=>selectTicket(t.id).catch(e=>feedback(e.message)));
   host.append(button);
  }
  if(!list.tickets.length)host.append(node('p','No tickets in this view.'));
 }
 async function selectTicket(ticketId){
  state.selected=ticketId;const {ticket,messages}=await api('tickets/'+ticketId);
  id('ticketTitle').textContent=ticket.subject;
  const host=id('ticketHistory');host.replaceChildren();
  for(const m of messages){const row=node('div',undefined,'message-item');row.append(node('strong',m.sender),node('div',m.body));host.append(row);}
  id('ticketStatus').value=ticket.status;id('ticketPriority').value=ticket.priority;id('ticketAssignee').value=ticket.assignedTo;
  id('ticketControls').classList.remove('hidden');id('replyForm').classList.remove('hidden');
  loadTickets().catch(e=>feedback(e.message));
 }
 async function loadArticles(){
  const data=await api('articles');const host=id('articles');host.replaceChildren();
  for(const item of data.articles){
   const box=node('div',undefined,'article');box.append(node('strong',item.question),node('small',item.locale+(item.active?' · Published':' · Hidden')),node('p',item.answer));
   const remove=node('button','Delete article');remove.type='button';
   remove.addEventListener('click',async()=>{
    if(!confirm('Delete this approved answer?'))return;
    try{await api('articles/'+item.id,{method:'DELETE'});await loadArticles();feedback('Article deleted.');}catch(e){feedback(e.message);}
   });
   box.append(remove);host.append(box);
  }
  if(!data.articles.length)host.append(node('p','No knowledge articles published yet.'));
 }
 async function loadSettings(){
  const c=await api('settings');
  id('businessNameInput').value=c.businessName;id('greetingInput').value=c.greeting;
  id('businessHoursInput').value=c.businessHours;id('defaultLocaleInput').value=c.defaultLocale;
  id('brandColorInput').value=c.brandColor;
 }
 async function refresh(){
  await Promise.all([loadMetrics(),loadTickets(),loadArticles(),loadSettings()]);
 }
 id('connectForm').addEventListener('submit',async event=>{
  event.preventDefault();state.workspace=id('workspace').value.trim();state.token=id('adminToken').value.trim();
  try{
   await refresh();
   id('adminToken').value='';
   id('connectPanel').classList.add('hidden');id('console').classList.remove('hidden');
   id('workspaceLabel').textContent='Workspace: '+state.workspace;
   id('supportPageLink').href='/support?workspace='+encodeURIComponent(state.workspace);
   feedback('Support workspace connected.');
  }catch(e){state.token='';feedback(e.message);}
 });
 id('refreshButton').addEventListener('click',()=>refresh().then(()=>feedback('Support data refreshed.')).catch(e=>feedback(e.message)));
 id('ticketFilter').addEventListener('change',()=>loadTickets().catch(e=>feedback(e.message)));
 id('ticketControls').addEventListener('submit',async event=>{
  event.preventDefault();if(!state.selected)return;
  try{await api('tickets/'+state.selected,{method:'PATCH',body:{status:id('ticketStatus').value,priority:id('ticketPriority').value,assignedTo:id('ticketAssignee').value}});await selectTicket(state.selected);await loadMetrics();feedback('Ticket updated.');}catch(e){feedback(e.message);}
 });
 id('replyForm').addEventListener('submit',async event=>{
  event.preventDefault();if(!state.selected)return;
  try{await api('tickets/'+state.selected+'/replies',{method:'POST',body:{message:id('agentReply').value}});id('agentReply').value='';await selectTicket(state.selected);await loadMetrics();feedback('Human reply saved.');}catch(e){feedback(e.message);}
 });
 id('articleForm').addEventListener('submit',async event=>{
  event.preventDefault();
  try{await api('articles',{method:'POST',body:{question:id('articleQuestion').value,answer:id('articleAnswer').value,locale:id('articleLocale').value}});id('articleForm').reset();await loadArticles();feedback('Approved answer published.');}catch(e){feedback(e.message);}
 });
 id('settingsForm').addEventListener('submit',async event=>{
  event.preventDefault();
  try{await api('settings',{method:'PATCH',body:{businessName:id('businessNameInput').value,greeting:id('greetingInput').value,businessHours:id('businessHoursInput').value,defaultLocale:id('defaultLocaleInput').value,brandColor:id('brandColorInput').value}});feedback('Customer-facing settings saved.');}catch(e){feedback(e.message);}
 });
 id('privacyForm').addEventListener('submit',async event=>{
  event.preventDefault();
  const action=event.submitter?.value||'export',email=id('privacyEmail').value.trim();
  if(action==='erase'&&!confirm('Permanently delete all support tickets and messages for '+email+'?'))return;
  try{
   const result=await api('privacy/'+action,{method:'POST',body:{email}});
   id('privacyResult').textContent=JSON.stringify(result,null,2);
   await loadTickets();await loadMetrics();feedback(action==='erase'?'Support records erased.':'Support records exported to this page.');
  }catch(e){feedback(e.message);}
 });
 document.querySelectorAll('[data-section]').forEach(tab=>tab.addEventListener('click',()=>{
  const section=tab.dataset.section;
  document.querySelectorAll('[data-section]').forEach(x=>x.classList.toggle('active',x===tab));
  document.querySelectorAll('.section').forEach(x=>x.classList.toggle('hidden',x.id!=='section-'+section));
 }));
})();
