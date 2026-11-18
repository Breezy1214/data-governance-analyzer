import "server-only";

const MAX_ADDRESS_LENGTH = 64;

/**
 * The visitor's address, used to key rate limits here and in the backend. The hosting platform sets the
 * first X-Forwarded-For entry to the address it saw; the rest of the header is client-supplied. Null when absent.
 */
export function visitorAddress(request: Request): string | null {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim().slice(0, MAX_ADDRESS_LENGTH) || null;
}
