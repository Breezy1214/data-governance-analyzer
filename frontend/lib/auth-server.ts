import "server-only";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createSupabaseClient } from "./supabase";
import { AUTH_MESSAGES } from "./auth-messages";
import type { AuthSession } from "./auth-client";

export const NO_STORE = { "Cache-Control": "no-store, private" };

export class AuthenticationError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function serverAuth() {
  const cookieStore = await cookies();
  return createSupabaseClient({
    getAll: () => cookieStore.getAll(),
    setAll: (updates) => {
      try {
        updates.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
      } catch {
        // Server Components cannot write cookies; proxy.ts refreshes them before render.
      }
    },
  });
}

function sessionError(error: { status?: number; name?: string }) {
  if (error.name === "AuthSessionMissingError" || error.status === 400 || error.status === 401 || error.status === 403) {
    return new AuthenticationError(401, AUTH_MESSAGES.expired);
  }
  return new AuthenticationError(503, AUTH_MESSAGES.unavailable);
}

export async function authenticatedSession() {
  const client = await serverAuth();
  const { data: { session }, error } = await client.auth.getSession();
  if (error) throw sessionError(error);
  if (!session) throw new AuthenticationError(401, AUTH_MESSAGES.expired);
  // The cookie session is untrusted until its JWT signature is verified against the project's signing keys.
  const { data, error: claimsError } = await client.auth.getClaims(session.access_token);
  if (claimsError) throw sessionError(claimsError);
  const claims = data?.claims;
  if (!claims || claims.is_anonymous || !claims.email) throw new AuthenticationError(401, AUTH_MESSAGES.expired);
  const payload: AuthSession = { user: { id: claims.sub, email: claims.email } };
  return { accessToken: session.access_token, payload };
}

export async function currentSession(): Promise<AuthSession | null> {
  try {
    return (await authenticatedSession()).payload;
  } catch (error) {
    if (error instanceof AuthenticationError && error.status === 401) return null;
    throw error;
  }
}

export function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

export function errorResponse(error: unknown) {
  return error instanceof AuthenticationError
    ? json({ message: error.message }, error.status)
    : json({ message: AUTH_MESSAGES.unavailable }, 503);
}

function hostOrigin(request: Request, origin: URL) {
  // Next may normalize request.url to localhost while the browser uses 127.0.0.1, so also accept the
  // actual Host header. Never trust X-Forwarded-Host here.
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname);
  const secure = origin.protocol === "https:" || (loopback && origin.protocol === "http:");
  return secure && origin.host === request.headers.get("host") ? origin.origin : null;
}

export function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin || !URL.canParse(origin) || request.headers.get("sec-fetch-site") === "cross-site") return false;
  const allowed = [
    new URL(request.url).origin,
    hostOrigin(request, new URL(origin)),
    process.env.APP_ORIGIN && new URL(process.env.APP_ORIGIN).origin,
    process.env.VERCEL_URL && new URL(`https://${process.env.VERCEL_URL}`).origin,
  ];
  return allowed.includes(origin);
}

export function requireSameOrigin(request: Request) {
  if (!sameOrigin(request)) throw new AuthenticationError(403, AUTH_MESSAGES.forbidden);
}
