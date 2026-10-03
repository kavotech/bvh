import { createClient } from '@supabase/supabase-js';
import { handle, requestBody, db, rateLimit, captcha, text, email, env, site, HttpError } from '../server/core.mjs';

export default handle(async (req, res) => {
  const body = requestBody(req);
  if (!['login','register','reset','resend'].includes(body.action)) throw new HttpError(400, 'Invalid action.');
  const address = email(body.email);
  const admin = db();
  await rateLimit(req, admin, 'auth');
  await rateLimit(req, admin, 'auth', address);
  await captcha(body.token, body.action);
  const client = createClient(env('VITE_SUPABASE_URL'), env('VITE_SUPABASE_ANON_KEY'), { auth: { persistSession: false, autoRefreshToken: false } });
  let result;
  const password = body.password;
  if (['login','register'].includes(body.action) && (typeof password !== 'string' || password.length < (body.action === 'register' ? 12 : 1) || password.length > 128)) throw new HttpError(400, 'Please check your password. New passwords need at least 12 characters.');
  if (body.action === 'login') {
    result = await client.auth.signInWithPassword({ email: address, password });
    if (result.error || !result.data.user?.email_confirmed_at) throw new HttpError(401, 'Sign-in failed. Check your details and verify your email.');
    res.status(200).json({ session: { access_token: result.data.session.access_token, refresh_token: result.data.session.refresh_token } });
    return;
  }
  if (body.action === 'register') {
    result = await client.auth.signUp({ email: address, password, options: { emailRedirectTo: `${site()}/login`, data: { full_name: text(body.fullName, 'your name', 100, 2), phone: text(body.phone, 'phone number', 30, 7), postcode: text(body.postcode, 'postcode', 12, 3) } } });
  } else if (body.action === 'reset') {
    result = await client.auth.resetPasswordForEmail(address, { redirectTo: `${site()}/reset-password` });
  } else {
    result = await client.auth.resend({ type: 'signup', email: address, options: { emailRedirectTo: `${site()}/login` } });
  }
  if (result.error) throw new HttpError(400, 'Unable to process this request. Please wait before trying again.');
  res.status(200).json({ message: 'If this address is eligible, an email with the next steps will arrive shortly. Check your spam folder too.' });
});
