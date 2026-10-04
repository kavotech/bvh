import { handle, requestBody, db, userFor, text, HttpError } from '../server/core.mjs';

export default handle(async (req, res) => {
  const body = requestBody(req);
  const client = db();
  const user = await userFor(req, client);
  const adminEmail = (process.env.ADMIN_EMAIL || 'info@breezyeevans.co.uk').toLowerCase();
  if (user.email.toLowerCase() !== adminEmail) throw new HttpError(403, 'Administrator access required.');
  const reference = text(body.reference, 'the booking reference', 100);
  const { data: booking, error } = await client.from('bookings').select('*').eq('reference', reference).single();
  if (error || !booking) throw new HttpError(404, 'Booking request not found.');
  const { data: driver } = await client.from('driver_verifications').select('full_name,date_of_birth,driving_licence_number,dvla_check_code,verification_status,licence_front_file,licence_back_file,created_at').eq('booking_id', booking.id).maybeSingle();
  const documents = {};
  for (const key of ['licence_front_file', 'licence_back_file']) {
    const path = driver?.[key];
    if (path) {
      const { data } = await client.storage.from('driver-verification-documents').createSignedUrl(path, 600);
      if (data?.signedUrl) documents[key] = data.signedUrl;
    }
  }
  res.status(200).json({ booking, driver: driver ? { ...driver, licence_front_file: undefined, licence_back_file: undefined } : null, documents });
});
