import { NextRequest, NextResponse } from "next/server";
import { createSupabaseClient } from "@/lib/supabase";
import { AUTH_MESSAGES } from "@/lib/auth-messages";

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  try {
    const client = createSupabaseClient({
      getAll: () => request.cookies.getAll(),
      setAll: (updates) => {
        updates.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        updates.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    });
    // Refresh cookies before Server Components, which cannot write them.
    const { error } = await client.auth.getUser();
    if (error && error.name !== "AuthSessionMissingError"
      && ![400, 401, 403].includes(error.status ?? 0)) {
      return new NextResponse(AUTH_MESSAGES.unavailable, {
        status: 503, headers: { "Cache-Control": "no-store" },
      });
    }
    response.headers.set("Cache-Control", "no-store, private");
    return response;
  } catch {
    return new NextResponse(AUTH_MESSAGES.unavailable, {
      status: 503, headers: { "Cache-Control": "no-store" },
    });
  }
}

export const config = { matcher: ["/"] };
