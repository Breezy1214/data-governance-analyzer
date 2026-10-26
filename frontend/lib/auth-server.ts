import "server-only";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export const SESSION_COOKIE = process.env.NODE_ENV === "production" ? "__Host-kg-scrum22-session" : "kg-scrum22-session";
export type AuthSession = {
  user: { id: string; email: string };
  binding: string;
  expiresAt: number;
  idleExpiresAt: number;
};

export async function backend(path: string, method = "GET", body?: unknown, signal?: AbortSignal) {
  const base = process.env.API_BASE_URL;
  const key = process.env.FRONTEND_SHARED_KEY;
  if (!base || !key) throw new Error("Authentication unavailable");
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return fetch(`${base.replace(/\/+$/, "")}${path}`, {
    method, cache: "no-store", redirect: "error",
    headers: { "Content-Type": "application/json", "X-Frontend-Key": key,
      ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(12000)]) : AbortSignal.timeout(12000),
  });
}

export async function currentSession(): Promise<AuthSession | null> {
  if (!(await cookies()).has(SESSION_COOKIE)) return null;
  const response = await backend("/auth/session");
  if (response.status === 401) return null;
  if (!response.ok) throw new Error("Authentication unavailable");
  return response.json();
}

export function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store, private" } });
}

export function clearCookie(response: NextResponse) {
  response.cookies.set(SESSION_COOKIE, "", { httpOnly: true, secure: process.env.NODE_ENV === "production",
    sameSite: "lax", path: "/", maxAge: 0 });
  return response;
}

export function sameOrigin(request: Request) {
  const allowed = process.env.APP_ORIGIN;
  return Boolean(allowed && request.headers.get("origin") === allowed
    && request.headers.get("sec-fetch-site") !== "cross-site");
}

export async function forward(request: Request, action: string) {
  const routes: Record<string, string> = {
    login: "/auth/login", logout: "/auth/logout", session: "/auth/session",
    activity: "/auth/activity", assessments: "/assessments",
  };
  if (!Object.hasOwn(routes, action)) return json({ message: "Not found." }, 404);
  if (request.method !== (action === "session" ? "GET" : "POST")) return json({ message: "Method not allowed." }, 405);
  if (request.method === "POST" && !sameOrigin(request)) return json({ message: "Request not allowed." }, 403);
  try {
    let body: unknown;
    if (action === "login" || action === "assessments") {
      if (!request.headers.get("content-type")?.startsWith("application/json")) return json({ message: "Invalid request." }, 415);
      // Bound the stream as well as Content-Length; do not buffer arbitrarily large bodies.
      const reader = request.body?.getReader();
      if (!reader) return json({ message: "Invalid request." }, 400);
      let size = 0;
      const parts: Uint8Array[] = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 16384) { await reader.cancel(); return json({ message: "Request too large." }, 413); }
        parts.push(value);
      }
      try { body = JSON.parse(Buffer.concat(parts).toString("utf8")); }
      catch { return json({ message: "Invalid request." }, 400); }
    }
    const upstream = await backend(routes[action], request.method, body, request.signal);
    if (!upstream.ok) {
      const status = [400, 401, 403, 422, 429].includes(upstream.status) ? upstream.status : 503;
      const message = status === 401 ? (action === "login" ? "Email or password is incorrect." : "Please sign in again.")
        : status === 429 ? "Too many attempts. Please try again later."
        : status === 503 ? "Sign-in service is unavailable. Please try again later."
        : "Please check your details and try again.";
      const response = json({ message }, status);
      return status === 401 && action !== "login" ? clearCookie(response) : response;
    }
    if (action === "logout") return clearCookie(json({ ok: true }));
    const result = await upstream.json();
    if (action === "login") {
      const { sessionToken, ...session } = result;
      if (typeof sessionToken !== "string" || !Number.isFinite(session.expiresAt)) throw new Error("Invalid session");
      const response = json(session);
      response.cookies.set(SESSION_COOKIE, sessionToken, { httpOnly: true,
        secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/",
        maxAge: Math.max(0, Math.floor(session.expiresAt - Date.now() / 1000)) });
      return response;
    }
    return json(result);
  } catch {
    return json({ message: "The service is temporarily unavailable. Please try again." }, 503);
  }
}
