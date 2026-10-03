import { HttpError } from './core.mjs';
import { calculateBookingCharges, calculateHirePricePence, DEFAULT_PAYMENT_SETTINGS } from './pricing.mjs';

export async function readBusinessSettings(client) {
  const { data, error } = await client.from('business_settings').select('*').eq('id', true).maybeSingle();
  if (error) {
    if (String(error.message || '').toLowerCase().includes('business_settings')) return DEFAULT_PAYMENT_SETTINGS;
    throw new HttpError(503, 'Payment settings are unavailable. Please call +44 7300 331603.');
  }
  return { ...DEFAULT_PAYMENT_SETTINGS, ...(data || {}) };
}

export function bookingWindow(data) {
  const collection = new Date(`${data.date}T${data.time}:00+00:00`);
  const duration = data.duration === 'custom' ? 24 : Number(data.duration);
  const returnAt = new Date(collection.getTime() + duration * 60 * 60 * 1000);
  if (!Number.isFinite(collection.getTime()) || !Number.isFinite(returnAt.getTime()) || returnAt <= collection) throw new HttpError(400, 'Please choose valid collection and return times.');
  return { collection_at: collection.toISOString(), return_at: returnAt.toISOString() };
}

export async function checkVehicleAvailable(client, vehicleId, collectionAt, returnAt, excludeBookingId = null) {
  const { data, error } = await client.rpc('bv_vehicle_available', { p_vehicle_id: vehicleId, p_start: collectionAt, p_end: returnAt, p_exclude_booking: excludeBookingId });
  if (error) {
    if (String(error.message || '').toLowerCase().includes('bv_vehicle_available')) return true;
    throw new HttpError(503, 'Unable to check vehicle availability. Please call +44 7300 331603.');
  }
  return data === true;
}

export async function createPaymentRowsForBooking(client, bookingId, charges, dueAt) {
  const rows = [
    { booking_id: bookingId, category: 'booking_deposit', expected_amount_pence: charges.booking_deposit_pence, currency: 'gbp', status: 'requires_payment', due_at: dueAt },
    { booking_id: bookingId, category: 'remaining_balance', expected_amount_pence: charges.outstanding_hire_balance_pence, currency: 'gbp', status: charges.outstanding_hire_balance_pence > 0 ? 'not_due' : 'not_applicable', due_at: dueAt },
    { booking_id: bookingId, category: 'insurance_charge', expected_amount_pence: charges.insurance_charge_pence, currency: 'gbp', status: charges.insurance_charge_pence > 0 ? 'not_due' : 'not_applicable', due_at: dueAt },
    { booking_id: bookingId, category: 'security_deposit', expected_amount_pence: charges.security_deposit_pence, currency: 'gbp', status: charges.security_deposit_pence > 0 ? 'not_due' : 'not_applicable', due_at: dueAt },
  ];
  const { error } = await client.from('booking_payments').upsert(rows, { onConflict: 'booking_id,category' });
  if (error && !String(error.message || '').toLowerCase().includes('booking_payments')) throw new HttpError(503, 'Unable to prepare payment records. Please contact us.');
}

export function calculateChargesForCar(car, duration, settings) {
  const dailyRatePence = Number.isSafeInteger(Number(car.daily_rate_pence)) && Number(car.daily_rate_pence) > 0
    ? Number(car.daily_rate_pence)
    : Math.round(Number(car.price_daily) * 100);
  const hirePricePence = calculateHirePricePence(dailyRatePence, duration);
  if (!hirePricePence) return null;
  return calculateBookingCharges(hirePricePence, settings);
}
