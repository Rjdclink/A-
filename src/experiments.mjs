import {createHmac} from 'node:crypto';
export function experimentVariant(workspace,experiment,subject,salt){
 const h=createHmac('sha256',salt).update(JSON.stringify([workspace,experiment,subject])).digest();
 return h.readUInt32BE(0)<0x80000000?'control':'treatment';
}
export function compareRates({control,treatment}){
 const a=control||{n:0,conversions:0},b=treatment||{n:0,conversions:0};
 const cr=a.n?a.conversions/a.n:null,tr=b.n?b.conversions/b.n:null;
 const detail={controlRate:cr,treatmentRate:tr,absoluteChange:cr===null||tr===null?null:tr-cr,controlSize:a.n,treatmentSize:b.n};
 if(a.n<100||b.n<100)return {status:'insufficient_data',...detail};
 if([a.conversions,a.n-a.conversions,b.conversions,b.n-b.conversions].some(x=>x<5))return {status:'insufficient_data',...detail};
 const pooled=(a.conversions+b.conversions)/(a.n+b.n);
 const se=Math.sqrt(pooled*(1-pooled)*(1/a.n+1/b.n));
 const z=se>0?(tr-cr)/se:0;
 return {status:Math.abs(z)>=1.96?'statistically_detectable':'inconclusive',zScore:Math.round(z*1000)/1000,...detail,method:'unadjusted two-sided z-test; exploratory only; fixed horizon and corrections for repeated looks required'};
}
