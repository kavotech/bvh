function fleetImageUrl(value) { return ({'/van-small.jpg':'/van-small.webp','/van-medium.jpg':'/van-medium.webp','/van-large.png':'/van-large.webp'})[value] || value || '/van-small.webp'; }
function vehicleDetailUrl(car) { return `/vehicle?van=${encodeURIComponent(car.id?.startsWith('fallback-') ? car.type : car.id || car.type)}`; }
function escapeHTML(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
/* ============================================================
   BREEZYEE VANS — App JS
   ============================================================ */
import { supabase, ADMIN_EMAIL } from './supabase.js';
import { post } from './forms.js';
import { initBookingWorkflow } from './booking-workflow.js';
import { initVehicleViewer } from './vehicle-viewer.js';
initBookingWorkflow();
initVehicleViewer();

let currentUser = null;
let bookingsRealtimeChannel = null;
let driverVerificationsRealtimeChannel = null;
const ADMIN_OWNER_NAME = 'Mr Olushola Fadipe';
supabase ? supabase.auth.onAuthStateChange((_event, session) => {
  currentUser = session?.user ?? null;
  updateAuthNav(currentUser);
}) : null;

function isAdminUser(user) {
  return user?.email?.toLowerCase() === ADMIN_EMAIL.toLowerCase();
}

async function refreshAuthState() {
  if (!supabase) {
    updateAuthNav(null);
    return null;
  }
  const { data } = await supabase.auth.getSession();
  const user = data.session?.user ?? null;
  currentUser = user;
  updateAuthNav(user);
  if (user) {
    const custEmailEl = document.getElementById('custEmail');
    const custNameEl = document.getElementById('custName');
    if (custEmailEl) custEmailEl.value = user.email || '';
    if (custNameEl) custNameEl.value = user.user_metadata?.full_name || '';
  }
  return user;
}

const managementRequests = new Map();
async function manageBooking(bookingId, action, availabilityChecked = false) {
  const identity = bookingId + ':' + action;
  const requestId = managementRequests.get(identity) || crypto.randomUUID();
  managementRequests.set(identity, requestId);
  const controls = document.querySelectorAll('.confirm-booking-btn,.cancel-booking-btn,.approve-driver-btn,.reject-driver-btn,.admin-email-action,#invoiceEmailForm button');
  controls.forEach(button => button.disabled = true);
  let result;
  try { result = await post('/api/manage', { bookingId, action, requestId, availabilityChecked }, 'manage'); }
  finally { controls.forEach(button => button.disabled = false); }
  managementRequests.delete(identity);
  await initDashboardPage(await refreshAuthState());
  return result;
}
async function confirmBooking(bookingId) {
  if (!confirm('Have you checked vehicle availability and agreed the hire details with the customer?')) return;
  try { await manageBooking(bookingId, 'confirm', true); }
  catch (error) { alert(error.message); }
}
async function cancelBooking(bookingId) {
  if (!confirm('Confirm cancellation of this booking and notify the customer?')) return;
  try { await manageBooking(bookingId, 'cancel_confirm'); }
  catch (error) { alert(error.message); }
}
async function updateDriverVerificationStatus(_verificationId, bookingId, _recipientEmail, status) {
  try { await manageBooking(bookingId, status === 'APPROVED' ? 'approve' : 'reject'); }
  catch (error) { alert(error.message); }
}

function updateAuthNav(user) {
  document.querySelectorAll('.nav-auth-signed-out').forEach(el => {
    el.style.display = user ? 'none' : '';
  });
  document.querySelectorAll('.nav-auth-signed-in').forEach(el => {
    el.style.display = user ? '' : 'none';
  });
  document.querySelectorAll('.nav-user-name').forEach(el => {
    el.textContent = user ? user.email : '';
  });
}

async function signOut() {
  if (supabase) await supabase.auth.signOut();
  await refreshAuthState();
  const path = window.location.pathname;
  if (path.includes('dashboard') || path.includes('admin-')) {
    window.location.href = 'login.html';
  }
}

document.getElementById('signOutLink')?.addEventListener('click', async (e) => {
  e.preventDefault();
  await signOut();
});

// ── NAVBAR SCROLL ──
const navbar = document.getElementById('navbar');
if (navbar) {
  window.addEventListener('scroll', () => {
    navbar.classList.toggle('scrolled', window.scrollY > 40);
  }, { passive: true });
}

// ── MOBILE NAV ──
const navToggle = document.getElementById('navToggle');
const navLinks  = document.getElementById('navLinks');
if (navToggle && navLinks) {
  function toggleNav(e) {
    e.preventDefault();
    e.stopPropagation();
    const open = navLinks.classList.toggle('open');
    navToggle.setAttribute('aria-expanded', String(open));
    navToggle.classList.toggle('open', open);
    document.body.style.overflow = open ? 'hidden' : '';
  }
  navToggle.addEventListener('click', toggleNav);
  navToggle.setAttribute('aria-expanded', 'false');
  navToggle.setAttribute('aria-controls', 'navLinks');
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && navLinks.classList.contains('open')) navToggle.click(); });

  navLinks.querySelectorAll('a').forEach(a => {
    a.addEventListener('click', () => {
      navLinks.classList.remove('open');
      navToggle.setAttribute('aria-expanded', 'false');
      navToggle.classList.remove('open');
      document.body.style.overflow = '';
    });
  });
}

// ── REVEAL ON SCROLL ──
const revealEls = document.querySelectorAll('.reveal');

function revealCheck() {
  revealEls.forEach(el => {
    if (el.classList.contains('visible')) return;
    const rect = el.getBoundingClientRect();
    if (rect.top < window.innerHeight - 20) {
      const siblings = [...(el.parentElement?.querySelectorAll('.reveal:not(.visible)') || [])];
      const idx = siblings.indexOf(el);
      el.style.transitionDelay = `${idx * 80}ms`;
      el.classList.add('visible');
    }
  });
}

function setupRevealElements(root = document) {
  const elements = root.querySelectorAll('.reveal');
  elements.forEach(el => {
    if (el.dataset.revealBound === 'true' || el.classList.contains('visible')) return;
    el.dataset.revealBound = 'true';
    const rect = el.getBoundingClientRect();
    if (rect.top < window.innerHeight - 20) {
      const siblings = [...(el.parentElement?.querySelectorAll('.reveal:not(.visible)') || [])];
      const idx = siblings.indexOf(el);
      el.style.transitionDelay = `${idx * 80}ms`;
      el.classList.add('visible');
    } else {
      revealObserver.observe(el);
    }
  });
}

const revealObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      const siblings = [...(entry.target.parentElement?.querySelectorAll('.reveal:not(.visible)') || [])];
      const idx = siblings.indexOf(entry.target);
      entry.target.style.transitionDelay = `${idx * 80}ms`;
      entry.target.classList.add('visible');
      revealObserver.unobserve(entry.target);
    }
  });
}, { threshold: 0, rootMargin: '0px 0px 0px 0px' });
setupRevealElements(document);

// Scroll fallback (fixes iOS Safari overflow-x issue with IntersectionObserver)
window.addEventListener('scroll', revealCheck, { passive: true });
window.addEventListener('resize', revealCheck, { passive: true });
// Run once on load to show elements already in view
revealCheck();

