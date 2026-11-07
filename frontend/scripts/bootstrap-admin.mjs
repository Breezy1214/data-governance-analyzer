import { createClient } from "@supabase/supabase-js";

// Operator-only bootstrap. No passwords or privileged keys belong in arguments or source.
const id = process.argv[2];
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id ?? "")
  || !url || !key || !URL.canParse(url) || new URL(url).protocol !== "https:") {
  console.error("Configure SUPABASE_URL and SUPABASE_SECRET_KEY, then supply the confirmed account's user ID.");
  process.exitCode = 1;
} else {
  try {
    const client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(10000) }) },
    });
    const { data, error } = await client.auth.admin.getUserById(id);
    if (error || !data.user?.email_confirmed_at || data.user.is_anonymous) {
      throw new Error("Create and confirm this account in Supabase first.");
    }
    const { error: updateError } = await client.auth.admin.updateUserById(id, { app_metadata: { app_role: "admin" } });
    if (updateError) throw new Error("The admin role could not be set. Check the project and server key.");
    console.log("Admin access granted to the selected account. Sign out and sign in again, then open /admin.");
  } catch {
    console.error("Admin setup failed. Check the confirmed user ID, project settings, and server key. No credentials were printed.");
    process.exitCode = 1;
  }
}
