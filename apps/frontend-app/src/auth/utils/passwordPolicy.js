export const passwordMinLength = 12;

const commonWeakPasswords = new Set([
  "password",
  "password123",
  "12345678",
  "123456789",
  "1234567890",
  "qwerty123",
  "welcome123",
  "admin123",
  "letmein123",
]);

export function validatePasswordPolicy(password) {
  const value = String(password || "");
  if (value.length < passwordMinLength) {
    return `Password must be at least ${passwordMinLength} characters`;
  }
  if (/\s/.test(value)) {
    return "Password must not contain whitespace";
  }
  if (!/[a-z]/.test(value)) {
    return "Password must include at least one lowercase letter";
  }
  if (!/[A-Z]/.test(value)) {
    return "Password must include at least one uppercase letter";
  }
  if (!/\d/.test(value)) {
    return "Password must include at least one number";
  }
  if (!/[^A-Za-z0-9]/.test(value)) {
    return "Password must include at least one symbol";
  }
  if (commonWeakPasswords.has(value.toLowerCase())) {
    return "Password is too common. Choose a more unique password";
  }
  return null;
}

export function passwordStrength(password) {
  const value = String(password || "");
  if (!value) return null;

  const checks = [
    value.length >= passwordMinLength,
    !/\s/.test(value),
    /[a-z]/.test(value),
    /[A-Z]/.test(value),
    /\d/.test(value),
    /[^A-Za-z0-9]/.test(value),
  ];
  const score = checks.filter(Boolean).length;

  if (score <= 2) return { label: "Weak", color: "#e53e3e", pct: 30 };
  if (score <= 4) return { label: "Good", color: "#dd6b20", pct: 65 };
  if (validatePasswordPolicy(value)) return { label: "Almost there", color: "#d69e2e", pct: 80 };
  return { label: "Strong", color: "#2f855a", pct: 100 };
}

export const passwordRequirementText =
  `Use at least ${passwordMinLength} characters with uppercase, lowercase, number, and symbol.`;