// ── BOOKING PAGE SETUP ──

const urlParams = new URLSearchParams(window.location.search);
if (urlParams.get('van')) {
  const vs = document.getElementById('vanSize');
  if (vs) vs.value = urlParams.get('van');
}

// ── FLEET PAGE BWB TABS ──
document.querySelectorAll('.bwb-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.bwb-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
  });
});
// Set today on bwb dates
const bwbDate   = document.getElementById('bwbDate');
const bwbReturn = document.getElementById('bwbReturn');
if (bwbDate) {
  const today = new Date().toISOString().split('T')[0];
  const next  = new Date(Date.now() + 86400000).toISOString().split('T')[0];
  bwbDate.value   = today;
  bwbDate.min     = today;
  if (bwbReturn) { bwbReturn.value = next; bwbReturn.min = today; }
}

// ── PRICE CALCULATION ──
const RATES = {
  small:  { hourly: 12.5, daily: 100 },
  medium: { hourly: 25, daily: 200 },
  xl:     { hourly: 43.75, daily: 350 },
};

function calcPrice() {
  const van      = document.getElementById('vanSize')?.value;
  const duration = document.getElementById('duration')?.value;
  const priceEl  = document.getElementById('estimatedPrice');
  const sumTotal = document.getElementById('sum-total');
  const sumVan   = document.getElementById('sum-van');
  const sumDur   = document.getElementById('sum-duration');
  const sumSvc   = document.getElementById('sum-service');

  const vanLabels = { small: 'Small / Medium Van (Citroen Berlingo)', medium: 'Medium / Large Van (Mercedes Sprinter)', xl: 'Large / XL Van (Iveco Daily Luton)' };
  const durLabels = { '2':'2 Hours','4':'4 Hours (Half Day)','8':'Full Day','24':'1 Day','48':'2 Days','72':'3 Days','custom':'Custom' };

  if (sumVan)  sumVan.textContent  = document.getElementById('vanSize')?.selectedOptions[0]?.dataset.model || vanLabels[van] || 'Not selected';
  if (sumDur)  sumDur.textContent  = durLabels[duration] || 'Not selected';
  if (sumSvc)  sumSvc.textContent  = 'Van Hire';

  if (!priceEl) return;

  if (!van || !duration || duration === 'custom') {
    const dash = duration === 'custom' ? 'Call for quote' : '—';
    priceEl.textContent = dash;
    if (sumTotal) sumTotal.textContent = dash;
    return;
  }
  const hrs      = parseFloat(duration);
  const isDays   = hrs >= 24;
  const daily = Number(document.getElementById('vanSize')?.selectedOptions[0]?.dataset.daily);
  const r = daily ? { daily, hourly: daily / 8 } : RATES[van];
  if (!r) return;
  const vanCost  = isDays ? r.daily * (hrs / 24) : r.hourly * hrs;
  const drCost   = 0;
  const hlpCost  = 0;
  const total    = `£${Math.ceil(vanCost + drCost + hlpCost).toLocaleString()}`;
  priceEl.textContent = total;
  if (sumTotal) sumTotal.textContent = total;
}

['vanSize', 'duration', 'helpers'].forEach(id => {
  document.getElementById(id)?.addEventListener('change', calcPrice);
});

// Set default date
const bd = document.getElementById('bookDate');
if (bd) { const t = new Date().toISOString().split('T')[0]; bd.min = t; bd.value = t; }

// ── FORM SUBMIT ──
const bookingForm    = document.getElementById('bookingForm');
const bookingConfirm = document.getElementById('bookingConfirm');
const newBookingBtn  = document.getElementById('newBookingBtn');
const helpersField = document.getElementById('helpersField');
const bkTabs = document.querySelectorAll('.bk-tab');
const termsModal = document.getElementById('termsModal');
const termsModalBody = document.getElementById('termsModalBody');
const termsAccepted = document.getElementById('termsAccepted');
const termsHelp = document.getElementById('termsHelp');
const doneTermsModal = document.getElementById('doneTermsModal');
const termsScrollStatus = document.getElementById('termsScrollStatus');

function setTermsReady() {
  if (termsAccepted) termsAccepted.disabled = false;
  if (doneTermsModal) doneTermsModal.disabled = false;
  if (termsHelp) termsHelp.textContent = 'You can now tick the box to accept the terms.';
  if (termsScrollStatus) termsScrollStatus.textContent = 'Terms read. You can close this popup and tick acceptance.';
}

function closeTermsModal() {
  if (!termsModal) return;
  termsModal.classList.remove('open');
  if (termsModal.open) termsModal.close();
  termsModal.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
}

const DRIVER_DOC_BUCKET = 'driver-verification-documents';

document.getElementById('openTermsModal')?.addEventListener('click', () => {
  if (!termsModal) return;
  termsModal.classList.add('open');
  if (!termsModal.open) termsModal.showModal();
  termsModal.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
  termsModalBody?.focus();
});

termsModal?.addEventListener('cancel', closeTermsModal);
document.getElementById('closeTermsModal')?.addEventListener('click', closeTermsModal);
doneTermsModal?.addEventListener('click', closeTermsModal);
termsModal?.addEventListener('click', e => {
  if (e.target === termsModal) closeTermsModal();
});

termsModalBody?.addEventListener('scroll', () => {
  const reachedBottom = termsModalBody.scrollTop + termsModalBody.clientHeight >= termsModalBody.scrollHeight - 8;
  if (reachedBottom) setTermsReady();
}, { passive: true });

newBookingBtn?.addEventListener('click', () => {
  bookingConfirm.style.display = 'none';
  bookingForm.style.display    = 'block';
  bookingForm.reset();
  if (document.getElementById('estimatedPrice')) document.getElementById('estimatedPrice').textContent = '—';
  if (helpersField) helpersField.style.display = 'none';
  if (termsAccepted) {
    termsAccepted.checked = false;
    termsAccepted.disabled = false;
  }
  if (doneTermsModal) doneTermsModal.disabled = true;
  if (termsHelp) termsHelp.textContent = 'Open the terms and scroll to the bottom before ticking this box.';
  if (termsScrollStatus) termsScrollStatus.textContent = 'Scroll to the bottom to enable acceptance.';

  bkTabs.forEach(t => t.classList.toggle('active', t.dataset.tab === 'van-hire'));
  const btn = bookingForm.querySelector('.bk-submit');
  if (btn) { btn.disabled = false; btn.textContent = 'Review booking request →'; }
  const t = new Date().toISOString().split('T')[0];
  if (document.getElementById('bookDate')) document.getElementById('bookDate').value = t;
});

// ── COOKIE BANNER ──
const COOKIE_BANNER_KEY = 'bv_cookies';
const cookieBanner = document.getElementById('cookieBanner');
if (cookieBanner) {
  if (localStorage.getItem(COOKIE_BANNER_KEY) === '1') {
    cookieBanner.classList.add('hide');
    cookieBanner.style.display = 'none';
  }

  function dismissCookie(accepted = false) {
    if (accepted) {
      localStorage.setItem(COOKIE_BANNER_KEY, '1');
    }
    cookieBanner.classList.add('hide');
    setTimeout(() => { cookieBanner.style.display = 'none'; }, 350);
  }

  document.getElementById('cookieAccept')?.addEventListener('click', () => {
    dismissCookie(true);
  });
  document.getElementById('cookieManage')?.addEventListener('click', dismissCookie);
}

