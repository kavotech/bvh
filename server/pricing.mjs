import { HttpError } from './core.mjs';

export const DEFAULT_PAYMENT_SETTINGS = Object.freeze({
  booking_deposit_pence: 5000,
  booking_deposit_percent_bps: 2500,
  booking_deposit_cap_pence: 0,
  security_deposit_pence: 25000,
  insurance_percent_bps: 2000,
  insurance_enabled: false,
  insurance_disclosure: '',
  hold_minutes: 15,
  payment_deadline_hours: 24,
});

export function poundsToPence(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return Math.round(amount * 100);
}

export function penceToDisplay(pence) {
  if (!Number.isSafeInteger(Number(pence))) return '£0';
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(Number(pence) / 100);
}

export function normalisePaymentSettings(settings = {}) {
  const merged = { ...DEFAULT_PAYMENT_SETTINGS, ...(settings || {}) };
  const intField = (name, min, max) => {
    const value = Number(merged[name]);
    if (!Number.isSafeInteger(value) || value < min || value > max) throw new HttpError(503, 'Payment settings need administrator review before checkout can continue.');
    return value;
  };
  return {
    booking_deposit_pence: intField('booking_deposit_pence', 0, 1000000),
    booking_deposit_percent_bps: intField('booking_deposit_percent_bps', 0, 10000),
    booking_deposit_cap_pence: intField('booking_deposit_cap_pence', 0, 1000000),
    security_deposit_pence: intField('security_deposit_pence', 0, 1000000),
    insurance_percent_bps: intField('insurance_percent_bps', 0, 10000),
    insurance_enabled: merged.insurance_enabled === true,
    insurance_disclosure: typeof merged.insurance_disclosure === 'string' ? merged.insurance_disclosure.trim() : '',
    hold_minutes: intField('hold_minutes', 5, 1440),
    payment_deadline_hours: intField('payment_deadline_hours', 1, 720),
  };
}

export function calculateHirePricePence(dailyRatePence, duration) {
  const daily = Number(dailyRatePence);
  if (!Number.isSafeInteger(daily) || daily <= 0) throw new HttpError(400, 'This vehicle needs a valid configured daily rate.');
  if (duration === 'custom') return null;
  const hours = Number(duration);
  if (![2, 4, 8, 24, 48, 72].includes(hours)) throw new HttpError(400, 'Please select a valid hire duration.');
  const units = hours >= 24 ? hours / 24 : hours / 8;
  return Math.ceil(daily * units);
}

export function calculateBookingCharges(hirePricePence, settingsInput = {}, { requireInsurance = false } = {}) {
  const settings = normalisePaymentSettings(settingsInput);
  const hire = Number(hirePricePence);
  if (!Number.isSafeInteger(hire) || hire <= 0) throw new HttpError(400, 'This booking needs a confirmed hire price before payment.');
  const percentageDeposit = Math.round(hire * settings.booking_deposit_percent_bps / 10000);
  const uncappedDeposit = settings.booking_deposit_percent_bps > 0 ? percentageDeposit : settings.booking_deposit_pence;
  const cappedDeposit = settings.booking_deposit_cap_pence > 0 ? Math.min(uncappedDeposit, settings.booking_deposit_cap_pence) : uncappedDeposit;
  const bookingDepositPence = Math.min(Math.max(cappedDeposit, 0), hire);
  const outstandingHireBalancePence = Math.max(hire - bookingDepositPence, 0);
  if (requireInsurance && !settings.insurance_enabled) {
    throw new HttpError(409, 'Insurance charges are not available online until Breezyee Vans confirms the insurer, policy terms and required disclosures. Please contact us to complete this booking.');
  }
  const insuranceChargePence = settings.insurance_enabled ? Math.round(hire * settings.insurance_percent_bps / 10000) : 0;
  const securityDepositPence = settings.security_deposit_pence;
  return {
    hire_price_pence: hire,
    booking_deposit_pence: bookingDepositPence,
    outstanding_hire_balance_pence: outstandingHireBalancePence,
    insurance_charge_pence: insuranceChargePence,
    security_deposit_pence: securityDepositPence,
    initial_payment_pence: bookingDepositPence,
    final_payment_pence: outstandingHireBalancePence + insuranceChargePence + securityDepositPence,
    currency: 'gbp',
    settings,
  };
}

export function paymentCategoryLabel(category) {
  return {
    booking_deposit: 'Initial booking deposit',
    remaining_balance: 'Outstanding rental balance',
    final_balance: 'Remaining balance, insurance and refundable deposit',
    insurance_charge: 'Insurance charge',
    security_deposit: 'Refundable security deposit',
    additional_charge: 'Additional charge',
  }[category] || 'Booking payment';
}
