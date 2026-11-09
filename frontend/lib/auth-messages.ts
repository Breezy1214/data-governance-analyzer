import { PASSWORD_MAX_BYTES, PASSWORD_MIN_CHARACTERS } from "./password-policy";

export const AUTH_MESSAGES = {
  unavailable: "Sign-in service is temporarily unavailable. Please try again.",
  invalid: "Email or password is incorrect.",
  expired: "Your session has ended. Please sign in again.",
  forbidden: "This request could not be verified. Reload this page and try again.",
  rateLimited: "Too many attempts. Please try again later.",
  invalidInput: "Please enter a valid email address and password.",
  offline: "Unable to connect. Please try again.",
  invalidEmail: "Please enter a valid email address.",
  passwordRules: `Use at least ${PASSWORD_MIN_CHARACTERS} characters, up to ${PASSWORD_MAX_BYTES}. A few unrelated words work well.`,
  passwordBreached: "This password has appeared in a data breach. Please choose a different one.",
  passwordReused: "Please choose a password you haven't used here before.",
  linkInvalid: "This link has expired or was already used. Please request a new one.",
};
