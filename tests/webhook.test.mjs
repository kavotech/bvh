import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { processStripeWebhook } from '../api/stripe-webhook.mjs';

process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
process.env.RESEND_API_KEY = 'test-key';

function fakeClient(payment) {
  const ops = [];
  const from = table => {
    const api = {
      select: () => api, eq: () => api, in: () => api,
      insert: value => { ops.push({ table, op: 'insert', value }); return Promise.resolve({ error: null }); },
      update: value => { ops.push({ table, op: 'update', value }); return api; },
      upsert: value => { ops.push({ table, op: 'upsert', value }); return Promise.resolve({ error: null }); },
      maybeSingle: () => Promise.resolve({ data: null }),
      single: () => Promise.resolve(table === 'booking_payments' ? { data: payment, error: null } : { data: null, error: {} }),
      then: (resolve, reject) => Promise.resolve({ error: null }).then(resolve, reject),
    };
    return api;
  };
  return { ops, from, rpc: async () => ({ data: [] }) };
}

const payment = (status = 'requires_payment') => ({
  id: 'pay_1', booking_id: 'book_1', category: 'booking_deposit', currency: 'gbp', expected_amount_pence: 5000, status,
  bookings: { id: 'book_1', reference: 'BV-TEST', paid_total_pence: 0, email: 'customer@example.test', name: 'Test Customer', vehicle_name: 'Mercedes Sprinter', date: '2027-01-02', time: '10:00' },
});

const event = (type, extra = {}) => ({
  id: `evt_${type}`, type, created: 1, data: { object: { id: 'pi_1', amount: 5000, amount_received: 5000, currency: 'gbp', status: 'succeeded', metadata: { booking_reference: 'BV-TEST', payment_id: 'pay_1', payment_category: 'booking_deposit' }, ...extra } },
});

// Stripe sends pretty-printed JSON; the signature only matches those exact bytes.
const signed = body => { const t = Math.floor(Date.now() / 1000); return `t=${t},v1=${createHmac('sha256', 'whsec_test').update(`${t}.${body}`).digest('hex')}`; };

test('webhook verifies the exact raw body, reserves the booking and emails customer and admin on success', async () => {
  const raw = JSON.stringify(event('payment_intent.succeeded'), null, 2);
  const client = fakeClient(payment());
  const result = await processStripeWebhook(raw, signed(raw), client);
  assert.equal(result.status, 200);
  assert.ok(client.ops.some(o => o.table === 'booking_payments' && o.value.status === 'paid'));
  assert.ok(client.ops.some(o => o.table === 'bookings' && o.value.booking_status === 'Reserved'));
  const mail = client.ops.find(o => o.table === 'email_outbox').value;
  assert.deepEqual(mail.map(m => m.recipient), ['customer@example.test', 'info@breezyeevans.co.uk']);
  assert.equal(mail[0].subject, 'Payment Received — Your Van Is Reserved');
  assert.equal(mail[0].submission_key, 'payment:pay_1:paid');
  assert.match(mail[0].html, /View My Booking/);
  const reparsed = JSON.stringify(JSON.parse(raw));
  assert.equal((await processStripeWebhook(reparsed, signed(raw), fakeClient(payment()))).status, 400, 're-serialised bodies must not verify');
});

test('failed payments email a retry link, and late failures never undo a paid payment', async () => {
  const raw = JSON.stringify(event('payment_intent.payment_failed', { status: 'requires_payment_method', last_payment_error: { message: 'Your card was declined.' } }), null, 2);
  const client = fakeClient(payment());
  assert.equal((await processStripeWebhook(raw, signed(raw), client)).status, 200);
  assert.ok(client.ops.some(o => o.table === 'bookings' && o.value.payment_status === 'failed'));
  const mail = client.ops.find(o => o.table === 'email_outbox').value;
  assert.equal(mail[0].subject, "Your Payment Didn't Go Through");
  assert.match(mail[0].text, /Your card was declined\./);
  assert.match(mail[0].html, /payment\?reference=BV-TEST&amp;category=booking_deposit/);
  const paidClient = fakeClient(payment('paid'));
  assert.equal((await processStripeWebhook(raw, signed(raw), paidClient)).status, 200);
  assert.ok(!paidClient.ops.some(o => ['booking_payments', 'bookings', 'email_outbox'].includes(o.table)));
});
