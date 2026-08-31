// Vercel serverless function. Lives at /api/subscribe on your live site.
// Reads its settings from Environment Variables you set in the Vercel dashboard.

const RESEND_KEY   = process.env.RESEND_API_KEY;
const APP_STORE_URL = process.env.APP_STORE_URL || "https://apps.apple.com/app/id0000000000";
const FROM          = process.env.FROM_EMAIL || "iRetina <onboarding@resend.dev>";
const NOTIFY        = process.env.NOTIFY_EMAIL;

async function resend(path, body) {
  const r = await fetch("https://api.resend.com" + path, {
    method: "POST",
    headers: { Authorization: "Bearer " + RESEND_KEY, "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!r.ok) throw new Error("Resend " + r.status + ": " + (await r.text()));
  return r.json();
}

function emailHtml() {
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"><title>Your iRetina download</title></head>
<body style="margin:0;padding:0;background:#F4F4F5;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">One tap installs it from the Mac App Store.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F4F4F5;">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:440px;background:#FFFFFF;border-radius:14px;border:1px solid #E5E5E7;">
<tr><td style="padding:32px 28px 28px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#18181B;">

<p style="margin:0 0 18px;font-size:16px;line-height:1.55;">Thanks for scanning.</p>
<p style="margin:0 0 24px;font-size:16px;line-height:1.55;">iRetina is a <strong>macOS</strong> app, so open this email on your Mac and hit the button:</p>

<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr>
<td align="center" style="border-radius:12px;background:#111113;">
<a href="${APP_STORE_URL}" style="display:block;padding:17px 24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:17px;font-weight:600;color:#FFFFFF;text-decoration:none;border-radius:12px;">Install iRetina for Mac</a>
</td></tr></table>

<p style="margin:22px 0 0;font-size:15px;line-height:1.6;color:#52525B;">It lives in your menu bar and nudges you every 20 minutes: look 20 feet away, for 20 seconds. That's the whole thing. No dashboard, no streaks, no guilt.</p>
<p style="margin:24px 0 0;font-size:15px;line-height:1.6;color:#18181B;">&mdash; The iRetina team<br><span style="color:#71717A;font-size:14px;">Reply to this email if anything breaks. We read every one.</span></p>

<hr style="border:0;border-top:1px solid #E5E5E7;margin:26px 0 20px;">
<p style="margin:0;font-size:14px;line-height:1.6;color:#52525B;"><strong style="color:#18181B;">P.S.</strong> Which building was the poster in? Hit reply and tell us &mdash; we're trying to work out which spots actually work.</p>

</td></tr></table>
<p style="margin:18px 0 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:12px;color:#A1A1AA;">You asked for this link at a poster on campus.</p>
</td></tr></table></body></html>`;
}

function emailText() {
  return [
    "Thanks for scanning.", "",
    "iRetina is a macOS menu bar app, so open this email on your Mac and install it here:",
    APP_STORE_URL, "",
    "It sits in your menu bar and nudges you every 20 minutes: look 20 feet away, for 20 seconds.",
    "", "- The iRetina team (reply if anything breaks - we read every one)", "",
    "P.S. Which building was the poster in? Hit reply and tell us."
  ].join("\n");
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    if (!RESEND_KEY) {
      console.error("RESEND_API_KEY is not set");
      return res.status(500).json({ error: "Mail is not set up yet." });
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const { email, loc, company } = body;

    // Honeypot: bots fill this hidden field, humans can't see it. Pretend it worked.
    if (company) return res.status(200).json({ ok: true });

    const clean = String(email || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(clean) || clean.length > 254) {
      return res.status(400).json({ error: "That email doesn't look right." });
    }

    const poster = String(loc || "unknown").replace(/[^a-z0-9_-]/gi, "").slice(0, 32) || "unknown";

    // 1. The download email. This is the one thing that must not fail quietly.
    await resend("/emails", {
      from: FROM,
      to: [clean],
      subject: "Your iRetina download (open this on your Mac)",
      html: emailHtml(),
      text: emailText(),
      tags: [{ name: "campaign", value: "campus_posters" }, { name: "poster", value: poster }]
    });

    // 2. Ping yourself, so you can watch leads land from your phone.
    if (NOTIFY) {
      resend("/emails", {
        from: FROM,
        to: [NOTIFY],
        subject: "+1 lead · " + poster,
        text: clean + "\nposter: " + poster + "\n" + new Date().toISOString()
      }).catch(e => console.error("notify failed", e));
    }

    console.log(JSON.stringify({ evt: "lead", email: clean, poster }));
    return res.status(200).json({ ok: true });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Couldn't send that. Try again?" });
  }
};
