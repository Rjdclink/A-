(() => {
 'use strict';
 const id=x=>document.getElementById(x);
 const state={token:'',workspace:'',selected:null,role:'owner',macros:[]};
 const feedback=message=>{id('feedback').textContent=message;};
 function node(tag,text,className){
  const x=document.createElement(tag);if(text!==undefined)x.textContent=String(text);if(className)x.className=className;return x;
 }
 function fileMime(file){
  const extension=file.name.split('.').at(-1).toLowerCase();
  const mime={pdf:'application/pdf',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',txt:'text/plain',csv:'text/csv'}[extension];
  if(!mime)throw Error('Choose a PDF, PNG, JPG, TXT, or CSV file.');
  return mime;
 }
 async function prepareFile(file){
  if(!file||!file.size||file.size>1024*1024)throw Error('Choose a nonempty file under 1 MiB.');
  const bytes=new Uint8Array(await file.arrayBuffer());
  const chunks=[];
  for(let i=0;i<bytes.length;i+=8192)chunks.push(String.fromCharCode(...bytes.subarray(i,i+8192)));
  return {name:file.name,mime:fileMime(file),contentBase64:btoa(chunks.join(''))};
 }
 function downloadFile(file){
  const bytes=Uint8Array.from(atob(file.contentBase64),char=>char.charCodeAt(0));
  const blob=new Blob([bytes],{type:'application/octet-stream'});
  const link=document.createElement('a'),url=URL.createObjectURL(blob);
  link.href=url;link.download=file.name;link.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
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
  for(const [label,value] of [['Total tickets',m.total],['Open',m.open],['Needs attention',m.pending],['Resolved',m.resolved],['Automated answers',m.automatedResponses],['Consented leads',m.contactLeads],['Appointments pending',m.appointmentPending],['Customer ratings',m.ratedTickets],['Average satisfaction',m.averageRating===null?'—':m.averageRating+'/5']]){
   const box=node('div',undefined,'kpi');box.append(node('span',label),node('strong',value));host.append(box);
  }
 }
 async function loadTickets(){
  const query=id('ticketFilter').value,search=id('ticketQuery').value.trim();
  const list=await api('tickets/search?q='+encodeURIComponent(search)+'&status='+encodeURIComponent(query));
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
  state.selected=ticketId;const {ticket,messages,rating,notes,files}=await api('tickets/'+ticketId);
  id('ticketRating').textContent=rating?'Customer satisfaction: '+rating.rating+'/5'+(rating.feedback?' · '+rating.feedback:''):'No rating yet.';
  id('ticketTitle').textContent=ticket.subject;
  const host=id('ticketHistory');host.replaceChildren();
  for(const m of messages){const row=node('div',undefined,'message-item');row.append(node('strong',m.sender),node('div',m.body));host.append(row);}
  const noteHost=id('ticketNotes');noteHost.replaceChildren();
  for(const note of notes||[]){const row=node('div',undefined,'message-item');row.append(node('strong','Private note · '+(note.author||'Staff')),node('div',note.body));noteHost.append(row);}
  if(!notes?.length)noteHost.append(node('small','No private staff notes.'));
  id('noteForm').classList.remove('hidden');
  id('ticketAttachmentPanel').classList.remove('hidden');
  const fileHost=id('ticketFiles');fileHost.replaceChildren();
  for(const file of files||[]){
   const row=node('div',undefined,'article');
   row.append(node('strong',file.name+' · '+file.uploadedBy),node('small',Math.ceil(file.size/1024)+' KiB'));
   const download=node('button','Download');download.type='button';download.className='quiet';
   download.addEventListener('click',async()=>{
    try{const result=await api('tickets/'+ticketId+'/files/'+file.id);downloadFile(result.file);}
    catch(e){feedback(e.message);}
   });row.append(download);fileHost.append(row);
  }
  if(!files?.length)fileHost.append(node('p','No files attached.'));
  id('ticketStatus').value=ticket.status;id('ticketPriority').value=ticket.priority;id('ticketAssignee').value=ticket.assignedTo;
  id('ticketControls').classList.remove('hidden');id('replyForm').classList.remove('hidden');
  loadTickets().catch(e=>feedback(e.message));
 }
 async function loadArticles(){
  const q=id('knowledgeQuery').value.trim();const data=await api('articles/search?q='+encodeURIComponent(q));const host=id('articles');host.replaceChildren();
  for(const item of data.articles){
   const box=node('div',undefined,'article');
   box.append(node('strong',item.question),node('small',item.locale+' · '+(item.category||'General')+(item.active?' · Published':' · Draft')),node('p',item.answer));
   if(state.role!=='agent'){
    const edit=node('button','Edit answer');edit.type='button';
    edit.addEventListener('click',async()=>{
     const updated=prompt('Edit this approved answer',item.answer);
     if(updated===null)return;
     try{await api('articles/'+item.id,{method:'PATCH',body:{answer:updated}});await loadArticles();feedback('Knowledge answer updated.');}catch(e){feedback(e.message);}
    });
    const toggle=node('button',item.active?'Unpublish':'Publish');toggle.type='button';
    toggle.addEventListener('click',async()=>{
     try{await api('articles/'+item.id,{method:'PATCH',body:{active:!item.active}});await loadArticles();feedback('Knowledge publication updated.');}catch(e){feedback(e.message);}
    });
    const remove=node('button','Delete');remove.type='button';
    remove.addEventListener('click',async()=>{
     if(!confirm('Delete this approved answer?'))return;
     try{await api('articles/'+item.id,{method:'DELETE'});await loadArticles();feedback('Article deleted.');}catch(e){feedback(e.message);}
    });
    const actions=node('div',undefined,'button-row');
    actions.append(edit,toggle,remove);box.append(actions);
   }
   host.append(box);
  }
  if(!data.articles.length)host.append(node('p','No knowledge articles published yet.'));
 }
 async function loadCustomers(){
  const data=await api('customers'),host=id('customersList');
  host.replaceChildren();
  for(const customer of data.customers){
   const button=node('button',undefined,'ticket-item');
   button.type='button';button.append(node('strong',customer.name||customer.email),
    node('small',customer.email),node('small',customer.ticketCount+' tickets · '+customer.unresolvedTickets+' unresolved'));
   button.addEventListener('click',()=>showCustomer(customer.email).catch(e=>feedback(e.message)));
   host.append(button);
  }
  if(!data.customers.length)host.append(node('p','No email-associated customer conversations.'));
 }
 async function showCustomer(email){
  const {profile}=await api('customers/lookup',{method:'POST',body:{email}});
  const host=id('customerHistory');host.replaceChildren();
  host.append(node('strong',profile.displayName||profile.email),node('p','Self-reported identity, not verified. Consented leads: '+profile.consentedLeadCount));
  for(const ticket of profile.tickets){
   const button=node('button',undefined,'ticket-item');button.type='button';
   button.append(node('strong',ticket.subject),node('small',ticket.status+' · '+new Date(ticket.updatedAt).toLocaleString()));
   button.addEventListener('click',async()=>{
    document.querySelector('[data-section="inbox"]').click();
    await selectTicket(ticket.id);
   });
   host.append(button);
  }
 }
 async function loadLeads(){
  const data=await api('leads'),host=id('leadsList');host.replaceChildren();
  for(const lead of data.leads){
   const block=node('div',undefined,'article');
   block.append(node('strong',lead.name+' · '+lead.email),node('p',lead.inquiry),node('small','Support ticket: '+lead.ticketId));
   const label=node('label','Lead status');
   const select=node('select');
   for(const status of ['new','contacted','qualified','closed']){const option=node('option',status);option.value=status;select.append(option);}
   select.value=lead.status;
   select.addEventListener('change',async()=>{
    try{await api('leads/'+lead.ticketId,{method:'PATCH',body:{status:select.value}});feedback('Lead updated.');}catch(e){feedback(e.message);}
   });
   label.append(select);block.append(label);host.append(block);
  }
  if(!data.leads.length)host.append(node('p','No visitors have requested follow-up contact.'));
 }
 async function loadAppointments(){
  const data=await api('appointments'),host=id('appointmentsList');host.replaceChildren();
  for(const appt of data.appointments){
   const block=node('div',undefined,'article');
   block.append(node('strong',appt.service),node('p','Requested: '+new Date(appt.requestedAt).toLocaleString()+' · '+appt.timezone),
    node('p',appt.notes||'No additional notes'),node('small','Ticket: '+appt.ticketId+' · NOT BOOKED'));
   const label=node('label','Internal review status');const select=node('select');
   for(const status of ['requested','reviewing','handled','declined']){const option=node('option',status);option.value=status;select.append(option);}
   select.value=appt.status;
   select.addEventListener('change',async()=>{
    try{await api('appointments/'+appt.id,{method:'PATCH',body:{status:select.value}});feedback('Appointment request updated, without creating a booking.');await loadMetrics();}catch(e){feedback(e.message);}
   });
   label.append(select);block.append(label);host.append(block);
  }
  if(!data.appointments.length)host.append(node('p','No appointment requests yet.'));
 }
 async function loadMacros(){
  const data=await api('macros'),host=id('macroList'),select=id('replyMacro');
  state.macros=data.macros;host.replaceChildren();select.replaceChildren(node('option','Select a saved response'));
  for(const item of data.macros){
   const option=node('option',item.title);option.value=item.id;select.append(option);
   const box=node('div',undefined,'article');box.append(node('strong',item.title),node('p',item.body));
   if(state.role!=='agent'){
    const remove=node('button','Remove');remove.type='button';
    remove.addEventListener('click',async()=>{
     if(!confirm('Delete this saved response?'))return;
     try{await api('macros/'+item.id,{method:'DELETE'});await loadMacros();feedback('Saved response removed.');}catch(e){feedback(e.message);}
    });box.append(remove);
   }
   host.append(box);
  }
  if(!data.macros.length)host.append(node('p','No reusable responses configured.'));
 }
 async function loadTeam(){
  const data=await api('team'),host=id('teamList');host.replaceChildren();
  for(const member of data.members){
   const box=node('div',undefined,'article');
   box.append(node('strong',member.name),node('p',member.email+' · '+member.role+' · '+(member.active?'Active':'Disabled')));
   const toggle=node('button',member.active?'Disable access':'Enable access');toggle.type='button';
   toggle.addEventListener('click',async()=>{
    if(member.active&&!confirm('Revoke this employee’s support access and active sessions?'))return;
    try{await api('team/'+member.id,{method:'PATCH',body:{active:!member.active}});await loadTeam();feedback('Staff access changed.');}catch(e){feedback(e.message);}
   });
   box.append(toggle);host.append(box);
  }
  if(!data.members.length)host.append(node('p','No individual staff accounts. Add one to enable separate support access.'));
 }
 async function loadCalendar(){
  const [slotData,bookingData]=await Promise.all([api('calendar/slots'),api('calendar/bookings')]);
  const slotHost=id('calendarSlots');slotHost.replaceChildren();
  for(const slot of slotData.slots){
   const item=node('div',undefined,'article');
   item.append(node('strong',slot.service),node('p',new Date(slot.startAt).toLocaleString()+' · '+slot.durationMinutes+' minutes'),
    node('small',slot.remaining+' available of '+slot.capacity+' · '+(slot.enabled?'Open':'Disabled')));
   if(state.role!=='agent'){
    const toggle=node('button',slot.enabled?'Disable slot':'Enable slot');toggle.type='button';
    toggle.addEventListener('click',async()=>{
     try{await api('calendar/slots/'+slot.id,{method:'PATCH',body:{enabled:!slot.enabled}});await loadCalendar();feedback('Calendar availability updated.');}catch(e){feedback(e.message);}
    });item.append(toggle);
   }
   slotHost.append(item);
  }
  if(!slotData.slots.length)slotHost.append(node('p','No upcoming internal appointment slots.'));
  const bookingHost=id('calendarBookings');bookingHost.replaceChildren();
  for(const booking of bookingData.bookings){
   const item=node('div',undefined,'article');
   item.append(node('strong',booking.service+' · '+booking.status),node('p',new Date(booking.startAt).toLocaleString()),
    node('small','Conversation: '+booking.ticketId+' · No external calendar confirmation'));
   bookingHost.append(item);
  }
  if(!bookingData.bookings.length)bookingHost.append(node('p','No internal bookings.'));
 }
 async function loadOperations(){
  const [notifications,alerts,reports,sla,routing]=await Promise.all([api('notifications'),api('alerts'),api('reports?days=7'),api('sla'),api('routing/rules')]);
  const host=id('supportNotifications');host.replaceChildren();
  for(const item of notifications.notifications){
   const box=node('div',undefined,'article');
   box.append(node('strong',item.kind.replaceAll('support.','').replaceAll('_',' ')),node('small',new Date(item.createdAt).toLocaleString()+(item.seen?' · Read':' · Unread')));
   const open=node('button','Review conversation');open.type='button';
   open.addEventListener('click',async()=>{
    try{await api('notifications/'+item.id+'/read',{method:'POST',body:{}});document.querySelector('[data-section="inbox"]').click();await selectTicket(item.ticketId);await loadOperations();}catch(e){feedback(e.message);}
   });box.append(open);host.append(box);
  }
  if(!notifications.notifications.length)host.append(node('p','No unreviewed support events.'));
  const alertHost=id('slaAlerts');alertHost.replaceChildren();
  for(const item of alerts.alerts){
   const row=node('div',undefined,'article');
   row.append(node('strong',item.type.replaceAll('_',' ')),node('small',item.minutesLate+' minutes past target'));
   const open=node('button','Open conversation');open.type='button';
   open.addEventListener('click',()=>{document.querySelector('[data-section="inbox"]').click();selectTicket(item.ticketId).catch(e=>feedback(e.message));});
   row.append(open);alertHost.append(row);
  }
  if(!alerts.alerts.length)alertHost.append(node('p','No overdue service targets.'));
  id('slaFirst').value=sla.firstResponseMinutes;id('slaResolution').value=sla.resolutionMinutes;
  const routingHost=id('routingList');routingHost.replaceChildren();
  for(const rule of routing.rules){
   const row=node('div',undefined,'article');row.append(node('strong',rule.phrase+' · '+rule.priority));
   if(state.role!=='agent'){
    const remove=node('button','Remove rule');remove.type='button';
    remove.addEventListener('click',async()=>{
     if(!confirm('Remove this automatic routing rule?'))return;
     try{await api('routing/rules/'+rule.id,{method:'DELETE'});await loadOperations();feedback('Routing rule removed.');}catch(e){feedback(e.message);}
    });row.append(remove);
   }
   routingHost.append(row);
  }
  if(!routing.rules.length)routingHost.append(node('p','No custom priority rules. Team assignment still uses least-open workload.'));
  const trend=id('trendList');trend.replaceChildren();
  const max=Math.max(1,...reports.daily.map(x=>x.tickets));
  for(const day of reports.daily){
   const row=node('div',undefined,'trend-row');
   const label=node('span',day.date.slice(5));
   const bar=node('div',undefined,'trend-track'),fill=node('div',undefined,'trend-fill');
   fill.style.width=(day.tickets/max*100)+'%';bar.append(fill);
   row.append(label,bar,node('strong',day.tickets));trend.append(row);
  }
 }
 async function loadSettings(){
  const c=await api('settings');
  id('businessNameInput').value=c.businessName;id('greetingInput').value=c.greeting;id('greetingEsInput').value=c.greetingEs;id('greetingFrInput').value=c.greetingFr;id('logoTextInput').value=c.logoText;
  id('businessHoursInput').value=c.businessHours;id('defaultLocaleInput').value=c.defaultLocale;
  id('brandColorInput').value=c.brandColor;
 }
 async function refresh(){
  await Promise.all([loadMetrics(),loadTickets(),loadArticles(),loadCustomers(),loadLeads(),loadAppointments(),loadMacros(),loadCalendar(),loadOperations(),loadSettings(),
   ...(state.role==='owner'?[loadTeam()]:[])]);
 }
 function connectReady(){
  id('adminToken').value='';id('staffPassword').value='';
  id('connectPanel').classList.add('hidden');id('console').classList.remove('hidden');
  id('workspaceLabel').textContent='Workspace: '+state.workspace+' · '+(state.role==='owner'?'Owner':state.role);
  id('supportPageLink').href='/support?workspace='+encodeURIComponent(state.workspace);
  const isOwner=state.role==='owner',canManage=isOwner||state.role==='manager';
  document.querySelectorAll('[data-owner-only]').forEach(x=>x.classList.toggle('hidden',!isOwner));
  document.querySelectorAll('[data-manager-only]').forEach(x=>x.classList.toggle('hidden',!canManage));
  feedback('Customer-service workspace connected.');
 }
 id('connectForm').addEventListener('submit',async event=>{
  event.preventDefault();state.workspace=id('workspace').value.trim();state.token=id('adminToken').value.trim();state.role='owner';
  try{await refresh();connectReady();}catch(e){state.token='';feedback(e.message);}
 });
 id('staffLoginForm').addEventListener('submit',async event=>{
  event.preventDefault();state.workspace=id('workspace').value.trim();
  try{
   const r=await fetch('/api/support/team/login?workspace='+encodeURIComponent(state.workspace),{
    method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({email:id('staffEmail').value,password:id('staffPassword').value})});
   const data=await r.json();if(!r.ok)throw Error(data.error||'Staff sign-in failed');
   state.token=data.token;state.role=data.role;
   try{await refresh();connectReady();}catch(e){await api('team/logout',{method:'POST',body:{}});state.token='';throw e;}
  }catch(e){state.token='';feedback(e.message);}
 });
 id('logoutButton').addEventListener('click',async()=>{
  if(state.role!=='owner')try{await api('team/logout',{method:'POST',body:{}});}catch{}
  state.token='';state.selected=null;state.role='owner';
  id('console').classList.add('hidden');id('connectPanel').classList.remove('hidden');
  id('adminToken').value='';id('staffPassword').value='';feedback('Signed out.');
 });
 id('refreshButton').addEventListener('click',()=>refresh().then(()=>feedback('Support data refreshed.')).catch(e=>feedback(e.message)));
 id('ticketFilter').addEventListener('change',()=>loadTickets().catch(e=>feedback(e.message)));
 id('ticketQuery').addEventListener('input',()=>loadTickets().catch(e=>feedback(e.message)));
 id('knowledgeQuery').addEventListener('input',()=>loadArticles().catch(e=>feedback(e.message)));
 id('replyMacro').addEventListener('change',()=>{
  const found=state.macros.find(m=>m.id===id('replyMacro').value);
  if(found)id('agentReply').value=found.body;
 });
 id('staffUpload').addEventListener('click',async()=>{
  if(!state.selected)return;
  const button=id('staffUpload');button.disabled=true;
  try{
   const file=await prepareFile(id('staffFile').files[0]);
   await api('tickets/'+state.selected+'/files',{method:'POST',body:file});
   id('staffFile').value='';
   await selectTicket(state.selected);
   feedback('File stored in this support conversation.');
  }catch(e){feedback(e.message);}
  finally{button.disabled=false;}
 });
 id('noteForm').addEventListener('submit',async event=>{
  event.preventDefault();if(!state.selected)return;
  try{await api('tickets/'+state.selected+'/notes',{method:'POST',body:{body:id('noteBody').value}});
   id('noteBody').value='';await selectTicket(state.selected);feedback('Private note saved.');}catch(e){feedback(e.message);}
 });
 id('macroForm').addEventListener('submit',async event=>{
  event.preventDefault();
  try{await api('macros',{method:'POST',body:{title:id('macroTitle').value,body:id('macroBody').value}});
   id('macroForm').reset();await loadMacros();feedback('Reusable response saved.');}catch(e){feedback(e.message);}
 });
 id('slotForm').addEventListener('submit',async event=>{
  event.preventDefault();
  const time=new Date(id('slotTime').value);if(!Number.isFinite(time.getTime())){feedback('Choose a valid future time.');return;}
  try{await api('calendar/slots',{method:'POST',body:{service:id('slotService').value,startAt:time.toISOString(),
   durationMinutes:Number(id('slotDuration').value),capacity:Number(id('slotCapacity').value)}});
   id('slotForm').reset();await loadCalendar();feedback('Internal appointment availability created.');}catch(e){feedback(e.message);}
 });
 id('routingForm').addEventListener('submit',async event=>{
  event.preventDefault();
  try{
   await api('routing/rules',{method:'POST',body:{phrase:id('routingPhrase').value,priority:id('routingPriority').value}});
   id('routingForm').reset();await loadOperations();feedback('Internal routing rule added.');
  }catch(e){feedback(e.message);}
 });
 id('slaForm').addEventListener('submit',async event=>{
  event.preventDefault();
  try{await api('sla',{method:'PATCH',body:{firstResponseMinutes:Number(id('slaFirst').value),resolutionMinutes:Number(id('slaResolution').value)}});
   await loadOperations();feedback('Local service targets updated.');}catch(e){feedback(e.message);}
 });
 id('teamForm').addEventListener('submit',async event=>{
  event.preventDefault();
  try{await api('team',{method:'POST',body:{name:id('memberName').value,email:id('memberEmail').value,
   password:id('memberPassword').value,role:id('memberRole').value}});
   id('teamForm').reset();await loadTeam();feedback('Individual support account created.');}catch(e){feedback(e.message);}
 });
 id('knowledgeImportForm').addEventListener('submit',async event=>{
  event.preventDefault();
  try{
   const file=id('articleImportFile').files[0];
   if(!file||file.size>480000)throw Error('Choose a JSON file under 480 KB.');
   let result;
   if(file.name.toLowerCase().endsWith('.csv')){
    result=await api('articles/import-csv',{method:'POST',body:{csv:await file.text()}});
   }else if(file.name.toLowerCase().endsWith('.json')){
    const json=JSON.parse(await file.text());
    const articles=Array.isArray(json)?json:json.articles;
    if(!Array.isArray(articles))throw Error('Import JSON must contain an articles array.');
    result=await api('articles/import',{method:'POST',body:{articles}});
   }else throw Error('Choose a .csv or .json knowledge file.');
   id('knowledgeImportForm').reset();await loadArticles();feedback(result.imported+' knowledge articles imported.');
  }catch(e){feedback(e.message);}
 });
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
  try{await api('articles',{method:'POST',body:{question:id('articleQuestion').value,answer:id('articleAnswer').value,locale:id('articleLocale').value,category:id('articleCategory').value}});id('articleForm').reset();await loadArticles();feedback('Approved answer published.');}catch(e){feedback(e.message);}
 });
 id('settingsForm').addEventListener('submit',async event=>{
  event.preventDefault();
  try{await api('settings',{method:'PATCH',body:{businessName:id('businessNameInput').value,greeting:id('greetingInput').value,greetingEs:id('greetingEsInput').value,greetingFr:id('greetingFrInput').value,logoText:id('logoTextInput').value,businessHours:id('businessHoursInput').value,defaultLocale:id('defaultLocaleInput').value,brandColor:id('brandColorInput').value}});feedback('Customer-facing settings saved.');}catch(e){feedback(e.message);}
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
 fetch('/api/dashboard-config').then(r=>r.json()).then(async config=>{if(config.public){state.workspace=config.workspace;state.role='owner';await refresh();connectReady();id('logoutButton').classList.add('hidden');}}).catch(e=>feedback(e.message));
})();
