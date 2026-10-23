import QRCode from 'qrcode';
export const VENMO_USERNAME=process.env.VENMO_BUSINESS_USERNAME||'bad-blue';
export const MONTHLY_PRICE=299;
export const VENMO_PROFILE='https://venmo.com/u/'+encodeURIComponent(VENMO_USERNAME.replace(/^@/,''));
export const VERIFIED_QR_TARGET=VENMO_PROFILE; // Generates a scannable profile QR; customer confirms recipient before paying.
export async function venmoQR(){return QRCode.toBuffer(VERIFIED_QR_TARGET,{type:'png',width:390,errorCorrectionLevel:'M',margin:2,color:{dark:'#008cff',light:'#ffffff'}});}
export function billingStatus(business){return business.subscription_status==='active'?'Active (payment confirmed)':business.subscription_status==='pending_review'?'Payment reported; awaiting verification':'Payment not yet verified';}
