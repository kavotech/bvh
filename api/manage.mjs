import { handle, requestBody, db, userFor, rateLimit, captcha, text, uuid, digest, env, HttpError } from '../server/core.mjs';
import { template, deliverEmails } from '../server/email.mjs';
import { checkVehicleAvailable } from '../server/booking-payments.mjs';
import { verifyReviewToken } from '../server/review-token.mjs';
export default handle(async (req,res) => {
  const body=requestBody(req), client=db();
  const directReview = ['approve','reject'].includes(body.action) && typeof body.reviewToken === 'string';
  const user=directReview ? null : await userFor(req,client);
  const isAdmin=directReview || user.email.toLowerCase()===(process.env.ADMIN_EMAIL || 'info@breezyeevans.co.uk').toLowerCase();
  await rateLimit(req,client,'manage',user?.id || `review:${body.reviewToken}`);
  await captcha(body.token,'manage');
  if(!['cancel','confirm','cancel_confirm','invoice','reminder','confirmation','approve','reject'].includes(body.action)) throw new HttpError(400,'Invalid booking action.');
  if(body.action!=='cancel' && !isAdmin) throw new HttpError(403,'Administrator access required.');
  const id=text(body.bookingId,'booking reference',100);
  const {data:booking,error}=await client.from('bookings').select('*').eq('id',id).single();
  if (directReview && (!booking || !verifyReviewToken(body.reviewToken, booking.reference))) throw new HttpError(403, 'This review link has expired or is invalid.');
  if(error || (!isAdmin && booking.user_id!==user.id)) throw new HttpError(404,'Booking not found.');
  if (['approve','reject'].includes(body.action)) {
    if (!isAdmin) throw new HttpError(403, 'Administrator access required.');
    const approvalCode = text(body.approvalCode, 'the approval code', 128, 4);
    if (approvalCode !== env('ADMIN_APPROVAL_CODE')) throw new HttpError(403, 'The administrative verification code is incorrect.');
    const key = digest([user?.id || body.reviewToken, body.action, id, String(body.rejectionReason || '')]);
    const pending = /pending|requested|driver verification/i.test(`${booking.status} ${booking.booking_status} ${booking.approval_status || ''}`);
    if (!pending) throw new HttpError(409, 'This booking has already been reviewed. Refresh the dashboard.');
    let status = 'Rejected';
    let title = 'Update on Your Breezyee Vans Booking Request';
    let detail = String(body.rejectionReason || '').trim().slice(0, 500) || 'We were unable to accept this request at this time.';
    if (body.action === 'approve') {
      if (!await checkVehicleAvailable(client, booking.vehicle_id, booking.collection_at, booking.return_at, booking.id)) throw new HttpError(409, 'This vehicle is no longer available for the requested period.');
      status = 'Approved — Awaiting Deposit';
      title = 'Your Breezyee Vans Booking Has Been Approved!';
      detail = `Great news! Your booking request has been approved. To secure your vehicle, complete the booking deposit here: ${process.env.SITE_URL || 'https://www.breezyeevans.co.uk'}/payment?reference=${encodeURIComponent(booking.reference)}&category=booking_deposit. Deposit deadline: ${booking.payment_deadline_at || 'before collection'}.`;
      await client.from('bookings').update({ status, booking_status: status, approval_status: status, approved_at: new Date().toISOString(), approved_by: user?.id || null, rejected_at: null, rejected_by: null }).eq('id', booking.id);
      await client.from('booking_holds').update({ status: 'active', expires_at: booking.payment_deadline_at || new Date(Date.now()+86400000).toISOString() }).eq('booking_id', booking.id);
      await client.from('booking_payments').update({ status: 'requires_payment' }).eq('booking_id', booking.id).eq('category', 'booking_deposit');
    } else {
      await client.from('bookings').update({ status, booking_status: status, approval_status: status, rejected_at: new Date().toISOString(), rejected_by: user?.id || null, rejection_reason: detail }).eq('id', booking.id);
      await client.from('booking_holds').update({ status: 'cancelled' }).eq('booking_id', booking.id);
      await client.from('booking_payments').update({ status: 'cancelled' }).eq('booking_id', booking.id).eq('category', 'booking_deposit');
    }
    await client.from('booking_approval_audit').insert({ booking_id: booking.id, action: body.action === 'approve' ? 'approved' : 'rejected', actor_id: user?.id || null, reason: detail });
    const content = template(title, [`Hello ${booking.name || 'there'},`, `Reference: ${booking.reference}`, `Vehicle: ${booking.vehicle_name || booking.van_size}`, `Collection: ${booking.date} at ${booking.time} (owner collection location)`, `Collection and drop-off: arranged directly with our team`, `Rental price: ${booking.price}`, `Booking deposit: £${(Number(booking.booking_deposit_pence || 0) / 100).toFixed(2)}`, `Refundable security deposit: £${(Number(booking.security_deposit_pence || 0) / 100).toFixed(2)}`, `Status: ${status}`, detail]);
    await client.from('email_outbox').insert([{ submission_key: key, recipient: booking.email, ...content }, { submission_key: key, recipient: process.env.ADMIN_NOTIFICATION_EMAIL || 'info@breezyeevans.co.uk', ...template(`Booking ${status} — ${booking.reference}`, [`Reference: ${booking.reference}`, `Status: ${status}`, `Reviewed by: ${user?.email || 'secure review link'}`]) }]);
    try { await deliverEmails(client, key); } catch { console.warn('email_queue_pending'); }
    res.status(200).json({ message: body.action === 'approve' ? 'Booking approved and payment instructions emailed.' : 'Booking rejected and the customer has been notified.' });
    return;
  }
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
  const content=template(title,[`Hello ${booking.name},`,`Reference: ${booking.reference || booking.id}`,`Status: ${status}`,`Vehicle: ${booking.vehicle_name || booking.van_size}`,`Pickup: ${booking.date} at ${booking.time} (UK time)`,`Pickup location: ${booking.pickup}`,`Hire estimate: ${booking.price}`,detail]);
  const jobs=[{recipient:booking.email,...content},{recipient:process.env.ADMIN_NOTIFICATION_EMAIL || 'info@breezyeevans.co.uk',...content}];
  const {error:mutationError}=await client.rpc('bv_manage',{p_id:id,p_action:body.action,p_status:status,p_actor:user.id,p_admin:isAdmin,p_key:key,p_hash:digest([id,body.action]),p_emails:jobs});
  if(mutationError) throw new HttpError(409,'This booking cannot be changed in its current state. Refresh and try again.');
  try {await deliverEmails(client,key);} catch {console.warn('email_queue_pending');}
  res.status(200).json({message:'Saved. The customer notification has been queued.'});
});
