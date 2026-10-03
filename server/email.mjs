import { env } from './core.mjs';
export const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
export function template(title, lines) {
  const text = `${title}\n\n${lines.join('\n')}\n\nBreezyee Vans\n+44 7300 331603\ninfo@breezyeevans.co.uk\nhttps://www.breezyeevans.co.uk`;
  const html = `<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0;background:#f5f0ff;font-family:Arial,sans-serif;color:#2d2540"><table role="presentation" width="100%"><tr><td align="center" style="padding:24px 12px"><table role="presentation" width="100%" style="max-width:600px;background:white;border-radius:16px"><tr><td style="padding:28px;background:#5b22b0;color:white;font-size:24px">Breezyee Vans</td></tr><tr><td style="padding:28px;line-height:1.65;overflow-wrap:anywhere"><h1 style="font-size:24px">${escape(title)}</h1>${lines.map(line => `<p>${escape(line)}</p>`).join('')}<hr><p>Call <a href="tel:+447300331603">+44 7300 331603</a><br><a href="mailto:info@breezyeevans.co.uk">info@breezyeevans.co.uk</a></p><a href="https://www.breezyeevans.co.uk">Visit Breezyee Vans</a></td></tr></table></td></tr></table></body></html>`;
  return { subject: title, html, text };
}
export function submissionEmails(kind, data, reference) {
  const lines = [`Hello ${data.name},`, `Reference: ${reference}`, ...(kind === 'booking' ? [`Vehicle: ${data.vehicle_name}`, `Requested pickup: ${data.date} at ${data.time} (UK time)`, `Pickup: ${data.pickup}`, `Destination: ${data.dropoff}`, `Duration: ${data.duration === 'custom' ? 'Custom hire' : data.duration + ' hours'}`, `Estimated price: ${data.price}. Subject to confirmation.`, 'Status: Requested. This is not a confirmed reservation. We will contact you to confirm availability and the final price.'] : [`Enquiry: ${data.service}`, data.message, 'We have received your enquiry and will reply using the contact details you provided.'])];
  const title = kind === 'booking' ? 'Your booking request has been received' : 'Your enquiry has been received';
  return [
    { recipient: data.email, ...template(title, lines) },
    { recipient: 'info@breezyeevans.co.uk', ...template(`New ${kind} request — ${reference}`, [...lines, `Customer email: ${data.email}`, `Phone: ${data.phone}`]) },
  ];
}
export async function sendResendEmail(job, idempotencyKey, fetcher = fetch) {
  const response = await fetcher('https://api.resend.com/emails', {
    method: 'POST', headers: { Authorization: `Bearer ${env('RESEND_API_KEY')}`, 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify({ from: 'Breezyee Vans <no-reply@breezyeevans.co.uk>', to: [job.recipient], reply_to: 'info@breezyeevans.co.uk', subject: job.subject, html: job.html, text: job.text }), signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error('Email provider rejected request');
  const { id } = await response.json();
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
