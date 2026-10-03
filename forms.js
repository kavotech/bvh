import { supabase } from './supabase.js';
const siteKey = import.meta.env.VITE_RECAPTCHA_SITE_KEY;
let captchaReady;
export function getToken(action) {
  if (!siteKey) return Promise.reject(new Error('Security check unavailable. Please call +44 7300 331603.'));
  captchaReady ||= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `https://www.google.com/recaptcha/api.js?render=${encodeURIComponent(siteKey)}`;
    script.async = true;
    script.onload = () => window.grecaptcha.ready(resolve);
    script.onerror = () => { captchaReady = null; script.remove(); reject(new Error('Unable to load the security check. Please retry or call us.')); };
    document.head.append(script);
  });
  return Promise.race([captchaReady.then(() => window.grecaptcha.execute(siteKey, { action })), new Promise((_, reject) => setTimeout(() => reject(new Error('Security check timed out. Please retry.')), 15000))]);
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
for (const action of ['reset','resend']) {
  document.getElementById(`auth-${action}`)?.addEventListener('click', async event => {
    const status = document.getElementById('authStatus');
    event.target.disabled = true;
    try { const result = await post('/api/auth', { action, email: document.getElementById('authEmail').value }, action); status.textContent = result.message; }
    catch (error) { status.textContent = error.message; }
    finally { event.target.disabled = false; }
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
    const { error } = await supabase.auth.updateUser({ password });
    if (error) throw new Error('Unable to reset your password. Request a new reset link.');
    await supabase.auth.signOut();
    status.textContent = 'Password updated. You can now sign in with your new password.';
    event.target.reset();
  } catch (error) { status.textContent = error.message; }
  finally { button.disabled = false; }
});
