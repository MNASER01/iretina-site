// Shared helpers for the API functions. Files that start with "_" are not public routes.
import crypto from 'node:crypto';

export const IOS_URL = 'https://apps.apple.com/us/app/iretina-eye-care/id6804286243';
export const MAC_URL = 'https://apps.apple.com/us/app/iretina-pro/id6781700588?mt=12';
export const SITE = 'https://go.iretina.app';

// A campaign name is the first part of the QR link, for example "college" in /college/ios.
// Only letters, digits, "-" and "_" are allowed. Anything else becomes "unknown".
export function cleanCampaign(value) {
  const v = String(value || '').toLowerCase();
  return /^[a-z0-9_-]{1,32}$/.test(v) ? v : 'unknown';
}

// Signed token for the unsubscribe link. Only the person who got the email has it.
// The signing key comes from the Resend key, so no extra setting is needed.
export function unsubToken(email) {
  const key = crypto.createHash('sha256').update('unsubscribe:' + (process.env.RESEND_API_KEY || '')).digest();
  return crypto.createHmac('sha256', key).update(String(email).toLowerCase()).digest('hex').slice(0, 32);
}

export async function resend(path, method, body) {
  const r = await fetch('https://api.resend.com' + path, {
    method,
    headers: { Authorization: 'Bearer ' + process.env.RESEND_API_KEY, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await r.json(); } catch { /* empty body */ }
  return { ok: r.ok, status: r.status, data };
}

// Adds one row to the Google Sheet, when the webhook is set. It never throws.
export async function logToSheet(email, poster) {
  if (!process.env.SHEET_WEBHOOK_URL) return;
  try {
    await fetch(process.env.SHEET_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, poster }),
      signal: AbortSignal.timeout(4000),
    });
  } catch (e) {
    console.error('sheet log failed', String(e));
  }
}
