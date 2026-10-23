const STEP_TYPES={
 template:{label:'Text',icon:'T',defaults:{template:'{{input.message}}'}},
 ai:{label:'AI',icon:'✦',defaults:{system:'Use supplied evidence. Be concise and accurate.',prompt:'{{input.message}}'}},
 agent_team:{label:'AI team',icon:'◈',defaults:{agents:[{name:'analyst',prompt:'Analyze {{input.question}}'},{name:'reviewer',prompt:'Review the analysis: {{agents.analyst}}'}],review_prompt:'Summarize these assessments: {{agents.analyst}} {{agents.reviewer}}'}},
 knowledge:{label:'Knowledge',icon:'▤',defaults:{query:'{{input.question}}'}},
 subworkflow:{label:'Call automation',icon:'↳',defaults:{workflow_id:'',input_map:{task:'{{input.message}}'}}},
 approval:{label:'Approval',icon:'✓',defaults:{message:'Please review this result.'}},
 branch:{label:'Decision',icon:'◇',defaults:{condition:{path:'input.approved',operator:'eq',value:true}}},
 http_get:{label:'API read',icon:'↗',defaults:{url:'https://api.example.com/resource'}},
 http_post:{label:'API action',icon:'⇢',defaults:{url:'https://api.example.com/action',body_template:'{{input.message}}'}}
};
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>{
 if(c==='&')return '&amp;';
 if(c==='<')return '&lt;';
 if(c==='>')return '&gt;';
 if(c==='"')return '&quot;';
 return '&#39;';
});
const clone=x=>JSON.parse(JSON.stringify(x));
const links=s=>s.type==='branch'?[{id:s.yes,label:'Yes'},{id:s.no,label:'No'}]:s.next?[{id:s.next,label:''}]:[];

