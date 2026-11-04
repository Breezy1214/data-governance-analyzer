import type { AdminUserAttributes } from "@supabase/supabase-js";
import { accountError, accountManager, adminInput, publicAccount, requireAdmin, validPassword } from "@/lib/admin-server";
import { AuthenticationError, errorResponse, json, requireSameOrigin } from "@/lib/auth-server";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    requireSameOrigin(request);
    const actor = await requireAdmin();
    const { id } = await context.params;
    if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) throw new AuthenticationError(400, "Choose a valid account.");
    const input = await adminInput(request);
    const keys = Object.keys(input);
    if (keys.length !== 1 || !["role", "disabled", "password"].includes(keys[0])) {
      throw new AuthenticationError(400, "Change one account setting at a time.");
    }
    if (id === actor.id && keys[0] !== "password") {
      throw new AuthenticationError(400, "Ask another administrator to change your role or account status.");
    }
    let attributes: AdminUserAttributes;
    if (keys[0] === "role" && (input.role === "user" || input.role === "admin")) {
      // Auth merges app_metadata, preserving provider and other application fields.
      attributes = { app_metadata: { app_role: input.role } };
    } else if (keys[0] === "disabled" && typeof input.disabled === "boolean") {
      attributes = { ban_duration: input.disabled ? "876000h" : "none" };
    } else if (keys[0] === "password" && validPassword(input.password)) {
      attributes = { password: input.password };
    } else throw new AuthenticationError(400, "Check the setting. Passwords must have 12–1,024 characters.");
    const { data, error } = await accountManager().updateUserById(id, attributes);
    accountError(error);
    if (!data.user) throw new Error("Account update unavailable");
    return json({ user: publicAccount(data.user) });
  } catch (error) { return errorResponse(error); }
}
