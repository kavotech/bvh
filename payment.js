import { post } from './forms.js';
import { supabase } from './supabase.js';

const STRIPE_PUBLISHABLE_KEY = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || '';
const params = new URLSearchParams(window.location.search);
const reference = params.get('reference') || '';
const stored = (() => { try { return JSON.parse(sessionStorage.getItem('bv_pending_payment') || '{}'); } catch { return {}; } })();
const paymentStatus = document.getElementById('paymentStatus');
const refEl = document.getElementById('paymentReference');
const amountEl = document.getElementById('paymentAmount');
const vehicleEl = document.getElementById('paymentVehicle');
const bookingStatusEl = document.getElementById('paymentBookingStatus');
const form = document.getElementById('paymentForm');
const payButton = document.getElementById('payWithStripe');
const paymentPanel = document.querySelector('.payment-panel');

let stripe;
let elements;
let clientSecret;

function formatAmount(amount, currency = 'gbp') {
  if (!Number.isFinite(Number(amount))) return stored.price || '—';
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: currency.toUpperCase() }).format(Number(amount) / 100);
}

function setStatus(message) {
  if (paymentStatus) paymentStatus.textContent = message;
}

if (refEl) refEl.textContent = reference || stored.reference || 'Pending';
if (amountEl && stored.price) amountEl.textContent = stored.price;
if (!reference && stored.reference) window.history.replaceState(null, '', `/payment?reference=${encodeURIComponent(stored.reference)}`);

async function refreshStatus() {
  if (!reference || !params.get('payment_intent_client_secret')) return;
  try {
    const { data } = supabase ? await supabase.auth.getSession() : { data: {} };
    if (!data.session) throw new Error('Sign in to confirm payment status.');
    const result = await post('/api/payment-status', { reference }, 'payment_status');
    if (bookingStatusEl) bookingStatusEl.textContent = result.status;
    if (result.paid) {
      setStatus(`Payment received for ${result.reference}. We will contact you to confirm availability and collection details.`);
      sessionStorage.removeItem('bv_pending_payment');
      payButton.disabled = true;
      payButton.textContent = 'Payment received';
    } else {
      setStatus(`Payment returned to Breezyee Vans. Current booking status: ${result.status}.`);
    }
  } catch (error) {
    setStatus(error.message);
  }
}

async function preparePaymentElement() {
  if (!reference) throw new Error('Missing booking reference. Please return to your booking confirmation.');
  if (!STRIPE_PUBLISHABLE_KEY) throw new Error('Stripe publishable key is not configured yet.');
  if (!window.Stripe) throw new Error('Stripe.js did not load. Refresh the page or contact us.');
  const result = await post('/api/stripe-payment-intent', { reference }, 'payment');
  clientSecret = result.clientSecret;
  stripe = window.Stripe(STRIPE_PUBLISHABLE_KEY);
  elements = stripe.elements({
    clientSecret,
    appearance: {
      theme: 'stripe',
      variables: { colorPrimary: '#5b22b0', colorText: '#241438', borderRadius: '14px', fontFamily: 'Poppins, system-ui, sans-serif' },
    },
  });
  const paymentElement = elements.create('payment', { layout: 'tabs' });
  paymentElement.mount('#paymentElement');
  if (amountEl) amountEl.textContent = result.price || formatAmount(result.amountTotal, result.currency);
  if (vehicleEl) vehicleEl.textContent = result.vehicle || 'Van hire';
  if (bookingStatusEl) bookingStatusEl.textContent = 'Awaiting payment';
  payButton.textContent = `Pay ${formatAmount(result.amountTotal, result.currency)}`;
  payButton.disabled = false;
  paymentPanel?.classList.add('payment-card-ready');
  setStatus('Enter your payment details below.');
}

form?.addEventListener('submit', async event => {
  event.preventDefault();
  if (!stripe || !elements || !clientSecret) return;
  payButton.disabled = true;
  setStatus('Checking payment details…');
  const { error: submitError } = await elements.submit();
  if (submitError) {
    setStatus(submitError.message || 'Please check your payment details.');
    payButton.disabled = false;
    return;
  }
  setStatus('Confirming payment securely…');
  const { error } = await stripe.confirmPayment({
    elements,
    clientSecret,
    confirmParams: { return_url: `${window.location.origin}/payment?reference=${encodeURIComponent(reference)}` },
  });
  if (error) {
    setStatus(error.message || 'Payment could not be confirmed. Please try again.');
    payButton.disabled = false;
  }
});

payButton.disabled = true;
if (params.get('payment_intent_client_secret')) {
  setStatus('Checking payment status…');
  refreshStatus();
} else {
  setStatus('Preparing secure payment…');
  preparePaymentElement().catch(error => {
    setStatus(error.message);
    payButton.disabled = true;
  });
}
