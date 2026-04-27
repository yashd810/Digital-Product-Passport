"use strict";

const createOauthService = require("../services/oauth-service");

describe("oauth service redirect sanitization", () => {
  test("keeps safe in-app paths", () => {
    expect(createOauthService.normalizeRedirectPath("/dashboard/passports", "/dashboard"))
      .toBe("/dashboard/passports");
  });

  test("falls back for absolute or protocol-relative redirects", () => {
    expect(createOauthService.normalizeRedirectPath("https://evil.example/steal", "/dashboard"))
      .toBe("/dashboard");
    expect(createOauthService.normalizeRedirectPath("//evil.example/steal", "/dashboard"))
      .toBe("/dashboard");
  });
});
