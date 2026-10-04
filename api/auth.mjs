import { createClient } from '@supabase/supabase-js';
import { createHmac } from 'node:crypto';
import { handle, requestBody, db, rateLimit, captcha, text, email, env, site, HttpError } from '../server/core.mjs';
import { template, sendResendEmail } from '../server/email.mjs';

async function findUserByEmail(admin, address) {
  const target = address.toLowerCase();
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new HttpError(503, 'Authentication is temporarily unavailable. Please try again.');
    const found = data.users.find(user => user.email?.toLowerCase() === target);
    if (found) return found;
    if (!data.users.length || data.users.length < 1000) return null;
  }
  throw new HttpError(503, 'Authentication needs administrator attention. Please contact us.');
}

function idempotencyKey(parts) {
  return createHmac('sha256', env('RATE_LIMIT_SECRET')).update(JSON.stringify(parts)).digest('hex');
}

async function sendOtpEmail(address, code, fetcher = fetch) {
  const content = template('Your Breezyee Vans sign-in code', [
    'Use this one-time code to finish signing in:',
    code,
    'This code expires soon. If you did not request it, you can ignore this email.',
  ]);
  await sendResendEmail({ recipient: address, ...content }, idempotencyKey(['otp', address, code]), fetcher);
}

async function sendResetEmail(address, actionLink, fetcher = fetch) {
  const content = template('Create or reset your Breezyee Vans password', [
    'Use this secure link to choose a new password:',
    actionLink,
    'If you did not request this, you can ignore this email. We will never ask you to email your password.',
  ]);
  await sendResendEmail({ recipient: address, ...content }, idempotencyKey(['reset', address, actionLink]), fetcher);
}

export default handle(async (req, res) => {
  const body = requestBody(req);
  if (!['login','register','reset','resend','start_otp','verify_otp'].includes(body.action)) throw new HttpError(400, 'Invalid action.');
  const address = email(body.email);
  const admin = db();
  await rateLimit(req, admin, 'auth');
  await rateLimit(req, admin, 'auth', address);
  await captcha(body.token, body.action);
  const anon = createClient(env('VITE_SUPABASE_URL'), env('VITE_SUPABASE_ANON_KEY'), { auth: { persistSession: false, autoRefreshToken: false } });
  const adminEmail = (process.env.ADMIN_EMAIL || 'info@breezyeevans.co.uk').toLowerCase();
  const password = body.password;

  if (body.action === 'start_otp') {
    const metadata = {};
    if (body.fullName) metadata.full_name = text(body.fullName, 'your name', 100, 2);
    if (body.phone) metadata.phone = text(body.phone, 'phone number', 30, 7);
    if (body.dob) metadata.date_of_birth = text(body.dob, 'date of birth', 10, 8);
    if (body.postcode) metadata.postcode = text(body.postcode, 'postcode', 12, 3);
    const shouldCreateUser = body.signup === true || address.toLowerCase() === adminEmail;
    const existing = await findUserByEmail(admin, address);
    if (!existing && !shouldCreateUser) throw new HttpError(400, 'No account was found for this email. Create an account first.');
    if (existing && Object.keys(metadata).length) await admin.auth.admin.updateUserById(existing.id, { user_metadata: { ...(existing.user_metadata || {}), ...metadata } });
    const isAdminAddress = address.toLowerCase() === adminEmail;
    const result = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email: address,
      options: { redirectTo: `${site()}/login`, data: { ...(existing?.user_metadata || {}), ...metadata, password_set: isAdminAddress || existing?.user_metadata?.password_set === true } },
    });
    if (result.error || !result.data?.properties?.email_otp) throw new HttpError(400, 'Unable to create a one-time code. Please wait before trying again.');
    await sendOtpEmail(address, result.data.properties.email_otp);
    res.status(200).json({ message: 'We sent a one-time code to your email. Enter it here to continue.' });
    return;
  }

  if (body.action === 'verify_otp') {
    const token = text(body.otp, 'your one-time code', 12, 6).replace(/\s+/g, '');
    const result = await anon.auth.verifyOtp({ email: address, token, type: 'email' });
    if (result.error || !result.data.session || !result.data.user?.email_confirmed_at) throw new HttpError(401, 'That code could not be verified. Check the latest email and try again.');
    res.status(200).json({ session: { access_token: result.data.session.access_token, refresh_token: result.data.session.refresh_token }, requiresPasswordSetup: address.toLowerCase() !== adminEmail && result.data.user.user_metadata?.password_set !== true });
    return;
  }

  if (['login','register'].includes(body.action) && (typeof password !== 'string' || password.length < (body.action === 'register' ? 12 : 1) || password.length > 128)) throw new HttpError(400, 'Please check your password. New passwords need at least 12 characters.');
  if (body.action === 'login') {
    const result = await anon.auth.signInWithPassword({ email: address, password });
    if (result.error || !result.data.user?.email_confirmed_at) throw new HttpError(401, 'Sign-in failed. Check your details and verify your email.');
    res.status(200).json({ session: { access_token: result.data.session.access_token, refresh_token: result.data.session.refresh_token } });
    return;
  }
  if (body.action === 'register') {
    const existing = await findUserByEmail(admin, address);
    if (existing) throw new HttpError(409, 'An account already exists for this email. Request a one-time code to sign in.');
    const created = await admin.auth.admin.createUser({
      email: address,
      password,
      email_confirm: true,
      user_metadata: { full_name: text(body.fullName, 'your name', 100, 2), phone: text(body.phone, 'phone number', 30, 7), postcode: text(body.postcode, 'postcode', 12, 3), password_set: true },
    });
    if (created.error) throw new HttpError(400, 'Unable to process this request. Please wait before trying again.');
    const result = await anon.auth.signInWithPassword({ email: address, password });
    if (result.error || !result.data.session) throw new HttpError(400, 'Account created. Please sign in to continue.');
    res.status(200).json({ session: { access_token: result.data.session.access_token, refresh_token: result.data.session.refresh_token } });
    return;
  }
  if (body.action === 'reset') {
    const existing = await findUserByEmail(admin, address);
    if (existing) {
      const result = await admin.auth.admin.generateLink({ type: 'recovery', email: address, options: { redirectTo: `${site()}/reset-password` } });
      if (!result.error && result.data?.properties?.action_link) await sendResetEmail(address, result.data.properties.action_link);
    }
    res.status(200).json({ message: 'If this address is eligible, an email with the next steps will arrive shortly. Check your spam folder too.' });
    return;
  }
  if (body.action === 'resend') {
    res.status(200).json({ message: 'Use the resend one-time code button to request a new code.' });
    return;
  }
});
