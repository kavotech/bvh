import { supabase, ADMIN_EMAIL } from './supabase.js';
import { post, ensureCaptchaLoaded } from './forms.js';

const loginPage = document.getElementById('loginPage');
const authForm = document.getElementById('authForm');
const authToggle = document.getElementById('authToggle');
const authHeading = document.getElementById('authHeading');
const authModeHint = document.getElementById('authModeHint');
const authSubmit = document.getElementById('authSubmit');
const authStatus = document.getElementById('authStatus');
const emailField = document.getElementById('authEmail');
const otpField = document.getElementById('authOtp');
const resendButton = document.getElementById('auth-resend');
const resetButton = document.getElementById('auth-reset');
const signupFields = loginPage ? [...loginPage.querySelectorAll('.signup-only')] : [];
const otpFields = loginPage ? [...loginPage.querySelectorAll('.otp-only')] : [];
const params = new URLSearchParams(window.location.search);

let authMode = params.get('mode') === 'signup' ? 'signUp' : 'signIn';
let otpSent = false;
let pendingEmail = '';
let resendAvailableAt = 0;

function isAdminUser(user) {
  return user?.email?.toLowerCase() === ADMIN_EMAIL.toLowerCase();
}

function normaliseEmail(value) {
  const address = String(value || '').trim();
  return address.toLowerCase() === 'admin' ? ADMIN_EMAIL : address;
}

function safeReturnTo() {
  const target = params.get('returnTo');
  if (!target) return '';
  try {
    const decoded = decodeURIComponent(target);
    if (!decoded.startsWith('/') || decoded.startsWith('//') || decoded.includes('\\')) return '';
    return decoded;
  } catch {
    return '';
  }
}

function dashboardFor(user) {
  return isAdminUser(user) ? '/dashboard' : '/user-dashboard';
}

function nextUrlFor(user) {
  return safeReturnTo() || dashboardFor(user);
}

function setStatus(message) {
  if (authStatus) authStatus.textContent = message;
}

function renderMode(message) {
  signupFields.forEach(field => {
    field.style.display = authMode === 'signUp' && !otpSent ? 'block' : 'none';
  });
  otpFields.forEach(field => {
    field.style.display = otpSent ? 'block' : 'none';
  });
  if (emailField) emailField.disabled = otpSent;
  if (authMode === 'signIn') {
    authHeading.textContent = otpSent ? 'Enter your one-time code' : 'Sign in to your account';
    authModeHint.textContent = 'New here?';
    authToggle.textContent = otpSent ? 'Use another email' : 'Create an account';
  } else {
    authHeading.textContent = otpSent ? 'Enter your signup code' : 'Create your account';
    authModeHint.textContent = 'Already registered?';
    authToggle.textContent = otpSent ? 'Use another email' : 'Sign in';
  }
  authSubmit.textContent = otpSent ? 'Verify code' : 'Send one-time code';
  setStatus(message || (otpSent ? 'Check your email and enter the code we sent.' : 'Enter your email and we’ll send a secure one-time code.'));
}

function resetOtpState(nextMode = authMode) {
  authMode = nextMode;
  otpSent = false;
  pendingEmail = '';
  resendAvailableAt = 0;
  if (emailField) emailField.disabled = false;
  if (otpField) otpField.value = '';
  renderMode();
}

async function sendCode({ resend = false } = {}) {
  const authEmail = pendingEmail || normaliseEmail(emailField?.value || '');
  if (!authEmail) {
    setStatus('Enter your email before requesting a code.');
    return;
  }
  if (resend && Date.now() < resendAvailableAt) {
    setStatus(`Please wait ${Math.ceil((resendAvailableAt - Date.now()) / 1000)} seconds before requesting another code.`);
    return;
  }
  const fullName = document.getElementById('authFullName')?.value.trim();
  const dob = document.getElementById('authDob')?.value;
  const phone = document.getElementById('authPhone')?.value.trim();
  const postcode = document.getElementById('authPostcode')?.value.trim();
  if (!otpSent && authMode === 'signUp' && (!fullName || !dob || !phone || !postcode)) {
    setStatus('Please complete all required signup fields.');
    return;
  }
  setStatus(resend ? 'Sending a fresh one-time code…' : 'Sending your one-time code…');
  const response = await post('/api/auth', { action: 'start_otp', email: authEmail, signup: authMode === 'signUp', fullName, dob, phone, postcode }, 'start_otp');
  pendingEmail = authEmail;
  otpSent = true;
  resendAvailableAt = Date.now() + 60000;
  renderMode(response.message || 'We sent a one-time code to your email.');
  otpField?.focus();
}

async function verifyCode() {
  const otp = otpField?.value.trim() || '';
  const authEmail = pendingEmail || normaliseEmail(emailField?.value || '');
  if (!otp) {
    setStatus('Enter the one-time code from your email.');
    return;
  }
  setStatus('Verifying your code…');
  const response = await post('/api/auth', { action: 'verify_otp', email: authEmail, otp }, 'verify_otp');
  const result = await supabase.auth.setSession(response.session);
  if (result.error) throw result.error;
  if (response.requiresPasswordSetup) {
    window.location.href = `/reset-password?setup=1${safeReturnTo() ? `&returnTo=${encodeURIComponent(safeReturnTo())}` : ''}`;
    return;
  }
  window.location.href = nextUrlFor(result.data?.user);
}

if (loginPage) {
  ensureCaptchaLoaded().catch(() => {});
  if (!supabase) setStatus('Authentication is not configured. Please contact support.');
  else {
    supabase.auth.getSession().then(({ data }) => {
      const user = data.session?.user;
      if (user) {
        setStatus('Already signed in. Redirecting…');
        window.location.href = nextUrlFor(user);
      }
    });
  }
  authToggle?.addEventListener('click', () => resetOtpState(otpSent ? authMode : (authMode === 'signIn' ? 'signUp' : 'signIn')));
  resendButton?.addEventListener('click', async event => {
    event.preventDefault();
    resendButton.disabled = true;
    try { await sendCode({ resend: true }); }
    catch (error) { setStatus(error.message || 'Unable to resend the code.'); }
    finally { setTimeout(() => { resendButton.disabled = false; }, Math.max(0, resendAvailableAt - Date.now())); }
  });
  resetButton?.addEventListener('click', async event => {
    event.preventDefault();
    resetButton.disabled = true;
    try {
      const authEmail = normaliseEmail(emailField?.value || '');
      if (!authEmail) throw new Error('Enter your email first, then request a password reset.');
      const result = await post('/api/auth', { action: 'reset', email: authEmail }, 'reset');
      setStatus(result.message);
    } catch (error) {
      setStatus(error.message || 'Unable to request a password reset.');
    } finally {
      resetButton.disabled = false;
    }
  });
  authForm?.addEventListener('submit', async event => {
    event.preventDefault();
    if (!supabase) return;
    authSubmit.disabled = true;
    try {
      if (!otpSent) await sendCode();
      else await verifyCode();
    } catch (error) {
      setStatus(error.message || 'Unable to continue. Please try again.');
    } finally {
      authSubmit.disabled = false;
    }
  });
  renderMode();
}
