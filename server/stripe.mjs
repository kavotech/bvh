import { env, site, HttpError } from './core.mjs';
import { createHmac, timingSafeEqual } from 'node:crypto';

const STRIPE_API = 'https://api.stripe.com/v1';

function stripeSecret() {
  return env('STRIPE_SECRET_KEY');
}

export function parseMoneyToPence(price) {
  if (typeof price !== 'string') return null;
  const match = price.trim().match(/^£(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) return null;
  const pounds = Number(match[1]);
  const pence = Number((match[2] || '').padEnd(2, '0'));
  if (!Number.isSafeInteger(pounds) || !Number.isSafeInteger(pence)) return null;
  const total = pounds * 100 + pence;
  return total > 0 ? total : null;
}

export async function stripeRequest(path, params, idempotencyKey, fetcher = fetch) {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) body.append(key, String(value));
  }
  const response = await fetcher(`${STRIPE_API}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${stripeSecret()}:`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    },
    body,
    signal: AbortSignal.timeout(15000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.warn('stripe_request_failed', { status: response.status, type: data?.error?.type });
    throw new HttpError(503, 'Unable to start secure payment. Your booking request is saved; please contact us.');
  }
  return data;
}

export async function createBookingCheckoutSession({ reference, bookingId, customerEmail, customerName, vehicleName, priceText }, fetcher = fetch) {
  const amount = parseMoneyToPence(priceText);
  if (!amount) return null;
  const base = site();
  return stripeRequest('/checkout/sessions', {
    mode: 'payment',
    'line_items[0][quantity]': 1,
    'line_items[0][price_data][currency]': 'gbp',
    'line_items[0][price_data][unit_amount]': amount,
    'line_items[0][price_data][product_data][name]': `Breezyee Vans booking request ${reference}`,
    'line_items[0][price_data][product_data][description]': `${vehicleName || 'Van hire'} estimated hire payment. Availability remains subject to confirmation.`,
    customer_email: customerEmail,
    client_reference_id: reference,
    success_url: `${base}/payment.html?session_id={CHECKOUT_SESSION_ID}&reference=${encodeURIComponent(reference)}`,
    cancel_url: `${base}/payment.html?cancelled=1&reference=${encodeURIComponent(reference)}`,
    'metadata[booking_reference]': reference,
    'metadata[booking_id]': bookingId || '',
    'metadata[customer_email]': customerEmail,
    'metadata[customer_name]': customerName || '',
    'payment_intent_data[metadata][booking_reference]': reference,
    'payment_intent_data[metadata][booking_id]': bookingId || '',
  }, `booking-payment:${reference}`, fetcher);
}

export function verifyStripeSignature(rawBody, signatureHeader, secret = env('STRIPE_WEBHOOK_SECRET'), toleranceSeconds = 300) {
  if (!signatureHeader) throw new HttpError(400, 'Missing Stripe signature.');
  const parts = Object.fromEntries(signatureHeader.split(',').map(part => {
    const [key, ...rest] = part.split('=');
    return [key, rest.join('=')];
  }));
  const timestamp = Number(parts.t);
  const signature = parts.v1;
  if (!Number.isFinite(timestamp) || !signature) throw new HttpError(400, 'Invalid Stripe signature.');
  if (Math.abs(Date.now() / 1000 - timestamp) > toleranceSeconds) throw new HttpError(400, 'Expired Stripe signature.');
  const expected = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
  const actual = Buffer.from(signature, 'hex');
  const expectedBuffer = Buffer.from(expected, 'hex');
  if (actual.length !== expectedBuffer.length || !timingSafeEqual(actual, expectedBuffer)) throw new HttpError(400, 'Invalid Stripe signature.');
}
