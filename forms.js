import { supabase } from './supabase.js';
const DEFAULT_RECAPTCHA_SITE_KEY = '6LfW3NstAAAAAB27CdNwy27joAxlNbfnKV-nuY5y';
const siteKey = import.meta.env.VITE_RECAPTCHA_SITE_KEY || DEFAULT_RECAPTCHA_SITE_KEY;
let captchaReady;
export function ensureCaptchaLoaded() {
  if (!siteKey) return Promise.reject(new Error('Security check unavailable. Please call +44 7300 331603.'));
  captchaReady ||= new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-recaptcha-v3]');
    if (existing && window.grecaptcha) {
      window.grecaptcha.ready(resolve);
      return;
    }
    const script = document.createElement('script');
    script.src = `https://www.google.com/recaptcha/api.js?render=${encodeURIComponent(siteKey)}`;
    script.async = true;
    script.dataset.recaptchaV3 = 'true';
    script.onload = () => window.grecaptcha.ready(resolve);
    script.onerror = () => { captchaReady = null; script.remove(); reject(new Error('Unable to load the security check. Please retry or call us.')); };
    document.head.append(script);
  });
  return captchaReady;
}
export function getToken(action) {
  if (!siteKey) return Promise.reject(new Error('Security check unavailable. Please call +44 7300 331603.'));
  return Promise.race([ensureCaptchaLoaded().then(() => window.grecaptcha.execute(siteKey, { action })), new Promise((_, reject) => setTimeout(() => reject(new Error('Security check timed out. Please retry.')), 15000))]);
}
export async function post(path, payload, action) {
  const token = await getToken(action);
  const { data } = supabase ? await supabase.auth.getSession() : { data: {} };
  const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(data.session ? { Authorization: `Bearer ${data.session.access_token}` } : {}) }, body: JSON.stringify({ ...payload, token }), signal: AbortSignal.timeout(60000) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || 'Unable to submit. Please retry or call us.');
  return result;
}

const enquiry = document.getElementById('enquiryForm');
if (enquiry) {
  let requestId = crypto.randomUUID();
  enquiry.addEventListener('submit', async event => {
    event.preventDefault();
    const button = enquiry.querySelector('[type=submit]');
    const status = document.getElementById('enquiryStatus');
    button.disabled = true; status.textContent = 'Sending your enquiry…';
    try {
      const data = Object.fromEntries(new FormData(enquiry));
      const result = await post('/api/submit', { ...data, kind: 'enquiry', requestId }, 'enquiry');
      status.textContent = `Thank you. Your enquiry is saved. Reference: ${result.reference}. We will be in touch.`;
      enquiry.reset(); requestId = crypto.randomUUID();
    } catch (error) { status.textContent = error.message; }
    finally { button.disabled = false; }
  });
}
document.getElementById('resetForm')?.addEventListener('submit', async event => {
  event.preventDefault();
  const button = event.target.querySelector('button');
  const status = document.getElementById('resetStatus');
  button.disabled = true;
  try {
    if (!supabase) throw new Error('Authentication is unavailable.');
    const { data } = await supabase.auth.getSession();
    if (!data.session) throw new Error('Please open a valid password reset link from your email.');
    const password = document.getElementById('newPassword').value;
    if (password.length < 12) throw new Error('Use at least 12 characters.');
    const userMeta = data.session.user?.user_metadata || {};
    const { error } = await supabase.auth.updateUser({ password, data: { ...userMeta, password_set: true } });
    if (error) throw new Error('Unable to reset your password. Request a new reset link.');
    await supabase.auth.signOut();
    status.textContent = 'Password updated. You can now sign in securely with your email and password.';
    event.target.reset();
  } catch (error) { status.textContent = error.message; }
  finally { button.disabled = false; }
});

const protectedForms = '#bookingForm,#enquiryForm,#resetForm';
if (siteKey && document.querySelector(protectedForms)) {
  const loadBadge = () => ensureCaptchaLoaded().catch(() => {});
  if ('requestIdleCallback' in window) requestIdleCallback(loadBadge, { timeout: 2500 });
  else setTimeout(loadBadge, 900);
}

