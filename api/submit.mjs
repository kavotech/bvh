import { handle, requestBody, db, rateLimit, captcha, userFor, uuid, digest, HttpError, DRIVER_DOC_BUCKET } from '../server/core.mjs';
import { validateBooking, validateEnquiry, validateDriver } from '../server/validation.mjs';
import { submissionEmails, deliverEmails } from '../server/email.mjs';
import { calculateChargesForCar, bookingWindow, checkVehicleAvailable, readBusinessSettings } from '../server/booking-payments.mjs';
import { penceToDisplay } from '../server/pricing.mjs';

export default handle(async (req, res) => {
  const body = requestBody(req);
  if (!['booking', 'enquiry'].includes(body.kind)) throw new HttpError(400, 'Invalid form.');
  const client = db();
  await rateLimit(req, client, 'submit');
  const requestId = uuid(body.requestId);
  await captcha(body.token, body.kind);
  let data, driver = null, owner, charges;
  if (body.kind === 'booking') {
    const user = await userFor(req, client);
    owner = user.id;
    const { data: car, error } = await client.from('cars').select('id,model,type,price_daily,daily_rate_pence,security_deposit_pence,is_active,published').eq('id', uuid(body.vehicleId)).single();
    if (error || car?.published === false) throw new HttpError(400, 'Please select a listed vehicle.');
    const settings = await readBusinessSettings(client);
    charges = calculateChargesForCar(car, body.duration, settings);
    if (!charges) throw new HttpError(400, 'Custom-duration bookings need a manual quote. Please call +44 7300 331603.');
    const window = bookingWindow({ date: body.date, time: body.time, duration: body.duration });
    const available = await checkVehicleAvailable(client, car.id, window.collection_at, window.return_at);
    if (!available) throw new HttpError(409, 'That vehicle is already reserved or unavailable for the selected time. Please choose another vehicle or date.');
    const holdExpires = new Date(Date.now() + charges.settings.hold_minutes * 60 * 1000).toISOString();
    const paymentDeadline = new Date(Date.now() + charges.settings.payment_deadline_hours * 60 * 60 * 1000).toISOString();
    data = validateBooking(body, user, car, new Date(), {
      ...window,
      hold_expires_at: holdExpires,
      payment_deadline_at: paymentDeadline,
      booking_status: 'Pending Approval',
      approval_status: 'Pending Approval',
      payment_status: 'unpaid',
      hire_price_pence: charges.hire_price_pence,
      booking_deposit_pence: charges.booking_deposit_pence,
      outstanding_balance_pence: charges.outstanding_hire_balance_pence,
      insurance_charge_pence: charges.insurance_charge_pence,
      security_deposit_pence: charges.security_deposit_pence,
      total_due_pence: charges.hire_price_pence + charges.insurance_charge_pence + charges.security_deposit_pence,
      price: penceToDisplay(charges.hire_price_pence),
    });
    driver = validateDriver(body, user, requestId);
    const { data: files, error: fileError } = await client.storage.from(DRIVER_DOC_BUCKET).list(`${user.id}/${requestId}`);
    if (fileError || ![driver.licence_front_file, driver.licence_back_file].every(path => files?.some(file => file.name === path.split('/').pop() && file.metadata?.size <= 5 * 1024 * 1024))) throw new HttpError(400, 'Please upload both licence documents, each under 5 MB.');
  } else {
    data = validateEnquiry(body);
    owner = data.email;
  }
  const key = digest([body.kind, owner, requestId]);
  const reference = `BV-${key.slice(0,16).toUpperCase()}`;
  const stable = { ...data }; delete stable.terms_accepted_at;
  const jobs = submissionEmails(body.kind, data, reference);
  const { data: saved, error } = await client.rpc('bv_submit', { p_key: key, p_hash: digest([stable, driver]), p_kind: body.kind, p_reference: reference, p_data: data, p_driver: driver, p_emails: jobs });
  if (error) {
    if (error.message?.includes('idempotency_conflict')) throw new HttpError(409, 'This request was already submitted with different details. Start a new request.');
    if (error.message?.includes('vehicle_unavailable')) throw new HttpError(409, 'That vehicle has just been reserved for the selected time. Please choose another vehicle or date.');
    throw new Error('Submission persistence failed');
  }
  if (body.kind === 'booking') {
    await client.from('bookings').update({ status: 'Pending Approval', booking_status: 'Pending Approval', approval_status: 'Pending Approval' }).eq('reference', saved.reference);
    await client.from('booking_holds').update({ status: 'cancelled' }).eq('reference', saved.reference).eq('status', 'active');
  }
  try { await deliverEmails(client, key); } catch { console.warn('email_queue_pending'); }
  res.status(200).json({ reference: saved.reference, status: body.kind === 'booking' ? 'Pending Approval' : 'Requested', message: body.kind === 'booking' ? "Booking Request Received! We've received your request and our team will review it shortly. You'll receive an email once your booking has been approved. No payment has been taken." : 'Your request is saved. Availability is subject to confirmation.', payment: null });
});
