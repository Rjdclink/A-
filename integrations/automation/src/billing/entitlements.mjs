/**
 * Entitlements are derived only from a Square-verified local subscription
 * lifecycle; a checkout redirect or a user-supplied status cannot grant access.
 */
export function subscriptionEntitlements(record,env=process.env){
 const valid=record&&['active','cancel_scheduled'].includes(record.status)&&
  ['starter','pro','enterprise'].includes(record.plan);
 const plan=valid?record.plan:'free';
 const defaults={free:1,starter:5,pro:30,enterprise:100};
 const configured=env['PLAN_'+plan.toUpperCase()+'_MAX_WORKFLOWS'];
 const maximum=configured===undefined?defaults[plan]:Number(configured);
 if(!Number.isSafeInteger(maximum)||maximum<1||maximum>10000)throw Error('Invalid plan capacity configuration');
 return {plan,paid:plan!=='free',max_workflows:maximum,external_actions:plan!=='free'};
}
export const enforceBilling=env=>env.BILLING_ENFORCE==='true';
