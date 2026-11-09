import "server-only";
import { createHash } from "node:crypto";
import { AUTH_MESSAGES } from "./auth-messages";
import { AuthenticationError } from "./auth-server";
import { passwordFits } from "./password-policy";

// Only the first five characters of the SHA-1 hash leave the server. An outage must not block sign-up.
async function isBreached(password: string) {
  const hash = createHash("sha1").update(password).digest("hex").toUpperCase();
  try {
    const response = await fetch(`https://api.pwnedpasswords.com/range/${hash.slice(0, 5)}`, {
      headers: { "Add-Padding": "true", "User-Agent": "data-governance-readiness-analyzer" },
      cache: "no-store",
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) return false;
    const suffix = hash.slice(5);
    return (await response.text()).split("\n").some((line) => {
      const [candidate, count] = line.trim().split(":");
      return candidate === suffix && Number(count) > 0;
    });
  } catch {
    return false;
  }
}

export async function requireNewPassword(value: unknown) {
  const password = typeof value === "string" ? value : "";
  if (!passwordFits(password)) throw new AuthenticationError(400, AUTH_MESSAGES.passwordRules);
  if (await isBreached(password)) throw new AuthenticationError(400, AUTH_MESSAGES.passwordBreached);
  return password;
}
