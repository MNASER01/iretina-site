// Runs when a person sends the form on the Mac page.
// It emails the Mac App Store link, saves the lead, and tells the owner.
// Settings come from the Vercel Environment Variables: RESEND_API_KEY, FROM_EMAIL, NOTIFY_EMAIL, SHEET_WEBHOOK_URL.
import { MAC_URL, IOS_URL, SITE, cleanCampaign, unsubToken, resend, logToSheet } from './_lib.js';

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,185}\.[a-z]{2,24}$/i;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  if (!process.env.RESEND_API_KEY) {
    console.error('RESEND_API_KEY is not set');
    return res.status(500).json({ ok: false, error: 'Mail is not set up yet.' });
  }

  let body = req.body || {};
  if (typeof body === 'string') { try { body = JSON.parse(body || '{}'); } catch { body = {}; } }

  // Honeypot: bots fill this hidden field. People cannot see it. Answer "ok" and do nothing.
  if (body.company) return res.status(200).json({ ok: true });

  const email = String(body.email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 254) {
    return res.status(400).json({ ok: false, error: 'That email does not look right.' });
  }
  const campaign = cleanCampaign(body.campaign || body.loc);
  const from = process.env.FROM_EMAIL || 'iRetina <support@iretina.app>';
  const unsub = `${SITE}/unsubscribe?e=${encodeURIComponent(email)}&t=${unsubToken(email)}`;

  // 1. The download email. This step must not fail silently.
  const sent = await resend('/emails', 'POST', {
    from,
    to: [email],
    subject: 'Your iRetina for Mac link',
    html: emailHtml(unsub),
    text: emailText(unsub),
    headers: { 'List-Unsubscribe': `<${unsub}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
    tags: [{ name: 'campaign', value: campaign }, { name: 'flow', value: 'mac_link' }],
  });
  if (!sent.ok) {
    console.error('send failed', sent.status, JSON.stringify(sent.data));
    return res.status(502).json({ ok: false, error: 'We could not send the email. Try again.' });
  }

  // 2. Save the lead. These steps can fail without an effect on the person.
  const saves = [
    logToSheet(email, campaign),
    resend('/contacts', 'POST', { email, unsubscribed: false }).catch(() => null),
  ];
  if (process.env.NOTIFY_EMAIL) {
    saves.push(resend('/emails', 'POST', {
      from, to: [process.env.NOTIFY_EMAIL],
      subject: 'New Mac lead: ' + campaign,
      text: `${email}\ncampaign: ${campaign}\n${new Date().toISOString()}`,
    }).catch(() => null));
  }
  await Promise.allSettled(saves);

  console.log(JSON.stringify({ evt: 'lead', campaign, at: new Date().toISOString() }));
  return res.status(200).json({ ok: true });
}

function emailText(unsub) {
  return [
    'Here is your iRetina for Mac link.',
    '',
    'Open this email on your Mac. Then open this link:',
    MAC_URL,
    '',
    'iRetina gives your eyes a calm 20-second break every 20 minutes.',
    '7-day free trial, then $4.99/month or $49.99/year. Requires macOS 15.5 or later.',
    '',
    'On iPhone too: ' + IOS_URL,
    '',
    'Questions? Reply to this email.',
    '',
    'You get this email because you asked for the link at iRetina.app. We also send iRetina tips now and then.',
    'Unsubscribe: ' + unsub,
  ].join('\n');
}

function emailHtml(unsub) {
  const font = "-apple-system,BlinkMacSystemFont,'SF Pro Display','Helvetica Neue',Helvetica,Arial,sans-serif";
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark"><title>Your iRetina for Mac link</title></head>
<body style="margin:0;padding:0;background:#000000;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">Open this email on your Mac. One button installs iRetina.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#000000;">
<tr><td align="center" style="padding:36px 16px 44px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;font-family:${font};color:#f5f5f7;">
<tr><td style="padding:0 4px 26px;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
  <td style="padding-right:10px;"><img src="https://iretina.app/assets/v2/logo-128.png" width="30" height="30" alt="" style="display:block;border:0;"></td>
  <td style="font-family:${font};font-size:19px;font-weight:600;letter-spacing:-0.3px;color:#f5f5f7;">iRetina</td>
  </tr></table>
</td></tr>
<tr><td style="background:#111113;border:1px solid #232326;border-radius:22px;padding:34px 30px 32px;">
  <p style="margin:0 0 12px;font-family:${font};font-size:30px;line-height:1.1;font-weight:600;letter-spacing:-0.9px;color:#ffffff;">Here is your Mac link.</p>
  <p style="margin:0 0 26px;font-family:${font};font-size:17px;line-height:1.5;color:#a1a1a6;">Open this email on your Mac. Then press the button.</p>
  <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
  <td align="center" bgcolor="#0a7cff" style="border-radius:999px;background:#0a7cff;">
    <a href="${MAC_URL}" style="display:inline-block;padding:14px 26px;font-family:${font};font-size:16px;font-weight:500;color:#ffffff;text-decoration:none;border-radius:999px;">Get iRetina for Mac</a>
  </td></tr></table>
  <p style="margin:28px 0 0;padding-top:22px;border-top:1px solid #232326;font-family:${font};font-size:15px;line-height:1.55;color:#a1a1a6;">Every 20 minutes, iRetina gives your eyes a calm 20-second break. Look about 20 feet away until the countdown ends.</p>
  <p style="margin:12px 0 0;font-family:${font};font-size:15px;line-height:1.55;color:#a1a1a6;">7-day free trial, then $4.99/month or $49.99/year. Requires macOS 15.5 or later.</p>
  <p style="margin:12px 0 0;font-family:${font};font-size:15px;line-height:1.55;color:#a1a1a6;">On iPhone too: <a href="${IOS_URL}" style="color:#3b9bff;text-decoration:none;">get the iPhone app</a>.</p>
</td></tr>
<tr><td style="padding:22px 6px 0;font-family:${font};font-size:12px;line-height:1.6;color:#6e6e73;">
  Questions? Reply to this email.<br>
  You get this email because you asked for the link at iRetina.app. We also send iRetina tips now and then.
  <a href="${unsub}" style="color:#a1a1a6;">Unsubscribe</a>
</td></tr>
</table>
</td></tr></table>
</body></html>`;
}
