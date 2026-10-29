import "server-only";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createSupabaseClient } from "./supabase";
import { AUTH_MESSAGES, type AuthSession } from "./auth-messages";

export class AuthenticationError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function serverAuth(readOnly = false) {
  const cookieStore = await cookies();
  return createSupabaseClient({
    getAll: () => cookieStore.getAll(),
    setAll: readOnly ? undefined : (updates) => {
      updates.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
    },
  });
}

export function sessionError(error: { status?: number; name?: string }) {
  if (error.name === "AuthSessionMissingError" || error.status === 400 || error.status === 401 || error.status === 403) {
    return new AuthenticationError(401, AUTH_MESSAGES.expired);
  }
  return new AuthenticationError(503, AUTH_MESSAGES.unavailable);
}

export async function authenticatedSession(readOnly = false) {
  const client = await serverAuth(readOnly);
  // getSession supplies a token, not trusted identity. Verify that token with Auth before use.
  const { data: { session }, error } = await client.auth.getSession();
  if (error) throw sessionError(error);
  if (!session) return null;
  const { data: { user }, error: userError } = await client.auth.getUser(session.access_token);
  if (userError) throw sessionError(userError);
  if (!user || user.is_anonymous || !user.email) throw new AuthenticationError(401, AUTH_MESSAGES.expired);
  const payload: AuthSession = { user: { id: user.id, email: user.email }, binding: user.id };
  return { accessToken: session.access_token, payload };
}

export async function currentSession(): Promise<AuthSession | null> {
  try { return (await authenticatedSession(true))?.payload ?? null; }
  catch (error) {
    if (error instanceof AuthenticationError && error.status === 401) return null;
    throw error;
  }
}

export function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store, private" } });
}

export function errorResponse(error: unknown) {
  return error instanceof AuthenticationError
    ? json({ message: error.message }, error.status)
    : json({ message: AUTH_MESSAGES.unavailable }, 503);
}

export function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin || request.headers.get("sec-fetch-site") === "cross-site") return false;
  const allowed = new Set([new URL(request.url).origin]);
  // Next may normalize request.url to localhost while the browser uses 127.0.0.1.
  // Host is the actual HTTP destination; never trust arbitrary X-Forwarded-Host values.
  try {
    const source = new URL(origin);
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(source.hostname);
    if (source.origin === origin && source.host === request.headers.get("host")
      && (source.protocol === "https:" || (loopback && source.protocol === "http:"))) {
      allowed.add(origin);
    }
  } catch { return false; }
  if (process.env.APP_ORIGIN) allowed.add(new URL(process.env.APP_ORIGIN).origin);
  if (process.env.VERCEL_URL) allowed.add(new URL("https://" + process.env.VERCEL_URL).origin);
  return allowed.has(origin);
}

export function requireSameOrigin(request: Request) {
  if (!sameOrigin(request)) throw new AuthenticationError(403, AUTH_MESSAGES.forbidden);
}

export async function backend(request: Request, accessToken: string) {
  const base = process.env.API_BASE_URL;
  if (!base) throw new Error("Backend configuration is unavailable.");
  // Stream unchanged; FastAPI owns JSON validation and its configured request-size limit.
  return fetch(new URL("/assessments", base), {
    method: "POST", cache: "no-store", redirect: "error",
    headers: { "Content-Type": request.headers.get("content-type") ?? "application/json",
      Authorization: `Bearer ${accessToken}` },
    body: request.body,
    duplex: "half",
    signal: AbortSignal.any([request.signal, AbortSignal.timeout(12000)]),
  } as RequestInit & { duplex: "half" });
}
