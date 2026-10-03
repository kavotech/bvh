import { db, HttpError } from '../server/core.mjs';
import { verifyStripeSignature } from '../server/stripe.mjs';

async function raw(req) {
  if (typeof req.body === 'string') return req.body;
  if (Buffer.isBuffer(req.body)) return req.body.toString('utf8');
  let body = '';
  for await (const chunk of req) body += chunk;
  return body;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'Method not allowed.' });
    return;
  }
  try {
    const body = await raw(req);
    verifyStripeSignature(body, req.headers['stripe-signature']);
    const event = JSON.parse(body);
    if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
      const session = event.data?.object || {};
      if (session.mode === 'payment' && session.payment_status === 'paid') {
        const reference = session.metadata?.booking_reference || session.client_reference_id;
        if (!reference) throw new HttpError(400, 'Missing booking reference.');
        const { error } = await db().from('bookings').update({ status: 'Paid' }).eq('reference', reference).neq('status', 'Cancelled');
        if (error) throw new Error('Booking payment status update failed');
      }
    }
    res.status(200).json({ received: true });
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 503;
    console.warn('stripe_webhook_failed', { status });
    res.status(status).json({ error: status === 400 ? error.message : 'Webhook unavailable.' });
  }
}
