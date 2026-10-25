(() => {
 'use strict';
 const id=x=>document.getElementById(x);
 const workspace=new URLSearchParams(location.search).get('workspace')||'default';
 let ticketId=null,sessionToken=null,seen=new Set(),polling=false,busy=false,config=null;
 const key='aplus:support-session:'+workspace;
 const language={
  en:{newChat:'New chat',sendButton:'Send',nameLabel:'Your name (optional)',emailLabel:'Email for follow-up (optional)',
   languageLabel:'Language',aiConsentText:'I agree to AI processing of my message if this business has enabled it.',
   leadConsentText:'I agree to this business using my name, email and inquiry to contact me about its services.',
   humanButton:'Speak with a human',appointmentSummary:'Request an appointment (staff review required)',
   bookingSummary:'Book an available business appointment slot',ratingPrompt:'How helpful was this support?',
   uploadFile:'Attach',bookSlot:'Reserve this slot',selfExport:'Export my conversation',selfErase:'Erase this conversation',
   privacyMessage:'Please do not send passwords, payment card details or sensitive personal information. Replies are not necessarily reviewed immediately by a person.',
   attachmentHeading:'Attach a document to this conversation',placeholder:'Ask a question…'},
  es:{newChat:'Nuevo chat',sendButton:'Enviar',nameLabel:'Su nombre (opcional)',emailLabel:'Correo electrónico (opcional)',
   languageLabel:'Idioma',aiConsentText:'Acepto que la IA procese mi mensaje si esta empresa la tiene habilitada.',
   leadConsentText:'Autorizo a esta empresa a usar mi nombre, correo y consulta para contactarme.',
   humanButton:'Hablar con una persona',appointmentSummary:'Solicitar una cita (requiere revisión)',
   bookingSummary:'Reservar un horario disponible',ratingPrompt:'¿Qué tan útil fue esta atención?',
   uploadFile:'Adjuntar',bookSlot:'Reservar horario',selfExport:'Exportar mi conversación',selfErase:'Borrar mi conversación',
   privacyMessage:'No envíe contraseñas, tarjetas de pago ni información personal confidencial. Es posible que las respuestas no sean revisadas inmediatamente por una persona.',
   attachmentHeading:'Adjuntar un archivo a esta conversación',placeholder:'Escriba su pregunta…'},
  fr:{newChat:'Nouvelle discussion',sendButton:'Envoyer',nameLabel:'Votre nom (facultatif)',emailLabel:'Adresse e-mail (facultatif)',
   languageLabel:'Langue',aiConsentText:'J’accepte que l’IA traite mon message si cette entreprise l’a activée.',
   leadConsentText:'J’autorise cette entreprise à utiliser mon nom, mon e-mail et ma demande pour me contacter.',
   humanButton:'Parler à une personne',appointmentSummary:'Demander un rendez-vous (examen nécessaire)',
   bookingSummary:'Réserver un créneau disponible',ratingPrompt:'Cette assistance a-t-elle été utile ?',
   uploadFile:'Joindre',bookSlot:'Réserver',selfExport:'Exporter ma conversation',selfErase:'Effacer ma conversation',
   privacyMessage:'Ne communiquez pas de mots de passe, de coordonnées bancaires ou de données personnelles sensibles. Une réponse humaine peut prendre du temps.',
   attachmentHeading:'Joindre un fichier à cette conversation',placeholder:'Posez une question…'}
 };
 function updateLanguage(){
  const locale=id('locale').value.slice(0,2)||'en',words=language[locale]||language.en;
  for(const [key,value] of Object.entries(words)){if(key!=='placeholder'&&id(key))id(key).textContent=value;}
  id('customerMessage').placeholder=words.placeholder;
  document.documentElement.lang=locale;
  if(!ticketId&&config){
   log.replaceChildren();
   say('assistant',locale==='es'?config.greetingEs:locale==='fr'?config.greetingFr:config.greeting);
  }
 }
 function saveSession(){
  try{if(ticketId&&sessionToken)sessionStorage.setItem(key,JSON.stringify({ticketId,sessionToken}));}catch{}
 }
 function clearSession(){
  try{sessionStorage.removeItem(key);}catch{}
 }
 function displayOptions(){
  id('ratingPanel').classList.remove('hidden');
  id('appointmentPanel').classList.remove('hidden');
  id('bookingPanel').classList.remove('hidden');
  id('selfPrivacyPanel').classList.remove('hidden');
  id('customerAttachmentPanel').classList.remove('hidden');
  id('leadConsentLabel').classList.add('hidden');
  id('humanButton').classList.remove('hidden');
  id('visitorName').disabled=true;id('visitorEmail').disabled=true;
 }
 const log=id('messages'),notice=id('notice'),form=id('chatForm');
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
 function say(sender,message){
  const bubble=document.createElement('div');bubble.className='bubble '+sender;bubble.textContent=message;
  log.append(bubble);log.scrollTop=log.scrollHeight;
 }
 async function api(path,body){
  const res=await fetch('/api/support/'+path+'?workspace='+encodeURIComponent(workspace),{
   method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  const data=await res.json();
  if(!res.ok)throw Error(data.error||'Support is unavailable');
  return data;
 }
 async function thread({display=true}={}){
  if(!ticketId||!sessionToken||polling)return;
  polling=true;
  try{
   const data=await api('thread',{ticketId,sessionToken});
   if(display)for(const m of data.messages){if(!seen.has(m.id)){say(m.sender==='customer'?'customer':m.sender==='agent'?'agent':'assistant',m.body);}}
   seen=new Set(data.messages.map(x=>x.id));
   notice.textContent=data.status==='pending'?'A team member needs to review this conversation.':data.status==='resolved'?'This conversation is marked resolved.':'';
  }catch(e){notice.textContent=e.message;}
  finally{polling=false;}
 }
 async function send(event){
  event.preventDefault();if(busy)return;
  const message=id('customerMessage').value.trim();if(!message)return;
  busy=true;id('sendButton').disabled=true;
  try{
   const data=await api('chat',{message,name:id('visitorName').value,email:id('visitorEmail').value,
    locale:id('locale').value,aiConsent:id('aiConsent').checked,leadConsent:!ticketId&&id('leadConsent').checked,...(ticketId?{ticketId,sessionToken}:{})});
   ticketId=data.ticketId;if(data.sessionToken)sessionToken=data.sessionToken;
   saveSession();displayOptions();loadSlots().catch(e=>{notice.textContent=e.message;});loadCustomerFiles().catch(e=>{notice.textContent=e.message;});
   id('customerMessage').value='';
   if(seen.size===0){say('customer',message);say('assistant',data.reply);await thread({display:false});}
   else await thread();
   if(data.needsHuman)notice.textContent='Your request has been flagged for a human team member. A response is not yet guaranteed.';
   if(data.leadCaptured)notice.textContent+=' Your request to be contacted has been recorded.';
  }catch(e){notice.textContent=e.message;}
  finally{busy=false;id('sendButton').disabled=false;}
 }
 async function loadCustomerFiles(){
  if(!ticketId||!sessionToken)return;
  const result=await api('files/list',{ticketId,sessionToken});
  const host=id('customerFiles');host.replaceChildren();
  for(const file of result.files){
   const box=document.createElement('div');box.className='article';
   const label=document.createElement('strong');label.textContent=file.name+' ('+Math.ceil(file.size/1024)+' KiB)';
   const button=document.createElement('button');button.type='button';button.className='quiet';button.textContent='Download';
   button.addEventListener('click',async()=>{
    try{
     const data=await api('files/read',{ticketId,sessionToken,fileId:file.id});
     downloadFile(data.file);
    }catch(e){notice.textContent=e.message;}
   });
   box.append(label,button);host.append(box);
  }
  if(!result.files.length){const label=document.createElement('p');label.textContent='No files attached.';host.append(label);}
 }
 async function start({restore=true}={}){
  try{
   const r=await fetch('/api/support/config?workspace='+encodeURIComponent(workspace));
   config=await r.json();if(!r.ok)throw Error(config.error||'Support unavailable');
   id('businessName').textContent=config.businessName;id('brandLogo').textContent=config.logoText;
   id('businessHours').textContent=config.businessHours||'Ask us a question.';
   id('locale').value=config.defaultLocale;updateLanguage();
   document.documentElement.style.setProperty('--accent',config.brandColor);
   if(restore){
    try{
     const value=JSON.parse(sessionStorage.getItem(key)||'null');
     if(value&&typeof value.ticketId==='string'&&typeof value.sessionToken==='string'){
      ticketId=value.ticketId;sessionToken=value.sessionToken;
      const result=await api('thread',{ticketId,sessionToken});
      log.replaceChildren();seen=new Set();
      for(const m of result.messages){say(m.sender==='customer'?'customer':m.sender==='agent'?'agent':'assistant',m.body);seen.add(m.id);}
      displayOptions();await Promise.all([loadSlots(),loadCustomerFiles()]);
      notice.textContent='This conversation has been restored in your current tab.';
      return;
     }
    }catch{ticketId=null;sessionToken=null;clearSession();}
   }
  }catch(e){notice.textContent=e.message;id('sendButton').disabled=true;}
 }
 async function loadSlots(){
  const r=await fetch('/api/support/calendar/slots?workspace='+encodeURIComponent(workspace));
  const data=await r.json();if(!r.ok)throw Error(data.error||'Availability unavailable');
  const select=id('availableSlots');select.replaceChildren();
  const available=data.slots.filter(slot=>slot.remaining>0);
  for(const slot of available){
   const option=document.createElement('option');
   option.value=slot.id;
   option.textContent=slot.service+' · '+new Date(slot.startAt).toLocaleString()+' · '+slot.remaining+' available';
   select.append(option);
  }
  if(!available.length){
   const option=document.createElement('option');option.value='';
   option.textContent='No times currently offered';select.append(option);
  }
  id('bookSlot').disabled=!available.length;
  await refreshBookings();
 }
 async function refreshBookings(){
  if(!ticketId||!sessionToken)return;
  const data=await api('calendar/my',{ticketId,sessionToken});
  const host=id('myBookings');host.replaceChildren();
  const active=data.bookings.filter(x=>x.status==='confirmed_local');
  for(const booking of active){
   const item=document.createElement('div');item.className='article';
   const title=document.createElement('strong');
   title.textContent=booking.service+' · '+new Date(booking.startAt).toLocaleString();
   const description=document.createElement('p');
   description.textContent='Reserved in A+ only. No external calendar confirmation.';
   const cancel=document.createElement('button');
   cancel.className='quiet';cancel.type='button';cancel.textContent='Cancel this reservation';
   cancel.addEventListener('click',async()=>{
    if(!confirm('Cancel this internal business reservation?'))return;
    try{await api('calendar/cancel',{bookingId:booking.id,ticketId,sessionToken});await loadSlots();notice.textContent='Reservation cancelled.';}
    catch(e){notice.textContent=e.message;}
   });
   item.append(title,description,cancel);host.append(item);
  }
  if(!active.length){const p=document.createElement('p');p.textContent='No active business reservations.';host.append(p);}
 }
 id('humanButton').addEventListener('click',async()=>{
  if(!ticketId||!sessionToken)return;
  const button=id('humanButton');button.disabled=true;
  try{
   await api('handoff',{ticketId,sessionToken});
   await thread();
   notice.textContent='Your conversation is now flagged for a human team member. Response times depend on staffing.';
  }catch(e){notice.textContent=e.message;}
  finally{button.disabled=false;}
 });
 id('ratingForm').addEventListener('submit',async event=>{
  event.preventDefault();
  if(!ticketId||!sessionToken)return;
  try{
   await api('rating',{ticketId,sessionToken,rating:Number(id('ratingValue').value),feedback:id('ratingFeedback').value});
   notice.textContent='Thank you. Your feedback has been recorded.';
  }catch(e){notice.textContent=e.message;}
 });
 id('appointmentForm').addEventListener('submit',async event=>{
  event.preventDefault();
  if(!ticketId||!sessionToken)return;
  const raw=id('appointmentTime').value;
  const timestamp=new Date(raw);
  if(!Number.isFinite(timestamp.getTime())){notice.textContent='Enter a valid preferred date and time.';return;}
  const button=id('appointmentForm').querySelector('button');button.disabled=true;
  try{
   await api('appointments',{ticketId,sessionToken,service:id('appointmentService').value,
    requestedAt:timestamp.toISOString(),timezone:Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC',notes:id('appointmentNotes').value});
   await thread();
   notice.textContent='Your request is in the review queue. No appointment has been booked.';
   id('appointmentForm').reset();
  }catch(e){notice.textContent=e.message;}
  finally{button.disabled=false;}
 });
 id('uploadFile').addEventListener('click',async()=>{
  if(!ticketId||!sessionToken)return;
  const button=id('uploadFile');button.disabled=true;
  try{
   const file=id('customerFile').files[0];
   const payload=await prepareFile(file);
   await api('files',{ticketId,sessionToken,...payload});
   id('customerFile').value='';
   await loadCustomerFiles();
   notice.textContent='Attachment saved securely in this support conversation.';
  }catch(e){notice.textContent=e.message;}
  finally{button.disabled=false;}
 });
 id('bookSlot').addEventListener('click',async()=>{
  if(!ticketId||!sessionToken||!id('availableSlots').value)return;
  const button=id('bookSlot');button.disabled=true;
  try{
   await api('calendar/book',{ticketId,sessionToken,slotId:id('availableSlots').value});
   notice.textContent='Your reservation is confirmed in this business support system. External calendars are not connected.';
   try{await loadSlots();}catch{notice.textContent+=' Reload the page to view the reservation.';}
  }catch(e){notice.textContent=e.message;await loadSlots().catch(()=>{});}
  finally{button.disabled=!id('availableSlots').value;}
 });
 id('selfExport').addEventListener('click',async()=>{
  if(!ticketId||!sessionToken)return;
  try{
   const data=await api('privacy/self/export',{ticketId,sessionToken});
   const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
   const url=URL.createObjectURL(blob),link=document.createElement('a');
   link.href=url;link.download='a-plus-support-conversation.json';link.click();
   setTimeout(()=>URL.revokeObjectURL(url),1000);
   notice.textContent='Your available customer-facing conversation data was exported.';
  }catch(e){notice.textContent=e.message;}
 });
 id('selfErase').addEventListener('click',async()=>{
  if(!ticketId||!sessionToken)return;
  if(!confirm('Permanently erase this support conversation, its reservations and related records? This cannot be undone.'))return;
  try{
   await api('privacy/self/erase',{ticketId,sessionToken});
   clearSession();ticketId=null;sessionToken=null;seen=new Set();
   log.replaceChildren();id('bookingPanel').classList.add('hidden');id('selfPrivacyPanel').classList.add('hidden');id('customerAttachmentPanel').classList.add('hidden');id('customerFile').value='';
   id('ratingPanel').classList.add('hidden');id('appointmentPanel').classList.add('hidden');id('humanButton').classList.add('hidden');id('customerAttachmentPanel').classList.add('hidden');id('customerFile').value='';
   id('leadConsentLabel').classList.remove('hidden');id('visitorName').disabled=false;id('visitorEmail').disabled=false;
   say('assistant','This conversation and associated A+ support records have been erased.');
   notice.textContent='You can start a new conversation.';
  }catch(e){notice.textContent=e.message;}
 });
 id('locale').addEventListener('change',updateLanguage);
 form.addEventListener('submit',send);
 id('newChat').addEventListener('click',()=>{
  clearSession();ticketId=null;sessionToken=null;seen=new Set();log.replaceChildren();notice.textContent='';id('bookingPanel').classList.add('hidden');id('selfPrivacyPanel').classList.add('hidden');id('customerAttachmentPanel').classList.add('hidden');id('customerFile').value='';id('humanButton').classList.add('hidden');id('ratingPanel').classList.add('hidden');id('ratingForm').reset();id('appointmentPanel').classList.add('hidden');id('appointmentForm').reset();id('leadConsentLabel').classList.remove('hidden');id('leadConsent').checked=false;
  id('visitorName').disabled=false;id('visitorEmail').disabled=false;start({restore:false});
 });
 setInterval(()=>{if(ticketId&&!busy)thread();},15000);
 start();
})();
