export const passportAuthoringAccessMessage = "Editor or company-admin access is required to manage passports.";

export function canManagePassports(user) {
  return Boolean(user) && user.role !== "viewer";
}
