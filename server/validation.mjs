import { HttpError, text, email } from './core.mjs';
import { calculateHirePricePence, penceToDisplay } from './pricing.mjs';
export function validateEnquiry(body) {
  return { name: text(body.name, 'your name', 100, 2), email: email(body.email), phone: text(body.phone, 'your phone number', 30, 7), message: text(body.message, 'your message', 4000, 10), service: text(body.service || 'General enquiry', 'service', 80) };
}
export function validateBooking(body, user, car, now = new Date(), extras = {}) {
  const priceDaily = Number(car?.price_daily);
  const dailyRatePence = Number(car?.daily_rate_pence);
  if (!car?.is_active || (!Number.isFinite(priceDaily) || priceDaily <= 0) && (!Number.isSafeInteger(dailyRatePence) || dailyRatePence <= 0)) throw new HttpError(400, 'Please choose a listed vehicle.');
  if (!['2','4','8','24','48','72','custom'].includes(body.duration)) throw new HttpError(400, 'Please select a duration.');
  const date = text(body.date, 'booking date', 10);
  const time = text(body.time, 'booking time', 5);
  const ukToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0,10) !== date || date < ukToday || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new HttpError(400, 'Please choose a valid future booking date and time.');
  if (date === ukToday && time <= new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hour12: false }).format(now)) throw new HttpError(400, 'Please choose a future pickup time.');
  if (body.termsAccepted !== true) throw new HttpError(400, 'Please accept the hire terms.');
  const dailyPence = Number.isSafeInteger(dailyRatePence) && dailyRatePence > 0 ? dailyRatePence : Math.round(priceDaily * 100);
  const price = body.duration === 'custom' ? 'Quote required' : penceToDisplay(calculateHirePricePence(dailyPence, body.duration));
  const name = text(body.name, 'your name', 100, 2);
  const phone = text(body.phone, 'your phone number', 30, 7);
  if (!/^[+\d ()-]{7,30}$/.test(phone)) throw new HttpError(400, 'Please check your phone number.');
  return { user_id: user.id, service: 'van-hire', van_size: car.type, vehicle_id: car.id, vehicle_name: car.model, name, email: user.email, phone, pickup: text(body.pickup, 'pickup location', 300, 3), dropoff: text(body.dropoff, 'destination', 300, 3), date, time, duration: body.duration, helpers: '0', price, status: extras.status || 'Awaiting booking deposit', terms_accepted_at: now.toISOString(), ...extras };
}
export function validateDriver(body, user, requestId) {
  const driver = body.driver || {};
  const dob = text(driver.date_of_birth, 'date of birth', 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dob) || !Number.isFinite(Date.parse(dob)) || new Date(dob).toISOString().slice(0,10) !== dob || Date.parse(dob) >= Date.now()) throw new HttpError(400, 'Please check your date of birth.');
  const result = { user_id: user.id, full_name: text(driver.full_name, 'driver name', 100, 2), date_of_birth: dob, driving_licence_number: text(driver.driving_licence_number, 'driving licence number', 30, 5), dvla_check_code: text(driver.dvla_check_code, 'DVLA check code', 30, 5), verification_status: 'PENDING' };
  for (const field of ['licence_front_file', 'licence_back_file']) {
    const path = text(driver[field], 'licence document', 250);
    if (!path.startsWith(`${user.id}/${requestId}/`) || path.includes('..') || !/\.(pdf|jpg|jpeg|png|webp)$/i.test(path)) throw new HttpError(400, 'Please upload valid licence documents.');
    result[field] = path;
  }
  return result;
}
