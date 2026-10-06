import { createClient } from '@supabase/supabase-js';
import { createHmac, createHash } from 'node:crypto';

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export const site = () => process.env.SITE_URL || 'https://www.breezyeevans.co.uk';
export const DRIVER_DOC_BUCKET = 'driver-verification-documents';
export function env(name) {
  if (!process.env[name]) throw new HttpError(503, 'This service is temporarily unavailable. Please call +44 7300 331603.');
  return process.env[name];
}
export function db() {
  return createClient(env('VITE_SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false, autoRefreshToken: false } });
}
export function text(value, label, max = 200, min = 1) {
  // Reject control characters in submitted text, without logging the value.
  // eslint-disable-next-line no-control-regex
  if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value)) throw new HttpError(400, `Please check ${label}.`);
  return value.trim();
}
export function email(value) {
  const result = text(value, 'your email address', 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result)) throw new HttpError(400, 'Please enter a valid email address.');
  return result;
}
export function uuid(value) {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw new HttpError(400, 'Please reload the form and try again.');
  return value;
}
export function requestBody(req) {
  if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed.');
  if (req.headers.origin !== site()) {
    const local = process.env.NODE_ENV !== 'production' && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(req.headers.origin || '');
    if (!local) throw new HttpError(403, 'Please submit this form from our website.');
  }
  if (!String(req.headers['content-type']).startsWith('application/json')) throw new HttpError(415, 'JSON required.');
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { throw new HttpError(400, 'Invalid request.'); } }
  if (!body || Array.isArray(body) || typeof body !== 'object' || Buffer.byteLength(JSON.stringify(body)) > 24000) throw new HttpError(400, 'Invalid request.');
  return body;
}
export async function rateLimit(req, client, action, identity = '') {
  const ip = String(req.headers['x-vercel-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
  const key = createHmac('sha256', env('RATE_LIMIT_SECRET')).update(`${action}:${identity || ip}`).digest('hex');
  const { data, error } = await client.rpc('bv_rate_limit', { p_key: key, p_limit: action === 'auth' ? 15 : 6 });
  if (error) throw new HttpError(503, 'Please try again later or call us.');
  if (!data) throw new HttpError(429, 'Too many attempts. Please wait 15 minutes before trying again.');
}
export async function captcha(token, action, fetcher = fetch) {
  text(token, 'the security check', 4096);
  const response = await fetcher('https://www.google.com/recaptcha/api/siteverify', {
    method: 'POST', body: new URLSearchParams({ secret: env('RECAPTCHA_SECRET_KEY'), response: token }), signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new HttpError(503, 'Security check unavailable. Please try again.');
  const result = await response.json();
  const hosts = (process.env.RECAPTCHA_HOSTNAMES || 'www.breezyeevans.co.uk,breezyeevans.co.uk').split(',').map(x => x.trim());
  const age = Date.now() - Date.parse(result.challenge_ts);
  const threshold = Number(process.env.RECAPTCHA_MIN_SCORE || 0.5);
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) throw new HttpError(503, 'Security check unavailable.');
  if (!result.success || result.action !== action || typeof result.score !== 'number' || result.score < threshold || !hosts.includes(result.hostname) || !Number.isFinite(age) || age < -10000 || age > 120000) {
    console.warn('recaptcha_rejected', { action });
    throw new HttpError(403, 'We could not verify your submission. Please retry, or contact us by phone.');
  }
}
export async function userFor(req, client) {
  const token = String(req.headers.authorization || '').replace(/^Bearer /, '');
  if (!token) throw new HttpError(401, 'Please sign in to continue.');
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user?.email_confirmed_at) throw new HttpError(401, 'Please sign in with a verified email address.');
  return data.user;
}
export function digest(value) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
export function handle(fn) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try { await fn(req, res); } catch (error) {
      const status = error instanceof HttpError ? error.status : 503;
      console.warn('request_failed', { status });
      if (status === 429) res.setHeader('Retry-After', '900');
      if (status === 405) res.setHeader('Allow', 'POST');
      res.status(status).json({ error: error instanceof HttpError ? error.message : 'Unable to complete this request. Please try again or call +44 7300 331603.' });
    }
  };
}
