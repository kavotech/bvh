import { handle, requestBody, db, rateLimit, captcha, userFor, text, HttpError } from '../server/core.mjs';
import { createBookingCheckoutSession } from '../server/stripe.mjs';

export default handle(async (req, res) => {
  const body = requestBody(req);
  const client = db();
  const user = await userFor(req, client);
  await rateLimit(req, client, 'payment', user.id);
  await captcha(body.token, 'payment');
  const reference = text(body.reference, 'booking reference', 40, 5);
  const { data: booking, error } = await client
    .from('bookings')
    .select('id,reference,user_id,email,name,vehicle_name,van_size,price,status')
    .eq('reference', reference)
    .single();
  if (error || booking.user_id !== user.id || booking.email?.toLowerCase() !== user.email.toLowerCase()) throw new HttpError(404, 'Booking not found.');
  if (booking.status === 'Paid') throw new HttpError(409, 'This booking has already been paid.');
  const session = await createBookingCheckoutSession({
    reference,
    bookingId: booking.id,
    customerEmail: booking.email,
    customerName: booking.name,
    vehicleName: booking.vehicle_name || booking.van_size,
    priceText: booking.price,
  });
  if (!session?.url) throw new HttpError(400, 'This booking needs a custom quote before payment. We will contact you.');
  res.status(200).json({ checkoutUrl: session.url, sessionId: session.id, reference, amountTotal: session.amount_total, currency: session.currency });
});
