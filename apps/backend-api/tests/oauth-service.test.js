"use strict";

const createOauthService = require("../services/oauth-service");

describe("oauth service redirect sanitization", () => {
  test("keeps safe in-app paths", () => {
    expect(createOauthService.normalizeRedirectPath("/dashboard/acme/passports", "/"))
      .toBe("/dashboard/acme/passports");
  });

  test("falls back for absolute or protocol-relative redirects", () => {
    expect(createOauthService.normalizeRedirectPath("https://evil.example/steal", "/dashboard/acme/overview"))
      .toBe("/dashboard/acme/overview");
    expect(createOauthService.normalizeRedirectPath("//evil.example/steal", "/dashboard/acme/overview"))
      .toBe("/dashboard/acme/overview");
  });
});
