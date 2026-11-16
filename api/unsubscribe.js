// Unsubscribe link from the email. It marks the contact in Resend, adds a row to the sheet, and tells the owner.
import { unsubToken, resend, logToSheet } from './_lib.js';
import { waitUntil } from '@vercel/functions';
import { track } from './_db.js';

export default async function handler(req, res) {
  const email = String(req.query.e || '').trim().toLowerCase();
  const token = String(req.query.t || '');
  const valid = Boolean(email && token && token === unsubToken(email));
  // Mail apps open links to check them. So a plain visit only shows a button. The button (a POST) does the change.
  const confirmed = req.method === 'POST';

  if (valid && confirmed) {
    await resend(`/contacts/${encodeURIComponent(email)}`, 'PATCH', { unsubscribed: true }).catch(() => null);
    await track(req, { type: 'unsub', platform: 'mac', campaign: 'unsubscribe', email });
    waitUntil(logToSheet(email, 'UNSUBSCRIBED'));
    if (process.env.NOTIFY_EMAIL && process.env.FROM_EMAIL) {
      await resend('/emails', 'POST', {
        from: process.env.FROM_EMAIL, to: [process.env.NOTIFY_EMAIL],
        subject: 'Unsubscribe: remove this address', text: email + '\n' + new Date().toISOString(),
      }).catch(() => null);
    }
  }
  console.log(JSON.stringify({ evt: 'unsubscribe', valid, confirmed, at: new Date().toISOString() }));

  const title = !valid ? 'This link is not valid.' : confirmed ? 'You are unsubscribed.' : 'Stop iRetina emails?';
  const text = !valid ? 'Reply to an iRetina email and we will remove you.' : confirmed ? 'We will not send you more emails.' : 'Press the button to unsubscribe.';
  const button = valid && !confirmed
    ? '<form method="post" style="margin:26px 0 0;"><button type="submit" style="height:50px;padding:0 26px;border:0;border-radius:999px;background:#0a7cff;color:#fff;font:500 16px -apple-system,BlinkMacSystemFont,Helvetica,Arial,sans-serif;cursor:pointer;">Unsubscribe</button></form>'
    : '';

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.status(valid ? 200 : 400).send(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>iRetina</title>
<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#000;color:#f5f5f7;font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display','Helvetica Neue',Inter,system-ui,sans-serif;text-align:center;padding:24px;">
<div><h1 style="font-size:28px;font-weight:600;letter-spacing:-0.03em;margin:0 0 10px;">${title}</h1>
<p style="color:#a1a1a6;font-size:17px;margin:0;">${text}</p>${button}</div></body></html>`);
}
