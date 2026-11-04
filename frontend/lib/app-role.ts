export type AppRole = "user" | "admin";

/** Only server-controlled app_metadata grants an application role. */
export function appRole(metadata: unknown): AppRole {
  return metadata !== null && typeof metadata === "object" && !Array.isArray(metadata)
    && "app_role" in metadata && metadata.app_role === "admin" ? "admin" : "user";
}
