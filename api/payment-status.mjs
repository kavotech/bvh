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
    .select('reference,user_id,email,vehicle_name,van_size,price,status')
    .eq('reference', reference)
    .single();
  if (error || booking.user_id !== user.id || booking.email?.toLowerCase() !== user.email.toLowerCase()) throw new HttpError(404, 'Booking not found.');
  res.status(200).json({ reference: booking.reference, status: booking.status, paid: booking.status === 'Paid', vehicle: booking.vehicle_name || booking.van_size, price: booking.price });
});
