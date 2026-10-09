import { env, HttpError, site } from './core.mjs';
import { createReviewToken } from './review-token.mjs';
export const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));

// A line like "Open the secure review page: https://..." becomes a lead-in
// sentence plus a standalone button, instead of an inline link mid-paragraph.
const URL_RE = /(https?:\/\/\S+)/;

function renderLine(line) {
  const match = URL_RE.exec(line);
  if (!match) {
    const isLabelValue = /^[A-Za-z][\w /&'-]{1,30}:\s/.test(line);
    const [, label, value] = isLabelValue ? line.match(/^([^:]+):\s*(.*)$/) : [null, null, null];
    if (isLabelValue) {
      return `<tr><td style="padding:9px 0;border-bottom:1px solid #eee4fb;font-size:14px"><span style="color:#8a7fa0;display:inline-block;min-width:150px">${escape(label)}</span><span style="color:#241740;font-weight:600">${escape(value)}</span></td></tr>`;
    }
    return `<tr><td style="padding:6px 0;font-size:14px;line-height:1.65;color:#453a5c">${escape(line)}</td></tr>`;
  }
  const lead = line.slice(0, match.index).trim();
  const url = match[1];
  const buttonLabel = /\/payment\b/.test(url) ? 'Complete Payment →' : /admin-booking-review/.test(url) ? 'Review Booking →' : 'Continue →';
  return `${lead ? `<tr><td style="padding:6px 0 2px;font-size:14px;line-height:1.6;color:#453a5c">${escape(lead)}</td></tr>` : ''}<tr><td style="padding:10px 0 4px"><a href="${escape(url)}" style="display:inline-block;background:#5b22b0;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:13px 26px;border-radius:50px">${buttonLabel}</a></td></tr>`;
}

export function template(title, lines) {
  const text = `${title}\n\n${lines.join('\n')}\n\nBreezyee Vans\n+44 7300 331603\ninfo@breezyeevans.co.uk\n${site()}`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)}</title></head>
<body style="margin:0;padding:0;background:#f1eef9;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;color:#241740">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1eef9"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:20px;overflow:hidden;box-shadow:0 8px 28px rgba(45,21,80,.08)">
<tr><td style="height:6px;line-height:6px;font-size:0;background:#5b22b0;background-color:#5b22b0">&nbsp;</td></tr>
<tr><td style="padding:26px 32px 18px">
<img src="${site()}/logo.png" width="132" alt="Breezyee Vans" style="display:block;border:0">
</td></tr>
<tr><td style="padding:32px 32px 8px">
<h1 style="margin:0 0 18px;font-size:21px;line-height:1.35;color:#1a1033">${escape(title)}</h1>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${lines.map(renderLine).join('')}</table>
</td></tr>
<tr><td style="padding:8px 32px 28px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #eee4fb;margin-top:8px"><tr><td style="padding-top:22px;font-size:13px;line-height:1.7;color:#8a7fa0">
Breezyee Vans — self-drive van hire<br>
<a href="tel:+447300331603" style="color:#5b22b0;text-decoration:none;font-weight:600">+44 7300 331603</a> &nbsp;·&nbsp;
<a href="mailto:info@breezyeevans.co.uk" style="color:#5b22b0;text-decoration:none;font-weight:600">info@breezyeevans.co.uk</a><br>
<a href="${site()}" style="color:#8a7fa0;text-decoration:underline">${site().replace(/^https?:\/\//, '')}</a>
</td></tr></table>
</td></tr>
</table>
</td></tr></table>
</body></html>`;
  return { subject: title, html, text };
}
export function submissionEmails(kind, data, reference) {
  const lines = [`Hello ${data.name || 'there'},`, `Reference: ${reference}`, ...(kind === 'booking' ? [`Vehicle: ${data.vehicle_name}`, `Collection date and time: ${data.date} at ${data.time} (UK time)`, `Collection and drop-off: arranged directly with our team after approval`, `Duration: ${data.duration === 'custom' ? 'Custom hire' : data.duration + ' hours'}`, `Estimated rental price: ${data.price}.`, `Estimated booking deposit: ${data.booking_deposit_pence ? `£${(Number(data.booking_deposit_pence) / 100).toFixed(2)}` : 'To be confirmed'}`, 'Status: Awaiting Approval.', 'No payment has been taken. Vehicle availability and the final hire terms will be confirmed by our team.'] : [`Enquiry: ${data.service}`, data.message, 'We have received your enquiry and will reply using the contact details you provided.'])];
  const title = kind === 'booking' ? "We've Received Your Breezyee Vans Booking Request" : 'Your enquiry has been received';
  return [
    { recipient: data.email, ...template(title, lines) },
    { recipient: process.env.ADMIN_NOTIFICATION_EMAIL || 'info@breezyeevans.co.uk', ...template(kind === 'booking' ? 'New Breezyee Vans Booking Request — Review Required' : `New ${kind} request — ${reference}`, kind === 'booking' ? [`Hi Olushola Fadipe,`, `You have received a booking request from ${data.name || 'a customer'}.`, `Booking reference: ${reference}`, `Customer email: ${data.email}`, `Phone: ${data.phone}`, `Open the secure review page to review this request: ${process.env.SITE_URL || 'https://www.breezyeevans.co.uk'}/admin-booking-review.html?reference=${encodeURIComponent(reference)}&token=${encodeURIComponent(createReviewToken(reference))}`, ...lines.slice(2)] : [...lines, `Customer email: ${data.email}`, `Phone: ${data.phone}`]) },
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
  const adminEmail = (process.env.ADMIN_NOTIFICATION_EMAIL || 'info@breezyeevans.co.uk').toLowerCase();
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