/** Deterministic top-to-bottom layout of validated acyclic workflows. */
export function graphLayout(spec){
 const byId=new Map((spec.steps||[]).map(s=>[s.id,s]));
 const depth=new Map(),visit=(id,n,trail)=>{
  if(trail.has(id))throw Error('Workflow contains a cycle');
  const step=byId.get(id);if(!step)return;
  if((depth.get(id)??-1)>=n)return;
  depth.set(id,n);
  const nextTrail=new Set(trail);nextTrail.add(id);
  for(const edge of links(step))visit(edge.id,n+1,nextTrail);
 };
 visit(spec.start,0,new Set());
 const byLevel=new Map();
 for(const step of spec.steps||[]){if(!depth.has(step.id))continue;const d=depth.get(step.id);if(!byLevel.has(d))byLevel.set(d,[]);byLevel.get(d).push(step.id);}
 const maxWidth=Math.max(1,...[...byLevel.values()].map(xs=>xs.length));
 const positions=new Map();
 for(const [level,ids] of byLevel){
  ids.forEach((id,i)=>positions.set(id,{x:46+i*252+(maxWidth-ids.length)*126,y:64+level*155}));
 }
 const nodes=[...positions].map(([id,pos])=>({...pos,id,step:byId.get(id)}));
 const edges=[];
 for(const node of nodes){
  for(const edge of links(node.step)){
   const target=positions.get(edge.id);if(target)edges.push({from:node.id,to:edge.id,label:edge.label,x1:node.x+104,y1:node.y+86,x2:target.x+104,y2:target.y});
  }
 }
 return {nodes,edges,width:Math.max(340,92+maxWidth*252),height:Math.max(340,160+byLevel.size*155)};
}
function generateId(spec,type){
 const base=type.replace(/[^a-z_]/g,'')||'step',ids=new Set(spec.steps.map(s=>s.id));
 for(let i=1;i<=1000;i++){const key=base+'_'+i;if(!ids.has(key))return key;}
 throw Error('No available step identifiers');
}
/** Inserts one node into a selected edge, preserving the old successor. */
export function insertStep(spec,afterId,type,branchPath='yes'){
 if(!STEP_TYPES[type])throw Error('Unknown step type');
 if((spec.steps||[]).length>=40)throw Error('Maximum 40 steps');
 const copy=clone(spec),previous=copy.steps.find(s=>s.id===afterId);
 if(!previous)throw Error('Select a step first');
 if(previous.type==='end')throw Error('Select a step before Finish');
 const path=previous.type==='branch'?(branchPath==='no'?'no':'yes'):'next';
 const oldTarget=previous[path],newId=generateId(copy,type);
 const inserted={id:newId,type,...clone(STEP_TYPES[type].defaults)};
 if(type==='branch'){
  if(!oldTarget)throw Error('Add an outcome after this step first');
  inserted.yes=oldTarget;inserted.no=oldTarget;
 }else if(oldTarget)inserted.next=oldTarget;
 previous[path]=newId;copy.steps.push(inserted);
 return copy;
}
export function removeStep(spec,stepId){
 const copy=clone(spec),step=copy.steps.find(s=>s.id===stepId);
 if(!step||step.type==='end'||step.type==='branch'||!step.next)throw Error('This step cannot be removed safely');
 for(const other of copy.steps){
  for(const key of ['next','yes','no'])if(other[key]===stepId)other[key]=step.next;
 }
 if(copy.start===stepId)copy.start=step.next;
 copy.steps=copy.steps.filter(s=>s.id!==stepId);
 return copy;
}
const field=(label,key,value,textarea=false)=>{
 const id='gv-'+key.replaceAll('.','-');
 return `<label class="gv-field" for="${esc(id)}">${esc(label)}${textarea?`<textarea id="${esc(id)}" data-gv-field="${esc(key)}">${esc(value)}</textarea>`:`<input id="${esc(id)}" data-gv-field="${esc(key)}" value="${esc(value)}">`}</label>`;
};
const select=(label,key,options,value)=>{
 const id='gv-'+key.replaceAll('.','-');
 return `<label class="gv-field" for="${esc(id)}">${esc(label)}<select id="${esc(id)}" data-gv-field="${esc(key)}">${options.map(o=>`<option value="${esc(o.value)}" ${String(o.value)===String(value)?'selected':''}>${esc(o.label)}</option>`).join('')}</select></label>`;
};
const options=(steps,selected)=>[{value:'',label:'End this path'},...steps.filter(s=>s.id!==selected).map(s=>({value:s.id,label:s.id}))];
function error(el,message){const node=el.querySelector('.gv-error');node.textContent=message||'';}
function setField(step,path,value){
 if(path==='condition.value'){
  let result=value;try{const parsed=JSON.parse(value);if(parsed===null||typeof parsed!=='object')result=parsed;}catch{}
  step.condition.value=result;
 }else if(path.startsWith('condition.'))step.condition[path.split('.')[1]]=value;
 else if(path==='agents'){
  let agents;try{agents=JSON.parse(value);}catch{throw Error('Agent list must be valid JSON');}
  if(!Array.isArray(agents))throw Error('Agent list must be an array');
  step.agents=agents;
 }else if(path==='input_map'){
  let input;
  try{input=JSON.parse(value);}catch{throw Error('Input map must be valid JSON');}
  if(!input||Array.isArray(input)||typeof input!=='object')throw Error('Input map must be an object');
  step.input_map=input;
 }else if(path==='connection_id'){
  if(value)step.connection_id=value;else delete step.connection_id;
 }else if(value===''&&['next'].includes(path))delete step.next;
 else step[path]=value;
}
function inspector(step,spec,connections,workflows=[],ownerId=''){
 if(!step)return '<p class="gv-hint">Select a step to edit it.</p>';
 const kind=STEP_TYPES[step.type]?.label||step.type;
 let html=`<h3>${esc(step.id)}</h3><p class="gv-hint">${esc(kind)} step</p>`;
 switch(step.type){
 case 'template':html+=field('Text','template',step.template||'',true);break;
 case 'ai':html+=field('Instructions','system',step.system||'',true)+field('Prompt','prompt',step.prompt||'',true);break;
 case 'knowledge':html+=field('Search question','query',step.query||'',true);break;
 case 'subworkflow':
  html+=select('Select automation','workflow_id',
    [{value:'',label:'Choose an automation'},...workflows.filter(w=>w.id!==ownerId).map(w=>({value:w.id,label:w.name}))],
    step.workflow_id||'');
  html+='<p class="gv-hint">Runs this automation, waits for its result, then continues. Results are available as {{steps.'+esc(step.id)+'.output}}.</p>';
  html+=`<details class="gv-advanced"><summary>Input mapping</summary>${field('Inputs (JSON)','input_map',JSON.stringify(step.input_map||{},null,2),true)}</details>`;
  break;
 case 'approval':html+=field('Approval request','message',step.message||'',true);break;
 case 'agent_team':
  html+=field('Final synthesis','review_prompt',step.review_prompt||'',true);
  html+=`<details class="gv-advanced"><summary>Edit specialists</summary>${field('Specialist definitions (JSON)','agents',JSON.stringify(step.agents||[],null,2),true)}</details>`;
  break;
 case 'branch':
  html+=field('Value to inspect','condition.path',step.condition?.path||'');
  html+=select('Comparison','condition.operator',['eq','ne','gt','gte','lt','lte','contains','exists'].map(x=>({value:x,label:x})),step.condition?.operator||'eq');
  html+=field('Compare with','condition.value',typeof step.condition?.value==='string'?step.condition.value:JSON.stringify(step.condition?.value??''));
  html+=select('If yes','yes',options(spec.steps,step.id),step.yes);
  html+=select('If no','no',options(spec.steps,step.id),step.no);
  break;
 case 'http_get':case 'http_post':
  html+=field('HTTPS address','url',step.url||'');
  if(step.type==='http_post')html+=field('Request body','body_template',step.body_template||'',true);
  html+=select('Connection','connection_id',[{value:'',label:'No credential'},...(connections||[]).map(c=>({value:c.id,label:c.name}))],step.connection_id||'');
  html+='<p class="gv-hint">The hostname must be approved in Advanced JSON settings.</p>';
  break;
 }
 if(step.type!=='branch'&&step.type!=='end')html+=select('Next step','next',options(spec.steps,step.id),step.next||'');
 if(step.type!=='end'&&step.type!=='branch')html+='<button class="gv-action plain" type="button" data-gv-action="remove">Remove step</button>';
 return html;
}
function draw(el,state){
 const layout=graphLayout(state.spec);
 const stage=el.querySelector('.gv-stage');stage.style.width=layout.width+'px';stage.style.height=layout.height+'px';stage.replaceChildren();
 const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('class','gv-links');
 svg.setAttribute('width',String(layout.width));svg.setAttribute('height',String(layout.height));
 svg.setAttribute('viewBox',`0 0 ${layout.width} ${layout.height}`);
 const defs=document.createElementNS('http://www.w3.org/2000/svg','defs');
 defs.innerHTML='<marker id="gv-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#788bb7"/></marker>';
 svg.append(defs);
 for(const edge of layout.edges){
  const p=document.createElementNS('http://www.w3.org/2000/svg','path');
  p.setAttribute('d',`M ${edge.x1} ${edge.y1} C ${edge.x1} ${edge.y1+48} ${edge.x2} ${edge.y2-50} ${edge.x2} ${edge.y2-7}`);
  p.setAttribute('fill','none');p.setAttribute('stroke',edge.label==='No'?'#bd8da8':'#788bb7');
  p.setAttribute('stroke-width','2');p.setAttribute('marker-end','url(#gv-arrow)');svg.append(p);
  if(edge.label){
   const label=document.createElementNS('http://www.w3.org/2000/svg','text');
   label.setAttribute('x',String(edge.x1+14));label.setAttribute('y',String(edge.y1+26));
   label.setAttribute('fill','#acbcd7');label.setAttribute('font-size','11');label.textContent=edge.label;svg.append(label);
  }
 }
 stage.append(svg);
 for(const node of layout.nodes){
  const button=document.createElement('button');
  button.className='gv-node';button.type='button';button.dataset.gvStep=node.id;
  button.dataset.type=node.step.type;button.setAttribute('aria-pressed',String(state.selected===node.id));
  button.style.left=node.x+'px';button.style.top=node.y+'px';
  button.innerHTML=`<span class="gv-node-icon" aria-hidden="true">${esc(STEP_TYPES[node.step.type]?.icon||'•')}</span><span class="gv-node-title">${esc(node.id)}</span><span class="gv-node-kind">${esc(STEP_TYPES[node.step.type]?.label||node.step.type)}</span>`;
  stage.append(button);
 }
}
export function openDesigner(workflow,deps){
 if(typeof document==='undefined')throw Error('Editor requires a browser');
 const selected=workflow.spec.start;
 const state={workflow,selected,spec:clone(workflow.spec),name:workflow.name,dirty:false,revision:workflow.revision};
 const cover=document.createElement('div');cover.className='gv-overlay';cover.setAttribute('role','presentation');
 cover.innerHTML=`<div class="gv-window" role="dialog" aria-modal="true" aria-labelledby="gv-heading">
  <header class="gv-top"><div class="gv-brandline"><div class="brandmark" aria-hidden="true">✦</div><div><h2 id="gv-heading">Design automation</h2><p>Choose a step to make changes.</p></div></div>
   <div class="gv-actions"><button class="gv-action plain" data-gv-action="preview" type="button">Preview</button><button class="gv-action plain" data-gv-action="versions" type="button">Versions</button><button class="gv-action plain" data-gv-action="export" type="button">Export</button><button class="gv-action plain" data-gv-action="close" type="button">Close</button><button class="gv-action primary" data-gv-action="save" type="button">Save changes</button></div>
  </header>
  <section class="gv-preview" hidden aria-label="Safe workflow preview">
    <div class="gv-preview-head"><strong>Preview has no side effects</strong><span>Runs local steps only. No AI calls or external actions.</span></div>
    <form id="gv-preview-form"><div class="gv-preview-fields"></div><button type="submit" class="gv-action primary" data-gv-action="preview-plan">Run preview</button>
     <button type="button" class="gv-action plain" data-gv-action="hide-preview">Close</button></form>
    <div class="gv-preview-results" aria-live="polite"></div>
  </section>
  <div class="gv-version-list" hidden></div>
  <div class="gv-body"><div class="gv-left"><div class="gv-toolbar">
   <label for="gv-add-type">Add step</label><select id="gv-add-type"><option value="ai">AI assistant</option><option value="template">Text</option><option value="knowledge">Knowledge</option><option value="approval">Approval</option><option value="branch">Decision</option><option value="agent_team">AI team</option><option value="subworkflow">Call automation</option><option value="http_get">API read</option><option value="http_post">API action</option></select>
   <button class="gv-action" type="button" data-gv-action="add">+ Add</button></div>
   <div class="gv-graph" aria-label="Workflow diagram"><div class="gv-stage"></div><span class="gv-graph-label" aria-hidden="true">WORKFLOW</span></div></div>
   <aside class="gv-right" aria-label="Selected step"><label class="gv-field">Automation name<input id="gv-name" maxlength="110"></label><div id="gv-inspector"></div>
   <details class="gv-advanced"><summary>Advanced configuration</summary><label class="gv-field">Whole workflow (JSON)<textarea id="gv-json" spellcheck="false" rows="8"></textarea></label><button class="gv-action" data-gv-action="apply-json" type="button">Apply JSON</button></details></aside>
  </div><footer class="gv-foot"><span class="gv-info">Changes stay private until saved.</span><span class="gv-error" role="alert" aria-live="polite"></span></footer></div>`;
 document.body.append(cover);
 const by=s=>cover.querySelector(s);
 const previewInputs=()=>{
  const source=JSON.stringify(state.spec);
  const keys=[...source.matchAll(/\{\{\s*input\.([a-zA-Z_][\w]*)\s*\}\}/g)].map(m=>m[1]);
  return [...new Set(keys)].filter(k=>!['__proto__','prototype','constructor'].includes(k)).slice(0,12);
 };
 const close=()=>{cover.remove();document.removeEventListener('keydown',key);};
 const key=e=>{if(e.key==='Escape')close();};
 document.addEventListener('keydown',key);
 const repaint=()=>{draw(cover,state);by('#gv-inspector').innerHTML=inspector(state.spec.steps.find(s=>s.id===state.selected),state.spec,deps.connections||[],deps.workflows||[],workflow.id);by('#gv-json').value=JSON.stringify(state.spec,null,2);};
 by('#gv-name').value=state.name;repaint();by('[data-gv-action="close"]').focus();
 cover.addEventListener('input',e=>{
  if(e.target.id==='gv-name'){state.name=e.target.value;state.dirty=true;return;}
  if(e.target.dataset.gvField){
   const step=state.spec.steps.find(s=>s.id===state.selected);if(!step)return;
   try{setField(step,e.target.dataset.gvField,e.target.value);error(cover,'');state.dirty=true;}
   catch(e){error(cover,e.message);}
  }
 });
 cover.addEventListener('change',e=>{if(e.target.dataset.gvField&&['next','yes','no','condition.operator','connection_id'].includes(e.target.dataset.gvField)){repaint();}});
 cover.addEventListener('submit',async e=>{
  if(e.target.id!=='gv-preview-form')return;
  e.preventDefault();
  const button=by('[data-gv-action="preview-plan"]');button.disabled=true;
  try{
   const input=Object.fromEntries([...cover.querySelectorAll('[data-gv-input]')].map(field=>[field.dataset.gvInput,field.value]));
   const report=await deps.api('/api/workflows/'+workflow.id+'/preview','POST',{input,spec:state.spec});
   const completed=report.trace.filter(x=>x.status==='previewed').map(x=>x.step_id);
   const status=report.stopped_before_side_effect?'Paused before a live step':'All local steps checked';
   const results=by('.gv-preview-results');
   results.replaceChildren();
   const heading=document.createElement('strong');heading.textContent=status;results.append(heading);
   const detail=document.createElement('p');detail.textContent=completed.length?
    completed.length+' local step'+(completed.length===1?'':'s')+' checked: '+completed.join(' → '):
    'The first step requires a live run';results.append(detail);
   if(!report.stopped_before_side_effect){
    const values=Object.entries(report.outputs).filter(([key,value])=>value!==null&&value!=='finished');
    if(values.length){
     const pre=document.createElement('pre');
     pre.textContent=String(typeof values.at(-1)[1]==='string'?values.at(-1)[1]:JSON.stringify(values.at(-1)[1])).slice(0,1600);
     results.append(pre);
    }
   }
   error(cover,'');
  }catch(err){error(cover,err.message||'Preview could not complete');}
  finally{button.disabled=false;}
 });
 cover.addEventListener('click',async e=>{
  const stepButton=e.target.closest('[data-gv-step]');
  if(stepButton){state.selected=stepButton.dataset.gvStep;repaint();return;}
  const action=e.target.closest('[data-gv-action]')?.dataset.gvAction;if(!action)return;
  try{
   if(action==='close'){close();return;}
   if(action==='preview'){
    const panel=by('.gv-preview');
    panel.hidden=!panel.hidden;
    if(!panel.hidden){
     by('.gv-preview-fields').innerHTML=previewInputs().map(key=>field(
      key.replaceAll('_',' ').replace(/^./,c=>c.toUpperCase()),'preview-'+key,'')).join('');
     // The same labels are used for keyboard and screen-reader access.
     for(const el of by('.gv-preview-fields').querySelectorAll('[data-gv-field]')){
      el.dataset.gvInput=el.dataset.gvField.slice('preview-'.length);
      delete el.dataset.gvField;
     }
     by('.gv-preview-results').replaceChildren();
    }
    return;
   }
   if(action==='hide-preview'){by('.gv-preview').hidden=true;return;}
   if(action==='add'){
    const type=by('#gv-add-type').value;
    state.spec=insertStep(state.spec,state.selected,type);
    if(type==='subworkflow'){
     const available=(deps.workflows||[]).find(w=>w.id!==workflow.id);
     if(available)state.spec.steps.at(-1).workflow_id=available.id;
    }
    state.selected=state.spec.steps.at(-1).id;state.dirty=true;error(cover,'');repaint();return;
   }
   if(action==='remove'){
    state.spec=removeStep(state.spec,state.selected);state.selected=state.spec.start;state.dirty=true;repaint();return;
   }
   if(action==='apply-json'){
    const parsed=JSON.parse(by('#gv-json').value);
    if(!parsed||!Array.isArray(parsed.steps))throw Error('Workflow JSON requires steps');
    state.spec=parsed;state.selected=parsed.start;state.dirty=true;repaint();error(cover,'');return;
   }
   if(action==='save'){
    const button=by('[data-gv-action="save"]');button.disabled=true;
    try{
     await deps.api('/api/workflows/'+workflow.id,'PATCH',{name:state.name,spec:state.spec,expected_revision:state.revision});
     close();await deps.refresh();deps.toast('Automation saved');
    }finally{button.disabled=false;}
    return;
   }
   if(action==='versions'){
    const list=by('.gv-version-list');
    if(!list.hidden){list.hidden=true;return;}
    const versions=await deps.api('/api/workflows/'+workflow.id+'/revisions');
    list.replaceChildren();
    for(const version of versions){
     const item=document.createElement('div');item.className='gv-version';
     const details=document.createElement('div');details.textContent=`Version ${version.revision} · ${version.name}`;
     const sub=document.createElement('small');sub.textContent=new Date(version.saved_at).toLocaleString()+' · '+version.step_count+' steps';details.append(sub);
     item.append(details);
     const button=document.createElement('button');button.className='gv-action';button.textContent='Restore';button.dataset.gvAction='restore';button.dataset.revision=String(version.revision);
     item.append(button);list.append(item);
    }
    list.hidden=false;return;
   }
   if(action==='restore'){
    if(!confirm('Restore this version? A new version will be saved.'))return;
    const rev=e.target.closest('[data-revision]').dataset.revision;
    const updated=await deps.api('/api/workflows/'+workflow.id+'/revisions/'+rev+'/restore','POST',{expected_revision:state.revision});
    state.spec=clone(updated.spec);state.name=updated.name;state.selected=updated.spec.start;state.dirty=false;state.revision=updated.revision;
    by('#gv-name').value=state.name;by('.gv-version-list').hidden=true;repaint();await deps.refresh();deps.toast('Version restored');return;
   }
   if(action==='export'){
    const safe={format:'growthveyra-workflow',schema_version:1,name:state.name,spec:clone(state.spec),trigger:workflow.trigger,enabled:false,allow_external:false};
    for(const step of safe.spec.steps)delete step.connection_id;
    const blob=new Blob([JSON.stringify(safe,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob);
    const anchor=document.createElement('a');anchor.href=url;anchor.download='growthveyra-'+workflow.id.slice(0,8)+'.json';anchor.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);return;
   }
  }catch(err){error(cover,err.message||'Could not complete this action');}
 });
 return {close,get spec(){return state.spec}};
}
if(typeof window!=='undefined')window.GVDesigner={open:openDesigner};
