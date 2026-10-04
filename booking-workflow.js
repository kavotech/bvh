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

  function vehicleWindowPayload() {
    const date = document.getElementById('bookDate')?.value;
    const time = document.getElementById('bookTime')?.value;
    const duration = document.getElementById('duration')?.value;
    if (!date || !time || !duration || duration === 'custom') return {};
    const start = new Date(date + 'T' + time + ':00Z');
    const end = new Date(start.getTime() + Number(duration) * 60 * 60 * 1000);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) return {};
    return { start: start.toISOString(), end: end.toISOString() };
  }

  async function loadVehicles() {
    try {
      const result = await post('/api/vehicles', vehicleWindowPayload(), 'vehicles');
      if (!result.vehicles?.length) throw new Error('No vehicles are available online right now. Please call +44 7300 331603.');
      vehicles = result.vehicles;
      select.replaceChildren(new Option('Select a vehicle', ''));
      const requested = new URLSearchParams(location.search).get('van');
      for (const vehicle of vehicles) {
        const label = `${vehicle.model} (${vehicle.price_display || `£${vehicle.price_daily}`}/day)${vehicle.available === false ? ' — unavailable for selected time' : ''}`;
        const option = new Option(label, vehicle.id);
        option.dataset.daily = vehicle.price_daily;
        option.dataset.dailyPence = vehicle.daily_rate_pence;
        option.dataset.model = vehicle.model;
        option.disabled = vehicle.available === false;
        select.add(option);
        if (requested === vehicle.type || requested === vehicle.id) select.value = vehicle.id;
      }
      submit.disabled = false;
      select.dispatchEvent(new Event('change'));
      const unavailable = vehicles.filter(vehicle => vehicle.available === false).length;
      status.textContent = unavailable ? 'Some vehicles are unavailable for that time. Choose an available van and sign in before submitting.' : 'Live vehicle selection loaded. Sign in before submitting driver documents.';
    } catch (error) { status.textContent = error.message; }
  }
  loadVehicles();
  ['bookDate','bookTime','duration'].forEach(id => document.getElementById(id)?.addEventListener('change', () => loadVehicles()));
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
        sessionStorage.setItem('bv_pending_payment', JSON.stringify({ reference: result.reference, price: result.payment?.breakdown ? `£${(result.payment.amountTotal / 100).toFixed(2)}` : document.getElementById('estimatedPrice').textContent, category: result.payment.category }));
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
