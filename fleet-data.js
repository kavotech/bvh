// Shared fleet fallback data, used whenever Supabase is unavailable or returns no cars.
export const FALLBACK_CARS = [
  {
    id: 'fallback-small',
    model: 'Citroen Berlingo',
    type: 'small',
    price_daily: 100,
    capacity: '2–3 m³',
    payload: 750,
    description: 'Best for light loads and deliveries. Compact, nimble, and easy to park in the city.',
    image_url: '/van-small.webp',
    is_active: true,
  },
  {
    id: 'fallback-medium',
    model: 'Mercedes Sprinter',
    type: 'medium',
    price_daily: 200,
    capacity: '10–12 m³',
    payload: 1500,
    description: 'Ideal for bulky items and business transport. Spacious, powerful, and built to perform.',
    image_url: '/van-medium.webp',
    is_active: true,
  },
  {
    id: 'fallback-xl',
    model: 'Iveco Daily Luton',
    type: 'xl',
    price_daily: 350,
    capacity: '18–20 m³',
    payload: 2000,
    description: 'Maximum capacity for the biggest jobs. Large furniture, bulky loads, zero compromises.',
    image_url: '/van-large.webp',
    is_active: true,
  },
];

// Older records may still store the pre-webp filenames; map them forward.
export function fleetImageUrl(value) {
  return ({ '/van-small.jpg': '/van-small.webp', '/van-medium.jpg': '/van-medium.webp', '/van-large.png': '/van-large.webp' })[value] || value || '/van-medium.webp';
}
