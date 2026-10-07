import { handle, requestBody, db, userFor, rateLimit, captcha, HttpError } from '../server/core.mjs';

export default handle(async (req, res) => {
  const body = requestBody(req);
  const client = db();
  const user = await userFor(req, client);
  const isAdmin = user.email.toLowerCase() === (process.env.ADMIN_EMAIL || 'info@breezyeevans.co.uk').toLowerCase();
  if (!isAdmin) throw new HttpError(403, 'Administrator access required.');
  await rateLimit(req, client, 'admin-users', user.id);
  await captcha(body.token, 'admin-users');

  const users = [];
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new HttpError(503, 'Unable to load account activity right now.');
    for (const account of data.users) {
      users.push({
        email: account.email,
        created_at: account.created_at,
        last_sign_in_at: account.last_sign_in_at || null,
        email_confirmed_at: account.email_confirmed_at || null,
      });
    }
    if (!data.users.length || data.users.length < 1000) break;
  }
  res.status(200).json({ users });
});
