import { timingSafeEqual } from 'node:crypto';
import { handle, env, db, HttpError } from '../server/core.mjs';
import { deliverEmails } from '../server/email.mjs';
export default handle(async (req, res) => {
  const expected = Buffer.from(`Bearer ${env('CRON_SECRET')}`);
  const actual = Buffer.from(String(req.headers.authorization || ''));
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new HttpError(401, 'Unauthorized.');
  const sent = await deliverEmails(db());
  res.status(200).json({ sent });
});
