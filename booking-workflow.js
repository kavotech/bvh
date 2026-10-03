import { supabase } from './supabase.js';
import { post } from './forms.js';

export function initBookingWorkflow() {
  const form = document.getElementById('bookingForm');
  if (!form) return;
  const select = document.getElementById('vanSize');
  const status = document.getElementById('bookingStatus');
  const submit = form.querySelector('[type=submit]');
  const review = document.getElementById('bookingReview');
  const confirm = document.getElementById('submitReviewedBooking');
  let vehicles = [], requestId = sessionStorage.getItem('bv_booking_request') || crypto.randomUUID();
  sessionStorage.setItem('bv_booking_request', requestId);
  submit.disabled = true;
  const steps = [...form.querySelectorAll('.booking-step')];
  const dots = [...form.querySelectorAll('.booking-step-dot')];
  let activeStep = 0;
  const showStep = index => {
    activeStep = Math.max(0, Math.min(index, steps.length - 1));
    steps.forEach((step, idx) => {
      const active = idx === activeStep;
      step.classList.toggle('is-active', active);
      step.hidden = !active;
    });
    dots.forEach((dot, idx) => {
      dot.classList.toggle('is-active', idx === activeStep);
      dot.classList.toggle('is-complete', idx < activeStep);
      dot.setAttribute('aria-current', idx === activeStep ? 'step' : 'false');
    });
    steps[activeStep]?.querySelector('input,select,textarea,button')?.focus({ preventScroll: true });
  };
  const validateStep = index => {
    const fields = [...steps[index].querySelectorAll('input,select,textarea')].filter(field => !field.disabled);
    for (const field of fields) {
      if (!field.reportValidity()) return false;
    }
    return true;
  };
  form.querySelectorAll('.booking-next').forEach(button => button.addEventListener('click', () => {
    if (validateStep(activeStep)) showStep(activeStep + 1);
  }));
  form.querySelectorAll('.booking-prev').forEach(button => button.addEventListener('click', () => showStep(activeStep - 1)));
  dots.forEach((dot, idx) => dot.addEventListener('click', () => {
    if (idx <= activeStep || validateStep(activeStep)) showStep(idx);
  }));
  showStep(0);
  async function loadVehicles() {
    try {
      if (!supabase) throw new Error('Booking is temporarily unavailable. Please contact us.');
      const { data, error } = await supabase.from('cars').select('id,model,type,price_daily').eq('is_active', true).order('price_daily').abortSignal(AbortSignal.timeout(8000));
      if (error || !data?.length) throw new Error('Online vehicle selection is unavailable. Please call +44 7300 331603.');
      vehicles = data;
      select.replaceChildren(new Option('Select a vehicle', ''));
      const requested = new URLSearchParams(location.search).get('van');
      for (const vehicle of vehicles) {
        const option = new Option(`${vehicle.model} (£${vehicle.price_daily}/day)`, vehicle.id);
        option.dataset.daily = vehicle.price_daily;
        option.dataset.model = vehicle.model;
        select.add(option);
        if (requested === vehicle.type || requested === vehicle.id) select.value = vehicle.id;
      }
      submit.disabled = false;
      select.dispatchEvent(new Event('change'));
      status.textContent = 'Requests are subject to availability and driver verification. Sign in before submitting.';
    } catch (error) { status.textContent = error.message; }
  }
  loadVehicles();
  const value = id => document.getElementById(id).value.trim();
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const vehicle = vehicles.find(item => item.id === select.value);
    if (!vehicle) return;
    document.getElementById('reviewDetails').textContent = `${vehicle.model}\n${value('bookDate')} at ${value('bookTime')} (UK time)\n${value('pickup')} → ${value('dropoff')}\n${value('custName')} · ${value('custEmail')}\nEstimated price: ${document.getElementById('estimatedPrice').textContent}\nThis is a request, not a confirmed reservation. Secure payment is the next step.`;
    review.showModal();
  });
  document.getElementById('editBooking')?.addEventListener('click', () => review.close());
  async function upload(id, userId) {
    const file = document.getElementById(id).files[0];
    const extensions = { 'image/jpeg':'jpg', 'image/png':'png', 'image/webp':'webp', 'application/pdf':'pdf' };
    if (!file || !extensions[file.type] || file.size > 5 * 1024 * 1024) throw new Error('Upload a JPG, PNG, WebP or PDF under 5 MB for each licence side.');
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer())), b => b.toString(16).padStart(2,'0')).join('');
    const path = `${userId}/${requestId}/${id}-${hash}.${extensions[file.type]}`;
    const { error } = await supabase.storage.from('driver-verification-documents').upload(path, file, { contentType: file.type, upsert: false });
    if (error && String(error.statusCode) !== '409') throw new Error('Unable to securely upload your documents. Please try again.');
    return path;
  }
  confirm.addEventListener('click', async () => {
    if (confirm.disabled) return;
    confirm.disabled = true; submit.disabled = true;
    const reviewStatus = document.getElementById('reviewStatus');
    reviewStatus.textContent = 'Securely submitting your request…';
    try {
      const { data } = await supabase.auth.getUser();
      if (!data.user?.email_confirmed_at) throw new Error('Please sign in with a verified email address before submitting. Your form is still here.');
      if (value('custEmail').toLowerCase() !== data.user.email.toLowerCase()) throw new Error('Use your signed-in email address for this booking.');
      const front = await upload('licenceFrontFile', data.user.id);
      const back = await upload('licenceBackFile', data.user.id);
      const result = await post('/api/submit', {
        kind: 'booking', requestId, vehicleId: select.value, name: value('custName'), phone: value('custPhone'),
        pickup: value('pickup'), dropoff: value('dropoff'), date: value('bookDate'), time: value('bookTime'), duration: value('duration'), termsAccepted: document.getElementById('termsAccepted').checked,
        driver: { full_name: value('driverFullName'), date_of_birth: value('driverDateOfBirth'), driving_licence_number: value('driverLicenceNumber'), dvla_check_code: value('dvlaCheckCode'), licence_front_file: front, licence_back_file: back },
      }, 'booking');
      review.close(); form.style.display = 'none';
      if (result.payment?.paymentPage) {
        sessionStorage.setItem('bv_pending_payment', JSON.stringify({ reference: result.reference, price: document.getElementById('estimatedPrice').textContent }));
        window.location.href = result.payment.paymentPage;
        return;
      }
      const done = document.getElementById('bookingConfirm');
      done.style.display = 'block'; done.tabIndex = -1;
      document.getElementById('bookingReference').textContent = result.reference;
      done.focus(); sessionStorage.removeItem('bv_booking_request');
    } catch (error) { reviewStatus.textContent = error.message; }
    finally { confirm.disabled = false; submit.disabled = false; }
  });
  document.getElementById('newBookingBtn')?.addEventListener('click', () => {
    requestId = crypto.randomUUID(); sessionStorage.setItem('bv_booking_request', requestId);
    document.getElementById('reviewStatus').textContent = '';
    select.dispatchEvent(new Event('change'));
  });
}
