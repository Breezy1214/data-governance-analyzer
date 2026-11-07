import "server-only";
import { createClient, type User } from "@supabase/supabase-js";
import { appRole } from "./app-role";
import { authenticatedSession, AuthenticationError, serverAuth } from "./auth-server";

const ADMIN_UNAVAILABLE = "Account management is temporarily unavailable. Please try again.";
export const USERS_PER_PAGE = 20;

export async function requireAdmin() {
  const session = await authenticatedSession();
  const client = await serverAuth();
  // Refresh authorization from Auth on every privileged request. A signed but stale
  // token must not keep admin rights after the account is demoted or disabled.
  const { data, error } = await client.auth.getUser(session.accessToken);
  if (error) {
    const invalidSession = error.status === 400 || error.status === 401 || error.status === 403;
    throw new AuthenticationError(invalidSession ? 401 : 503,
      invalidSession ? "Please sign in again." : ADMIN_UNAVAILABLE);
  }
  const user = data.user;
  if (!user || user.id !== session.payload.user.id || user.is_anonymous
    || (user.banned_until && Date.parse(user.banned_until) > Date.now())) {
    throw new AuthenticationError(401, "Please sign in again.");
  }
  if (appRole(user.app_metadata) !== "admin") {
    throw new AuthenticationError(403, "An administrator account is required.");
  }
  return user;
}

export function accountManager() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key || new URL(url).protocol !== "https:") {
    throw new AuthenticationError(503, ADMIN_UNAVAILABLE);
  }
  // This separate server-only client never uses browser cookies or returns its key.
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (input, init) => fetch(input, {
      ...init, cache: "no-store", signal: AbortSignal.timeout(10000),
    }) },
  }).auth.admin;
}

export function publicAccount(user: User) {
  return {
    id: user.id,
    email: user.email ?? "",
    role: appRole(user.app_metadata),
    disabled: Boolean(user.banned_until && Date.parse(user.banned_until) > Date.now()),
  };
}

export function accountError(error: { status?: number } | null) {
  if (!error) return;
  if (error.status === 429) throw new AuthenticationError(429, "Too many requests. Please wait and try again.");
  if (error.status && error.status >= 400 && error.status < 500) {
    throw new AuthenticationError(400, "The account could not be updated. Check the account details and password requirements.");
  }
  throw new AuthenticationError(503, ADMIN_UNAVAILABLE);
}

export function validPassword(value: unknown): value is string {
  return typeof value === "string" && value.length >= 12 && value.length <= 1024;
}

/** Bound even chunked input before parsing; never include submitted values in errors. */
export async function adminInput(request: Request): Promise<Record<string, unknown>> {
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") {
    throw new AuthenticationError(400, "Send account details as JSON.");
  }
  const reader = request.body?.getReader();
  if (!reader) throw new AuthenticationError(400, "Account details are required.");
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 4096) {
        await reader.cancel();
        throw new AuthenticationError(413, "Account details are too large.");
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  let input: unknown;
  try { input = JSON.parse(new TextDecoder().decode(bytes)); } catch {
    throw new AuthenticationError(400, "Check the account details and try again.");
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new AuthenticationError(400, "Check the account details and try again.");
  }
  return input as Record<string, unknown>;
}