// ── CHAT BUBBLE ──
document.getElementById('chatBubble')?.addEventListener('click', () => {
  window.location.href = 'tel:+447300331603';
});

// ── SMOOTH SCROLL ──
document.querySelectorAll('a[href^="#"]').forEach(a => {
  a.addEventListener('click', e => {
    const targetSel = a.getAttribute('href');
    // Ignore placeholder links like href="#" to avoid invalid selector errors.
    if (!targetSel || targetSel === '#') return;
    const t = document.querySelector(targetSel);
    if (t) { e.preventDefault(); t.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' }); }
  });
});

// ── CAR MANAGEMENT FUNCTIONS ──
let carsData = [];
let carsRealtimeChannel = null;

// Fallback fleet data in case Supabase isn't configured yet
const FALLBACK_CARS = [
  {
    id: 'fallback-1',
    model: 'Citroen Berlingo',
    type: 'small',
    price_daily: 100,
    capacity: '2–3 m³',
    payload: 750,
    description: 'Best for light loads and deliveries. Compact, nimble, and easy to park in the city.',
    image_url: '/van-small.jpg',
    is_active: true
  },
  {
    id: 'fallback-2',
    model: 'Mercedes Sprinter',
    type: 'medium',
    price_daily: 200,
    capacity: '10–12 m³',
    payload: 1500,
    description: 'Ideal for bulky items and business transport. Spacious, powerful, and built to perform.',
    image_url: '/van-medium.jpg',
    is_active: true
  },
  {
    id: 'fallback-3',
    model: 'Iveco Daily Luton',
    type: 'xl',
    price_daily: 350,
    capacity: '18–20 m³',
    payload: 2000,
    description: 'Maximum capacity for the biggest jobs. Large furniture, bulky loads, zero compromises.',
    image_url: '/van-large.png',
    is_active: true
  }
];

async function loadCarsFromSupabase() {
  // Check if Supabase is configured
  if (!supabase) {
        carsData = FALLBACK_CARS;
    return FALLBACK_CARS;
  }

  try {
    const { data: cars, error } = await supabase
      .from('cars')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.warn('Operation unavailable');
            carsData = FALLBACK_CARS;
      return FALLBACK_CARS;
    }

    if (!cars) throw new Error('Fleet unavailable');

    carsData = cars;
        return cars;
  } catch (error) {
    console.warn('Operation unavailable');
        carsData = FALLBACK_CARS;
    return FALLBACK_CARS;
  }
}

async function initCarsPage(user) {
  const carsPage = document.body.dataset.page === 'cars';
  if (!carsPage) return;
  if (!user || !isAdminUser(user)) {
    window.location.href = 'login.html';
    return;
  }

  const cars = await loadCarsFromSupabase();
  renderAdminCarsTable(cars);
  renderAdminCarsPreview(cars);
  updateCarsStats(cars);

  // Only set up realtime subscription if we successfully loaded from Supabase and supabase is available
  const usingFallback = cars === FALLBACK_CARS;
  if (!usingFallback && !carsRealtimeChannel && supabase) {
    carsRealtimeChannel = supabase
      .channel('cars-sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cars' }, () => {
        loadCarsFromSupabase().then(cars => {
          renderAdminCarsTable(cars);
          renderAdminCarsPreview(cars);
          updateCarsStats(cars);
        });
      })
      .subscribe();
  }

  // A failed write must never appear to have saved a fleet change.
  function validateCar(carData) {
    if (!carData.model?.trim() || !['small','medium','xl'].includes(carData.type) || !Number.isFinite(Number(carData.price_daily)) || Number(carData.price_daily) <= 0) throw new Error('Check the vehicle model, type and daily rate.');
    if (carData.image_url && !/^\/(?!\/)[a-zA-Z0-9/_.-]+$/.test(carData.image_url) && !/^https:\/\/[^\s<>"']+$/.test(carData.image_url)) throw new Error('Use a valid HTTPS image URL or an existing /image path.');
  }
  window.saveCarToSupabase = async carData => {
    validateCar(carData);
    if (!supabase || usingFallback) throw new Error('Fleet storage is unavailable. No changes were saved.');
    const { data, error } = await supabase.from('cars').insert([carData]).select().single();
    if (error) throw new Error('Unable to save vehicle. Please check your connection and permissions.');
    return data;
  };
  window.updateCarInSupabase = async (id, carData) => {
    validateCar(carData);
    if (!supabase || usingFallback) throw new Error('Fleet storage is unavailable. No changes were saved.');
    const { data, error } = await supabase.from('cars').update(carData).eq('id',id).select().single();
    if (error) throw new Error('Unable to update vehicle. No changes were saved.');
    return data;
  };
  window.deleteCarFromSupabase = async id => {
    if (!supabase || usingFallback) throw new Error('Fleet storage is unavailable. No changes were saved.');
    const { error } = await supabase.from('cars').delete().eq('id',id);
    if (error) throw new Error('Unable to delete vehicle. No changes were saved.');
    return true;
  };
}

function renderAdminCarsTable(cars) {
  const tableBody = document.getElementById('carsTableBody');
  if (!tableBody) return;

  if (!cars || cars.length === 0) {
    tableBody.innerHTML = '<tr><td colspan="7" class="txt-dim">No cars in fleet yet.</td></tr>';
    return;
  }

  const typeLabels = {
    small: 'Small / Medium',
    medium: 'Medium / Large',
    xl: 'Large / XL'
  };

  const typeBadgeClasses = {
    small: 'car-badge-small',
    medium: 'car-badge-medium',
    xl: 'car-badge-xl'
  };

  const gradientColors = {
    small: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    medium: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
    xl: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)'
  };

  const vanEmojis = {
    small: '🚐',
    medium: '🚛',
    xl: '🚚'
  };

  tableBody.innerHTML = cars.map(car => `
    <tr>
      <td>
        <div class="car-thumb" style="background: ${car.image_url ? `url(&quot;${escapeHTML(car.image_url)}&quot;)` : gradientColors[car.type]}; background-size: cover; background-position: center;">
          ${!car.image_url ? `<span>${vanEmojis[car.type] || '🚐'}</span>` : ''}
        </div>
      </td>
      <td><strong>${escapeHTML(car.model)}</strong></td>
      <td><span class="car-badge ${typeBadgeClasses[car.type]}">${typeLabels[car.type]}</span></td>
      <td><strong>£${escapeHTML(car.price_daily)}</strong>/day</td>
      <td>${escapeHTML(car.capacity)} • ${escapeHTML(car.payload)} kg</td>
      <td><span class="status-badge ${car.is_active ? 'status-active' : 'status-inactive'}">${car.is_active ? 'Active' : 'Inactive'}</span></td>
      <td>
        <button class="admin-btn-icon edit-car-btn" data-id="${car.id}" title="Edit car">✏️</button>
        <button class="admin-btn-icon delete-car-btn" data-id="${car.id}" title="Delete car">🗑️</button>
      </td>
    </tr>
  `).join('');

  // Add event listeners for edit and delete buttons
  tableBody.querySelectorAll('.edit-car-btn').forEach(btn => {
    btn.addEventListener('click', () => editCar(btn.dataset.id));
  });

  tableBody.querySelectorAll('.delete-car-btn').forEach(btn => {
    btn.addEventListener('click', () => deleteCar(btn.dataset.id));
  });
}

