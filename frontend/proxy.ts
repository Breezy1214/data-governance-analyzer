import { NextRequest, NextResponse } from "next/server";
import { createSupabaseClient } from "@/lib/supabase";

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
    // Refresh cookies before Server Components, which cannot write them. The page reports auth failures.
    await client.auth.getClaims();
  } catch {
    // Missing configuration is reported by the page.
  }
  response.headers.set("Cache-Control", "no-store, private");
  return response;
}

export const config = { matcher: ["/", "/update-password"] };
