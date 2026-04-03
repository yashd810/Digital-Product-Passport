"use strict";
require("dotenv").config();

const express    = require("express");
const nodemailer = require("nodemailer");
const fs         = require("fs");
const path       = require("path");

const emailStyles = fs.readFileSync(path.join(__dirname, "../src/email-styles.css"), "utf8");

const app  = express();
const PORT = process.env.CONTACT_PORT || 3002;
app.disable("x-powered-by");
app.set("trust proxy", 1);

// ─── CORS ────────────────────────────────────────────────────────────────────
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
<style>${emailStyles}</style></head><body>
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
<style>${emailStyles}</style></head><body>
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
