import { handle, requestBody, db, rateLimit, captcha, userFor, uuid, digest, HttpError } from '../server/core.mjs';
import { validateBooking, validateEnquiry, validateDriver } from '../server/validation.mjs';
import { submissionEmails, deliverEmails } from '../server/email.mjs';
import { parseMoneyToPence } from '../server/stripe.mjs';

export default handle(async (req, res) => {
  const body = requestBody(req);
  if (!['booking', 'enquiry'].includes(body.kind)) throw new HttpError(400, 'Invalid form.');
  const client = db();
  await rateLimit(req, client, 'submit');
  const requestId = uuid(body.requestId);
  await captcha(body.token, body.kind);
  let data, driver = null, owner;
  if (body.kind === 'booking') {
    const user = await userFor(req, client);
    owner = user.id;
    const { data: car, error } = await client.from('cars').select('id,model,type,price_daily,is_active').eq('id', uuid(body.vehicleId)).single();
    if (error) throw new HttpError(400, 'Please select a listed vehicle.');
    data = validateBooking(body, user, car);
    driver = validateDriver(body, user, requestId);
    const { data: files, error: fileError } = await client.storage.from('driver-verification-documents').list(`${user.id}/${requestId}`);
    if (fileError || ![driver.licence_front_file, driver.licence_back_file].every(path => files?.some(file => file.name === path.split('/').pop() && file.metadata?.size <= 5 * 1024 * 1024))) throw new HttpError(400, 'Please upload both licence documents, each under 5 MB.');
  } else {
    data = validateEnquiry(body);
    owner = data.email;
  }
  const key = digest([body.kind, owner, requestId]);
  const reference = `BV-${key.slice(0,16).toUpperCase()}`;
  const stable = { ...data }; delete stable.terms_accepted_at;
  const jobs = submissionEmails(body.kind, data, reference);
  const { data: saved, error } = await client.rpc('bv_submit', { p_key: key, p_hash: digest([stable, driver]), p_kind: body.kind, p_reference: reference, p_data: data, p_driver: driver, p_emails: jobs });
  if (error) {
    if (error.message?.includes('idempotency_conflict')) throw new HttpError(409, 'This request was already submitted with different details. Start a new request.');
    throw new Error('Submission persistence failed');
  }
  // Persistence succeeds even if the provider is unavailable; the durable queue can retry.
  try { await deliverEmails(client, key); } catch { console.warn('email_queue_pending'); }
  const amount = body.kind === 'booking' ? parseMoneyToPence(data.price) : null;
  const payment = amount ? { paymentPage: `/payment?reference=${encodeURIComponent(saved.reference)}`, amountTotal: amount, currency: 'gbp' } : null;
  res.status(200).json({ reference: saved.reference, status: 'Requested', message: payment ? 'Your booking request is saved. Continue to secure payment.' : 'Your request is saved. Availability is subject to confirmation.', payment });
});
