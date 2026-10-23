/** UTC-only calendar availability for businesses that explicitly enable internal bookings. */
export function slotEligibility(business,date){
 const at=date instanceof Date?date:new Date(date);
 if(!Number.isFinite(at.getTime()))return {available:false,reason:'invalid-time'};
 if(!business?.booking_enabled)return {available:false,reason:'confirmation-disabled'};
 const weekday=at.getUTCDay(),hour=at.getUTCHours(),minute=at.getUTCMinutes();
 const weekdays=String(business.booking_weekdays||'1,2,3,4,5').split(',').map(Number);
 const start=Number(business.booking_start_hour),end=Number(business.booking_end_hour);
 const duration=Number(business.booking_slot_minutes||30);
 if(!weekdays.includes(weekday))return {available:false,reason:'closed-day'};
 if(![15,30,60].includes(duration)||!Number.isInteger(start)||!Number.isInteger(end)||start<0||end>24||start>=end)return {available:false,reason:'invalid-business-hours'};
 const minuteOfDay=hour*60+minute;
 if(minuteOfDay<start*60||minuteOfDay+duration>end*60)return {available:false,reason:'outside-business-hours'};
 if((minuteOfDay-start*60)%duration!==0)return {available:false,reason:'not-a-slot'};
 return {available:true,reason:'slot-within-internal-hours'};
}
