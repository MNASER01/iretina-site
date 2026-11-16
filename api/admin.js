// The private admin API for the metrics page at /admin.
//
// Sign-in has no password. An admin types their email, and the system emails a sign-in link.
// Only addresses in the Vercel settings NOTIFY_EMAIL, ADMIN_EMAILS and ADMIN_EMAILS_2 are admins.
//
//   POST /api/admin?action=login   { email }  -> emails a sign-in link, if the address is an admin
//   GET  /api/admin?action=verify&t=...       -> checks the link, sets the session cookie, opens /admin
//   GET  /api/admin?action=data&days=30       -> the numbers (needs the session cookie)
//   POST /api/admin?action=logout             -> removes the session cookie
import crypto from 'node:crypto';
import { SITE, resend } from './_lib.js';
import { readEvents } from './_db.js';

const COOKIE = '__Host-iretina-admin';
const LINK_MINUTES = 15;
const SESSION_DAYS = 30;

// The admin list: NOTIFY_EMAIL, plus all settings whose name starts with ADMIN_EMAILS
// (for example ADMIN_EMAILS and ADMIN_EMAILS_2). Each setting can hold more than one address, with commas.
function admins() {
  const lists = Object.keys(process.env).filter((k) => k.startsWith('ADMIN_EMAILS')).map((k) => process.env[k]);
  return [process.env.NOTIFY_EMAIL, ...lists.join(',').split(',')]
    .map((e) => String(e || '').trim().toLowerCase())
    .filter(Boolean);
}

// The signing key comes from the Resend key, so no extra secret setting is needed.
function key() {
  return crypto.createHash('sha256').update('admin:' + (process.env.RESEND_API_KEY || '')).digest();
}

// A token is "<data>.<signature>". The data holds the email, the kind ("link" or "session") and the end time.
function sign(email, kind, minutes) {
  const data = Buffer.from(JSON.stringify({ e: email, k: kind, x: Date.now() + minutes * 60000 })).toString('base64url');
  const mac = crypto.createHmac('sha256', key()).update(data).digest('base64url');
  return data + '.' + mac;
}

function verify(token, kind) {
  const [data, mac] = String(token || '').split('.');
  if (!data || !mac) return null;
  const good = crypto.createHmac('sha256', key()).update(data).digest('base64url');
  const a = Buffer.from(mac), b = Buffer.from(good);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let body;
  try { body = JSON.parse(Buffer.from(data, 'base64url').toString()); } catch { return null; }
  if (body.k !== kind || !(body.x > Date.now())) return null;
  if (!admins().includes(body.e)) return null; // an address removed from the settings loses access at once
  return body.e;
}

function sessionEmail(req) {
  const m = String(req.headers.cookie || '').match(new RegExp('(?:^|;\\s*)' + COOKIE + '=([^;]+)'));
  return m ? verify(m[1], 'session') : null;
}

// A small limit on sign-in emails: one each 30 seconds for each address, for each running server.
const lastSent = new Map();

export default async function handler(req, res) {
  const action = String(req.query.action || '');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex');

  if (action === 'login' && req.method === 'POST') {
    let body = req.body || {};
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
    const email = String(body.email || '').trim().toLowerCase();
    const recent = Date.now() - (lastSent.get(email) || 0) < 30000;
    if (admins().includes(email) && !recent && process.env.RESEND_API_KEY) {
      lastSent.set(email, Date.now());
      const link = `${SITE}/api/admin?action=verify&t=${encodeURIComponent(sign(email, 'link', LINK_MINUTES))}`;
      const sent = await resend('/emails', 'POST', {
        from: process.env.FROM_EMAIL || 'iRetina <support@iretina.app>',
        to: [email],
        subject: 'Your iRetina admin sign-in link',
        text: `Open this link to sign in to the iRetina metrics page:\n\n${link}\n\nThe link works for ${LINK_MINUTES} minutes. If you did not ask for it, ignore this email.`,
      });
      if (!sent.ok) console.error('admin link send failed', sent.status);
    }
    // The answer is the same for all addresses, so a stranger cannot find out who is an admin.
    return res.status(200).json({ ok: true });
  }

  if (action === 'verify') {
    const email = verify(req.query.t, 'link');
    if (!email) return res.redirect(302, '/admin?link=expired');
    res.setHeader('Set-Cookie', `${COOKIE}=${sign(email, 'session', SESSION_DAYS * 1440)}; Path=/; Max-Age=${SESSION_DAYS * 86400}; HttpOnly; Secure; SameSite=Lax`);
    return res.redirect(302, '/admin');
  }

  if (action === 'logout' && req.method === 'POST') {
    res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`);
    return res.status(200).json({ ok: true });
  }

  if (action === 'data') {
    const email = sessionEmail(req);
    if (!email) return res.status(401).json({ ok: false, error: 'Sign in first.' });
    const days = Math.max(0, Math.min(3650, parseInt(req.query.days, 10) || 0));
    try {
      const data = await readEvents(days);
      if (!data) return res.status(503).json({ ok: false, error: 'The database is not connected.' });
      return res.status(200).json({ ok: true, admin: email, now: new Date().toISOString(), ...data });
    } catch (e) {
      console.error('admin data failed', String(e));
      return res.status(500).json({ ok: false, error: 'The database did not answer. Try again.' });
    }
  }

  return res.status(404).json({ ok: false, error: 'Not found' });
}
