import "server-only";
import { AuthenticationError, NO_STORE } from "./auth-server";
import { visitorAddress } from "./visitor";

/** FastAPI scores and owns the register; these helpers pass requests to it and never touch the database. */

const TIMEOUT_MS = 12000;

function backendUrl(path: string) {
  const base = process.env.API_BASE_URL;
  if (!base) throw new Error("Backend configuration is unavailable.");
  return new URL(path, base);
}

export function bearer(accessToken: string) {
  return { Authorization: `Bearer ${accessToken}` };
}

/** Streams a browser request to FastAPI unchanged and relays its answer. FastAPI validates and limits the body. */
export async function forwardToBackend(request: Request, path: string, headers: Record<string, string>) {
  const response = await fetch(backendUrl(path), {
    method: request.method, cache: "no-store", redirect: "error",
    headers: { "Content-Type": request.headers.get("content-type") ?? "application/json", ...headers },
    body: request.body,
    duplex: "half",
    signal: AbortSignal.any([request.signal, AbortSignal.timeout(TIMEOUT_MS)]),
  } as RequestInit & { duplex: "half" });
  const relayed: Record<string, string> = { "Content-Type": "application/json", ...NO_STORE };
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) relayed["Retry-After"] = retryAfter;
  return new Response(response.status === 204 ? null : response.body, { status: response.status, headers: relayed });
}

/** Reads JSON from FastAPI for a server-rendered page. Null when it isn't found. */
export async function readFromBackend(path: string, accessToken: string): Promise<unknown> {
  const response = await fetch(backendUrl(path), {
    cache: "no-store", redirect: "error", headers: bearer(accessToken), signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (response.status === 404) return null;
  if (response.status === 401) throw new AuthenticationError(401, "Please sign in again.");
  if (!response.ok) throw new Error(`Register request failed with ${response.status}`);
  return response.json();
}

/**
 * Identifies a demo visitor to the backend's rate limiter. The backend only trusts X-Demo-Client alongside the
 * shared DEMO_PROXY_SECRET, so a direct caller can't pick its own key; without the secret nothing is sent.
 */
export function demoClientHeaders(request: Request): Record<string, string> {
  const secret = process.env.DEMO_PROXY_SECRET;
  const client = visitorAddress(request);
  return secret && client ? { "X-Demo-Client": client, "X-Demo-Proxy-Secret": secret } : {};
}
