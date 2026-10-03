import { handle, requestBody, db, userFor, rateLimit, captcha, text, uuid, digest, HttpError } from '../server/core.mjs';
import { template, deliverEmails } from '../server/email.mjs';
export default handle(async (req,res) => {
  const body=requestBody(req), client=db();
  const user=await userFor(req,client);
  const isAdmin=user.email.toLowerCase()===(process.env.ADMIN_EMAIL || 'kavotechuk@gmail.com').toLowerCase();
  await rateLimit(req,client,'manage',user.id);
  await captcha(body.token,'manage');
  if(!['cancel','confirm','cancel_confirm','invoice','reminder','confirmation','approve','reject'].includes(body.action)) throw new HttpError(400,'Invalid booking action.');
  if(body.action!=='cancel' && !isAdmin) throw new HttpError(403,'Administrator access required.');
  const id=text(body.bookingId,'booking reference',100);
  const {data:booking,error}=await client.from('bookings').select('*').eq('id',id).single();
  if(error || (!isAdmin && booking.user_id!==user.id)) throw new HttpError(404,'Booking not found.');
  const key=digest([user.id,uuid(body.requestId)]);
  let status=booking.status, title='Booking update', detail='Contact us if you have any questions.';
  if(body.action==='cancel') { status='Cancellation requested'; title='Cancellation request received'; detail='Your cancellation request has been received. We will contact you about the applicable hire terms. This does not confirm cancellation or a refund.'; }
  if(body.action==='confirm') {
    if(body.availabilityChecked!==true) throw new HttpError(400,'Confirm that vehicle availability has been checked.');
    const {data:driver}=await client.from('driver_verifications').select('verification_status').eq('booking_id',id).eq('verification_status','APPROVED').maybeSingle();
    if(!driver) throw new HttpError(400,'Approve the driver verification before confirming availability.');
    status='Confirmed'; title='Your booking is confirmed'; detail='Our team has confirmed your vehicle availability. Contact us for collection arrangements and the agreed hire terms.';
  }
  if(body.action==='cancel_confirm') { status='Cancelled'; title='Your booking has been cancelled'; detail='Our team has confirmed cancellation. Any charges or refunds are handled according to your agreed hire terms.'; }
  if(['approve','reject'].includes(body.action)) {
    title=body.action==='approve'?'Driver verification approved':'Driver verification needs attention';
    detail=body.action==='approve'?'Your licence check is approved. Vehicle availability and the reservation still require separate confirmation.':'Please contact our team about your driver verification.';
  }
  if(['invoice','reminder','confirmation'].includes(body.action)) {
    title=body.action==='reminder'?'A reminder about your booking request':'Your booking details';
    detail='The amount below is a hire estimate. This message is not a payment receipt or a new confirmation of availability.';
  }
  const content=template(title,[`Hello ${booking.name},`,`Reference: ${booking.reference || booking.id}`,`Status: ${status}`,`Vehicle: ${booking.vehicle_name || booking.van_size}`,`Pickup: ${booking.date} at ${booking.time} (UK time)`,`Pickup location: ${booking.pickup}`,`Destination: ${booking.dropoff}`,`Hire estimate: ${booking.price}`,detail]);
  const jobs=[{recipient:booking.email,...content},{recipient:'info@breezyeevans.co.uk',...content}];
  const {error:mutationError}=await client.rpc('bv_manage',{p_id:id,p_action:body.action,p_status:status,p_actor:user.id,p_admin:isAdmin,p_key:key,p_hash:digest([id,body.action]),p_emails:jobs});
  if(mutationError) throw new HttpError(409,'This booking cannot be changed in its current state. Refresh and try again.');
  try {await deliverEmails(client,key);} catch {console.warn('email_queue_pending');}
  res.status(200).json({message:'Saved. The customer notification has been queued.'});
});
