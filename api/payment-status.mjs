import { handle, requestBody, db, rateLimit, captcha, userFor, text, HttpError } from '../server/core.mjs';

export default handle(async (req, res) => {
  const body = requestBody(req);
  const client = db();
  const user = await userFor(req, client);
  await rateLimit(req, client, 'payment-status', user.id);
  await captcha(body.token, 'payment_status');
  const reference = text(body.reference, 'booking reference', 40, 5);
  const { data: booking, error } = await client
    .from('bookings')
    .select('id,reference,user_id,email,vehicle_name,van_size,price,status,booking_status,payment_status,paid_total_pence')
    .eq('reference', reference)
    .single();
  if (error || booking.user_id !== user.id || booking.email?.toLowerCase() !== user.email.toLowerCase()) throw new HttpError(404, 'Booking not found.');
  const { data: payments } = await client.from('booking_payments').select('category,expected_amount_pence,received_amount_pence,status,currency').eq('booking_id', booking.id).order('created_at', { ascending: true });
  res.status(200).json({
    reference: booking.reference,
    status: booking.booking_status || booking.status,
    paymentStatus: booking.payment_status || 'unpaid',
    paid: ['deposit_paid', 'fully_paid'].includes(booking.payment_status) || ['Reserved', 'Fully paid', 'Paid'].includes(booking.status),
    vehicle: booking.vehicle_name || booking.van_size,
    price: booking.price,
    payments: payments || [],
  });
});
