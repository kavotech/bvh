import { handle, requestBody, db, userFor, rateLimit, captcha, HttpError } from '../server/core.mjs';
import { readBusinessSettings } from '../server/booking-payments.mjs';

function isAdmin(user) {
  return user.email?.toLowerCase() === (process.env.ADMIN_EMAIL || 'info@breezyeevans.co.uk').toLowerCase();
}

function poundsToPenceInput(value, label) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0 || amount > 10000) throw new HttpError(400, `Please check ${label}.`);
  return Math.round(amount * 100);
}

function percentToBpsInput(value, label) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0 || amount > 100) throw new HttpError(400, `Please check ${label}.`);
  return Math.round(amount * 100);
}

export default handle(async (req, res) => {
  const body = requestBody(req);
  const client = db();
  const user = await userFor(req, client);
  await rateLimit(req, client, 'manage', user.id);
  await captcha(body.token, 'manage');
  if (!isAdmin(user)) throw new HttpError(403, 'Administrator access required.');
  if (body.action === 'get') {
    const settings = await readBusinessSettings(client);
    res.status(200).json({ settings });
    return;
  }
  if (body.action === 'update') {
    const payload = {
      id: true,
      booking_deposit_percent_bps: percentToBpsInput(body.bookingDepositPercent, 'booking deposit percentage'),
      booking_deposit_cap_pence: poundsToPenceInput(body.bookingDepositCap || 0, 'booking deposit cap'),
      security_deposit_pence: poundsToPenceInput(body.securityDeposit, 'security deposit'),
      insurance_percent_bps: percentToBpsInput(body.insurancePercent, 'insurance percentage'),
      insurance_enabled: body.insuranceEnabled === true,
      insurance_disclosure: String(body.insuranceDisclosure || '').trim().slice(0, 2000),
      hold_minutes: Math.max(5, Math.min(1440, Math.round(Number(body.holdMinutes) || 15))),
      payment_deadline_hours: Math.max(1, Math.min(720, Math.round(Number(body.paymentDeadlineHours) || 24))),
      updated_by: user.id,
      updated_at: new Date().toISOString(),
    };
    if (!Number.isSafeInteger(payload.insurance_percent_bps) || payload.insurance_percent_bps < 0 || payload.insurance_percent_bps > 10000) throw new HttpError(400, 'Please check the insurance percentage.');
    if (payload.insurance_enabled && payload.insurance_disclosure.length < 20) throw new HttpError(400, 'Add the confirmed insurance disclosure before enabling insurance charges.');
    const { data, error } = await client.from('business_settings').upsert(payload).select('*').single();
    if (error) throw new HttpError(503, 'Unable to save payment settings. Run the latest Supabase migration first.');
    res.status(200).json({ settings: data, message: 'Payment settings saved.' });
    return;
  }
  throw new HttpError(400, 'Invalid settings action.');
});
