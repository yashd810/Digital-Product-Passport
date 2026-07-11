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

const emailStylesPath = process.env.EMAIL_STYLES_PATH
  || path.resolve(__dirname, "..", "..", "..", "frontend-app", "src", "shared", "styles", "email-styles.css");
const emailStyles = fs.readFileSync(emailStylesPath, "utf8");

const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  "\"": "&quot;",
  "'": "&#39;",
}[char]));

const safeHttpUrl = (value) => {
  try {
    const url = new URL(String(value || ""));
    if (url.protocol !== "https:" && url.protocol !== "http:") return "#";
    return escapeHtml(url.toString());
  } catch {
    return "#";
  }
};

const renderInfoTable = (rows = []) => {
  const content = rows
    .map((row) => ({
      label: String(row?.label ?? "").trim(),
      value: String(row?.value ?? "").trim(),
    }))
    .filter((row) => row.label && row.value);

  if (!content.length) return "";

  return `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;border-collapse:collapse;margin:18px 0;border:1px solid #dbe7e5;border-radius:10px;overflow:hidden">
      <tbody>
        ${content.map((row, index) => {
          const isLast = index === content.length - 1;
          const borderStyle = isLast ? "border-bottom:none;" : "border-bottom:1px solid #e8eeed;";
          return `
            <tr>
              <td style="padding:12px 14px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.7px;color:#0f8a85;background:#f6fbfa;${borderStyle}width:36%;white-space:nowrap;vertical-align:top">${escapeHtml(row.label)}</td>
              <td style="padding:12px 14px;font-size:13px;color:#102124;font-weight:500;${borderStyle}vertical-align:top;word-break:break-word">${escapeHtml(row.value)}</td>
            </tr>`;
        }).join("")}
      </tbody>
    </table>`;
};

const renderContactSubmissionBody = ({
  firstName,
  lastName,
  email,
  company,
  sector,
  serviceInterest,
  deadline,
  howFound,
  message,
}) => `
  ${renderInfoTable([
    { label: "Name", value: `${firstName || ""} ${lastName || ""}`.trim() },
    { label: "Email", value: email },
    { label: "Company", value: company },
    { label: "Sector", value: sector },
    { label: "Service Interest", value: serviceInterest },
    { label: "Compliance Deadline", value: deadline },
    { label: "How Found", value: howFound },
  ])}
  <p><strong>Message:</strong></p>
  <p style="white-space:pre-wrap">${escapeHtml(message)}</p>
`;

const renderContactConfirmationBody = ({ firstName, lastName, email, company, sector, message }) => `
  <p>Hello ${escapeHtml(firstName)},</p>
  <p>Thanks for reaching out. We received your message and will review it shortly.</p>
  ${renderInfoTable([
    { label: "Name", value: `${firstName || ""} ${lastName || ""}`.trim() },
    { label: "Email", value: email },
    { label: "Company", value: company },
    { label: "Sector", value: sector },
  ])}
  <p>If you need to add anything, just reply to this email and we’ll pick it up.</p>
  <p style="white-space:pre-wrap"><strong>Your message:</strong><br>${escapeHtml(message)}</p>
`;

const renderPasswordResetBody = ({ email, resetUrl }) => `
  <p>We received a request to reset the password for <strong>${escapeHtml(email)}</strong>.</p>
  <div class="cta-wrap"><a href="${safeHttpUrl(resetUrl)}" class="cta-btn">🔐 Reset Password →</a></div>
  <p style="font-size:13px;color:#888;text-align:center">If you didn't request this, you can safely ignore this email.</p>
`;

const renderCompanyInvitationBody = ({ inviterName, companyName, inviteeEmail, role, registerUrl }) => `
  <p><strong>${escapeHtml(inviterName)}</strong> has invited you to join <strong>${escapeHtml(companyName)}</strong>.</p>
  ${renderInfoTable([
    { label: "Your Email", value: inviteeEmail },
    { label: "Company", value: companyName },
    { label: "Role", value: role },
  ])}
  <div style="background:#fff9e8;border:1px solid #efd38f;border-radius:8px;padding:12px 14px;margin:16px 0;font-size:13px;color:#7a5a00;line-height:1.6">
    ⏰ This invitation expires in <strong style="color:#5e4300">48 hours</strong> and can only be used <strong style="color:#5e4300">once</strong>.
  </div>
  <div class="cta-wrap"><a href="${safeHttpUrl(registerUrl)}" class="cta-btn">Accept Invitation →</a></div>
`;

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
    <p class="hdr-sub">${escapeHtml(preheader)}</p>
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
        <p>Hello ${escapeHtml(user.firstName || "there")},</p>
        <p>Your one-time verification code is:</p>
        <div style="text-align:center;margin:28px 0">
          <span style="font-size:38px;font-weight:900;letter-spacing:14px;color:#102124;font-family:monospace;background:#f6fbfa;padding:14px 20px;border-radius:10px;border:2px solid #d6e8e6;display:inline-block">${otp}</span>
        </div>
        <p>This code expires in <strong>10 minutes</strong>. Do not share it with anyone.</p>
        <p style="font-size:13px;color:#8BAAAD">If you did not attempt to log in, you can safely ignore this email.</p>
      `,
    }),
  });
};

module.exports = {
  createTransporter,
  brandedEmail,
  sendOtpEmail,
  renderInfoTable,
  renderContactSubmissionBody,
  renderContactConfirmationBody,
  renderPasswordResetBody,
  renderCompanyInvitationBody,
  escapeHtml,
};
