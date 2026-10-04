import { createHmac, timingSafeEqual } from 'node:crypto';

const secret = () => process.env.ADMIN_REVIEW_SECRET || process.env.CRON_SECRET || process.env.ADMIN_APPROVAL_CODE || '';
export function createReviewToken(reference, ttlSeconds = 7 * 24 * 60 * 60) {
  const payload = Buffer.from(JSON.stringify({ reference, exp: Math.floor(Date.now() / 1000) + ttlSeconds })).toString('base64url');
  const signature = createHmac('sha256', secret()).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}
export function verifyReviewToken(token, reference) {
  try {
    const [payload, signature] = String(token || '').split('.');
    if (!payload || !signature || !secret()) return false;
    const expected = createHmac('sha256', secret()).update(payload).digest();
    const supplied = Buffer.from(signature, 'base64url');
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return false;
    const value = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return value.reference === reference && Number(value.exp) > Math.floor(Date.now() / 1000);
  } catch { return false; }
}
