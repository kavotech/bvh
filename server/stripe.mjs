import { env, HttpError } from './core.mjs';
import { createHmac, timingSafeEqual } from 'node:crypto';

const STRIPE_API = 'https://api.stripe.com/v1';

function stripeSecret() {
  return env('STRIPE_SECRET_KEY');
}

export function stripeEnvironment() {
  const secret = stripeSecret();
  const actual = secret.startsWith('sk_live') ? 'live' : secret.startsWith('sk_test') ? 'test' : null;
  if (!actual) throw new HttpError(503, 'Stripe is not configured with a valid secret key. Please contact support.');
  // The key prefix is the source of truth. STRIPE_ENVIRONMENT remains an optional
  // deployment label, but a stale label must not override the actual Stripe key mode.
  return actual;
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
  stripeEnvironment();
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

export async function createBookingPaymentIntent({
  reference,
  bookingId,
  paymentId,
  category = 'booking_deposit',
  customerEmail,
  customerName,
  vehicleName,
  amountPence,
  priceText,
}, fetcher = fetch) {
  const amount = Number.isSafeInteger(Number(amountPence)) ? Number(amountPence) : parseMoneyToPence(priceText);
  if (!amount) return null;
  return stripeRequest('/payment_intents', {
    amount,
    currency: 'gbp',
    receipt_email: customerEmail,
    description: `Breezyee Vans ${category.replaceAll('_', ' ')} ${reference} — ${vehicleName || 'Van hire'}`,
    'automatic_payment_methods[enabled]': true,
    'metadata[booking_reference]': reference,
    'metadata[booking_id]': bookingId || '',
    'metadata[payment_id]': paymentId || '',
    'metadata[payment_category]': category,
    'metadata[customer_email]': customerEmail,
    'metadata[customer_name]': customerName || '',
  }, `booking-payment:${reference}:${category}`, fetcher);
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
