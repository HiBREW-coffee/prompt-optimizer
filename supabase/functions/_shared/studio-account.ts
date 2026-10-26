import { StudioError } from "./studio-contract.ts";

// App-owned, non-deliverable identities reuse Auth/password and the existing RLS.
// Only the account name is displayed. No shared Auth configuration is changed.
const ACCOUNT_DOMAIN = "accounts.dongwu.invalid";
export const USERNAME_PATTERN = "[A-Za-z0-9][A-Za-z0-9_\\-]{2,31}";

export function normalizeUsername(value: unknown): string {
  if (typeof value !== "string") throw new StudioError("INVALID_USERNAME");
  const name = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{2,31}$/.test(name))
    throw new StudioError("INVALID_USERNAME");
  return name;
}

export function usernameEmail(value: unknown): string {
  return `${normalizeUsername(value)}@${ACCOUNT_DOMAIN}`;
}

export function accountLoginEmail(value: string): string {
  const identifier = value.trim();
  if (!identifier.includes("@")) return usernameEmail(identifier);
  if (identifier.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier))
    throw new StudioError("INVALID_LOGIN_ID");
  return identifier.toLowerCase();
}

export function isAccountEmail(value: string): boolean {
  return value.toLowerCase().endsWith(`@${ACCOUNT_DOMAIN}`);
}

export function accountLabel(email: string): string {
  if (!isAccountEmail(email)) return email;
  const name = email.slice(0, email.lastIndexOf("@"));
  try { return normalizeUsername(name); } catch { return email; }
}
