"use strict";

/**
 * Email transport, branded email template, and OTP email sender.
 *
 * Usage:
 *   const { createTransporter, brandedEmail, sendOtpEmail } = require("./services/email");
 */

const nodemailer = require("nodemailer");
const fs         = require("fs");
const path       = require("path");

const emailStyles = fs.readFileSync(path.join(__dirname, "..", "..", "src", "email-styles.css"), "utf8");

const createTransporter = () => nodemailer.createTransport({
  host:   process.env.EMAIL_HOST   || "smtp.sendgrid.net",
  port:   parseInt(process.env.EMAIL_PORT || "587"),
  secure: process.env.EMAIL_SECURE === "true" || false,
  auth:   { user: process.env.EMAIL_USER || "apikey", pass: process.env.EMAIL_PASS },
});

const brandedEmail = ({ preheader, bodyHtml }) => `
<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>${emailStyles}</style></head><body>
<div class="wrapper">
  <div class="hdr">
    <div class="hdr-logo">🌍</div>
    <h1 class="hdr-title">Digital Product Passport</h1>
    <p class="hdr-sub">${preheader}</p>
  </div>
  <div class="body">${bodyHtml}</div>
  <div class="footer">
    <p>© ${new Date().getFullYear()} Digital Product Passport System. All rights reserved.</p>
    <p>You received this because you are part of a DPP workflow.</p>
  </div>
</div></body></html>`;

const sendOtpEmail = async (user, otp) => {
  const transporter = createTransporter();
  await transporter.sendMail({
    from: process.env.EMAIL_FROM || "noreply@dpp-system.com",
    to: user.email,
    subject: "Your verification code — Digital Product Passport",
    html: brandedEmail({
      preheader: "Two-factor authentication code",
      bodyHtml: `
        <p>Hello ${user.first_name || "there"},</p>
        <p>Your one-time verification code is:</p>
        <div style="text-align:center;margin:28px 0">
          <span style="font-size:38px;font-weight:900;letter-spacing:14px;color:#1C3738;font-family:monospace;background:#F4FFF8;padding:14px 20px;border-radius:10px;border:2px solid #d0e4e0;display:inline-block">${otp}</span>
        </div>
        <p>This code expires in <strong>10 minutes</strong>. Do not share it with anyone.</p>
        <p style="font-size:13px;color:#8BAAAD">If you did not attempt to log in, you can safely ignore this email.</p>
      `,
    }),
  });
};

module.exports = { createTransporter, brandedEmail, sendOtpEmail };
