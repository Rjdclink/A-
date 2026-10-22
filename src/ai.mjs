export async function advisory({metrics,objective,fetcher=fetch}){
 const endpoint=process.env.AI_BASE_URL||'https://vireonix.ai/v1/chat/completions';
 const url=new URL(endpoint);
 if(url.protocol!=='https:')throw Error('AI endpoint must use HTTPS');
 const controller=new AbortController();
 const timer=setTimeout(()=>controller.abort(),25000);
 try{
  const response=await fetcher(url,{method:'POST',signal:controller.signal,headers:{'content-type':'application/json',...(process.env.AI_API_KEY?{'authorization':'Bearer '+process.env.AI_API_KEY}:{})},body:JSON.stringify({model:process.env.AI_MODEL||'auto',temperature:0.2,messages:[{role:'system',content:'You are a careful ecommerce performance analyst. Use only aggregate numbers supplied. Distinguish facts from hypotheses. Never invent uplift, ROI, customers, benchmarks or campaign spend. Give three prioritized experiments, measurement plans and failure conditions. No autonomous ad publishing or customer messaging.'},{role:'user',content:JSON.stringify({objective:String(objective||'Improve conversion').slice(0,500),metrics})}]})});
  if(!response.ok)throw Error('AI service unavailable ('+response.status+')');
  const data=await response.json();
  const output=data?.choices?.[0]?.message?.content;
  if(typeof output!=='string'||!output.trim())throw Error('AI returned no usable advice');
  return output.slice(0,12000);
 }finally{clearTimeout(timer);}
}
