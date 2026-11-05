/**
 * Checks a registration form before it is sent, with the same limits the API
 * enforces (`@chatofy/types`), so a refusal the user could have been told about
 * on the device never costs a request or a throttle slot.
 */

import type { MessageKey } from '@chatofy/i18n';
import { AUTH_LIMITS, emailSchema } from '@chatofy/types';

export interface RegisterFormValues {
  name: string;
  email: string;
  password: string;
  confirmPassword: string;
}

/** The first problem with the form, or null when it can be sent. */
export function validateRegistration(values: RegisterFormValues): MessageKey | null {
  const name = values.name.trim();
  if (name.length < AUTH_LIMITS.minName || !values.email.trim() || !values.password) {
    return 'mobile.auth.fillAllFields';
  }
  if (name.length > AUTH_LIMITS.maxName) return 'mobile.auth.nameTooLong';
  if (!emailSchema.safeParse(values.email.trim()).success) return 'mobile.auth.invalidEmail';
  if (values.password.length < AUTH_LIMITS.minPassword) return 'web.auth.passwordTooShort';
  if (values.password.length > AUTH_LIMITS.maxPassword) return 'mobile.auth.passwordTooLong';
  if (values.password !== values.confirmPassword) return 'mobile.auth.passwordMismatch';
  return null;
}

/** The new-password form of a reset: the same rules, without a name or an email. */
export function validateNewPassword(password: string, confirmPassword: string): MessageKey | null {
  if (!password) return 'mobile.auth.fillAllFields';
  if (password.length < AUTH_LIMITS.minPassword) return 'web.auth.passwordTooShort';
  if (password.length > AUTH_LIMITS.maxPassword) return 'mobile.auth.passwordTooLong';
  if (password !== confirmPassword) return 'mobile.auth.passwordMismatch';
  return null;
}
