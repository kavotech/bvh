import { supabase } from './supabase.js';

const fallbackVehicles = [
  { id: 'small', type: 'small', model: 'Citroen Berlingo', image_url: '/van-small.webp', capacity: '2-3 m³', payload: 750, price_daily: 100, description: 'Small van for light moves, deliveries and city jobs.' },
  { id: 'medium', type: 'medium', model: 'Mercedes Sprinter', image_url: '/van-medium.webp', capacity: '10-12 m³', payload: 1500, price_daily: 200, description: 'Medium van for removals, bulky items and business transport.' },
  { id: 'xl', type: 'xl', model: 'Iveco Daily Luton', image_url: '/van-large.webp', capacity: '18-20 m³', payload: 2000, price_daily: 350, description: 'Large van for full moves, furniture and high-volume loads.' },
];

function fleetImageUrl(value) {
  return ({ '/van-small.jpg': '/van-small.webp', '/van-medium.jpg': '/van-medium.webp', '/van-large.png': '/van-large.webp' })[value] || value || '/van-medium.webp';
}

function pickVehicle(vehicles) {
  const requested = new URLSearchParams(location.search).get('van') || 'medium';
  return vehicles.find(vehicle => [vehicle.id, vehicle.type, `fallback-${vehicle.type}`].includes(requested)) || vehicles.find(vehicle => vehicle.type === 'medium') || vehicles[0];
}

function renderVehicle(vehicle) {
  const stableId = vehicle.id?.startsWith('fallback-') ? vehicle.type : vehicle.id || vehicle.type;
  const image = fleetImageUrl(vehicle.image_url);
  const rate = Number(vehicle.price_daily || 0);
  const rateText = rate ? `From £${rate}` : 'Rate on request';
  const rateDayText = rate ? `From £${rate}/day` : 'Rate on request';
  const selectors = {
    vehicleTitle: vehicle.model,
    vehicleSubtitle: vehicle.description || 'Preview this van before submitting a booking request.',
    vehicleCapacity: vehicle.capacity || 'Load space listed on request',
    vehicleRate: rateText,
    detailCapacity: vehicle.capacity || 'Listed on request',
    detailPayload: vehicle.payload ? `${vehicle.payload} kg` : 'Listed on request',
    detailRate: rateDayText,
  };

  for (const [id, text] of Object.entries(selectors)) {
    const node = document.getElementById(id);
    if (node) node.textContent = text;
  }

  const img = document.getElementById('vehicleImage');
  if (img) {
    img.src = image;
    img.alt = `${vehicle.model} preview`;
  }
  for (const link of [document.getElementById('bookVehicleLink'), document.getElementById('bookVehicleLinkBottom')]) {
    if (link) link.href = `/booking?van=${encodeURIComponent(stableId)}`;
  }
}

async function loadVehicle() {
  let vehicles = fallbackVehicles;
  if (supabase) {
    try {
      const { data, error } = await supabase.from('cars').select('*').eq('is_active', true).order('price_daily');
      if (!error && data?.length) vehicles = data;
    } catch {
      vehicles = fallbackVehicles;
    }
  }
  renderVehicle(pickVehicle(vehicles));
}

function initVehicleControls() {
  const stage = document.querySelector('.vehicle-stage');
  if (!stage) return;

  document.querySelectorAll('.angle-btn').forEach(button => {
    button.addEventListener('click', () => {
      document.querySelectorAll('.angle-btn').forEach(item => item.classList.toggle('is-active', item === button));
      stage.dataset.angle = button.dataset.angle;
    });
  });

  document.querySelectorAll('.tool-btn').forEach(button => {
    button.addEventListener('click', () => {
      const key = button.dataset.toggle;
      const pressed = button.getAttribute('aria-pressed') === 'true';
      button.setAttribute('aria-pressed', String(!pressed));
      stage.classList.toggle(`show-${key}`, !pressed);
    });
  });

  document.querySelectorAll('.assistant-action').forEach(button => {
    button.addEventListener('click', () => {
      document.querySelectorAll('.assistant-action').forEach(item => item.classList.toggle('is-active', item === button));
      const prompt = document.getElementById('vehiclePrompt');
      const messages = {
        rent: 'Arrange to rent this van for your move.',
        damage: 'We will confirm vehicle condition and handover details before collection.',
        load: 'Check the load space against your items before submitting the request.',
        price: 'Daily rate is estimated from the configured fleet price.',
      };
      if (prompt) prompt.textContent = messages[button.dataset.focus] || messages.rent;
    });
  });
}

export function initVehicleViewer() {
  if (!document.querySelector('.vehicle-page')) return;
  initVehicleControls();
  loadVehicle();
}
