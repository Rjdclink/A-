import {aiCompleteDetailed} from './runner.mjs';
import {validateWorkflow} from './engine.mjs';

const PERMITTED=new Set(['ai','agent_team','template','branch','knowledge','approval','end']);
const FIELDS=new Set(['id','type','system','prompt','template','query','message','condition',
 'agents','review_prompt','next','yes','no']);

export class BlueprintValidationError extends Error {}

export function parseBlueprint(text){
 if(typeof text!=='string'||text.length>24000)throw new BlueprintValidationError('AI draft was not usable');
 const trimmed=text.trim();
 const body=trimmed.startsWith('```')?trimmed.replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,''):trimmed;
 let parsed;
 try{parsed=JSON.parse(body);}catch{throw new BlueprintValidationError('AI returned an invalid workflow draft');}
 if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw new BlueprintValidationError('AI draft must be a JSON object');
 const name=typeof parsed.name==='string'?parsed.name.trim():'';
 if(name.length<2||name.length>100)throw new BlueprintValidationError('AI draft has an invalid name');
 const spec=parsed.spec;
 if(!spec||typeof spec!=='object'||Array.isArray(spec)||!Array.isArray(spec.steps)||spec.steps.length>12)
  throw new BlueprintValidationError('AI draft contains too many or invalid steps');
 const clean={start:spec.start,steps:[]};
 for(const step of spec.steps){
  if(!step||typeof step!=='object'||!PERMITTED.has(step.type))throw new BlueprintValidationError('AI draft contains an unsupported action');
  if(Object.keys(step).some(field=>!FIELDS.has(field)))throw new BlueprintValidationError('AI draft contains unsupported configuration');
  clean.steps.push(step);
 }
 try{validateWorkflow(clean);}catch(error){throw new BlueprintValidationError('AI draft validation failed: '+String(error.message).slice(0,120));}
 if(JSON.stringify(clean).length>12000)throw new BlueprintValidationError('AI draft is too large');
 return {name,spec:clean,trigger:{type:'manual'},enabled:false,allow_external:false,requires_review:true};
}

const SYSTEM=`You are drafting a GrowthVeyra workflow blueprint for an administrator.
Respond with ONE JSON object, no commentary or markdown.
Use this shape: {"name":"Short useful title","spec":{"start":"first","steps":[{"id":"first","type":"ai","system":"Accurate assistant","prompt":"Analyze {{input.request}}","next":"done"},{"id":"done","type":"end"}]}}.
Allowed step types only: template, ai, agent_team, knowledge, branch, approval, end.
For branch include condition:{path:"input.field",operator:"eq",value:"value"}, yes and no step IDs.
Steps form a directed acyclic graph, contain unique IDs and terminate at end.
For AI teams use 2 specialists with distinct name, system and prompt.
Use only data supplied by the operator in input placeholders.
No APIs, URLs, emails, payments, external actions, secret keys, subscriptions, or fictitious integrations.
Make a practical 2-6-step plan. All drafts require human review before they are saved or enabled.`;

export async function generateBlueprint(goal,{env=process.env,aiFetch=fetch}={}){
 const info=await aiCompleteDetailed(SYSTEM,'User goal: '+goal,{env,fetchImpl:aiFetch});
 return parseBlueprint(info.text);
}
