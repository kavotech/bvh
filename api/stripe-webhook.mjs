import { db, HttpError, site } from '../server/core.mjs';
import { verifyStripeSignature } from '../server/stripe.mjs';
import { template, deliverEmails } from '../server/email.mjs';
import { paymentCategoryLabel, penceToDisplay } from '../server/pricing.mjs';

async function recordEvent(client, event) {
  const { data: existing } = await client.from('stripe_webhook_events').select('id,processing_status').eq('id', event.id).maybeSingle();
  if (existing?.processing_status === 'processed' || existing?.processing_status === 'ignored') return false;
  if (!existing) {
    const created = event.created ? new Date(event.created * 1000).toISOString() : null;
    const { error } = await client.from('stripe_webhook_events').insert({ id: event.id, event_type: event.type, stripe_created_at: created, processing_status: 'processing' });
    if (error && !String(error.message || '').toLowerCase().includes('stripe_webhook_events')) throw error;
  }
  return true;
}

async function finishEvent(client, event, status, detail = {}) {
  await client.from('stripe_webhook_events').update({
    processing_status: status,
    processed_at: new Date().toISOString(),
    booking_id: detail.bookingId,
    payment_id: detail.paymentId,
    error: detail.error,
  }).eq('id', event.id);
}

async function markPaymentIntent(client, event, nextStatus) {
  const intent = event.data?.object || {};
  const reference = intent.metadata?.booking_reference;
  const paymentId = intent.metadata?.payment_id;
  const category = intent.metadata?.payment_category;
  if (!reference || !paymentId || !category) throw new HttpError(400, 'Missing payment metadata.');
  const { data: payment, error: paymentError } = await client.from('booking_payments').select('*,bookings!inner(id,reference,booking_status,payment_status,paid_total_pence,email,name,vehicle_name,van_size,date,time)').eq('id', paymentId).single();
  if (paymentError) throw new HttpError(400, 'Payment record not found.');
  if (payment.bookings.reference !== reference || payment.category !== category || payment.currency !== intent.currency) throw new HttpError(400, 'Payment metadata mismatch.');
  if (Number(payment.expected_amount_pence) !== Number(intent.amount)) throw new HttpError(400, 'Payment amount mismatch.');
  const detail = { bookingId: payment.booking_id, paymentId: payment.id, payment, intent, changed: false };
  // Stripe does not guarantee event order: never let a late failure or processing event undo a payment.
  if (payment.status === 'paid') return detail;
  const now = new Date().toISOString();
  const patch = {
    status: nextStatus,
    stripe_payment_intent_id: intent.id,
    stripe_charge_id: intent.latest_charge || payment.stripe_charge_id,
    received_amount_pence: nextStatus === 'paid' ? intent.amount_received || intent.amount : payment.received_amount_pence,
    paid_at: nextStatus === 'paid' ? now : payment.paid_at,
    updated_at: now,
    metadata: { stripe_status: intent.status, stripe_event: event.id },
  };
  await client.from('booking_payments').update(patch).eq('id', payment.id);
  if (nextStatus === 'paid') {
    if (category === 'booking_deposit') {
      await client.from('bookings').update({
        status: 'Reserved',
        booking_status: 'Reserved',
        payment_status: 'deposit_paid',
        paid_total_pence: Number(payment.bookings.paid_total_pence || 0) + Number(patch.received_amount_pence || 0),
      }).eq('id', payment.booking_id);
      await client.from('booking_holds').update({ status: 'converted' }).eq('booking_id', payment.booking_id).eq('status', 'active');
      await client.from('booking_payments').update({ status: 'requires_payment', updated_at: now }).eq('booking_id', payment.booking_id).in('category', ['remaining_balance', 'insurance_charge', 'security_deposit']).eq('status', 'not_due');
    } else {
      await client.from('bookings').update({
        status: 'Fully paid',
        booking_status: 'Fully paid',
        payment_status: 'fully_paid',
        paid_total_pence: Number(payment.bookings.paid_total_pence || 0) + Number(patch.received_amount_pence || 0),
      }).eq('id', payment.booking_id);
    }
  } else if (nextStatus === 'failed') {
    await client.from('bookings').update({ payment_status: 'failed', status: 'Payment failed' }).eq('id', payment.booking_id);
  }
  return { ...detail, changed: true };
}

