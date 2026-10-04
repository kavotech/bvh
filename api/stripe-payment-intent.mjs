import { handle, requestBody, db, rateLimit, captcha, userFor, text, HttpError } from '../server/core.mjs';
import { createBookingPaymentIntent, stripeEnvironment } from '../server/stripe.mjs';
import { paymentCategoryLabel, penceToDisplay } from '../server/pricing.mjs';

const PAYABLE = new Set(['booking_deposit', 'final_balance', 'remaining_balance', 'insurance_charge', 'security_deposit', 'additional_charge']);

async function ensureFinalPayment(client, booking) {
  const { data: existing, error: existingError } = await client
    .from('booking_payments')
    .select('*')
    .eq('booking_id', booking.id)
    .eq('category', 'final_balance')
    .maybeSingle();
  if (existingError && !String(existingError.message || '').toLowerCase().includes('booking_payments')) throw new HttpError(503, 'Payment records are unavailable.');
  if (existing) return existing;
  if (Number(booking.insurance_charge_pence || 0) > 0) {
    throw new HttpError(409, 'Insurance configuration must be confirmed by Breezyee Vans before this remaining payment can be taken online.');
  }
  const amount = Number(booking.outstanding_balance_pence || 0) + Number(booking.insurance_charge_pence || 0) + Number(booking.security_deposit_pence || 0);
  const { data, error } = await client.from('booking_payments').insert({
    booking_id: booking.id,
    category: 'final_balance',
    expected_amount_pence: amount,
    currency: 'gbp',
    status: amount > 0 ? 'requires_payment' : 'not_applicable',
    due_at: booking.payment_deadline_at,
  }).select('*').single();
  if (error) throw new HttpError(503, 'Unable to prepare the remaining payment.');
  return data;
}

export default handle(async (req, res) => {
  const body = requestBody(req);
  const stripeMode = stripeEnvironment();
  const client = db();
  const user = await userFor(req, client);
  await rateLimit(req, client, 'payment', user.id);
  await captcha(body.token, 'payment');
  const reference = text(body.reference, 'booking reference', 40, 5);
  const category = PAYABLE.has(body.category) ? body.category : 'booking_deposit';
  const { data: booking, error } = await client
    .from('bookings')
    .select('id,reference,user_id,email,name,vehicle_name,van_size,price,date,time,duration,pickup,dropoff,status,booking_status,payment_status,booking_deposit_pence,outstanding_balance_pence,insurance_charge_pence,security_deposit_pence,payment_deadline_at')
    .eq('reference', reference)
    .single();
  if (error || booking.user_id !== user.id || booking.email?.toLowerCase() !== user.email.toLowerCase()) throw new HttpError(404, 'Booking not found.');
  if (/cancel|expired/i.test(`${booking.status} ${booking.booking_status}`)) throw new HttpError(409, 'This booking is not payable online. Please contact us.');

  let payment;
  if (category === 'final_balance') payment = await ensureFinalPayment(client, booking);
  else {
    const { data, error: paymentError } = await client.from('booking_payments').select('*').eq('booking_id', booking.id).eq('category', category).single();
    if (paymentError) throw new HttpError(400, 'This payment is not available yet. Please contact us.');
    payment = data;
  }
  if (payment.status === 'paid') throw new HttpError(409, 'This payment has already been received.');
  if (payment.status === 'not_due' && category !== 'final_balance') throw new HttpError(409, 'This payment is not due yet.');
  if (payment.expected_amount_pence <= 0) throw new HttpError(409, 'There is no balance to pay for this item.');

  const intent = await createBookingPaymentIntent({
    reference,
    bookingId: booking.id,
    paymentId: payment.id,
    category: payment.category,
    customerEmail: booking.email,
    customerName: booking.name,
    vehicleName: booking.vehicle_name || booking.van_size,
    amountPence: payment.expected_amount_pence,
  });
  if (!intent?.client_secret) throw new HttpError(400, 'This booking needs a custom quote before payment. We will contact you.');
  await client.from('booking_payments').update({
    stripe_payment_intent_id: intent.id,
    status: intent.status === 'processing' ? 'processing' : 'requires_payment',
    updated_at: new Date().toISOString(),
    metadata: { stripe_status: intent.status },
  }).eq('id', payment.id);
  res.status(200).json({
    clientSecret: intent.client_secret,
    paymentIntentId: intent.id,
    reference,
    category: payment.category,
    categoryLabel: paymentCategoryLabel(payment.category),
    amountTotal: intent.amount,
    currency: intent.currency,
    vehicle: booking.vehicle_name || booking.van_size,
    customerEmail: booking.email,
    price: penceToDisplay(payment.expected_amount_pence),
    breakdown: {
      hirePrice: penceToDisplay(Number(booking.booking_deposit_pence || 0) + Number(booking.outstanding_balance_pence || 0)),
      bookingDeposit: penceToDisplay(booking.booking_deposit_pence || 0),
      outstandingBalance: penceToDisplay(booking.outstanding_balance_pence || 0),
      insurance: penceToDisplay(booking.insurance_charge_pence || 0),
      refundableSecurityDeposit: penceToDisplay(booking.security_deposit_pence || 0),
    },
    stripeEnvironment: stripeMode,
    booking: { date: booking.date, time: booking.time, duration: booking.duration, pickup: booking.pickup, dropoff: booking.dropoff },
  });
});
