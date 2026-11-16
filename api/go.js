// Records QR scans and link clicks.
//   /college/ios          -> saves a scan, then sends the phone to the iPhone App Store page.
//   page load (beacon)    -> the email page calls /api/go?p=mac&beacon=1 and this saves the scan only.
//   /r/mac                -> saves a click on "Get iRetina for Mac", then opens the Mac App Store page.
import { IOS_URL, MAC_URL, cleanCampaign } from './_lib.js';
import { track, isBot } from './_db.js';

export default async function handler(req, res) {
  const p = String(req.query.p || 'ios');
  const campaign = cleanCampaign(req.query.c);
  const bot = isBot(req);
  res.setHeader('Cache-Control', 'no-store');

  if (p === 'macstore') {
    const source = req.query.s === 'email' ? 'email' : 'page';
    if (!bot) await track(req, { type: 'click', platform: 'mac', campaign, source });
    return res.redirect(302, MAC_URL);
  }

  const platform = p === 'mac' || p === 'windows' ? p : 'ios';
  if (!bot) {
    console.log(JSON.stringify({ evt: 'scan', platform, campaign, at: new Date().toISOString() }));
    // Scans go to the database only. The old Google Sheet link is slow, and a scan must redirect fast.
    await track(req, { type: 'scan', platform, campaign });
  }
  if (platform !== 'ios') return res.status(204).end();
  return res.redirect(302, IOS_URL);
}
