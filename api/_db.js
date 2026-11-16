// Database helpers. All events (scans, emails, clicks) go to one table in the Neon Postgres database.
// The database link comes from the Vercel setting DATABASE_URL. Vercel added it when the database was connected.
import crypto from 'node:crypto';
import { neon } from '@neondatabase/serverless';

let sql = null;      // the database client, made on first use
let ready = null;    // a promise that ends when the table exists

export function db() {
  if (!process.env.DATABASE_URL) return null;
  if (!sql) sql = neon(process.env.DATABASE_URL);
  return sql;
}

// Makes the table one time for each server start. It is safe to run again.
async function ensureTable() {
  const q = db();
  if (!q) return false;
  if (!ready) {
    ready = (async () => {
      await q`CREATE TABLE IF NOT EXISTS events (
        id        BIGSERIAL PRIMARY KEY,
        at        TIMESTAMPTZ NOT NULL DEFAULT now(),
        type      TEXT NOT NULL,   -- scan, lead, waitlist, click, unsub
        platform  TEXT NOT NULL,   -- ios, mac, windows
        campaign  TEXT NOT NULL,   -- first part of the QR link, for example "college"
        device    TEXT NOT NULL,   -- iphone, android, mac, windows, other
        source    TEXT,            -- for clicks: "email" or "page"
        email     TEXT,            -- only for lead, waitlist and unsub
        visitor   TEXT             -- a one-day hash, to count different people. It is not an IP address.
      )`;
      await q`CREATE INDEX IF NOT EXISTS events_at_idx ON events (at)`;
    })().catch((e) => { ready = null; throw e; });
  }
  await ready;
  return true;
}

const BOT = /bot|crawl|spider|preview|facebookexternalhit|slurp|monitor|headless|scanner|curl|wget|python|vercel/i;

export function isBot(req) {
  return BOT.test(String(req.headers['user-agent'] || ''));
}

export function deviceOf(req) {
  const ua = String(req.headers['user-agent'] || '');
  if (/iPhone|iPod/.test(ua)) return 'iphone';
  if (/Android/.test(ua)) return 'android';
  if (/iPad|Macintosh/.test(ua)) return 'mac';
  if (/Windows/.test(ua)) return 'windows';
  return 'other';
}

// One-day hash of the network address and browser. The same person on the same day gets the same value.
// The hash changes each day and cannot be turned back into an IP address.
function visitorOf(req) {
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const ua = String(req.headers['user-agent'] || '');
  const day = new Date().toISOString().slice(0, 10);
  const salt = crypto.createHash('sha256').update('visitor:' + (process.env.RESEND_API_KEY || '')).digest('hex');
  return crypto.createHash('sha256').update([ip, ua, day, salt].join('|')).digest('hex').slice(0, 16);
}

// Saves one event. It never throws: a storage problem must not break a scan or an email.
export async function track(req, { type, platform, campaign, source = null, email = null }) {
  try {
    if (!(await ensureTable())) return false;
    await db()`INSERT INTO events (type, platform, campaign, device, source, email, visitor)
               VALUES (${type}, ${platform}, ${campaign}, ${deviceOf(req)}, ${source}, ${email}, ${visitorOf(req)})`;
    return true;
  } catch (e) {
    console.error('track failed', String(e));
    return false;
  }
}

export async function readEvents(days) {
  if (!(await ensureTable())) return null;
  const q = db();
  const since = days > 0 ? new Date(Date.now() - days * 86400000).toISOString() : '1970-01-01T00:00:00Z';
  const events = await q`SELECT at, type, platform, campaign, device, source, visitor
                         FROM events WHERE at >= ${since} ORDER BY at DESC LIMIT 50000`;
  const people = await q`SELECT at, type, platform, campaign, email
                         FROM events WHERE email IS NOT NULL ORDER BY at DESC LIMIT 20000`;
  return { events, people };
}
