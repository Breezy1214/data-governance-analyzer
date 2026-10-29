import "server-only";
import { createServerClient, type CookieMethodsServer } from "@supabase/ssr";

export function supabaseConfig() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key || new URL(url).protocol !== "https:") {
    throw new Error("Supabase configuration is unavailable.");
  }
  return { url, key };
}

export function createSupabaseClient(cookies: CookieMethodsServer) {
  const { url, key } = supabaseConfig();
  return createServerClient(url, key, {
    cookies,
    cookieOptions: {
      name: "session",
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
    },
    global: { fetch: (input, init) => fetch(input, {
      ...init, cache: "no-store", signal: AbortSignal.timeout(10000),
    }) },
  });
}
