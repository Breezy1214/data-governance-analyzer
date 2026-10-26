import { forward } from "@/lib/auth-server";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ action: string }> };
export async function GET(request: Request, context: Context) {
  return forward(request, (await context.params).action);
}
export async function POST(request: Request, context: Context) {
  return forward(request, (await context.params).action);
}
