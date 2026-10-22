import {createHmac,timingSafeEqual} from 'node:crypto';
export function verifyShopify(raw,header,secret){
 if(!Buffer.isBuffer(raw)||typeof header!=='string'||typeof secret!=='string'||!secret)return false;
 if(!/^[a-z0-9+/]{43}=$/i.test(header))return false;
 const expected=createHmac('sha256',secret).update(raw).digest();
 const given=Buffer.from(header,'base64');
 return given.length===expected.length&&timingSafeEqual(given,expected);
}
export function validateShopDomain(value){
 if(typeof value!=='string'||!/^[a-z0-9][a-z0-9-]{0,60}\.myshopify\.com$/.test(value))throw Error('Invalid shop domain');
 return value;
}
export function shopifyOrder(payload){
 if(!payload||!['number','string'].includes(typeof payload.id)||!Number.isSafeInteger(Number(payload.id))||String(payload.id).length>20)throw Error('Invalid Shopify order ID');
 const amount=Number(payload.current_total_price??payload.total_price);
 if(!Number.isFinite(amount)||amount<0||amount>1e9)throw Error('Invalid Shopify order total');
 const currency=payload.currency||'USD';
 if(currency!=='USD')throw Error('Only USD Shopify order imports are supported');
 const customerId=payload.customer?.id==null?undefined:String(payload.customer.id);
 return {type:'purchase',value:amount,currency:'USD',campaign:'shopify',consent:true,...(customerId?{customerId}:{})};
}
