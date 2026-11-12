import "server-only";
import { NO_STORE } from "./auth-server";

/** Streams an assessment request to FastAPI unchanged; FastAPI owns JSON validation and its request-size limit. */
export async function forwardAssessment(request: Request, path: string, headers: Record<string, string>) {
  const base = process.env.API_BASE_URL;
  if (!base) throw new Error("Backend configuration is unavailable.");
  const response = await fetch(new URL(path, base), {
    method: "POST", cache: "no-store", redirect: "error",
    headers: { "Content-Type": request.headers.get("content-type") ?? "application/json", ...headers },
    body: request.body,
    duplex: "half",
    signal: AbortSignal.any([request.signal, AbortSignal.timeout(12000)]),
  } as RequestInit & { duplex: "half" });
  return new Response(response.body, {
    status: response.status,
    headers: { "Content-Type": "application/json", ...NO_STORE },
  });
}
