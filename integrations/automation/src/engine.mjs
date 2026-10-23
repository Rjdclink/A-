const TYPES=new Set(['template','ai','agent_team','branch','approval','knowledge','http_get','http_post','subworkflow','end']);
const OPS=new Set(['eq','ne','gt','gte','lt','lte','contains','exists']);
export function lookup(scope,path){
  const keys=String(path||'').split('.');
  if(keys.length>12||keys.some(k=>!k||['__proto__','prototype','constructor'].includes(k)))return undefined;
  let value=scope;
  for(const k of keys){if(value===null||typeof value!=='object'||!Object.hasOwn(value,k))return undefined;value=value[k];}
  return value;
}
export function render(template,scope){
  return String(template??'').replace(/\{\{\s*([\w.]+)\s*\}\}/g,(_m,key)=>{
    const v=lookup(scope,key);
    return v==null?'':typeof v==='object'?JSON.stringify(v):String(v);
  });
}
export function evaluate(condition,scope){
  if(!condition||!OPS.has(condition.operator))throw Error('Invalid branch operator');
  const a=lookup(scope,condition.path),b=condition.value;
  switch(condition.operator){
    case 'exists':return a!==undefined&&a!==null&&a!=='';
    case 'eq':return a===b;
    case 'ne':return a!==b;
    case 'contains':return typeof a==='string'&&a.toLowerCase().includes(String(b).toLowerCase());
    default:{const x=Number(a),y=Number(b);if(a==null||b==null||!Number.isFinite(x)||!Number.isFinite(y))return false;
      if(condition.operator==='gt')return x>y;if(condition.operator==='gte')return x>=y;
      if(condition.operator==='lt')return x<y;return x<=y;}
  }
}
export function validateWorkflow(spec){
  if(!spec||typeof spec!=='object'||Array.isArray(spec))throw Error('Workflow specification must be an object');
  if(!Array.isArray(spec.steps)||spec.steps.length<1||spec.steps.length>40)throw Error('Workflow must contain 1-40 steps');
  const ids=new Map();
  for(const step of spec.steps){
    if(!step||typeof step!=='object'||typeof step.id!=='string'||!/^[a-z][a-z0-9_-]{0,39}$/i.test(step.id))throw Error('Invalid step ID');
    if(ids.has(step.id))throw Error('Duplicate step ID');
    if(!TYPES.has(step.type))throw Error('Unsupported step type: '+step.type);
    if(step.type==='branch'&&(!step.condition||!OPS.has(step.condition.operator)||typeof step.condition.path!=='string'))throw Error('Invalid branch condition');
    if(['template','ai','knowledge'].includes(step.type)&&typeof (step.template??step.prompt??step.query)!=='string')throw Error('Step requires text');
    if(step.type==='agent_team'){
      if(!Array.isArray(step.agents)||step.agents.length<2||step.agents.length>5)throw Error('Agent teams must contain 2-5 specialists');
      const names=new Set();
      for(const agent of step.agents){
        if(!agent||typeof agent.name!=='string'||!/^[a-z][a-z0-9_]{0,30}$/i.test(agent.name))throw Error('Invalid agent name');
        if(names.has(agent.name))throw Error('Duplicate agent name');names.add(agent.name);
        if(typeof agent.prompt!=='string'||agent.prompt.length<1||agent.prompt.length>6000||
           agent.system!==undefined&&(typeof agent.system!=='string'||agent.system.length>3000))throw Error('Invalid agent instructions');
      }
      if(step.review_prompt!==undefined&&(typeof step.review_prompt!=='string'||step.review_prompt.length>6000))throw Error('Invalid team review prompt');
    }
    if(step.type==='subworkflow'){
      if(typeof step.workflow_id!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(step.workflow_id))throw Error('Subworkflow requires a valid workflow ID');
      if(step.input_map!==undefined){
        if(!step.input_map||Array.isArray(step.input_map)||typeof step.input_map!=='object'||Object.keys(step.input_map).length>20)throw Error('Subworkflow input map must be an object with up to 20 fields');
        for(const [key,value] of Object.entries(step.input_map))
          if(!/^[a-z][a-z0-9_]{0,39}$/i.test(key)||typeof value!=='string'||value.length>4000)throw Error('Invalid subworkflow input template');
      }
    }
    if(['http_get','http_post'].includes(step.type)&&typeof step.url!=='string')throw Error('HTTP step requires URL');
    if(step.connection_id!==undefined&&(!['http_get','http_post'].includes(step.type)||typeof step.connection_id!=='string'||!/^[0-9a-f-]{36}$/i.test(step.connection_id)))throw Error('Invalid connection reference');
    ids.set(step.id,step);
  }
  if(!ids.has(spec.start))throw Error('Invalid starting step');
  for(const step of spec.steps){
    const targets=step.type==='branch'?[step.yes,step.no]:[step.next];
    for(const target of targets)if(target!==undefined&&target!==null&&!ids.has(target))throw Error('Unknown step target '+target);
    if(step.type==='branch'&&(!step.yes||!step.no))throw Error('Branch must define yes and no targets');
    if(step.type==='end'&&step.next)throw Error('End cannot have a next step');
  }
  const visiting=new Set(),visited=new Set();
  function walk(id){
    if(!id)return;
    if(visiting.has(id))throw Error('Workflow contains a cycle');
    if(visited.has(id))return;
    visiting.add(id);
    const step=ids.get(id);
    for(const target of step.type==='branch'?[step.yes,step.no]:[step.next])walk(target);
    visiting.delete(id);visited.add(id);
  }
  walk(spec.start);
  if(visited.size!==ids.size)throw Error('Workflow contains unreachable steps');
  return spec;
}
export function templates(){return [
 {name:'Lead qualification',description:'Draft a concise, grounded lead assessment with AI.',trigger:{type:'manual'},spec:{start:'qualify',steps:[{id:'qualify',type:'ai',system:'Evaluate the supplied sales inquiry only; do not invent facts.',prompt:'Assess and prioritize this inbound lead: {{input.inquiry}}',next:'done'},{id:'done',type:'end'}]}},
 {name:'Document research',description:'Use saved workspace knowledge to prepare a cited summary.',trigger:{type:'manual'},spec:{start:'search',steps:[{id:'search',type:'knowledge',query:'{{input.question}}',next:'synthesize'},{id:'synthesize',type:'ai',system:'Answer using provided source excerpts, cite source names, and identify gaps.',prompt:'Question: {{input.question}}\nSource material: {{steps.search}}',next:'done'},{id:'done',type:'end'}]}},
 {name:'Collaborative market analysis',description:'Research, critique, and synthesize with three specialized AI calls.',trigger:{type:'manual'},spec:{start:'team',steps:[{id:'team',type:'agent_team',agents:[{name:'analyst',system:'Separate observations from assumptions and cite supplied evidence.',prompt:'Analyze this market question: {{input.question}}'},{name:'reviewer',system:'Critically assess unsupported assertions in the supplied findings.',prompt:'Critique these findings: {{agents.analyst}}'}],review_prompt:'Provide a balanced conclusion for {{input.question}} using {{agents.analyst}} and reviewer concerns {{agents.reviewer}}',next:'done'},{id:'done',type:'end'}]}},
 {name:'Approval-gated outreach',description:'Draft a message and require authorization before an external action.',trigger:{type:'manual'},spec:{start:'draft',steps:[{id:'draft',type:'ai',system:'Draft a professional business message. Do not claim actions or results not supplied.',prompt:'Write a message responding to: {{input.request}}',next:'review'},{id:'review',type:'approval',message:'Approve this drafted message before any external action: {{steps.draft}}',next:'done'},{id:'done',type:'end'}]}}
 ];}