function renderAdminCarsPreview(cars) {
  const previewGrid = document.querySelector('.admin-cars-preview-grid');
  if (!previewGrid) return;

  if (!cars || cars.length === 0) {
    previewGrid.innerHTML = '<p class="txt-dim">No cars to preview.</p>';
    return;
  }

  const typeLabels = {
    small: 'Small / Medium Van',
    medium: 'Medium / Large Van',
    xl: 'Large / XL Van'
  };

  const gradientColors = {
    small: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    medium: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
    xl: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)'
  };

  const vanEmojis = {
    small: '🚐',
    medium: '🚛',
    xl: '🚚'
  };

  previewGrid.innerHTML = cars.map(car => `
    <div class="car-preview-card">
      <div class="car-preview-img" style="background: ${car.image_url ? `url(&quot;${escapeHTML(car.image_url)}&quot;)` : gradientColors[car.type]}; background-size: cover; background-position: center;">
        ${!car.image_url ? `<span style="font-size: 3rem;">${vanEmojis[car.type] || '🚐'}</span>` : ''}
      </div>
      <div class="car-preview-info">
        <h4>${escapeHTML(car.model)}</h4>
        <p class="car-type">${typeLabels[car.type]}</p>
        <div class="car-specs">
          <span>${escapeHTML(car.capacity)}</span>
          <span>•</span>
          <span>${escapeHTML(car.payload)} kg</span>
        </div>
        <div class="car-preview-price">
          <strong>£${escapeHTML(car.price_daily)}</strong><span>/day</span>
        </div>
      </div>
    </div>
  `).join('');
}

function updateCarsStats(cars) {
  if (!cars || cars.length === 0) {
    document.getElementById('totalCarsCount').textContent = '0';
    document.getElementById('avgPriceRate').textContent = '£0';
    document.getElementById('totalCapacity').textContent = '0 m³';
    document.getElementById('fleetUtil').textContent = '0%';
    return;
  }

  const totalCars = cars.length;
  const avgPrice = cars.reduce((sum, car) => sum + Number(car.price_daily), 0) / totalCars;
  const activeCars = cars.filter(car => car.is_active).length;

  // Parse capacity ranges (e.g., "10–12 m³" -> average of 11)
  const capacities = cars.map(car => {
    const match = car.capacity.match(/(\d+)(?:–(\d+))?\s*m³/);
    if (match) {
      const min = parseInt(match[1]);
      const max = match[2] ? parseInt(match[2]) : min;
      return (min + max) / 2;
    }
    return 0;
  });
  const totalCapacity = capacities.reduce((sum, cap) => sum + cap, 0);

  document.getElementById('totalCarsCount').textContent = totalCars;
  document.getElementById('avgPriceRate').textContent = `£${Math.round(avgPrice)}`;
  document.getElementById('totalCapacity').textContent = `${Math.round(totalCapacity)} m³ (approx.)`;
  document.getElementById('fleetUtil').textContent = Math.round(activeCars / totalCars * 100) + '%';
}

async function editCar(id) {
  const car = carsData.find(c => c.id === id);
  if (!car) return;

  document.getElementById('modalTitle').textContent = 'Edit Car';
  document.getElementById('carModel').value = car.model;
  document.getElementById('carType').value = car.type;
  document.getElementById('carPrice').value = car.price_daily;
  document.getElementById('carCapacity').value = car.capacity;
  document.getElementById('carPayload').value = car.payload;
  document.getElementById('carDesc').value = car.description || '';
  document.getElementById('carActive').checked = car.is_active;

  // Handle image preview
  if (car.image_url) {
    const previewImg = document.getElementById('previewImg');
    const imagePreview = document.getElementById('imagePreview');
    previewImg.src = car.image_url;
    imagePreview.style.display = 'block';
  }

  document.getElementById('carModal').style.display = 'flex';

  // Store the car ID for updating
  document.getElementById('carForm').dataset.editId = id;
  document.getElementById('carForm').dispatchEvent(new Event('fleet-edit'));
}

async function deleteCar(id) {
  if (!confirm('Are you sure you want to delete this car?')) return;

  try {
    await window.deleteCarFromSupabase(id);
    alert('Car deleted successfully!');
  } catch (error) {
    alert('Error deleting car: ' + error.message);
  }
}

async function loadCarsForFleetPage() {
    const fleetGrid = document.querySelector('.van-cards-grid');
  const specsGrid = document.querySelector('.specs-comparison');

  if (fleetGrid) {
    renderFleetCards(FALLBACK_CARS, fleetGrid);
  }

  if (specsGrid) {
    renderSpecsCards(FALLBACK_CARS, specsGrid);
  }

  try {
    const cars = await loadCarsFromSupabase();

    if (fleetGrid) {
            renderFleetCards(cars, fleetGrid);
    }

    if (specsGrid) {
            renderSpecsCards(cars, specsGrid);
    }

  } catch (error) {
    console.warn('Operation unavailable');
    if (fleetGrid) {
      renderFleetCards(FALLBACK_CARS, fleetGrid);
    }
  }
}

function renderFleetCards(cars, container) {
  cars = cars?.filter(car => car.is_active);
    if (!cars || cars.length === 0) {
    container.innerHTML = '<p class="txt-dim">No fleet available at the moment.</p>';
    return;
  }

  const typeBadgeClasses = {
    small: '',
    medium: 'van-badge-purple',
    xl: ''
  };

  const badgeLabels = {
    small: 'Small / Medium Van',
    medium: 'Best Seller',
    xl: 'Large / XL Van'
  };

  const descriptions = {
    small: 'Best for light loads and deliveries. Compact, nimble, and easy to park in the city.',
    medium: 'Ideal for bulky items and business transport. Spacious, powerful, and built to perform.',
    xl: 'Maximum capacity for the biggest jobs. Large furniture, bulky loads, zero compromises.'
  };

  const fallbackIcons = {
    small: '🚐',
    medium: '🚛',
    xl: '🚚'
  };

  container.innerHTML = cars.map(car => `
    <div class="van-card reveal ${car.type === 'medium' ? 'van-featured' : ''}">
      <div class="van-card-image van-card-image-loading">
        <div class="van-card-image-fallback">${fallbackIcons[car.type] || '🚐'}</div>
        <img
          src="${escapeHTML(fleetImageUrl(car.image_url))}"
          alt="${escapeHTML(car.model)}"
          loading="lazy"
          decoding="async"
          width="640"
          height="400"
          onload="this.parentElement.classList.add('is-loaded');"
          onerror="this.parentElement.classList.add('is-error'); this.style.display='none';"
        />
      </div>
      <div class="van-card-body">
        <div class="van-name-row">
          <span class="van-badge-tag ${typeBadgeClasses[car.type]}">${badgeLabels[car.type]}</span>
        </div>
        <h3>${escapeHTML(car.model)}</h3>
        <p>${escapeHTML(car.description || descriptions[car.type])}</p>
        <div class="van-specs-row">
          <span class="vspec">Automatic</span>
          <span class="vspec">${escapeHTML(car.capacity)}</span>
          <span class="vspec">${escapeHTML(car.payload)} kg payload</span>
        </div>
        <div class="van-price-row">
          <div><span class="price-from">From</span><strong class="price-big">£${escapeHTML(car.price_daily)}</strong><span class="price-unit">/day</span></div>
          <a href="${vehicleDetailUrl(car)}" class="btn btn-primary">View Van</a>
        </div>
      </div>
    </div>
  `).join('');
  requestAnimationFrame(() => setupRevealElements(container));
}

