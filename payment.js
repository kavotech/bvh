import { post } from './forms.js';
import { supabase } from './supabase.js';

const params = new URLSearchParams(window.location.search);
const reference = params.get('reference') || '';
const stored = (() => { try { return JSON.parse(sessionStorage.getItem('bv_pending_payment') || '{}'); } catch { return {}; } })();
let checkoutUrl = stored.reference === reference ? stored.checkoutUrl : '';
const paymentStatus = document.getElementById('paymentStatus');
const refEl = document.getElementById('paymentReference');
const amountEl = document.getElementById('paymentAmount');
const payButton = document.getElementById('payWithStripe');

if (refEl) refEl.textContent = reference || stored.reference || 'Pending';
if (amountEl && stored.price) amountEl.textContent = stored.price;

async function refreshStatus() {
  if (!reference || !params.get('session_id')) return;
  try {
    const { data } = supabase ? await supabase.auth.getSession() : { data: {} };
    if (!data.session) throw new Error('Sign in to confirm payment status.');
    const result = await post('/api/payment-status', { reference }, 'payment_status');
    if (result.paid) {
      paymentStatus.textContent = `Payment received for ${result.reference}. We will contact you to confirm availability and collection details.`;
      sessionStorage.removeItem('bv_pending_payment');
      payButton.disabled = true;
      payButton.textContent = 'Payment received';
    } else {
      paymentStatus.textContent = `Stripe returned you to Breezyee Vans. Current booking status: ${result.status}.`;
    }
  } catch (error) {
    paymentStatus.textContent = error.message;
  }
}

if (params.get('cancelled')) paymentStatus.textContent = 'Payment was cancelled. Your booking request is still saved; you can retry payment or contact us.';
else if (params.get('session_id')) paymentStatus.textContent = 'Checking Stripe payment status…';
else paymentStatus.textContent = checkoutUrl ? 'Ready to continue to Stripe Checkout.' : 'Payment details are unavailable. Please contact us with your booking reference.';

payButton?.addEventListener('click', async () => {
  if (!checkoutUrl) {
    try {
      paymentStatus.textContent = 'Preparing secure payment…';
      const result = await post('/api/stripe-checkout', { reference }, 'payment');
      checkoutUrl = result.checkoutUrl;
      sessionStorage.setItem('bv_pending_payment', JSON.stringify({ reference, checkoutUrl, price: amountEl?.textContent || '' }));
    } catch (error) {
      paymentStatus.textContent = error.message;
      return;
    }
  }
  window.location.href = checkoutUrl;
});

refreshStatus();
