import { supabase, DRIVER_DOC_BUCKET } from './supabase.js';
import { post } from './forms.js';
import { fleetImageUrl } from './fleet-data.js';

export function initBookingWorkflow() {
  const form = document.getElementById('bookingForm');
  if (!form) return;
  const select = document.getElementById('vanSize');
  const pickerGrid = document.getElementById('vanPickerGrid');
  const status = document.getElementById('bookingStatus');
  const submit = form.querySelector('[type=submit]');
  const review = document.getElementById('bookingReview');
  const confirm = document.getElementById('submitReviewedBooking');
  let vehicles = [], requestId = sessionStorage.getItem('bv_booking_request') || crypto.randomUUID();
  let vehicleLoadSequence = 0;
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

  form.querySelectorAll('[data-licence-upload]').forEach(wrapper => {
    const input = wrapper.querySelector('.licence-upload-input');
    const zone = wrapper.querySelector('.licence-upload-zone');
    const preview = wrapper.querySelector('.licence-upload-preview');
    const thumb = wrapper.querySelector('.licence-upload-thumb');
    const filename = wrapper.querySelector('.licence-upload-filename');
    const statusEl = wrapper.querySelector('.licence-upload-status');
    let objectUrl = null;
    const reset = () => {
      if (objectUrl) { URL.revokeObjectURL(objectUrl); objectUrl = null; }
      input.value = '';
      zone.hidden = false;
      preview.hidden = true;
      thumb.style.backgroundImage = '';
      thumb.textContent = '';
    };
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) { reset(); return; }
      const maxSize = 5 * 1024 * 1024;
      if (!/^image\/(jpeg|png|webp)$|^application\/pdf$/.test(file.type) || file.size > maxSize) {
        statusEl.textContent = 'Use a JPG, PNG, WebP or PDF under 5 MB.';
        reset();
        return;
      }
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      if (file.type === 'application/pdf') {
        thumb.style.backgroundImage = '';
        thumb.textContent = 'PDF';
      } else {
        objectUrl = URL.createObjectURL(file);
        thumb.style.backgroundImage = `url("${objectUrl}")`;
        thumb.textContent = '';
      }
      filename.textContent = file.name;
      statusEl.textContent = 'Ready to upload';
      zone.hidden = true;
      preview.hidden = false;
    });
    wrapper.querySelector('.licence-upload-remove')?.addEventListener('click', reset);
  });

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

  function syncVanPickerSelection() {
    pickerGrid?.querySelectorAll('.van-picker-card').forEach(card => {
      const isSelected = card.dataset.vehicleId === select.value;
      card.classList.toggle('is-selected', isSelected);
      card.setAttribute('aria-pressed', String(isSelected));
      const button = card.querySelector('.van-picker-select');
      if (button && !card.classList.contains('is-unavailable')) button.textContent = isSelected ? 'Selected ✓' : 'Select this van';
    });
  }

  function renderVanPicker() {
    if (!pickerGrid) return;
    if (!vehicles.length) { pickerGrid.innerHTML = '<p class="txt-dim">No vans are available online right now. Please call +44 7300 331603.</p>'; return; }
    const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    pickerGrid.innerHTML = vehicles.map(vehicle => {
      const unavailable = vehicle.available === false;
      const price = vehicle.price_display || `£${vehicle.price_daily}/day`;
      return `<article class="van-picker-card${unavailable ? ' is-unavailable' : ''}" data-vehicle-id="${vehicle.id}" role="button" tabindex="${unavailable ? '-1' : '0'}" aria-pressed="false" aria-disabled="${unavailable}">
        <div class="van-picker-image" style="background-image:url('${escapeHTML(fleetImageUrl(vehicle.image_url))}')"></div>
        <div class="van-picker-body">
          <h4>${escapeHTML(vehicle.model)}</h4>
          <p>${escapeHTML(vehicle.description || '')}</p>
          <div class="van-picker-specs">
            ${vehicle.capacity ? `<span>${escapeHTML(vehicle.capacity)}</span>` : ''}
            ${vehicle.payload ? `<span>${escapeHTML(vehicle.payload)} kg</span>` : ''}
            <span>Automatic</span>
          </div>
          <div class="van-picker-foot">
            <strong>${escapeHTML(price)}${vehicle.price_display ? '' : '/day'}</strong>
            <button type="button" class="btn btn-sm btn-outline van-picker-select" ${unavailable ? 'disabled' : ''}>${unavailable ? 'Unavailable for these dates' : 'Select this van'}</button>
          </div>
        </div>
      </article>`;
    }).join('');
    pickerGrid.querySelectorAll('.van-picker-card:not(.is-unavailable)').forEach(card => {
      const choose = () => { select.value = card.dataset.vehicleId; select.dispatchEvent(new Event('change')); };
      card.addEventListener('click', choose);
      card.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choose(); } });
    });
    syncVanPickerSelection();
  }

  select.addEventListener('change', syncVanPickerSelection);

  async function loadVehicles() {
    const loadSequence = ++vehicleLoadSequence;
    const previousVehicle = select.value;
    try {
      const result = await post('/api/vehicles', vehicleWindowPayload(), 'vehicles');
      if (loadSequence !== vehicleLoadSequence) return;
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
        if (vehicle.available !== false && (requested === vehicle.type || requested === vehicle.id || previousVehicle === vehicle.id)) select.value = vehicle.id;
      }
      submit.disabled = false;
      renderVanPicker();
      select.dispatchEvent(new Event('change'));
      const unavailable = vehicles.filter(vehicle => vehicle.available === false).length;
      status.textContent = unavailable ? 'Some vehicles are unavailable for that time. Choose an available van and sign in before submitting.' : 'Live vehicle selection loaded. Sign in before submitting driver documents.';
    } catch (error) { status.textContent = error.message; }
  }
  loadVehicles();
  ['bookDate','bookTime','duration'].forEach(id => document.getElementById(id)?.addEventListener('change', () => loadVehicles()));
  const value = id => document.getElementById(id).value.trim();
  const setText = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const vehicle = vehicles.find(item => item.id === select.value);
    if (!vehicle) return;
    setText('reviewVehicle', vehicle.model);
    setText('reviewPickup', `${value('bookDate')} at ${value('bookTime')} (UK time)`);
    setText('reviewCustomer', `${value('custName')} · ${value('custEmail')}`);
    setText('reviewPrice', document.getElementById('estimatedPrice').textContent);
    review.showModal();
  });
  document.getElementById('editBooking')?.addEventListener('click', () => review.close());
  async function upload(id, userId) {
    const file = document.getElementById(id).files[0];
    const extensions = { 'image/jpeg':'jpg', 'image/png':'png', 'image/webp':'webp', 'application/pdf':'pdf' };
    if (!file || !extensions[file.type] || file.size > 5 * 1024 * 1024) throw new Error('Upload a JPG, PNG, WebP or PDF under 5 MB for each licence side.');
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer())), b => b.toString(16).padStart(2,'0')).join('');
    const path = `${userId}/${requestId}/${id}-${hash}.${extensions[file.type]}`;
    const { error } = await supabase.storage.from(DRIVER_DOC_BUCKET).upload(path, file, { contentType: file.type, upsert: false });
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
      if (!data.user?.email_confirmed_at) {
        sessionStorage.setItem('bv_booking_request', requestId);
        window.location.href = `/login?returnTo=${encodeURIComponent(window.location.pathname + window.location.search)}`;
        return;
      }
      if (value('custEmail').toLowerCase() !== data.user.email.toLowerCase()) throw new Error('Use your signed-in email address for this booking.');
      const front = await upload('licenceFrontFile', data.user.id);
      const back = await upload('licenceBackFile', data.user.id);
      const result = await post('/api/submit', {
        kind: 'booking', requestId, vehicleId: select.value, name: value('custName'), phone: value('custPhone'),
        date: value('bookDate'), time: value('bookTime'), duration: value('duration'), termsAccepted: document.getElementById('termsAccepted').checked,
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
