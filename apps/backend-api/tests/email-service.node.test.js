"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

test("email service loads its shared stylesheet outside Docker", () => {
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
