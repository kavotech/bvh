import { handle, requestBody, db, rateLimit, captcha, HttpError } from '../server/core.mjs';
import { checkVehicleAvailable } from '../server/booking-payments.mjs';

function publicVehicle(car, available = true) {
  const daily = Number.isSafeInteger(Number(car.daily_rate_pence)) && Number(car.daily_rate_pence) > 0 ? Math.round(Number(car.daily_rate_pence) / 100) : Number(car.price_daily);
  return {
    id: car.id,
    model: car.model,
    type: car.type,
    category: car.category || car.type,
    price_daily: daily,
    daily_rate_pence: Number.isSafeInteger(Number(car.daily_rate_pence)) ? Number(car.daily_rate_pence) : Math.round(Number(car.price_daily) * 100),
    capacity: car.capacity,
    payload: car.payload,
    description: car.description,
    image_url: car.image_url,
    is_active: car.is_active !== false,
    available,
  };
}

export default handle(async (req, res) => {
  const body = requestBody(req);
  const client = db();
  await rateLimit(req, client, 'vehicles');
  await captcha(body.token, 'vehicles');
  const { data, error } = await client
    .from('cars')
    .select('id,model,type,category,price_daily,daily_rate_pence,capacity,payload,description,image_url,is_active,published')
    .eq('is_active', true)
    .order('price_daily', { ascending: true });
  if (error) throw new HttpError(503, 'Vehicle selection is temporarily unavailable. Please call +44 7300 331603.');
  const cars = (data || []).filter(car => car.published !== false);
  const hasWindow = body.start && body.end;
  const vehicles = [];
  for (const car of cars) {
    const available = hasWindow ? await checkVehicleAvailable(client, car.id, body.start, body.end) : true;
    vehicles.push(publicVehicle(car, available));
  }
  res.status(200).json({ vehicles });
});
