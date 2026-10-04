import { supabase, ADMIN_EMAIL } from './supabase.js';
import { post, ensureCaptchaLoaded } from './forms.js';

const page = document.getElementById('loginPage');
const form = document.getElementById('authForm');
const email = document.getElementById('authEmail');
const password = document.getElementById('authPassword');
const fullName = document.getElementById('authFullName');
const phone = document.getElementById('authPhone');
const submit = document.getElementById('authSubmit');
const status = document.getElementById('authStatus');
const heading = document.getElementById('authHeading');
const toggle = document.getElementById('authToggle');
const modeHint = document.getElementById('authModeHint');
const passwordToggle = document.getElementById('passwordToggle');
const reset = document.getElementById('auth-reset');
const params = new URLSearchParams(window.location.search);
let mode = params.get('mode') === 'signup' ? 'register' : 'login';

function setStatus(message, error = false) { if (status) { status.textContent = message; status.classList.toggle('error', error); } }
function safeReturnTo() { const target = params.get('returnTo'); if (!target) return ''; try { const decoded = decodeURIComponent(target); return decoded.startsWith('/') && !decoded.startsWith('//') && !decoded.includes('\\') ? decoded : ''; } catch { return ''; } }
function nextUrl(user) { return safeReturnTo() || (user?.email?.toLowerCase() === ADMIN_EMAIL.toLowerCase() ? '/dashboard' : '/user-dashboard'); }
function render() { const signup = mode === 'register'; heading.textContent = signup ? 'Create your account' : 'Welcome back'; modeHint.textContent = signup ? 'Already a customer?' : 'New to Breezyee Vans?'; toggle.textContent = signup ? 'Sign in' : 'Create an account'; submit.textContent = signup ? 'Create account' : 'Sign in securely'; document.querySelectorAll('.signup-only').forEach(el => { el.hidden = !signup; }); }
async function completeSession(response) { const result = await supabase.auth.setSession(response.session); if (result.error) throw result.error; window.location.href = nextUrl(result.data.user); }

if (page) {
  ensureCaptchaLoaded().catch(() => {});
  if (!supabase) setStatus('Authentication is not configured. Please contact support.', true);
  passwordToggle?.addEventListener('click', () => { const visible = password.type === 'text'; password.type = visible ? 'password' : 'text'; passwordToggle.textContent = visible ? 'Show' : 'Hide'; passwordToggle.setAttribute('aria-pressed', String(!visible)); });
  toggle?.addEventListener('click', () => { mode = mode === 'login' ? 'register' : 'login'; render(); setStatus(''); });
  reset?.addEventListener('click', async event => { event.preventDefault(); const address = email.value.trim(); if (!address || !address.includes('@')) { setStatus('Enter your email first, then choose forgot password.', true); return; } reset.disabled = true; try { const result = await post('/api/auth', { action: 'reset', email: address }, 'reset'); setStatus(result.message); } catch (error) { setStatus(error.message, true); } finally { reset.disabled = false; } });
  form?.addEventListener('submit', async event => { event.preventDefault(); if (!supabase) return; submit.disabled = true; setStatus(mode === 'register' ? 'Creating your secure account…' : 'Signing you in…'); try { const payload = { action: mode, email: email.value.trim(), password: password.value }; if (mode === 'register') Object.assign(payload, { fullName: fullName.value.trim(), phone: phone.value.trim(), postcode: document.getElementById('authPostcode')?.value.trim() }); await completeSession(await post('/api/auth', payload, mode)); } catch (error) { setStatus(error.message || 'Sign-in failed. Please try again.', true); } finally { submit.disabled = false; } });
  supabase?.auth.getSession().then(({ data }) => { if (data.session) window.location.href = nextUrl(data.session.user); });
  render();
}
