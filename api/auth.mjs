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
  if (!['login','register','reset'].includes(body.action)) throw new HttpError(400, 'Invalid action.');
  const address = email(body.email);
  const admin = db();
  await rateLimit(req, admin, 'auth');
  await rateLimit(req, admin, 'auth', address);
  await captcha(body.token, body.action);
  const anon = createClient(env('VITE_SUPABASE_URL'), env('VITE_SUPABASE_ANON_KEY'), { auth: { persistSession: false, autoRefreshToken: false } });
  const password = body.password;

  if (['login','register'].includes(body.action) && (typeof password !== 'string' || password.length < (body.action === 'register' ? 12 : 1) || password.length > 128)) throw new HttpError(400, 'Please check your password. New passwords need at least 12 characters.');
  if (body.action === 'login') {
    const result = await anon.auth.signInWithPassword({ email: address, password });
    if (result.error || !result.data.user?.email_confirmed_at) throw new HttpError(401, 'Sign-in failed. Check your details and verify your email.');
    res.status(200).json({ session: { access_token: result.data.session.access_token, refresh_token: result.data.session.refresh_token } });
    return;
  }
  if (body.action === 'register') {
    const existing = await findUserByEmail(admin, address);
    if (existing) throw new HttpError(409, 'An account already exists for this email. Try signing in instead.');
    const userMetadata = { password_set: true };
    if (body.fullName) userMetadata.full_name = text(body.fullName, 'your name', 100, 2);
    const created = await admin.auth.admin.createUser({
      email: address,
      password,
      email_confirm: true,
      user_metadata: userMetadata,
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
});
