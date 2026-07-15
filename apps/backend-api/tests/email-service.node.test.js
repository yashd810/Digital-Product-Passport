"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

function withEmailEnv(overrides, callback) {
  const keys = ["EMAIL_HOST", "EMAIL_PORT", "EMAIL_SECURE", "EMAIL_USER", "EMAIL_PASS", "EMAIL_FROM"];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  try {
    for (const key of keys) delete process.env[key];
    Object.assign(process.env, overrides);
    return callback();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("email service loads its backend-owned stylesheet outside Docker", () => {
  const stylesheetPath = path.resolve(__dirname, "../src/shared/email/email-styles.css");
  assert.equal(fs.existsSync(stylesheetPath), true);
  assert.match(fs.readFileSync(stylesheetPath, "utf8"), /EMAIL TEMPLATE STYLES/);

  const { brandedEmail } = require("../src/services/email");
  const html = brandedEmail({
    preheader: "Verification <unsafe>",
    bodyHtml: "<p>Ready</p>",
  });

  assert.match(html, /Digital Product Passport/);
  assert.match(html, /<style>[\s\S]+<\/style>/);
  assert.match(html, /<p>Ready<\/p>/);
  assert.match(html, /Verification &lt;unsafe&gt;/);
  assert.doesNotMatch(html, /Verification <unsafe>/);
});

test("email body renderers escape request-derived text and reject unsafe links", () => {
  const {
    renderContactSubmissionBody,
    renderContactConfirmationBody,
    renderPasswordResetBody,
    renderCompanyInvitationBody,
  } = require("../src/services/email");
  const unsafe = "<img src=x onerror=alert(1)>";

  for (const html of [
    renderContactSubmissionBody({ firstName: unsafe, email: unsafe, message: unsafe }),
    renderContactConfirmationBody({ firstName: unsafe, email: unsafe, message: unsafe }),
    renderPasswordResetBody({ email: unsafe, resetUrl: "javascript:alert(1)" }),
    renderCompanyInvitationBody({
      inviterName: unsafe,
      companyName: unsafe,
      inviteeEmail: unsafe,
      role: unsafe,
      registerUrl: "javascript:alert(1)",
    }),
  ]) {
    assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
    assert.doesNotMatch(html, /<img src=x onerror=alert\(1\)>/);
  }
  assert.doesNotMatch(renderPasswordResetBody({ email: "user@example.test", resetUrl: "javascript:alert(1)" }), /javascript:/);
  assert.match(renderCompanyInvitationBody({ registerUrl: "javascript:alert(1)" }), /href="#"/);
});

test("mail delivery has no provider or sender fallbacks", () => {
  const {
    getEmailConfiguration,
    getEmailFromAddress,
    isEmailConfigured,
  } = require("../src/services/email");

  withEmailEnv({}, () => {
    assert.equal(isEmailConfigured(), false);
    assert.throws(() => getEmailConfiguration(), { code: "emailNotConfigured" });
  });

  withEmailEnv({
    EMAIL_HOST: "smtp.example.test",
    EMAIL_PORT: "587",
    EMAIL_SECURE: "false",
    EMAIL_USER: "smtp-user",
    EMAIL_PASS: "smtp-password",
    EMAIL_FROM: "noreply@example.test",
  }, () => {
    assert.equal(isEmailConfigured(), true);
    assert.equal(getEmailFromAddress(), "noreply@example.test");
    assert.deepEqual(getEmailConfiguration(), {
      host: "smtp.example.test",
      port: 587,
      secure: false,
      user: "smtp-user",
      pass: "smtp-password",
      from: "noreply@example.test",
    });
  });
});
