import { sameOriginRoute } from "@/lib/auth-server";
import { scoreAndSave } from "@/lib/save-assessment";

export const POST = sameOriginRoute(async (request, { params }: { params: Promise<{ id: string }> }) =>
  scoreAndSave(request, (await params).id));