function renderSpecsCards(cars, container) {
  cars = cars?.filter(car => car.is_active);
  if (!cars || cars.length === 0) {
    container.innerHTML = '<p class="txt-dim">No specifications available.</p>';
    return;
  }

  container.innerHTML = cars.map(car => `
    <div class="specs-card reveal ${car.type === 'medium' ? 'specs-featured' : ''}">
      <h3>${escapeHTML(car.model)}</h3>
      <div class="specs-list">
        <div class="spec-row">
          <span class="spec-label">Transmission</span>
          <span class="spec-value">Automatic</span>
        </div>
        <div class="spec-row">
          <span class="spec-label">Load Space</span>
          <span class="spec-value">${escapeHTML(car.capacity)}</span>
        </div>
        <div class="spec-row">
          <span class="spec-label">Max Payload</span>
          <span class="spec-value">${escapeHTML(car.payload)} kg</span>
        </div>
        <div class="spec-row">
          <span class="spec-label">Fuel Type</span>
          <span class="spec-value">Diesel</span>
        </div>
        <div class="spec-row">
          <span class="spec-label">Seats</span>
          <span class="spec-value">2 front ${car.type !== 'small' ? '' : '+ jump seats'}</span>
        </div>
        <div class="spec-row">
          <span class="spec-label">Daily Rate</span>
          <span class="spec-value">From £${escapeHTML(car.price_daily)}</span>
        </div>
      </div>
      <a href="${vehicleDetailUrl(car)}" class="btn btn-primary btn-sm">View Van</a>
    </div>
  `).join('');
  requestAnimationFrame(() => setupRevealElements(container));
}

window.addEventListener('load', async () => {
  document.body.classList.add('is-ready');
  const user = await refreshAuthState();
  initLoginPage(user);
  initBookingPage(user);
  initDashboardPage(user);
  initCarsPage(user);

  // Load cars for fleet pages - check for actual page elements instead of pathname
  const hasFleetGrid = document.querySelector('.van-cards-grid');
  const hasSpecsGrid = document.querySelector('.specs-comparison');
  if (hasFleetGrid || hasSpecsGrid) {
        loadCarsForFleetPage();
  }
});

function initLoginPage(user) {
  const loginPage = document.getElementById('loginPage');
  if (!loginPage) return;
  if (user) {
    document.getElementById('authStatus').textContent = 'Already signed in. Redirecting to your dashboard…';
    setTimeout(() => {
      window.location.href = isAdminUser(user) ? 'dashboard.html' : 'user-dashboard.html';
    }, 900);
    return;
  }

  const authForm = document.getElementById('authForm');
  const authToggle = document.getElementById('authToggle');
  const authHeading = document.getElementById('authHeading');
  const authModeHint = document.getElementById('authModeHint');
  const authSubmit = document.getElementById('authSubmit');
  const authStatus = document.getElementById('authStatus');
  const emailField = document.getElementById('authEmail');
  const otpField = document.getElementById('authOtp');
  const signupFields = loginPage.querySelectorAll('.signup-only');
  const otpFields = loginPage.querySelectorAll('.otp-only');
  let authMode = 'signIn';
  let otpSent = false;
  let pendingEmail = '';

  function normaliseEmail(value) {
    const email = value.trim();
    return email.toLowerCase() === 'admin' ? ADMIN_EMAIL : email;
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
    authStatus.textContent = message || (otpSent ? 'Check your email and enter the code we sent.' : 'Enter your email and we’ll send a secure one-time code.');
  }

  function resetOtpState(nextMode = authMode) {
    authMode = nextMode;
    otpSent = false;
    pendingEmail = '';
    if (emailField) emailField.disabled = false;
    if (otpField) otpField.value = '';
    renderMode();
  }

  authToggle.addEventListener('click', () => {
    resetOtpState(otpSent ? authMode : (authMode === 'signIn' ? 'signUp' : 'signIn'));
  });
  renderMode();

  authForm.addEventListener('submit', async e => {
    e.preventDefault();
    const rawEmail = emailField?.value.trim() || '';
    const authEmail = normaliseEmail(rawEmail);
    if (!authEmail) return;

    if (!supabase) {
      authStatus.textContent = 'Authentication is not configured. Please contact support.';
      return;
    }

    const fullName = document.getElementById('authFullName')?.value.trim();
    const dob = document.getElementById('authDob')?.value;
    const phone = document.getElementById('authPhone')?.value.trim();
    const postcode = document.getElementById('authPostcode')?.value.trim();

    if (!otpSent && authMode === 'signUp' && (!fullName || !dob || !phone || !postcode)) {
      authStatus.textContent = 'Please complete all required signup fields.';
      return;
    }

    authSubmit.disabled = true;
    try {
      if (!otpSent) {
        authStatus.textContent = 'Sending your one-time code…';
        const response = await post('/api/auth', { action: 'start_otp', email: authEmail, signup: authMode === 'signUp', fullName, dob, phone, postcode }, 'start_otp');
        pendingEmail = authEmail;
        otpSent = true;
        renderMode(response.message || 'We sent a one-time code to your email.');
        otpField?.focus();
        return;
      }

      const token = otpField?.value.trim() || '';
      if (!token) {
        authStatus.textContent = 'Enter the one-time code from your email.';
        return;
      }
      authStatus.textContent = 'Verifying your code…';
      const response = await post('/api/auth', { action: 'verify_otp', email: pendingEmail || authEmail, token }, 'verify_otp');
      const result = await supabase.auth.setSession(response.session);
      if (result.error) throw result.error;
      if (response.requiresPasswordSetup) {
        window.location.href = 'reset-password.html?setup=1';
        return;
      }
      const signedInUser = result.data?.user;
      window.location.href = isAdminUser(signedInUser) ? 'dashboard.html' : 'user-dashboard.html';
    } catch (error) {
      authStatus.textContent = error.message || 'Unable to continue. Please try again.';
    } finally {
      authSubmit.disabled = false;
    }
  });
}

function initBookingPage(user) {
  const bookingFormExists = document.getElementById('bookingForm');
  if (!bookingFormExists) return;
  if (!user) return;

  const custEmailEl = document.getElementById('custEmail');
  const custNameEl = document.getElementById('custName');
  if (custEmailEl) {
    custEmailEl.value = user.email || '';
  }
  if (custNameEl) {
    custNameEl.value = user.user_metadata?.full_name || '';
  }
  const driverNameEl = document.getElementById('driverFullName');
  if (driverNameEl && !driverNameEl.value) {
    driverNameEl.value = user.user_metadata?.full_name || '';
  }
}