export function paymentEmails(outcome, { payment, intent }) {
  const booking = payment.bookings;
  const label = paymentCategoryLabel(payment.category);
  const amount = penceToDisplay(outcome === 'paid' ? intent.amount_received || intent.amount : intent.amount);
  const vehicle = booking.vehicle_name || booking.van_size || 'Van hire';
  const admin = process.env.ADMIN_NOTIFICATION_EMAIL || 'info@breezyeevans.co.uk';
  const summary = [`Reference: ${booking.reference}`, `Vehicle: ${vehicle}`, `Collection: ${booking.date || 'To be confirmed'}${booking.time ? ` at ${booking.time}` : ''}`, `Payment: ${label}`, `Amount: ${amount}`];
  if (outcome === 'paid') {
    const reserved = payment.category === 'booking_deposit';
    return [
      { recipient: booking.email, ...template(reserved ? 'Payment Received — Your Van Is Reserved' : 'Payment Received — Thank You', [`Hello ${booking.name || 'there'},`, `We've received your payment. ${reserved ? 'Your van is now reserved for your dates.' : 'Thank you — your payment has been applied to your booking.'}`, ...summary, `Status: ${reserved ? 'Reserved' : 'Fully paid'}`, 'Our team will contact you to arrange collection and drop-off. A Stripe receipt has also been sent to this address.', `View your booking at any time: ${site()}/user-dashboard`]) },
      { recipient: admin, ...template(`Payment Received — ${booking.reference}`, [`${booking.name || 'A customer'} has paid ${amount} (${label}).`, ...summary, `Customer email: ${booking.email}`, `Stripe payment: ${intent.id}`]) },
    ];
  }
  const reason = String(intent.last_payment_error?.message || '').slice(0, 200);
  return [
    { recipient: booking.email, ...template("Your Payment Didn't Go Through", [`Hello ${booking.name || 'there'},`, 'We were unable to take your payment, so no money has been taken and your booking has not been reserved yet.', ...summary, ...(reason ? [`Reason given by your bank: ${reason}`] : []), 'You can try again with the same or a different card:', `${site()}/payment?reference=${encodeURIComponent(booking.reference)}&category=${encodeURIComponent(payment.category)}`, 'If it keeps failing, call us on +44 7300 331603 and we will help.']) },
    { recipient: admin, ...template(`Payment Failed — ${booking.reference}`, [`A ${label.toLowerCase()} payment of ${amount} from ${booking.name || 'a customer'} failed.`, ...summary, ...(reason ? [`Reason: ${reason}`] : []), `Customer email: ${booking.email}`, `Stripe payment: ${intent.id}`]) },
  ];
}

async function notify(client, key, jobs) {
  try {
    const { error } = await client.from('email_outbox').upsert(jobs.map(job => ({ submission_key: key, ...job })), { onConflict: 'submission_key,recipient', ignoreDuplicates: true });
    if (error) throw error;
    await deliverEmails(client, key);
  } catch {
    console.warn('payment_email_pending', { key });
  }
}

async function handleRefund(client, event) {
  const refund = event.data?.object || {};
  const intentId = refund.payment_intent;
  if (!intentId) return {};
  const { data: payment } = await client.from('booking_payments').select('*').eq('stripe_payment_intent_id', intentId).maybeSingle();
  if (!payment) return {};
  await client.from('booking_refunds').upsert({
    booking_id: payment.booking_id,
    payment_id: payment.id,
    requested_amount_pence: refund.amount || 0,
    actual_amount_pence: refund.amount || 0,
    reason: refund.reason || 'Stripe refund',
    status: refund.status === 'succeeded' ? 'succeeded' : refund.status === 'failed' ? 'failed' : 'processing',
    stripe_refund_id: refund.id,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'stripe_refund_id' });
  return { bookingId: payment.booking_id, paymentId: payment.id };
}

export async function processStripeWebhook(rawBody, signature, client = db()) {
  let event;
  try {
    verifyStripeSignature(rawBody, signature);
    event = JSON.parse(rawBody);
    if (!await recordEvent(client, event)) return { status: 200, body: { received: true, duplicate: true } };
    let detail = {};
    if (event.type === 'payment_intent.succeeded') {
      detail = await markPaymentIntent(client, event, 'paid');
      if (detail.changed) await notify(client, `payment:${detail.paymentId}:paid`, paymentEmails('paid', detail));
    } else if (event.type === 'payment_intent.processing') detail = await markPaymentIntent(client, event, 'processing');
    else if (event.type === 'payment_intent.payment_failed') {
      detail = await markPaymentIntent(client, event, 'failed');
      if (detail.changed) await notify(client, `payment:${event.id}:failed`, paymentEmails('failed', detail));
    } else if (event.type === 'payment_intent.canceled') detail = await markPaymentIntent(client, event, 'failed');
    else if (event.type === 'refund.created' || event.type === 'refund.updated' || event.type === 'charge.refunded') detail = await handleRefund(client, event);
    else {
      await finishEvent(client, event, 'ignored');
      return { status: 200, body: { received: true, ignored: true } };
    }
    await finishEvent(client, event, 'processed', { bookingId: detail.bookingId, paymentId: detail.paymentId });
    return { status: 200, body: { received: true } };
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 503;
    console.warn('stripe_webhook_failed', { status, event: event?.id });
    if (event?.id) await finishEvent(client, event, 'failed', { error: error instanceof Error ? error.message.slice(0, 300) : 'Webhook failed' });
    return { status, body: { error: status === 400 ? error.message : 'Webhook unavailable.' } };
  }
}

// Web-standard handler: Vercel pre-parses JSON bodies for (req, res) handlers, which destroys the
// exact bytes Stripe signed. request.text() is the raw payload.
export async function POST(request) {
  const { status, body } = await processStripeWebhook(await request.text(), request.headers.get('stripe-signature'));
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}
