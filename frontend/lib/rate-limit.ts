import "server-only";
import { AUTH_MESSAGES } from "./auth-messages";
import { AuthenticationError, sameOriginRoute } from "./auth-server";
import { visitorAddress } from "./visitor";

/**
 * Throttles repeated sign-in, sign-up and password-reset attempts from one visitor.
 *
 * Counters live in memory, so each server instance keeps its own. That is enough to stop rapid
 * repeated attempts against a route; Supabase applies its own account-level limits behind this.
 */

export const AUTH_WINDOW_MS = 60_000;
/**
 * Attempts per visitor per window. Successful attempts count too, so the routes everyone uses once on demo day
 * (a room on shared Wi-Fi is one address) get more room than the ones that send email or change a password.
 */
export const AUTH_ATTEMPTS_PER_WINDOW = {
  login: 30,
  signup: 30,
  confirm: 30,
  "forgot-password": 10,
  "update-password": 10,
} as const;
export type AuthRoute = keyof typeof AUTH_ATTEMPTS_PER_WINDOW;
const MAX_TRACKED_CLIENTS = 10_000;

const attempts = new Map<string, number[]>();

/** Records an attempt and throws a 429 once this visitor has used up the route's attempts for the window. */
export function limitAuthAttempts(request: Request, route: AuthRoute, now = Date.now()) {
  const key = `${route}:${visitorAddress(request) ?? "unknown"}`;
  const recent = (attempts.get(key) ?? []).filter((time) => now - time < AUTH_WINDOW_MS);
  if (recent.length >= AUTH_ATTEMPTS_PER_WINDOW[route]) {
    attempts.set(key, recent);
    throw new AuthenticationError(429, AUTH_MESSAGES.rateLimited, Math.ceil(AUTH_WINDOW_MS / 1000));
  }
  recent.push(now);
  // Re-insert so the map stays ordered by latest attempt, then drop the stalest visitors if it grows too large.
  attempts.delete(key);
  attempts.set(key, recent);
  while (attempts.size > MAX_TRACKED_CLIENTS) attempts.delete(attempts.keys().next().value!);
}

/** A same-origin route (see sameOriginRoute) that also counts each request against the route's attempt limit. */
export function throttledRoute<Context extends unknown[]>(
  route: AuthRoute, handler: (request: Request, ...context: Context) => Promise<Response>,
) {
  return sameOriginRoute<Context>(async (request, ...context) => {
    limitAuthAttempts(request, route);
    return handler(request, ...context);
  });
}

/** Clears every counter. Tests use this so one case's attempts don't throttle the next. */
export function resetAuthAttempts() {
  attempts.clear();
}
