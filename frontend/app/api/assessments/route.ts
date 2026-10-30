import { authenticatedSession, errorResponse, NO_STORE, requireSameOrigin } from "@/lib/auth-server";

export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const { accessToken } = await authenticatedSession();
    const response = await forwardToBackend(request, accessToken);
    return new Response(response.body, {
      status: response.status,
      headers: { "Content-Type": "application/json", ...NO_STORE },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

function forwardToBackend(request: Request, accessToken: string) {
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
