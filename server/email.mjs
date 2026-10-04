import { env, HttpError } from './core.mjs';
export const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
export function template(title, lines) {
  const text = `${title}\n\n${lines.join('\n')}\n\nBreezyee Vans\n+44 7300 331603\ninfo@breezyeevans.co.uk\nhttps://www.breezyeevans.co.uk`;
  const htmlLine = line => escape(line).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" style="color:#5b22b0;font-weight:700">Review this booking</a>');
  const html = `<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0;background:#f5f0ff;font-family:Arial,sans-serif;color:#2d2540"><table role="presentation" width="100%"><tr><td align="center" style="padding:24px 12px"><table role="presentation" width="100%" style="max-width:600px;background:white;border-radius:16px"><tr><td style="padding:28px;background:#5b22b0;color:white;font-size:24px">Breezyee Vans</td></tr><tr><td style="padding:28px;line-height:1.65;overflow-wrap:anywhere"><h1 style="font-size:24px">${escape(title)}</h1>${lines.map(line => `<p>${htmlLine(line)}</p>`).join('')}<hr><p>Call <a href="tel:+447300331603">+44 7300 331603</a><br><a href="mailto:info@breezyeevans.co.uk">info@breezyeevans.co.uk</a></p><a href="https://www.breezyeevans.co.uk">Visit Breezyee Vans</a></td></tr></table></td></tr></table></body></html>`;
  return { subject: title, html, text };
}
export function submissionEmails(kind, data, reference) {
  const lines = [`Hello ${data.name || 'there'},`, `Reference: ${reference}`, ...(kind === 'booking' ? [`Vehicle: ${data.vehicle_name}`, `Collection date and time: ${data.date} at ${data.time} (UK time)`, `Collection: ${data.pickup}`, `Destination: ${data.dropoff}`, `Duration: ${data.duration === 'custom' ? 'Custom hire' : data.duration + ' hours'}`, `Estimated rental price: ${data.price}.`, `Estimated booking deposit: ${data.booking_deposit_pence ? `£${(Number(data.booking_deposit_pence) / 100).toFixed(2)}` : 'To be confirmed'}`, 'Status: Awaiting Approval.', 'No payment has been taken. Vehicle availability and the final hire terms will be confirmed by our team.'] : [`Enquiry: ${data.service}`, data.message, 'We have received your enquiry and will reply using the contact details you provided.'])];
  const title = kind === 'booking' ? "We've Received Your Breezyee Vans Booking Request" : 'Your enquiry has been received';
  return [
    { recipient: data.email, ...template(title, lines) },
    { recipient: process.env.ADMIN_NOTIFICATION_EMAIL || 'info@breezyeemoves.co.uk', ...template(kind === 'booking' ? 'New Breezyee Vans Booking Request — Review Required' : `New ${kind} request — ${reference}`, kind === 'booking' ? [`Hi Olushola Fadipe,`, `You have received a booking request from ${data.name || 'a customer'}.`, `Booking reference: ${reference}`, `Customer email: ${data.email}`, `Phone: ${data.phone}`, `Please sign in and review, then approve or decline this request: ${process.env.SITE_URL || 'https://www.breezyeevans.co.uk'}/dashboard?booking=${encodeURIComponent(reference)}`, ...lines.slice(2)] : [...lines, `Customer email: ${data.email}`, `Phone: ${data.phone}`]) },
  ];
}
export async function sendResendEmail(job, idempotencyKey, fetcher = fetch) {
  const payload = from => ({ from, to: [job.recipient], reply_to: 'info@breezyeevans.co.uk', subject: job.subject, html: job.html, text: job.text });
  const send = (from, key = idempotencyKey) => fetcher('https://api.resend.com/emails', {
    method: 'POST', headers: { Authorization: `Bearer ${env('RESEND_API_KEY')}`, 'Content-Type': 'application/json', 'Idempotency-Key': key },
    body: JSON.stringify(payload(from)), signal: AbortSignal.timeout(10000),
  });
  let response = await send('Breezyee Vans <no-reply@breezyeevans.co.uk>');
  let result = await response.json().catch(() => ({}));
  const domainUnverified = response.status === 403 && /domain is not verified/i.test(String(result.message || ''));
  const recipient = String(job.recipient || '').toLowerCase();
  const adminEmail = (process.env.ADMIN_NOTIFICATION_EMAIL || 'info@breezyeemoves.co.uk').toLowerCase();
  if (domainUnverified && recipient === adminEmail) {
    console.warn('resend_domain_unverified_admin_fallback');
    response = await send('Breezyee Vans <onboarding@resend.dev>', `${idempotencyKey}:fallback`);
    result = await response.json().catch(() => ({}));
  }
  if (!response.ok) {
    if (domainUnverified) throw new HttpError(503, 'Email delivery is not fully configured yet. Verify breezyeevans.co.uk in Resend, then try again.');
    throw new HttpError(503, 'Email delivery is temporarily unavailable. Please try again or call +44 7300 331603.');
  }
  const { id } = result;
  if (!id) throw new Error('Email provider returned no receipt');
  return id;
}
export async function deliverEmails(client, submissionKey = null, fetcher = fetch) {
  const { data: jobs, error } = await client.rpc('bv_claim_emails', { p_submission_key: submissionKey });
  if (error) throw new Error('Email queue unavailable');
  let sent = 0;
  for (const job of jobs || []) {
    try {
      const providerId = await sendResendEmail(job, job.id, fetcher);
      const { error: updateError } = await client.from('email_outbox').update({ sent_at: new Date().toISOString(), provider_id: providerId, locked_until: null }).eq('id', job.id);
      if (updateError) throw new Error('Email receipt not saved');
      sent++;
    } catch {
      console.warn('email_delivery_pending');
    }
  }
  return sent;
}
