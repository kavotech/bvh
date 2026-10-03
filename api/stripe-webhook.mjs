import { db, HttpError } from '../server/core.mjs';
import { verifyStripeSignature } from '../server/stripe.mjs';

async function raw(req) {
  if (typeof req.body === 'string') return req.body;
  if (Buffer.isBuffer(req.body)) return req.body.toString('utf8');
  let body = '';
  for await (const chunk of req) body += chunk;
  return body;
}

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
  const { data: payment, error: paymentError } = await client.from('booking_payments').select('*,bookings!inner(id,reference,booking_status,payment_status,paid_total_pence,email)').eq('id', paymentId).single();
  if (paymentError) throw new HttpError(400, 'Payment record not found.');
  if (payment.bookings.reference !== reference || payment.category !== category || payment.currency !== intent.currency) throw new HttpError(400, 'Payment metadata mismatch.');
  if (Number(payment.expected_amount_pence) !== Number(intent.amount)) throw new HttpError(400, 'Payment amount mismatch.');
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
  return { bookingId: payment.booking_id, paymentId: payment.id };
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

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'Method not allowed.' });
    return;
  }
  const client = db();
  let event;
  try {
    const body = await raw(req);
    verifyStripeSignature(body, req.headers['stripe-signature']);
    event = JSON.parse(body);
    const shouldProcess = await recordEvent(client, event);
    if (!shouldProcess) {
      res.status(200).json({ received: true, duplicate: true });
      return;
    }
    let detail = {};
    if (event.type === 'payment_intent.succeeded') detail = await markPaymentIntent(client, event, 'paid');
    else if (event.type === 'payment_intent.processing') detail = await markPaymentIntent(client, event, 'processing');
    else if (event.type === 'payment_intent.payment_failed' || event.type === 'payment_intent.canceled') detail = await markPaymentIntent(client, event, 'failed');
    else if (event.type === 'refund.created' || event.type === 'refund.updated' || event.type === 'charge.refunded') detail = await handleRefund(client, event);
    else {
      await finishEvent(client, event, 'ignored');
      res.status(200).json({ received: true, ignored: true });
      return;
    }
    await finishEvent(client, event, 'processed', detail);
    res.status(200).json({ received: true });
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 503;
    console.warn('stripe_webhook_failed', { status, event: event?.id });
    if (event?.id) await finishEvent(client, event, 'failed', { error: error instanceof Error ? error.message.slice(0, 300) : 'Webhook failed' });
    res.status(status).json({ error: status === 400 ? error.message : 'Webhook unavailable.' });
  }
}
