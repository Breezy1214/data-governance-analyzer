import { sameOriginRoute } from "@/lib/auth-server";
import { scoreAndSave } from "@/lib/save-assessment";

export const POST = sameOriginRoute((request) => scoreAndSave(request, null));
