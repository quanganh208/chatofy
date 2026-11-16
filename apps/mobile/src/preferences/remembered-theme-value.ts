// The stored value parsed apart from SecureStore, so it is checkable without a device.

import type { ThemeChoice } from '@chatofy/types';

export function parseThemeChoice(raw: string | null): ThemeChoice {
  return raw === 'light' || raw === 'dark' ? raw : 'system';
}
