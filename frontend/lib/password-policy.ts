export const PASSWORD_MIN_CHARACTERS = 15;
// Supabase stores passwords with bcrypt, which accepts at most 72 bytes.
export const PASSWORD_MAX_BYTES = 72;

export function passwordFits(password: string) {
  return new TextEncoder().encode(password).length <= PASSWORD_MAX_BYTES
    && [...password].length >= PASSWORD_MIN_CHARACTERS;
}
