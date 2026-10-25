/**
 * Parse RFC 4180-style CSV input without running formulas, fetching external
 * content, or accepting unbounded data. The caller validates each article and
 * persists the entire validated batch transactionally.
 */
export function parseSupportCsv(input){
 if(typeof input!=='string'||!input.trim()||input.length>480000)throw Error('Invalid knowledge CSV size');
 const source=input.replace(/^\uFEFF/,'');
 const rows=[],row=[];let cell='',quoted=false,afterQuote=false;
 function pushCell(){row.push(cell);cell='';afterQuote=false;}
 function pushRow(){
  pushCell();
  if(row.some(x=>x.trim()))rows.push([...row]);
  row.length=0;
  if(rows.length>101)throw Error('CSV exceeds 100 articles');
 }
 for(let i=0;i<source.length;i++){
  const c=source[i];
  if(quoted){
   if(c==='"'){
    if(source[i+1]==='"'){cell+='"';i++;}
    else{quoted=false;afterQuote=true;}
   }else cell+=c;
   continue;
  }
  if(c==='"'){
   if(cell.length||afterQuote)throw Error('Malformed CSV quoted field');
   quoted=true;
  }else if(c===','){pushCell();}
  else if(c==='\r'||c==='\n'){
   if(c==='\r'&&source[i+1]==='\n')i++;
   pushRow();
  }else if(afterQuote){
   if(c!==' '&&c!=='\t')throw Error('Unexpected text after quoted CSV field');
  }else cell+=c;
 }
 if(quoted)throw Error('Unclosed CSV quoted field');
 if(row.length||cell)pushRow();
 if(rows.length<2)throw Error('CSV header and at least one article are required');
 const headers=rows.shift().map(h=>h.trim().toLowerCase());
 if(new Set(headers).size!==headers.length||!headers.includes('question')||!headers.includes('answer'))throw Error('CSV requires unique question and answer headers');
 const permitted=new Set(['question','answer','locale','category','active']);
 if(headers.some(h=>!permitted.has(h)))throw Error('Unknown knowledge CSV header');
 return rows.map(fields=>{
  if(fields.length!==headers.length)throw Error('CSV row does not match header count');
  const obj=Object.fromEntries(headers.map((h,i)=>[h,fields[i].trim()]));
  const active=(obj.active||'true').toLowerCase();
  if(!['true','false','yes','no','1','0'].includes(active))throw Error('Invalid CSV active value');
  return {question:obj.question,answer:obj.answer,locale:obj.locale||'en',category:obj.category||'',active:['true','yes','1'].includes(active)};
 });
}
