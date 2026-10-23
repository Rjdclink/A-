import {query} from './src/db.mjs';
import {ensureSchema} from './src/schema.mjs';
import {escapeHtml as e,passwordHash,passwordMatches,randomToken,digest,secureCookie,cookieToken,slugify,readForm,isValidEmail,rateLimit} from './src/security.mjs';
import {inspectWebsite,normalizePublicURL} from './src/scanner.mjs';
import {smtpReady,imapReady,closeMailTransport,sendMail,pollInbox} from './src/mail.mjs';
import {BADBLUE_EMAIL,getMailConnection,loadMailConnection,connectMail,updateMailOptions,disconnectMail,verifyGmailAppPassword,describeGmailFailure} from './src/mail_config.mjs';
import {analyzeOpportunity} from './src/ai.mjs';
import {venmoQR,VENMO_PROFILE,VENMO_USERNAME} from './src/payments.mjs';
import {cycle,createLead} from './src/workflows.mjs';
import {slotEligibility} from './src/booking.mjs';
const css='body{background:#081625;color:#eef6ff;font:16px/1.5 system-ui;margin:0}a{color:#5de5d2}nav{display:flex;justify-content:space-between;gap:18px;padding:22px;border-bottom:1px solid #31516b}main{max-width:960px;margin:40px auto;padding:0 20px}h1{font-size:clamp(30px,5vw,62px);line-height:1.1}.card{background:#12283f;padding:25px;border:1px solid #31516b;border-radius:15px;margin:18px 0}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:18px}.muted{color:#a5b8ca}button,.btn{background:#5de5d2;color:#051924;border:0;border-radius:9px;padding:12px 18px;font-weight:bold;cursor:pointer;display:inline-block;text-decoration:none}input,textarea{display:block;width:95%;padding:12px;margin:8px 0 18px;background:#081827;color:white;border:1px solid #50738b;border-radius:8px}input[type=checkbox]{width:20px;height:20px;display:inline;vertical-align:middle;margin:8px 8px 8px 0}label{display:block;margin:12px 0}textarea{min-height:110px}pre{white-space:pre-wrap;overflow-wrap:anywhere}';
const page=(title,body,status=200)=>new Response('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+e(title)+' | AI Revenue Recovery</title><style>'+css+'</style></head><body><nav><a href="/"><b>↗ AI Revenue Recovery</b></a><span><a href="/dashboard">Dashboard</a> · <a href="/billing">Venmo</a> · <a href="/login">Sign in</a></span></nav><main>'+body+'</main></body></html>',{status,headers:{'content-type':'text/html;charset=utf-8','x-content-type-options':'nosniff','content-security-policy':"default-src 'self'; style-src 'unsafe-inline'; img-src 'self' data:; form-action 'self'; frame-ancestors 'none'"}});
const go=(p,c)=>new Response(null,{status:303,headers:{location:p,...(c?{'set-cookie':c}:{})}});
const fld=(k,l,type='text')=>'<label>'+e(l)+'<input name="'+k+'" type="'+type+'" required maxlength="220"></label>';
async function auth(req){const t=cookieToken(req);if(!t)return null;const r=await query('SELECT b.* FROM sessions s JOIN businesses b ON b.id=s.business_id WHERE s.token_hash=$1 AND s.expires_at>now()',[digest(t)]);return r.rows[0];}
const fail=(s,code=400)=>page('Error','<div class="card"><h2>Unable to continue</h2><p>'+e(s)+'</p></div>',code);
async function handle(req){
 const u=new URL(req.url),p=u.pathname,m=req.method;
 if(p==='/health')return new Response(JSON.stringify({ok:true,ai:'Vireonix',billing:'manual Venmo QR'}),{headers:{'content-type':'application/json'}});
 if(p==='/venmo-qr.png')return new Response(await venmoQR(),{headers:{'content-type':'image/png'}});
 if(p==='/')return page('Home','<h1>Discover missed sales.<br><span style="color:#5de5d2">Recover more revenue.</span></h1><p class="muted">AI-powered public business research, personalized outreach, lead management and follow-up automation.</p><a class="btn" href="/signup">Create a workspace</a><div class="grid">'+[['Autonomous discovery','Discover online businesses through public links.'],['Revenue analysis','Analyze visible conversion friction and clearly label financial estimates.'],['AI correspondence','Draft personalized proposals and follow-ups.'],['Lead management','Capture inquiries and appointment requests.'],['Venmo checkout','Pay Bad Blue $299 monthly by QR code.']].map(([a,b])=>'<div class="card"><h2>'+a+'</h2><p>'+b+'</p></div>').join('')+'</div>');
 if(p==='/signup'&&m==='GET')return page('Register','<h1>Create workspace</h1><div class="card"><form method="POST">'+fld('name','Business name')+fld('email','Email','email')+fld('password','Password (12+ characters)','password')+'<button>Register</button></form></div>');
 if(p==='/login'&&m==='GET')return page('Sign in','<h1>Sign in</h1><div class="card"><form method="POST">'+fld('email','Username or email','text')+fld('password','Password','password')+'<button>Sign in</button></form></div>');
 if(p==='/signup'&&m==='POST'){const f=await readForm(req),name=String(f.get('name')||'').trim().slice(0,90),email=String(f.get('email')||'').toLowerCase().trim(),pw=String(f.get('password')||'');if(!name||!isValidEmail(email)||pw.length<12)return fail('Valid business name, email and password of 12+ characters required');const slug=slugify(name)+'-'+randomToken().replace(/[^a-z0-9]/gi,'').slice(0,8).toLowerCase();try{const r=await query('INSERT INTO businesses(owner_email,password_hash,name,slug,contact_email) VALUES($1,$2,$3,$4,$1) RETURNING id',[email,passwordHash(pw),name,slug]);const t=randomToken();await query("INSERT INTO sessions(token_hash,business_id,expires_at) VALUES($1,$2,now()+interval '30 days')",[digest(t),r.rows[0].id]);return go('/dashboard',secureCookie(t));}catch(ex){if(ex.code==='23505')return fail('Email already registered');throw ex;}}
 if(p==='/login'&&m==='POST'){if(!rateLimit(req,'login',5,3600000))return fail('Too many sign-in attempts. Try again later.',429);const f=await readForm(req),identifier=String(f.get('email')||'').toLowerCase().trim(),email=identifier==='rjdc'?'contact.badblue@gmail.com':identifier,pw=String(f.get('password')||'');const r=await query('SELECT * FROM businesses WHERE owner_email=$1',[email]);if(!r.rowCount||!passwordMatches(pw,r.rows[0].password_hash))return fail('Invalid credentials',401);const t=randomToken();await query("INSERT INTO sessions(token_hash,business_id,expires_at) VALUES($1,$2,now()+interval '30 days')",[digest(t),r.rows[0].id]);return go('/dashboard',secureCookie(t));}
 if(p==='/billing'&&m==='GET'){const b=await auth(req);return page('Venmo','<h1>$299 monthly subscription</h1><div class="card"><img src="/venmo-qr.png" alt="Bad Blue Venmo QR" style="width:330px;max-width:100%;background:white;padding:10px;border-radius:12px"><p>Pay Bad Blue (@'+e(VENMO_USERNAME)+') each month</p><a class="btn" href="'+e(VENMO_PROFILE)+'">Open Venmo</a><p class="muted">Manual payments are not automatically verified. Reporting a payment does not prove receipt.</p>'+(b?'<p>Account: '+e(b.subscription_status)+'</p><form method="POST" action="/billing/report"><button>Report payment sent</button></form>':'')+'</div>');}
 if(p==='/tasks'&&m==='POST'){const id=req.headers.get('x-neon-trigger-invocation-id'),token=req.headers.get('authorization')?.replace('Bearer ','');if(!id&&(!process.env.TASK_SECRET||token!==process.env.TASK_SECRET))return fail('Unauthorized',403);return new Response(JSON.stringify(await cycle()),{headers:{'content-type':'application/json'}});}
 if(p==='/logout'&&m==='POST'){const token=cookieToken(req);if(token)await query('DELETE FROM sessions WHERE token_hash=$1',[digest(token)]);return go('/login','__Host-arr_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0');}

 if(p.startsWith('/b/')){
   const match=p.match(/^\/b\/([a-z0-9_-]+)(?:\/(lead|book))?$/);
   if(!match)return fail('Not found',404);
   const businessResult=await query('SELECT * FROM businesses WHERE slug=$1',[match[1]]);
   if(!businessResult.rowCount)return fail('Business not found',404);
   const company=businessResult.rows[0],link='/b/'+e(company.slug);
   if(m==='GET'&&!match[2])return page(company.name,
      '<h1>'+e(company.name)+'</h1><p>'+e(company.description||'Tell us how we can help.')+'</p>'+
      '<div class="card"><h2>Ask about our services</h2><form method="POST" action="'+link+'/lead">'+
      fld('name','Name')+fld('email','Email','email')+
      '<label>Inquiry<textarea name="inquiry" required maxlength="2000"></textarea></label>'+
      '<label><input type="checkbox" name="consent" value="yes"> I consent to email responses and follow-ups about my inquiry.</label>'+
      '<input name="website" style="position:absolute;left:-9999px" tabindex="-1" autocomplete="off"><button>Send inquiry</button></form></div>'+
      '<div class="card"><h2>Request an appointment</h2><p class="muted">Choose a future time in UTC. The business will receive your request; this does not automatically confirm availability.</p>'+
      '<form method="POST" action="'+link+'/book">'+fld('name','Name')+fld('email','Email','email')+
      fld('starts_at','Preferred appointment date and time (UTC)','datetime-local')+
      '<label><input type="checkbox" name="consent" value="yes"> I consent to email responses about this booking.</label>'+
      '<input name="website" style="position:absolute;left:-9999px" tabindex="-1" autocomplete="off"><button>Request appointment</button></form></div>');
   if(m==='POST'&&match[2]){
     if(!rateLimit(req,'customer-form',10,3600000))return fail('Too many submissions; please try later',429);
     const form=await readForm(req);
     if(form.get('website'))return page('Thank you','<h2>Request received.</h2>');
     const name=String(form.get('name')||'').trim().slice(0,100);
     const email=String(form.get('email')||'').trim().toLowerCase();
     if(!name||!isValidEmail(email))return fail('A valid name and email are required');
     if(match[2]==='book'){
       const raw=String(form.get('starts_at')||'');
       if(!/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(raw))return fail('Choose a valid appointment time');
       const starts=new Date(raw+'Z');
       if(!Number.isFinite(starts.getTime())||starts.getTime()<Date.now()+15*60000||starts.getTime()>Date.now()+180*86400000)return fail('Select an appointment at least 15 minutes ahead, within six months');
       const lead=await createLead(company,{name,email,inquiry:'Appointment requested for '+starts.toISOString(),consent:form.get('consent')==='yes'});
       const eligible=slotEligibility(company,starts);
       let state='requested';
       if(eligible.available){
         try{
           await query("INSERT INTO appointments(business_id,lead_id,starts_at,status) VALUES($1,$2,$3,'confirmed')",[company.id,lead.id,starts.toISOString()]);
           state='confirmed';
         }catch(error){
           if(error.code!=='23505')throw error;
           await query("INSERT INTO appointments(business_id,lead_id,starts_at,status) VALUES($1,$2,$3,'requested')",[company.id,lead.id,starts.toISOString()]);
         }
       }else await query("INSERT INTO appointments(business_id,lead_id,starts_at,status) VALUES($1,$2,$3,'requested')",[company.id,lead.id,starts.toISOString()]);
       return page('Appointment '+state,'<div class="card"><h2>Appointment '+e(state)+'</h2><p>'+e(company.name)+' '+(state==='confirmed'?'has confirmed your internal booking for ':'received your booking request for ')+e(starts.toISOString())+'.</p><p class="muted">'+(state==='confirmed'?'Checked against the business-configured internal UTC calendar; external calendars are not synchronized.':'Availability requires business confirmation.')+'</p></div>');
     }
     const inquiry=String(form.get('inquiry')||'').trim().slice(0,2000);
     if(!inquiry)return fail('Please describe your inquiry');
     await createLead(company,{name,email,inquiry,consent:form.get('consent')==='yes'});
     return page('Thank you','<div class="card"><h2>Your inquiry was received.</h2></div>');
   }
   return fail('Method not allowed',405);
 }
 const b=await auth(req);if(!b)return go('/login');

 if(p==='/mail'&&m==='GET'){
  if(b.owner_email!=='brclink1985@gmail.com')return fail('Administrator access required',403);
  const config=await getMailConnection();
  const checked=(v)=>v?' checked':'';
  const status=config.connected?'<p><strong>Gmail SMTP and IMAP verified on '+e(config.verified_at)+'.</strong></p>':'<p><strong>Gmail has not been connected to this hosted platform.</strong></p>';
  const credsPresent=process.env.MAIL_ENCRYPTION_KEY?'<p class="muted">Encrypted credential storage is configured on Neon.</p>':'<p class="muted">Server credential encryption must be configured before connecting.</p>';
  const form='<div class="card"><h2>'+e(BADBLUE_EMAIL)+'</h2>'+status+credsPresent+
    '<p>The Gmail account already connected to ChatGPT does not automatically grant access to this independent website.</p>'+
    '<div class="card"><h3>Use your existing Gmail password on Google, not in this form</h3><p>Your ordinary Gmail password cannot authorize SMTP or IMAP directly. Keep your regular password unchanged: sign in on Google, then create a separate 16-character App Password for this platform.</p><p><a class="btn" href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener noreferrer">Open Google App Passwords</a></p><p class="muted">Google requires 2-Step Verification. If App Passwords is unavailable, a separately configured Sign in with Google (OAuth) integration is required.</p></div>'+
    '<p class="muted">Enter it below directly on this HTTPS website, never into GitHub or chat. The server verifies both SMTP sending access and IMAP incoming access without sending a test email, then encrypts the credential in Neon.</p>'+
    '<form method="POST" action="/mail/connect" autocomplete="off"><label>Google-generated App Password (16 characters, NOT your regular Gmail password)<input type="password" name="app_password" autocomplete="new-password" required minlength="16" maxlength="25"></label>'+
    '<label>Business postal mailing address (required for outbound promotional outreach)<textarea name="postal_address" maxlength="350">'+e(config.postal_address||'')+'</textarea></label>'+
    '<label><input name="outreach" type="checkbox" value="yes"'+checked(config.outreach_enabled)+'> Enable automated outreach to public business contacts (max 10/day; includes unsubscribe instructions)</label>'+
    '<label><input name="ai_replies" type="checkbox" value="yes"'+checked(config.ai_replies_enabled)+'> Allow correspondence from platform conversations to be processed by the third-party AI provider (Vireonix), and automatically send context-aware replies</label>'+
    '<button>Verify Gmail and connect</button></form></div>';
  const options=config.connected?'<div class="card"><h2>Automation settings</h2><form method="POST" action="/mail/options">'+
    '<label>Business postal address<textarea name="postal_address" maxlength="350">'+e(config.postal_address||'')+'</textarea></label>'+
    '<label><input type="checkbox" name="outreach" value="yes"'+checked(config.outreach_enabled)+'> Enable automated B2B outreach</label>'+
    '<label><input type="checkbox" name="ai_replies" value="yes"'+checked(config.ai_replies_enabled)+'> AI-powered automated responses (email contents processed by Vireonix)</label>'+
    '<button>Save automation options</button></form>'+
    '<form method="POST" action="/mail/verify"><button>Recheck SMTP + incoming IMAP</button></form>'+
    '<form method="POST" action="/mail/test-send"><button>Send a test message to this Gmail inbox</button></form>'+ 
    '<form method="POST" action="/mail/poll-now"><button>Check for platform replies now</button></form>'+ 
    '<form method="POST" action="/mail/disconnect"><button>Disconnect and erase saved Gmail app credential</button></form></div>':'';
  const inbox='<div class="card"><h2>Correspondence</h2><a href="/mail/inbox">View received replies and prepared outbound drafts</a></div>';
  const resp=page('Gmail connection','<h1>Connect Gmail sending and incoming replies</h1>'+form+options+inbox);
  resp.headers.set('cache-control','private, no-store');return resp;
 }
 if(p==='/mail/connect'&&m==='POST'){
  if(b.owner_email!=='brclink1985@gmail.com')return fail('Administrator access required',403);
  if(!rateLimit(req,'mail-connect',4,3600000))return fail('Too many connection attempts; try again later',429);
  const f=await readForm(req);
  try{
    await connectMail({password:f.get('app_password'),postalAddress:f.get('postal_address'),outreach:f.get('outreach')==='yes',aiReplies:f.get('ai_replies')==='yes'});
    closeMailTransport();return go('/mail');
  }catch(error){const detail=describeGmailFailure(error);console.warn('Gmail connection rejected:',detail.code,'stage:',detail.stage);return fail(detail.message+' (Error: '+detail.code+')',422);}
 }
 if(p==='/mail/options'&&m==='POST'){
  if(b.owner_email!=='brclink1985@gmail.com')return fail('Administrator access required',403);
  const f=await readForm(req);
  try{await updateMailOptions({postalAddress:f.get('postal_address'),outreach:f.get('outreach')==='yes',aiReplies:f.get('ai_replies')==='yes'});}catch(error){return fail(String(error.message).slice(0,160),422);}
  return go('/mail');
 }
 if(p==='/mail/verify'&&m==='POST'){
  if(b.owner_email!=='brclink1985@gmail.com')return fail('Administrator access required',403);
  if(!smtpReady()||!imapReady())return fail('Connect Gmail first',422);
  try{await verifyGmailAppPassword(process.env.SMTP_PASSWORD);return page('Gmail verified','<h2>Gmail sending and incoming connections verified.</h2><a href="/mail">Mail settings</a>');}
  catch(error){const detail=describeGmailFailure(error);console.warn('Gmail recheck rejected:',detail.code,'stage:',detail.stage);return fail(detail.message+' (Error: '+detail.code+')',422);}
 }
 if(p==='/mail/test-send'&&m==='POST'){
  if(b.owner_email!=='brclink1985@gmail.com')return fail('Administrator access required',403);
  if(!rateLimit(req,'mail-test-send',3,3600000))return fail('Test email sending is limited to three per hour',429);
  if(!smtpReady())return fail('Connect Gmail first',422);
  try{
   await sendMail({to:BADBLUE_EMAIL,subject:'AI Revenue Recovery Gmail connection test',body:'This test confirms the hosted platform can send email from your configured Bad Blue Gmail mailbox. This message does not contact any outside business.'});
   return page('Test message sent','<h2>Gmail accepted your test message.</h2><p>Check the inbox at '+e(BADBLUE_EMAIL)+'.</p><a href="/mail">Return to Gmail settings</a>');
  }catch(error){console.warn('Mailbox test sending failed:',error.code||error.name);return fail('Gmail sending failed. Code: '+String(error.code||'delivery-error').slice(0,45),422);}
 }
 if(p==='/mail/poll-now'&&m==='POST'){
  if(b.owner_email!=='brclink1985@gmail.com')return fail('Administrator access required',403);
  if(!rateLimit(req,'mail-test-poll',8,3600000))return fail('Mailbox checks are limited; wait a few minutes',429);
  if(!imapReady())return fail('Connect Gmail first',422);
  try{
   const r=await pollInbox({maxMessages:16});
   return page('Mail check complete','<h2>Gmail inbox checked.</h2><p>Messages examined: '+Number(r.examined||0)+'; platform replies handled: '+Number(r.handled||0)+'.</p><a href="/mail/inbox">View platform correspondence</a>');
  }catch(error){console.warn('Gmail polling failed:',error.code||error.name);return fail('Gmail inbox check failed. Code: '+String(error.code||'read-error').slice(0,45),422);}
 }

 if(p==='/mail/disconnect'&&m==='POST'){
  if(b.owner_email!=='brclink1985@gmail.com')return fail('Administrator access required',403);
  closeMailTransport();await disconnectMail();return go('/mail');
 }
 if(p==='/mail/inbox'&&m==='GET'){
  if(b.owner_email!=='brclink1985@gmail.com')return fail('Administrator access required',403);
  const inbox=await query("SELECT direction,status,sender,recipient,subject,body,created_at FROM correspondence WHERE direction='inbound' OR status IN ('draft','retry','error','sent') ORDER BY created_at DESC LIMIT 50");
  return page('Correspondence','<h1>Gmail correspondence</h1><p class="muted">Received platform-related replies and prepared message drafts. This is not a copy of unrelated Gmail conversations.</p>'+
    inbox.rows.map(x=>'<div class="card"><p><strong>'+e(x.direction)+' · '+e(x.status)+'</strong> '+e(x.created_at)+'</p><p>From: '+e(x.sender)+' · To: '+e(x.recipient)+'</p><h3>'+e(x.subject)+'</h3><pre>'+e(x.body.slice(0,3000))+'</pre></div>').join('')+
    (!inbox.rows.length?'<p>No platform correspondence yet.</p>':'')+'<a href="/mail">Mail settings</a>');
 }

 if(p==='/billing/report'&&m==='POST'){
   const month=new Date().toISOString().slice(0,7);
   await query("INSERT INTO payments(business_id,month,monthly_amount,status) VALUES($1,$2,299,'unverified') ON CONFLICT(business_id,month) DO UPDATE SET reported_at=now(),status='unverified'",[b.id,month]);
   await query("UPDATE businesses SET subscription_status='pending_review' WHERE id=$1 AND subscription_status<>'active'",[b.id]);
   return go('/billing');
 }
 if(p==='/appointments'&&m==='GET'){
   const r=await query('SELECT a.*,l.name AS customer_name,l.email AS customer_email FROM appointments a LEFT JOIN leads l ON l.id=a.lead_id WHERE a.business_id=$1 ORDER BY a.starts_at DESC LIMIT 100',[b.id]);
   return page('Appointments','<h1>Appointment requests</h1><p class="muted">Requests are tracked here; a confirmed booking requires verified business availability.</p>'+
      r.rows.map(x=>'<div class="card"><strong>'+e(x.customer_name||'Customer')+'</strong> — '+e(x.customer_email||'')+'<p>'+e(new Date(x.starts_at).toISOString())+' UTC · '+e(x.status)+'</p></div>').join('')+
      (!r.rows.length?'<div class="card">No appointments requested.</div>':''));
 }
 if(p==='/invoices'&&m==='GET'){
   const [invoices,leads]=await Promise.all([
     query('SELECT * FROM invoices WHERE business_id=$1 ORDER BY created_at DESC LIMIT 100',[b.id]),
     query("SELECT id,name,email FROM leads WHERE business_id=$1 AND consent=true ORDER BY created_at DESC LIMIT 100",[b.id])
   ]);
   const options=leads.rows.map(l=>'<option value="'+e(l.id)+'">'+e(l.name)+' ('+e(l.email)+')</option>').join('');
   return page('Invoices','<h1>Invoice reminders</h1><p class="muted">Send reminders only to existing customers who consented to email communication; delivery requires connected SMTP.</p>'+
     '<div class="card"><h2>Create customer invoice</h2><form method="POST" action="/invoices">'+
     '<label>Customer <select name="lead_id" required style="display:block;width:100%;padding:12px;margin:7px 0 17px"><option value="">Choose a consenting customer</option>'+options+'</select></label>'+
     fld('amount','Amount in USD, for example 299.00')+fld('due_at','Due date (UTC)','date')+
     '<label>HTTPS invoice payment link (optional)<input name="payment_url" type="url" maxlength="500"></label><button>Create invoice</button></form></div>'+
     '<h2>Invoice status</h2>'+invoices.rows.map(x=>'<div class="card"><strong>'+e(x.customer_name)+'</strong> — $'+(Number(x.amount_cents)/100).toFixed(2)+' · '+e(x.status)+
       '<p>Due '+e(new Date(x.due_at).toISOString().slice(0,10))+' · Reminders sent: '+Number(x.reminded_count||0)+'</p>'+
       (x.status==='unpaid'?'<form method="POST" action="/invoices/paid"><input type="hidden" name="id" value="'+e(x.id)+'"><button>Mark paid after confirmation</button></form>':'')+'</div>').join('')+
     (!invoices.rows.length?'<div class="card">No invoices yet.</div>':''));
 }
 if(p==='/invoices'&&m==='POST'){
   const f=await readForm(req),leadId=String(f.get('lead_id')||''),amount=String(f.get('amount')||'').trim(),due=String(f.get('due_at')||'');
   if(!/^[0-9a-f-]{36}$/.test(leadId)||!/^\d{1,6}(?:\.\d{1,2})?$/.test(amount)||!/^\d{4}-\d\d-\d\d$/.test(due))return fail('Valid customer, amount and due date are required');
   const cents=Math.round(Number(amount)*100);
   if(!Number.isInteger(cents)||cents<=0||cents>100000000)return fail('Invoice amount is outside supported limits');
   const lead=await query('SELECT name,email FROM leads WHERE id=$1 AND business_id=$2 AND consent=true',[leadId,b.id]);
   if(!lead.rowCount)return fail('Customer must exist and have consented to email');
   const paymentRaw=String(f.get('payment_url')||'').trim().slice(0,500);
   let paymentUrl='';
   if(paymentRaw){try{const u=normalizePublicURL(paymentRaw);if(u.protocol!=='https:')throw Error('HTTPS required');paymentUrl=u.href;}catch{return fail('Use a valid public HTTPS payment link');}}
   const dueDate=new Date(due+'T00:00:00Z');
   if(!Number.isFinite(dueDate.getTime()))return fail('Invalid due date');
   await query("INSERT INTO invoices(business_id,lead_id,customer_name,email,amount_cents,due_at,payment_url,status) VALUES($1,$2,$3,$4,$5,$6,$7,'unpaid')",[b.id,leadId,lead.rows[0].name,lead.rows[0].email,cents,dueDate.toISOString(),paymentUrl]);
   return go('/invoices');
 }
 if(p==='/invoices/paid'&&m==='POST'){
   const f=await readForm(req),invoiceId=String(f.get('id')||'');
   if(!/^[0-9a-f-]{36}$/.test(invoiceId))return fail('Invalid invoice ID');
   await query("UPDATE invoices SET status='paid' WHERE business_id=$1 AND id=$2",[b.id,invoiceId]);
   return go('/invoices');
 }


 if(p==='/dashboard'){
   const admin=b.owner_email==='brclink1985@gmail.com';
   const internal=admin?await query("SELECT id FROM businesses WHERE owner_email='system@ai-revenue-recovery.invalid'"):null;
   const scopeId=admin&&internal?.rows[0]?.id||b.id;
   const [leads,appointments,scans,opportunities,contacts,pending,scanned,mailCount]=await Promise.all([
     query('SELECT count(*)::int n FROM leads WHERE business_id=$1',[b.id]),
     query('SELECT count(*)::int n FROM appointments WHERE business_id=$1',[b.id]),
     query('SELECT count(*)::int n FROM business_scans WHERE business_id=$1 OR business_id=$2',[b.id,scopeId]),
     query("SELECT COALESCE(SUM(CASE WHEN jsonb_typeof(analysis->'opportunities')='array' THEN jsonb_array_length(analysis->'opportunities') ELSE 0 END),0)::int n FROM prospects WHERE business_id=$1 AND status IN ('analyzed','contacted')",[scopeId]),
     query("SELECT company_name,host,contact_email,contacted_at FROM prospects WHERE business_id=$1 AND status='contacted' AND contacted_at IS NOT NULL ORDER BY contacted_at DESC LIMIT 100",[scopeId]),
     query("SELECT count(*)::int n FROM prospects WHERE business_id=$1 AND status='pending'",[scopeId]),
     query("SELECT p.website,p.company_name,p.host,p.status,p.scanned_at,(SELECT s.id FROM business_scans s WHERE s.business_id=p.business_id AND split_part(replace(replace(replace(s.website,'https://www.',''),'https://',''),'http://',''),'/',1)=split_part(replace(replace(replace(p.website,'https://www.',''),'https://',''),'http://',''),'/',1) ORDER BY s.created_at DESC LIMIT 1) AS report_id FROM prospects p WHERE p.business_id=$1 AND p.status IN ('analyzed','contacted') AND p.scanned_at IS NOT NULL ORDER BY p.scanned_at DESC LIMIT 100",[scopeId]),
     query("SELECT count(*)::int n FROM correspondence WHERE business_id=$1 AND direction='outbound' AND status='sent'",[scopeId])
   ]);
   const count=(label,value)=>'<div class="card"><h2>'+e(String(value))+'</h2><p>'+e(label)+'</p></div>';
   const companyLines=contacts.rows.length?contacts.rows.map(x=>'<p><strong>'+e(x.company_name||x.host)+'</strong> — '+e(x.contact_email)+' — '+e(new Date(x.contacted_at).toISOString())+'</p>').join(''):'<p>No verified outbound company emails have been sent.</p>';
   const siteLines=scanned.rows.length?'<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse"><tr><th>Company</th><th>Website</th><th>Completed</th><th>Analysis</th></tr>'+
      scanned.rows.map(x=>'<tr><td>'+e(x.company_name||x.host)+'</td><td><a rel="noopener noreferrer" target="_blank" href="'+e(x.website)+'">'+e(x.website)+'</a></td><td>'+e(new Date(x.scanned_at).toISOString())+'</td><td>'+(x.report_id?'<a href="/report/'+e(x.report_id)+'">View full report</a>':'Report unavailable')+'</td></tr>').join('')+'</table></div>':'<p>No successfully analyzed company websites yet.</p>';
   const sections='<div class="grid">'+count('Customer inquiries',leads.rows[0].n)+count('Appointment requests',appointments.rows[0].n)+count('Completed website analyses',scans.rows[0].n)+count('Opportunities identified',opportunities.rows[0].n)+count('Queued company sites',pending.rows[0].n)+count('Confirmed company emails sent',mailCount.rows[0].n)+'</div>';
   return page('Dashboard','<h1>'+e(b.name)+' dashboard</h1>'+
     '<div class="card"><p>Outbound sender: <strong>contact.badblue@gmail.com</strong> · <a href="/mail">Configure Gmail</a></p><p>Automated sending: <strong>'+(smtpReady()?'Connected':'Not connected')+'</strong> · Incoming replies: <strong>'+(imapReady()?'Connected':'Not connected')+'</strong></p><p class="muted">Neon discovery trigger runs every 5 minutes; only successfully completed reviews count.</p></div>'+
     sections+
     '<div class="card"><h2>Companies contacted ('+contacts.rows.length+' latest)</h2>'+companyLines+'</div>'+
     '<div class="card"><h2>Company websites successfully scanned ('+scanned.rows.length+' latest)</h2>'+siteLines+'</div>'+
     '<div class="grid"><div class="card"><h2>AI analyzer</h2><a href="/scan">Review a website</a></div>'+
     '<div class="card"><h2>Customer inquiries</h2><a href="/leads">View leads</a><p><a href="/b/'+e(b.slug)+'">Public customer form</a></p></div>'+
     '<div class="card"><h2>Appointments</h2><a href="/appointments">View requests</a></div>'+
     '<div class="card"><h2>Invoices</h2><a href="/invoices">Manage invoice reminders</a></div>'+
     '<div class="card"><h2>Payments</h2><a href="/billing">Bad Blue Venmo QR</a></div>'+
     '<div class="card"><h2>Business settings</h2><a href="/settings">Configure business</a></div></div>');
 }
 if(p==='/settings'&&m==='GET')return page('Settings','<h1>Business settings</h1><form method="POST"><label>Description<textarea name="description">'+e(b.description)+'</textarea></label><label>Services<textarea name="services">'+e(b.services)+'</textarea></label><label>FAQ<textarea name="faq">'+e(b.faq)+'</textarea></label><div class="card"><h2>Internal appointment booking (UTC)</h2><p class="muted">Only enable if these hours match your business. No external calendar is synchronized.</p><label><input type="checkbox" name="booking_enabled" value="yes" '+(b.booking_enabled?'checked':'')+'> Automatically confirm free slots</label><label>Start hour (UTC)<input type="number" name="booking_start_hour" min="0" max="23" value="'+Number(b.booking_start_hour??9)+'"></label><label>End hour (UTC)<input type="number" name="booking_end_hour" min="1" max="24" value="'+Number(b.booking_end_hour??17)+'"></label><label>Minutes per slot<select name="booking_slot_minutes"><option value="15" '+(Number(b.booking_slot_minutes)===15?'selected':'')+'>15</option><option value="30" '+(Number(b.booking_slot_minutes)===30?'selected':'')+'>30</option><option value="60" '+(Number(b.booking_slot_minutes)===60?'selected':'')+'>60</option></select></label></div><button>Save settings</button></form>');
 if(p==='/settings'&&m==='POST'){const f=await readForm(req);const start=Number(f.get('booking_start_hour')??9),end=Number(f.get('booking_end_hour')??17),duration=Number(f.get('booking_slot_minutes')??30);if(!Number.isInteger(start)||!Number.isInteger(end)||start<0||end>24||start>=end||![15,30,60].includes(duration))return fail('Choose valid UTC business hours and duration');await query('UPDATE businesses SET description=$2,services=$3,faq=$4,booking_enabled=$5,booking_start_hour=$6,booking_end_hour=$7,booking_slot_minutes=$8 WHERE id=$1',[b.id,String(f.get('description')||'').slice(0,3000),String(f.get('services')||'').slice(0,3000),String(f.get('faq')||'').slice(0,3000),f.get('booking_enabled')==='yes',start,end,duration]);return go('/dashboard');}
 if(p==='/leads'){const r=await query('SELECT * FROM leads WHERE business_id=$1 ORDER BY created_at DESC LIMIT 100',[b.id]);return page('Leads','<h1>Customer inquiries</h1>'+r.rows.map(x=>'<div class="card"><strong>'+e(x.name)+' — '+e(x.email)+'</strong><p>'+e(x.inquiry)+'</p></div>').join(''));}
 if(p==='/scan'&&m==='GET')return page('AI analysis','<h1>Analyze a public website</h1><div class="card"><form method="POST">'+fld('url','Public website URL','url')+'<button>Analyze with AI</button></form></div>');
 if(p==='/scan'&&m==='POST'){const f=await readForm(req);let observation,analysis;try{observation=await inspectWebsite(String(f.get('url')||''));analysis=await analyzeOpportunity(observation);}catch(ex){return fail('Website analysis unavailable: '+ex.message,422);}const r=await query('INSERT INTO business_scans(business_id,website,page_title,evidence,ai_analysis,outreach_draft) VALUES($1,$2,$3,$4,$5,$6) RETURNING id',[b.id,observation.url,observation.title,JSON.stringify(observation),JSON.stringify(analysis),analysis.email_body]);return go('/report/'+r.rows[0].id);}
 if(p.startsWith('/report/')){
  const id=p.split('/')[2];
  if(!/^[a-f0-9-]{36}$/.test(id))return fail('Not found',404);
  const internal=b.owner_email==='brclink1985@gmail.com'?await query("SELECT id FROM businesses WHERE owner_email='system@ai-revenue-recovery.invalid'"):null;
  const scopeId=internal?.rows[0]?.id||b.id;
  const r=await query('SELECT * FROM business_scans WHERE id=$2 AND (business_id=$1 OR business_id=$3)',[b.id,id,scopeId]);
  if(!r.rowCount)return fail('Not found',404);
  const report=JSON.parse(r.rows[0].ai_analysis),audit=report.technical_audit||null;
  const coverage=(audit?.page_coverage||[]).map(p=>'<li><a rel="noopener noreferrer" target="_blank" href="'+e(p.url)+'">'+e(p.title||p.url)+'</a> — '+e(p.kind)+'</li>').join('');
  const problems=(audit?.findings||[]).map(f=>'<div class="card"><h3>'+e(f.code.replace(/-/g,' '))+'</h3><p>'+e(f.evidence)+'</p><p>Evidence strength: '+e(f.confidence)+' · Observed on '+Number(f.occurrences||1)+' page(s)</p><p><a rel="noopener noreferrer" target="_blank" href="'+e(f.url)+'">Inspect original public page</a></p><p><strong>Proposed improvement:</strong> '+e(f.service)+'</p><p class="muted">'+e(f.assumptions)+'</p></div>').join('');
  const advice=(report.opportunities||[]).map(x=>'<div class="card"><h3>'+e(x.finding)+'</h3><p><strong>Evidence:</strong> '+e(x.evidence)+'</p>'+(x.source_url?'<p><a rel="noopener noreferrer" href="'+e(x.source_url)+'" target="_blank">View cited website</a></p>':'')+'<p><strong>Suggested remedy:</strong> '+e(x.service)+'</p><p class="muted">'+e(x.impact_scenario)+' · '+e(x.assumptions)+'</p></div>').join('');
  const review=audit?'<div class="card"><h2>Multi-page research coverage</h2><p>Public pages: '+Number(audit.pages_audited||0)+' · Evidence categories: '+Number(audit.findings_count||0)+' · Review priority '+Number(audit.score?.value||0)+'/100 (heuristic, not actual revenue)</p><ul>'+coverage+'</ul></div>':'';
  return page('Website review','<h1>'+e(report.company_name)+'</h1><p>'+e(report.summary)+'</p><p class="muted">This report uses public website observations only: business profits, real cart abandonment, and lost revenue were not independently verified.</p>'+review+'<h2>AI opportunity analysis</h2>'+advice+(audit?'<h2>Independent evidence checks</h2>'+problems:'')+'<div class="card"><h2>Tailored outreach draft</h2><strong>'+e(report.email_subject)+'</strong><pre>'+e(report.email_body)+'</pre></div>');
 }

 return fail('Not found',404);
}
export default {async fetch(req){try{if(req.method==='POST'&&!['/tasks'].includes(new URL(req.url).pathname)){const origin=req.headers.get('origin');if(origin&&origin!==new URL(req.url).origin)return fail('Invalid origin',403);}if(new URL(req.url).pathname!=='/health'&&new URL(req.url).pathname!=='/venmo-qr.png'&&new URL(req.url).pathname!=='/')await ensureSchema();if(new URL(req.url).pathname!=='/health')await loadMailConnection();return await handle(req);}catch(ex){console.error('Application error',ex);return fail('Temporary service issue',503);}}};
