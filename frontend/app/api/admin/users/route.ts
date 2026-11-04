import { accountError, accountManager, adminInput, publicAccount, requireAdmin, USERS_PER_PAGE, validPassword } from "@/lib/admin-server";
import { AuthenticationError, errorResponse, json, requireSameOrigin } from "@/lib/auth-server";

export async function GET(request: Request) {
  try {
    await requireAdmin();
    const page = Number(new URL(request.url).searchParams.get("page") ?? "1");
    if (!Number.isInteger(page) || page < 1 || page > 100000) throw new AuthenticationError(400, "Choose a valid page.");
    const { data, error } = await accountManager().listUsers({ page, perPage: USERS_PER_PAGE });
    accountError(error);
    return json({ users: data.users.map(publicAccount), page, hasMore: data.users.length === USERS_PER_PAGE });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    await requireAdmin();
    const input = await adminInput(request);
    const email = typeof input.email === "string" ? input.email.trim() : "";
    if (Object.keys(input).some((key) => !["email", "password", "role"].includes(key))
      || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254
      || !validPassword(input.password) || (input.role !== "user" && input.role !== "admin")) {
      throw new AuthenticationError(400, "Enter an email, a password of 12–1,024 characters, and a valid role.");
    }
    const { data, error } = await accountManager().createUser({
      email, password: input.password, email_confirm: true, app_metadata: { app_role: input.role },
    });
    accountError(error);
    if (!data.user) throw new Error("Account creation unavailable");
    return json({ user: publicAccount(data.user) }, 201);
  } catch (error) { return errorResponse(error); }
}
