"use strict";
require("dotenv").config();

const express    = require("express");
const nodemailer = require("nodemailer");

const app  = express();
const PORT = process.env.CONTACT_PORT || 3002;
app.disable("x-powered-by");
app.set("trust proxy", 1);

// ─── CORS ────────────────────────────────────────────────────────────────────
// Manual handler so preflight always gets the right headers.
// "null" origin = file:// in browser; falsy origin = server-to-server.
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "http://localhost:3000")
  .split(",").map(s => s.trim()).filter(Boolean);
const allowedOriginSet = new Set(allowedOrigins);

app.use((req, res, next) => {
  const origin  = req.headers.origin;
  const allowed = !origin || origin === "null" || allowedOriginSet.has(origin);

  if (allowed) {
    // Echo back the origin (or * for no-origin requests) so the browser accepts it
    res.setHeader("Access-Control-Allow-Origin",  origin || "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept");
  }

  // Respond to preflight immediately
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  next();
});

app.use(express.json({ limit: "25kb" }));

// ─── SMTP ────────────────────────────────────────────────────────────────────
const createTransporter = () => nodemailer.createTransport({
  host:   process.env.EMAIL_HOST || "smtp.gmail.com",
  port:   parseInt(process.env.EMAIL_PORT || "587"),
  secure: process.env.EMAIL_SECURE === "true",
  auth:   { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
});

// ─── RATE LIMITER ─────────────────────────────────────────────────────────────
// Max 5 submissions per IP per hour (in-memory — resets on restart, fine for this use case).
const rateMap = new Map();
function checkRate(ip) {
  const now = Date.now();
  const e   = rateMap.get(ip);
  if (!e || e.resetAt < now) { rateMap.set(ip, { count: 1, resetAt: now + 3_600_000 }); return true; }
  if (e.count >= 5) return false;
  e.count++;
  return true;
}

// ─── EMAIL TEMPLATES ─────────────────────────────────────────────────────────
function notificationEmail({ fullName, email, company, sector, service_interest, deadline, message, how_found, submittedAt }) {
  const row = (label, value) => value
    ? `<tr><td class="tlbl">${label}</td><td class="tval">${value}</td></tr>`
    : "";
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body{margin:0;padding:0;background:#07131f;font-family:Arial,Helvetica,sans-serif}
  .wrap{max-width:620px;margin:32px auto;border-radius:18px;overflow:hidden;border:1px solid rgba(13,181,176,.2);box-shadow:0 12px 42px rgba(0,0,0,.5)}
  .hdr{background:linear-gradient(135deg,#0e2234 0%,#07131f 100%);padding:30px 40px;text-align:center;border-bottom:1px solid rgba(13,181,176,.2)}
  .hdr-tag{font-size:11px;font-weight:700;letter-spacing:2.5px;text-transform:uppercase;color:#0db5b0;margin-bottom:7px}
  .hdr-title{color:#f0f6fa;font-size:21px;font-weight:700;margin:0}
  .hdr-sub{color:rgba(240,246,250,.55);font-size:12px;margin:5px 0 0}
  .body{background:#102132;padding:32px 40px}
  .body p{font-size:14px;color:#b8ccd9;line-height:1.75;margin:0 0 16px}
  .tbl{width:100%;border-collapse:collapse;margin:18px 0;border:1px solid rgba(13,181,176,.15);border-radius:10px;overflow:hidden}
  .tbl td{padding:10px 14px;font-size:13px;border-bottom:1px solid rgba(255,255,255,.05)}
  .tbl tr:last-child td{border-bottom:none}
  .tlbl{color:#0db5b0;font-weight:700;text-transform:uppercase;letter-spacing:.7px;font-size:11px;width:36%;white-space:nowrap;background:rgba(13,181,176,.06)}
  .tval{color:#f0f6fa;font-weight:500}
  .msg-lbl{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1.2px;color:#0db5b0;margin-bottom:8px}
  .msg-box{background:rgba(13,181,176,.07);border:1px solid rgba(13,181,176,.2);border-radius:10px;padding:16px;font-size:13px;color:#b8ccd9;line-height:1.8;white-space:pre-wrap;word-break:break-word}
  .cta{text-align:center;margin:28px 0 8px}
  .cta a{display:inline-block;background:linear-gradient(135deg,#14b8a6 0%,#0f766e 100%);color:#06131d!important;text-decoration:none;padding:13px 30px;border-radius:50px;font-size:14px;font-weight:700;box-shadow:0 10px 24px rgba(13,181,176,.22)}
  .foot{background:#07131f;padding:16px 40px;text-align:center;border-top:1px solid rgba(255,255,255,.06)}
  .foot p{font-size:11px;color:#7a94a8;margin:3px 0}
</style></head><body>
<div class="wrap">
  <div class="hdr">
    <div class="hdr-tag">ClarosDPP</div>
    <h1 class="hdr-title">New Website Enquiry</h1>
    <p class="hdr-sub">Submitted ${submittedAt}</p>
  </div>
  <div class="body">
    <p>A new enquiry has arrived via the ClarosDPP website contact form.</p>
    <table class="tbl">
      ${row("Name",             fullName)}
      <tr><td class="tlbl">Email</td><td class="tval"><a href="mailto:${email}" style="color:#0db5b0">${email}</a></td></tr>
      ${row("Company",          company)}
      ${row("Sector",           sector)}
      ${row("Service Interest", service_interest)}
      ${row("Deadline",         deadline)}
      ${row("Found Via",        how_found)}
    </table>
    <p class="msg-lbl">Message</p>
    <div class="msg-box">${message.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}</div>
    <div class="cta">
      <a href="mailto:${email}?subject=Re: Your ClarosDPP enquiry">Reply to ${fullName} →</a>
    </div>
  </div>
  <div class="foot">
    <p>© ${new Date().getFullYear()} ClarosDPP</p>
    <p>Submitted via the ClarosDPP marketing website contact form</p>
  </div>
</div></body></html>`;
}

function confirmationEmail({ firstName }) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body{margin:0;padding:0;background:#07131f;font-family:Arial,Helvetica,sans-serif}
  .wrap{max-width:600px;margin:32px auto;border-radius:18px;overflow:hidden;border:1px solid rgba(13,181,176,.2);box-shadow:0 12px 42px rgba(0,0,0,.45)}
  .hdr{background:linear-gradient(135deg,#0e2234 0%,#07131f 100%);padding:30px 40px;text-align:center;border-bottom:1px solid rgba(13,181,176,.2)}
  .hdr-tag{font-size:11px;font-weight:700;letter-spacing:2.5px;text-transform:uppercase;color:#0db5b0;margin-bottom:7px}
  .hdr-title{color:#f0f6fa;font-size:21px;font-weight:700;margin:0}
  .body{background:#102132;padding:32px 40px}
  .body p{font-size:14px;color:#b8ccd9;line-height:1.8;margin:0 0 14px}
  .body h2{color:#f0f6fa;font-size:17px;font-weight:700;margin:0 0 14px}
  .steps{padding:0;margin:18px 0}
  .steps li{font-size:13px;color:#b8ccd9;padding:9px 0;border-bottom:1px solid rgba(255,255,255,.05);list-style:none;display:flex;align-items:flex-start;gap:10px}
  .steps li:last-child{border-bottom:none}
  .tick{color:#0db5b0;font-weight:700;flex-shrink:0;margin-top:1px}
  .foot{background:#07131f;padding:16px 40px;text-align:center;border-top:1px solid rgba(255,255,255,.06)}
  .foot p{font-size:11px;color:#7a94a8;margin:3px 0}
</style></head><body>
<div class="wrap">
  <div class="hdr">
    <div class="hdr-tag">ClarosDPP</div>
    <h1 class="hdr-title">Message received — thank you</h1>
  </div>
  <div class="body">
    <h2>Hi ${firstName},</h2>
    <p>Thanks for reaching out to ClarosDPP. We've received your enquiry and a member of our team will be in touch within 1 business day.</p>
    <p>Here's what happens next:</p>
    <ul class="steps">
      <li><span class="tick">✓</span>A compliance specialist reviews your enquiry</li>
      <li><span class="tick">✓</span>We'll schedule your free 45-minute consultation at a time that suits you</li>
      <li><span class="tick">✓</span>We'll assess your regulatory exposure and outline a practical compliance path — no commitment required</li>
    </ul>
    <p style="font-size:13px;color:#7a94a8">Have an urgent question? Just reply to this email.</p>
  </div>
  <div class="foot">
    <p>© ${new Date().getFullYear()} ClarosDPP. Compliance intelligence for the circular economy.</p>
    <p>You received this because you submitted an enquiry at clarosdpp.com.</p>
  </div>
</div></body></html>`;
}

// ─── ROUTE ───────────────────────────────────────────────────────────────────
app.post("/api/contact", async (req, res) => {
  try {
    const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim()
               || req.socket.remoteAddress
               || "anon";

    if (!checkRate(ip))
      return res.status(429).json({ error: "Too many submissions. Please try again in an hour." });

    const {
      first_name, last_name, email,
      company = "", sector = "", service_interest = "",
      deadline = "", message, how_found = "",
    } = req.body;

    if (!first_name?.trim() || !last_name?.trim() || !email?.trim() || !message?.trim())
      return res.status(400).json({ error: "Required fields missing." });

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))
      return res.status(400).json({ error: "Invalid email address." });

    const adminEmail  = process.env.ADMIN_EMAIL || process.env.EMAIL_FROM;
    const fullName    = `${first_name.trim()} ${last_name.trim()}`;
    const submittedAt = new Date().toLocaleString("en-GB", {
      timeZone: "UTC", dateStyle: "medium", timeStyle: "short",
    }) + " UTC";
    const transporter = createTransporter();

    // Notification → admin
    await transporter.sendMail({
      from:    process.env.EMAIL_FROM,
      to:      adminEmail,
      replyTo: email.trim(),
      subject: `New ClarosDPP enquiry — ${fullName}${company ? " (" + company.trim() + ")" : ""}`,
      html:    notificationEmail({
        fullName, email: email.trim(), company: company.trim(),
        sector, service_interest, deadline,
        message: message.trim(), how_found, submittedAt,
      }),
    });

    // Confirmation → enquirer (best-effort)
    try {
      await transporter.sendMail({
        from:    process.env.EMAIL_FROM,
        to:      email.trim(),
        subject: "We received your message — ClarosDPP",
        html:    confirmationEmail({ firstName: first_name.trim() }),
      });
    } catch (e) {
      console.warn("[contact-server] Confirmation email skipped:", e.message);
    }

    res.json({ ok: true });
  } catch (err) {
    console.error("[contact-server] Error:", err.message);
    res.status(500).json({ error: "Failed to send. Please try again or email us directly." });
  }
});

// ─── START ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => console.log(`[contact-server] listening on port ${PORT}`));
