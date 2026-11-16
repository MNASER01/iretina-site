// Records one QR scan.
//   /college/ios  -> records the scan, then sends the phone to the App Store.
//   Mac page load -> the page calls /api/go?p=mac&c=college&beacon=1 and this records the scan only.
import { IOS_URL, cleanCampaign, logToSheet } from './_lib.js';

const BOT = /bot|crawl|spider|preview|facebookexternalhit|slurp|monitor|headless/i;

export default async function handler(req, res) {
  const platform = req.query.p === 'mac' ? 'mac' : 'ios';
  const campaign = cleanCampaign(req.query.c);
  const isBot = BOT.test(String(req.headers['user-agent'] || ''));
  res.setHeader('Cache-Control', 'no-store');

  if (!isBot) {
    console.log(JSON.stringify({ evt: 'scan', platform, campaign, at: new Date().toISOString() }));
    await logToSheet('[scan]', `${campaign}/${platform}`);
  }
  if (platform === 'mac') return res.status(204).end();
  return res.redirect(302, IOS_URL);
}
