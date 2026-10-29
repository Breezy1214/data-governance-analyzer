export const AUTH_MESSAGES = {
  unavailable: "Sign-in service is temporarily unavailable. Please try again.",
  invalid: "Email or password is incorrect.",
  expired: "Your session has ended. Please sign in again.",
  forbidden: "This request could not be verified. Reload this page and try again.",
  rateLimited: "Too many attempts. Please try again later.",
  invalidInput: "Please enter a valid email address and password.",
};
export type AuthSession = { user: { id: string; email: string }; binding: string };
