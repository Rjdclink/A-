(() => {
 'use strict';
 const id=x=>document.getElementById(x);
 const workspace=new URLSearchParams(location.search).get('workspace')||'default';
 let ticketId=null,sessionToken=null,seen=new Set(),polling=false,busy=false;
 const log=id('messages'),notice=id('notice'),form=id('chatForm');
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
   id('ratingPanel').classList.remove('hidden');id('appointmentPanel').classList.remove('hidden');id('leadConsentLabel').classList.add('hidden');id('humanButton').classList.remove('hidden');
   id('customerMessage').value='';
   if(seen.size===0){say('customer',message);say('assistant',data.reply);await thread({display:false});}
   else await thread();
   if(data.needsHuman)notice.textContent='Your request has been flagged for a human team member. A response is not yet guaranteed.';
   if(data.leadCaptured)notice.textContent+=' Your request to be contacted has been recorded.';
   id('visitorName').disabled=true;id('visitorEmail').disabled=true;
  }catch(e){notice.textContent=e.message;}
  finally{busy=false;id('sendButton').disabled=false;}
 }
 async function start(){
  try{
   const r=await fetch('/api/support/config?workspace='+encodeURIComponent(workspace));
   const config=await r.json();if(!r.ok)throw Error(config.error||'Support unavailable');
   id('businessName').textContent=config.businessName;
   id('businessHours').textContent=config.businessHours||'Ask us a question.';
   id('locale').value=config.defaultLocale;
   document.documentElement.style.setProperty('--accent',config.brandColor);
   say('assistant',config.greeting);
  }catch(e){notice.textContent=e.message;id('sendButton').disabled=true;}
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
 form.addEventListener('submit',send);
 id('newChat').addEventListener('click',()=>{
  ticketId=null;sessionToken=null;seen=new Set();log.replaceChildren();notice.textContent='';id('humanButton').classList.add('hidden');id('ratingPanel').classList.add('hidden');id('ratingForm').reset();id('appointmentPanel').classList.add('hidden');id('appointmentForm').reset();id('leadConsentLabel').classList.remove('hidden');id('leadConsent').checked=false;
  id('visitorName').disabled=false;id('visitorEmail').disabled=false;start();
 });
 setInterval(()=>{if(ticketId&&!busy)thread();},15000);
 start();
})();
