import "server-only";
import { AUTH_MESSAGES } from "./auth-messages";
import { AuthenticationError } from "./auth-server";

/**
 * Throttles repeated sign-in, sign-up and password-reset attempts from one visitor.
 *
 * Counters live in memory, so each server instance keeps its own. That is enough to stop rapid
 * repeated attempts against a route; Supabase applies its own account-level limits behind this.
 */

export const AUTH_WINDOW_MS = 60_000;
export const AUTH_ATTEMPTS_PER_WINDOW = 10;
const MAX_TRACKED_CLIENTS = 10_000;

const attempts = new Map<string, number[]>();

/** The hosting platform sets the first X-Forwarded-For entry to the visitor's address. */
function clientKey(request: Request) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim().slice(0, 64) || "unknown";
}

/** Records an attempt and throws a 429 once this visitor has used up the route's attempts for the window. */
export function limitAuthAttempts(request: Request, route: string, now = Date.now()) {
  const key = `${route}:${clientKey(request)}`;
  const recent = (attempts.get(key) ?? []).filter((time) => now - time < AUTH_WINDOW_MS);
  if (recent.length >= AUTH_ATTEMPTS_PER_WINDOW) {
    attempts.set(key, recent);
    throw new AuthenticationError(429, AUTH_MESSAGES.rateLimited);
  }
  recent.push(now);
  // Re-insert so the map stays ordered by latest attempt, then drop the stalest visitors if it grows too large.
  attempts.delete(key);
  attempts.set(key, recent);
  while (attempts.size > MAX_TRACKED_CLIENTS) attempts.delete(attempts.keys().next().value!);
}

/** Clears every counter. Tests use this so one case's attempts don't throttle the next. */
export function resetAuthAttempts() {
  attempts.clear();
}
