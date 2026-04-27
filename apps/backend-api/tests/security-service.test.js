"use strict";

const {
  validatePasswordPolicy,
  hashOtpCode,
  generateOtpCode,
} = require("../services/security-service");

describe("security service", () => {
  test("rejects weak passwords that miss required character classes", () => {
    expect(validatePasswordPolicy("alllowercase123!")).toMatch(/uppercase/i);
    expect(validatePasswordPolicy("ALLUPPERCASE123!")).toMatch(/lowercase/i);
    expect(validatePasswordPolicy("NoNumbers!!!")).toMatch(/number/i);
    expect(validatePasswordPolicy("NoSymbols123")).toMatch(/symbol/i);
  });

  test("accepts stronger passwords", () => {
    expect(validatePasswordPolicy("StrongPassword123!")).toBeNull();
  });

  test("hashOtpCode is deterministic and hex encoded", () => {
    const first = hashOtpCode("123456");
    const second = hashOtpCode("123456");
    expect(first).toBe(second);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
  });

  test("generateOtpCode returns a zero-padded 6 digit code", () => {
    const code = generateOtpCode();
    expect(code).toMatch(/^\d{6}$/);
  });
});