async function initDashboardPage(user) {
  const dashboardPage = document.getElementById('dashboardPage');
  if (!dashboardPage) return;
  if (!user) {
    window.location.href = 'login.html';
    return;
  }

  const isAdmin = isAdminUser(user);
  const isUserDashboard = dashboardPage.classList.contains('user-dashboard-page');
  const isAdminDashboard = dashboardPage.classList.contains('admin-console-page');
  const isInvoicePage = dashboardPage.classList.contains('admin-invoices-page');
  const isDriverChecksPage = dashboardPage.classList.contains('admin-driver-checks-page');
  if (isAdminDashboard && !isAdmin) {
    window.location.href = 'user-dashboard.html';
    return;
  }
  if (isUserDashboard && isAdmin) {
    window.location.href = 'dashboard.html';
    return;
  }
  document.querySelectorAll('.admin-only').forEach(el => {
    el.style.display = isAdmin ? '' : 'none';
  });

  const customerName = user.user_metadata?.full_name || user.email?.split('@')[0] || 'there';
  const displayName = isUserDashboard ? customerName : ADMIN_OWNER_NAME;
  const escapeHTML = value => String(value ?? '--')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
  const greetingEl = document.getElementById('dashboardGreeting');
  if (greetingEl) {
    greetingEl.textContent = isUserDashboard
      ? `Welcome back, ${customerName}`
      : `Welcome back, ${displayName}`;
  }

  const avatarEl = document.getElementById('headerAvatar');
  if (avatarEl) {
    avatarEl.textContent = isUserDashboard
      ? customerName.split(' ').map(part => part[0]).join('').slice(0, 2).toUpperCase()
      : 'OF';
  }

  document.querySelectorAll('.admin-owner-name').forEach(el => {
    el.textContent = displayName;
  });

  const setText = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  };

  const formatMoney = value => `GBP ${Math.round(value).toLocaleString()}`;
  const parseMoney = value => {
    if (typeof value === 'number') return value;
    const parsed = Number(String(value || '').replace(/[^\d.]/g, ''));
    return Number.isFinite(parsed) ? parsed : 0;
  };

  let bookings = [];
  let verifications = [];
  let error = null;

  if (supabase) {
    const result = isAdmin
      ? await supabase.from('bookings').select('*').order('created_at', { ascending: false })
      : await supabase.from('bookings').select('*').eq('user_id', user.id).order('created_at', { ascending: false });
    bookings = result.data;
    error = result.error;

    const verificationResult = isAdmin
      ? await supabase.from('driver_verifications').select('*').order('created_at', { ascending: false })
      : await supabase.from('driver_verifications').select('*').eq('user_id', user.id).order('created_at', { ascending: false });
    if (!verificationResult.error && Array.isArray(verificationResult.data)) {
      verifications = verificationResult.data;
    }
  }

  const tableBody = document.getElementById('bookingsTableBody');
  if (error || !Array.isArray(bookings)) {
    if (!tableBody) return;
    tableBody.innerHTML = '<tr><td colspan="5" class="txt-dim">Unable to load booking data. Please check your Supabase setup.</td></tr>';
    setText('dashboardSyncStatus', 'Supabase connection issue');
    return;
  }

  const verificationStatusLabel = verification => {
    const status = verification?.verification_status || 'PENDING';
    if (status === 'APPROVED') return '🟢 Approved';
    if (status === 'REJECTED') return '🔴 Rejected';
    return '🟡 Pending Review';
  };
  const verificationStatusClass = verification => {
    const status = verification?.verification_status || 'PENDING';
    if (status === 'APPROVED') return 'paid';
    if (status === 'REJECTED') return 'cancelled';
    return 'pending';
  };
  const driverReleaseMessage = verification => {
    const status = verification?.verification_status || 'PENDING';
    if (status === 'APPROVED') return 'Your driving licence has been verified.';
    if (status === 'REJECTED') return 'Your licence verification was unsuccessful. Please contact support.';
    return 'Your driving documents are being reviewed.';
  };

  const invoiceRows = bookings.slice(0, 10).map((booking, index) => {
    const customer = booking.name || booking.email || 'Customer';
    return `<tr><td>${escapeHTML(customer)}</td><td>${escapeHTML(booking.email)}</td><td>${escapeHTML(booking.service)}</td><td>${escapeHTML(booking.price || 'GBP 0')}</td><td><button class="admin-email-action" type="button" data-email-action="invoice" data-booking-index="${index}">Invoice</button><button class="admin-email-action ghost" type="button" data-email-action="reminder" data-booking-index="${index}">Reminder</button></td></tr>`;
  }).join('');

  const bookingRows = bookings.slice(0, 10).map(booking => {
    const status = booking.status || 'Requested';
    const loweredStatus = status.toLowerCase();
    const statusClass = loweredStatus.includes('cancel')
      || loweredStatus.includes('unsuccessful')
      ? 'cancelled'
      : loweredStatus.includes('pending') || loweredStatus.includes('review')
        ? 'pending'
        : loweredStatus.includes('paid') || loweredStatus.includes('verified')
          ? 'paid'
          : 'successful';

    return `<tr>
      <td>${escapeHTML(booking.service)}</td>
      <td>${escapeHTML(booking.date)}</td>
      <td>${escapeHTML(booking.van_size)}</td>
      <td><span class="admin-status ${statusClass}">${escapeHTML(status)}</span></td>
      <td>${escapeHTML(booking.price || 'GBP 0')}</td>
      ${isAdmin ? `<td>
        <button class="admin-btn-icon confirm-booking-btn" data-id="${escapeHTML(booking.id)}" title="Confirm checked availability">Confirm</button>
        <button class="admin-btn-icon cancel-booking-btn" data-id="${escapeHTML(booking.id)}" title="Cancel booking">Cancel</button>
      </td>` : ''}
    </tr>`;
  }).join('');

  if (isUserDashboard) {
    const actions = document.getElementById('customerBookingActions');
    if (actions) {
      actions.replaceChildren();
      bookings.filter(b => ['Requested','Confirmed','Pending','Driver Verification Pending'].includes(b.status)).forEach(booking => {
        const button = document.createElement('button'); button.className = 'btn btn-outline btn-sm';
        button.textContent = 'Request cancellation: ' + (booking.reference || booking.id);
        button.addEventListener('click', async () => {
          if (!confirm('Request cancellation? The team will review the applicable hire terms.')) return;
          button.disabled = true;
          try { await manageBooking(booking.id, 'cancel'); }
          catch(error) { alert(error.message); button.disabled = false; }
        }); actions.append(button);
      });
    }
  }
  if (tableBody) {
    tableBody.innerHTML = bookings.length === 0
      ? `<tr><td colspan="${isAdmin ? '6' : '5'}" class="txt-dim">No bookings found yet.</td></tr>`
      : isInvoicePage ? invoiceRows : bookingRows;
  }

  // Add event listeners for booking action buttons
  if (isAdmin) {
    tableBody?.querySelectorAll('.confirm-booking-btn').forEach(btn => {
      btn.addEventListener('click', () => confirmBooking(btn.dataset.id));
    });

    tableBody?.querySelectorAll('.cancel-booking-btn').forEach(btn => {
      btn.addEventListener('click', () => cancelBooking(btn.dataset.id));
    });

    // Populate customers table
    const customersTableBody = document.getElementById('customersTableBody');
    if (customersTableBody && Array.isArray(bookings)) {
      // Group bookings by customer email
      const customerData = Object.create(null);
      bookings.forEach(booking => {
        const email = booking.email;
        if (!email) return;

        if (!customerData[email]) {
          customerData[email] = {
            name: booking.name || 'Unknown',
            email: email,
            bookings: 0,
            totalSpent: 0
          };
        }
        customerData[email].bookings++;
        customerData[email].totalSpent += parseMoney(booking.price);
      });

      const customerRows = Object.values(customerData).map(customer => `
        <tr>
          <td>${escapeHTML(customer.name)}</td>
          <td>${escapeHTML(customer.email)}</td>
          <td>${customer.bookings}</td>
          <td>${formatMoney(customer.totalSpent)}</td>
          <td>
            <a href="mailto:${escapeHTML(customer.email)}">Contact</a>
          </td>
        </tr>
      `).join('');

      customersTableBody.innerHTML = Object.keys(customerData).length === 0
        ? '<tr><td colspan="5" class="txt-dim">No customers found yet.</td></tr>'
        : customerRows;

      // Add event listeners for customer delete buttons

    }
  }

  setText('dashboardBookingsCount', bookings.length);
  const now = new Date();
  const upcomingBookings = bookings.filter(b => b.date && new Date(b.date + 'T23:59:59') >= now && !/cancel/i.test(b.status || ''));
  setText('dashboardUpcomingCount', upcomingBookings.length);

  const uniqueUsers = new Set(bookings.filter(b => b.email).map(b => b.email));
  setText('dashboardUsersCount', uniqueUsers.size);

  const weeklyCountEl = document.getElementById('dashboardWeeklyCount');
  const weeklyBookings = bookings.filter(b => {
    const created = b.created_at ? new Date(b.created_at) : null;
    return created && (Date.now() - created.getTime()) <= 7 * 24 * 60 * 60 * 1000;
  });
  if (weeklyCountEl) weeklyCountEl.textContent = weeklyBookings.length;

  const totalRevenue = bookings.filter(b => b.status === 'Paid').reduce((sum, b) => sum + parseMoney(b.price), 0);
  const pendingBookings = bookings.filter(b => /requested|pending/i.test(b.status || ''));
  const completedBookings = bookings.filter(b => {
    const status = (b.status || '').toLowerCase();
    return status.includes('success') || status.includes('complete') || status.includes('confirm');
  });
  const todayISO = now.toISOString().split('T')[0];
  const todayBookings = bookings.filter(b => b.date === todayISO);
  const overdueBookings = pendingBookings.filter(b => {
    const created = b.created_at ? new Date(b.created_at) : null;
    return created && (Date.now() - created.getTime()) > 3 * 24 * 60 * 60 * 1000;
  });
  const currentMonthRevenue = bookings.filter(b => b.status === 'Paid').reduce((sum, booking) => {
    const created = booking.created_at ? new Date(booking.created_at) : null;
    if (!created || created.getMonth() !== now.getMonth() || created.getFullYear() !== now.getFullYear()) return sum;
    return sum + parseMoney(booking.price);
  }, 0);
  const revenueGoal = Math.max(25000, totalRevenue * 1.25);
  const monthlyProgress = Math.min(100, Math.round((currentMonthRevenue / revenueGoal) * 100)) || 0;
  const fleetUtilisation = 'Not tracked';
  const followUpRate = bookings.length ? Math.round((pendingBookings.length / bookings.length) * 100) : 0;

  setText('dashboardRevenue', formatMoney(totalRevenue));
  setText('dashboardBalance', formatMoney(totalRevenue));
  setText('dashboardCreditAmount', 'Not tracked');
  setText('dashboardPendingCount', pendingBookings.length);
  setText('dashboardCustomersCount', uniqueUsers.size);
  setText('dashboardCompletedCount', completedBookings.length);
  setText('dashboardMonthlyRevenue', formatMoney(currentMonthRevenue));
  setText('dashboardTodayCount', todayBookings.length);
  setText('dashboardOverdueCount', overdueBookings.length);
  setText('dashboardAverageBooking', formatMoney(bookings.length ? totalRevenue / bookings.length : 0));
  setText('dashboardConversionRate', `${bookings.length ? Math.round((completedBookings.length / bookings.length) * 100) : 0}%`);
  setText('dashboardRevenueGoal', `${monthlyProgress}%`);
  setText('dashboardFleetUtilisation', fleetUtilisation);
  setText('dashboardFollowUps', `${followUpRate}%`);
  setText('dashboardSyncStatus', 'Synced with Supabase');
  setText('dashboardLastSync', `Updated ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`);

  const nextBooking = upcomingBookings
    .slice()
    .sort((a, b) => new Date(a.date) - new Date(b.date))[0];
  setText('userNextService', nextBooking?.service || 'No upcoming booking');
  setText('userNextDate', nextBooking?.date || 'Book your next van when ready');
  setText('userNextVan', nextBooking?.van_size || 'Van size pending');
  setText('userTotalSpend', formatMoney(totalRevenue));
  setText('userEmail', user.email || '--');
  setText('userEmailSidebar', user.email || '--');
  setText('userPhone', user.user_metadata?.phone || 'Not added');
  setText('userPostcode', user.user_metadata?.postcode || 'Not added');

  const latestVerification = verifications[0];
  setText('driverVerificationStatus', verificationStatusLabel(latestVerification));
  setText('driverVerificationUpdated', latestVerification?.updated_at ? new Date(latestVerification.updated_at).toLocaleString() : '--');
  setText('driverVerificationDvlaCode', latestVerification?.dvla_check_code ? 'Submitted' : 'Not submitted');
  setText('driverVerificationDocuments', latestVerification ? 'Licence front and licence back' : 'No documents uploaded');
  const driverVerificationBadge = document.getElementById('driverVerificationBadge');
  if (driverVerificationBadge) {
    driverVerificationBadge.className = `admin-status ${verificationStatusClass(latestVerification)}`;
    driverVerificationBadge.textContent = verificationStatusLabel(latestVerification);
  }
  setText('driverVerificationMessage', latestVerification
    ? driverReleaseMessage(latestVerification)
    : 'Submit your driver verification with your next booking.');

  if (isAdmin && isDriverChecksPage) {
    const pending = verifications.filter(item => item.verification_status === 'PENDING');
    const approved = verifications.filter(item => item.verification_status === 'APPROVED');
    const rejected = verifications.filter(item => item.verification_status === 'REJECTED');
    setText('driverChecksPendingCount', pending.length);
    setText('driverChecksApprovedCount', approved.length);
    setText('driverChecksRejectedCount', rejected.length);

    const bookingById = new Map(bookings.map(booking => [booking.id, booking]));
    const pendingList = document.getElementById('driverChecksList');
    if (pendingList) {
      pendingList.innerHTML = pending.length ? pending.map(item => {
        const booking = bookingById.get(item.booking_id) || {};
        const bookingReference = item.booking_id ? String(item.booking_id).slice(0, 8).toUpperCase() : 'Pending';
        return `<article class="driver-check-card">
          <div class="driver-check-card-head">
            <div>
              <span class="admin-status pending">🟡 Pending Review</span>
              <h3>${escapeHTML(item.full_name || booking.name || 'Customer')}</h3>
              <p>${escapeHTML(booking.email || 'No email on booking')}</p>
            </div>
            <strong>${escapeHTML(bookingReference)}</strong>
          </div>
          <div class="driver-check-grid">
            <div><span>Vehicle</span><strong>${escapeHTML(booking.van_size || '--')}</strong></div>
            <div><span>Collection Date</span><strong>${escapeHTML(booking.date || '--')}</strong></div>
            <div><span>DVLA Code</span><strong>${escapeHTML(item.dvla_check_code || '--')}</strong></div>
            <div><span>Licence Details</span><strong>${escapeHTML(item.driving_licence_number || '--')}</strong></div>
          </div>
          <div class="driver-document-actions">
            <button type="button" data-doc-path="${escapeHTML(item.licence_front_file || '')}">Licence Front</button>
            <button type="button" data-doc-path="${escapeHTML(item.licence_back_file || '')}">Licence Back</button>
          </div>
          <div class="driver-admin-actions">
            <a href="https://www.gov.uk/check-driving-information" target="_blank" rel="noopener">Open DVLA Verification</a>
            <button type="button" class="approve-driver-btn" data-verification-id="${item.verification_id}" data-booking-id="${item.booking_id}" data-email="${escapeHTML(booking.email || '')}">Approve Driver</button>
            <button type="button" class="reject-driver-btn" data-verification-id="${item.verification_id}" data-booking-id="${item.booking_id}" data-email="${escapeHTML(booking.email || '')}">Reject Driver</button>

          </div>
        </article>`;
      }).join('') : '<p class="txt-dim">No pending driver checks right now.</p>';

      pendingList.querySelectorAll('[data-doc-path]').forEach(button => {
        button.addEventListener('click', async () => {
          const path = button.dataset.docPath;
          if (!path || !supabase) return;
          const { data, error: signedUrlError } = await supabase.storage.from(DRIVER_DOC_BUCKET).createSignedUrl(path, 300);
          if (signedUrlError) {
            alert('Unable to open this secure document.');
            return;
          }
          window.open(data.signedUrl, '_blank', 'noopener');
        });
      });

      pendingList.querySelectorAll('.approve-driver-btn').forEach(button => {
        button.addEventListener('click', () => updateDriverVerificationStatus(button.dataset.verificationId, button.dataset.bookingId, button.dataset.email, 'APPROVED'));
      });
      pendingList.querySelectorAll('.reject-driver-btn').forEach(button => {
        button.addEventListener('click', () => updateDriverVerificationStatus(button.dataset.verificationId, button.dataset.bookingId, button.dataset.email, 'REJECTED'));
      });

    }
  }

  const composeAdminEmail = booking => ({
    subject: 'Your booking details',
    body: booking ? [booking.reference || booking.id, booking.vehicle_name || booking.van_size, booking.date, booking.time, booking.pickup, booking.dropoff, 'Status: ' + booking.status, 'Hire estimate: ' + booking.price, 'This is not a payment receipt or a new confirmation of availability.'].join('\n') : '',
  });
  const openAdminEmail = async (booking, type = 'confirmation') => {
    if (!booking?.email) { setText('invoiceEmailStatus','Select a booking.'); return; }
    try { const result = await manageBooking(booking.id,type); setText('invoiceEmailStatus',result.message); }
    catch(error) { setText('invoiceEmailStatus',error.message); }
  };

  if (isInvoicePage) {
    const bookingSelect = document.getElementById('invoiceBookingSelect');
    const amountInput = document.getElementById('invoiceAmount');
    const dueInput = document.getElementById('invoiceDueDate');
    const typeSelect = document.getElementById('invoiceEmailType');
    const preview = document.getElementById('invoiceEmailPreview');
    const form = document.getElementById('invoiceEmailForm');
    const previewButton = document.getElementById('previewInvoiceEmail');
    const selectableBookings = bookings.filter(booking => booking.email);
    if (bookingSelect) {
      bookingSelect.innerHTML = selectableBookings.length
        ? selectableBookings.map((booking, index) => `<option value="${index}">${escapeHTML(booking.name || booking.email)} - ${escapeHTML(booking.service || 'Booking')} - ${escapeHTML(booking.price || 'GBP 0')}</option>`).join('')
        : '<option value="">No bookings with customer emails</option>';
    }
    const selectedBooking = () => selectableBookings[Number(bookingSelect?.value || 0)];
    const syncInvoiceForm = () => {
      const booking = selectedBooking();
      if (amountInput) amountInput.value = booking?.price || '';
      if (dueInput && !dueInput.value) dueInput.value = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const email = composeAdminEmail(booking, typeSelect?.value || 'invoice');
      if (preview) preview.textContent = booking ? `Subject: ${email.subject}\n\n${email.body}` : 'Select a booking with an email address.';
    };
    bookingSelect?.addEventListener('change', syncInvoiceForm);
    typeSelect?.addEventListener('change', syncInvoiceForm);
    amountInput?.addEventListener('input', syncInvoiceForm);
    dueInput?.addEventListener('change', syncInvoiceForm);
    document.getElementById('invoiceMessage')?.addEventListener('input', syncInvoiceForm);
    previewButton?.addEventListener('click', syncInvoiceForm);
    form?.addEventListener('submit', async e => {
      e.preventDefault();
      await openAdminEmail(selectedBooking(), typeSelect?.value || 'invoice');
    });
    document.querySelectorAll('[data-email-action]').forEach(button => {
      button.addEventListener('click', async () => {
        const booking = bookings[Number(button.dataset.bookingIndex)];
        await openAdminEmail(booking, button.dataset.emailAction);
      });
    });
    syncInvoiceForm();
  }

  const revenueGoalBar = document.getElementById('dashboardRevenueGoalBar');
  if (revenueGoalBar) revenueGoalBar.style.width = `${monthlyProgress}%`;
  const fleetBar = document.getElementById('dashboardFleetUtilisationBar');
  if (fleetBar) fleetBar.style.width = '0%';
  const followUpsBar = document.getElementById('dashboardFollowUpsBar');
  if (followUpsBar) followUpsBar.style.width = `${followUpRate}%`;

  const monthlyTotals = Array.from({ length: 12 }, () => 0);
  bookings.forEach(booking => {
    const created = booking.created_at ? new Date(booking.created_at) : booking.date ? new Date(booking.date) : null;
    if (!created || created.getFullYear() !== now.getFullYear() || booking.status !== 'Paid') return;
    monthlyTotals[created.getMonth()] += parseMoney(booking.price);
  });
  const maxMonth = Math.max(...monthlyTotals, 1);
  document.querySelectorAll('[data-month-bar]').forEach((bar, index) => {
    const height = Math.round((monthlyTotals[index] / maxMonth) * 100);
    bar.style.height = `${height}%`;
    bar.classList.toggle('active', index === now.getMonth());
  });

  if (supabase && !bookingsRealtimeChannel) {
    bookingsRealtimeChannel = supabase
      .channel('admin-bookings-sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings' }, () => {
        initDashboardPage(user);
      })
      .subscribe(status => {
        if (status === 'SUBSCRIBED') setText('dashboardSyncStatus', 'Live Supabase sync on');
      });
  }
  if (supabase && !driverVerificationsRealtimeChannel) {
    driverVerificationsRealtimeChannel = supabase
      .channel('driver-verifications-sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'driver_verifications' }, () => {
        initDashboardPage(user);
      })
      .subscribe();
  }
}
