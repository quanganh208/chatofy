import { createContext, use, useEffect, type ReactNode } from 'react';
import { Appearance, useColorScheme, View } from 'react-native';
import { vars } from 'nativewind';
// expo-router vendors React Navigation; its navigators read the theme from this
// copy, so a ThemeProvider imported from `@react-navigation/native` reaches none
// of them (measured: the active tab stayed the library's default blue).
import {
  DarkTheme,
  DefaultTheme,
  ThemeProvider as NavigationTheme,
} from 'expo-router/react-navigation';
import * as SystemUI from 'expo-system-ui';
import type { ThemeChoice } from '@chatofy/types';
import { colors, type ColorScheme, type ThemeColors } from '@/ui/theme';
import { themeVariables } from '@/ui/theme-variables';
import { navigationColors, navigationFonts } from '@/ui/navigation-colors';
import { useAccountPreferences } from '@/preferences/account-preferences';
import { readRememberedTheme, rememberTheme } from '@/preferences/remembered-theme';
import { useAuth } from './auth-provider';

interface ThemeContextValue {
  scheme: ColorScheme;
  colors: ThemeColors;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

// Built once per scheme: `vars()` returns a style object, and a new one on every
// render would restyle the whole tree for nothing.
const rootVariables = {
  light: vars(themeVariables('light')),
  dark: vars(themeVariables('dark')),
} as const;

const navigationThemes = {
  light: { ...DefaultTheme, colors: navigationColors('light'), fonts: navigationFonts },
  dark: { ...DarkTheme, colors: navigationColors('dark'), fonts: navigationFonts },
} as const;

/** What `Appearance.setColorScheme` takes for a stored choice; `system` hands control back. */
function appearanceFor(choice: ThemeChoice): 'light' | 'dark' | 'unspecified' {
  return choice === 'system' ? 'unspecified' : choice;
}

// Applied before the first render, so a cold start paints in the last theme this
// phone showed instead of the system one while the account's choice loads.
Appearance.setColorScheme(appearanceFor(readRememberedTheme()));

/**
 * The choice to apply now: the account's once its document has loaded, `system`
 * for nobody signed in, and nothing (keep what is showing) while either is pending.
 */
function useSettledChoice(): ThemeChoice | null {
  const { isLoading, session } = useAuth();
  const { preferences, hydrated } = useAccountPreferences();
  if (isLoading) return null;
  if (session === null) return 'system';
  return hydrated ? preferences.theme : null;
}

interface ThemeProviderProps {
  children: ReactNode;
}

/**
 * The account's theme choice, applied to everything the app draws.
 *
 * The choice is the `theme` field of the account preferences — the same one web
 * reads — and a signed-out visitor gets `system`. Until the account's document
 * has loaded, the theme this phone last applied stands in (`remembered-theme.ts`). It is applied
 * through `Appearance.setColorScheme`, so `useColorScheme()` answers with the
 * choice rather than the phone's setting: native pickers, the keyboard and every
 * screen still on `useTheme` follow it without knowing a choice exists.
 *
 * Three consumers, one scheme: the colour variables NativeWind classes read (set
 * on the root view, so `global.css` holds no palette), `useTheme()` for the
 * screens that have not moved to `className` yet, and React Navigation's header
 * and tab bar.
 */
export function ThemeProvider({ children }: ThemeProviderProps) {
  const choice = useSettledChoice();
  useEffect(() => {
    if (choice === null) return;
    Appearance.setColorScheme(appearanceFor(choice));
    rememberTheme(choice);
  }, [choice]);

  const raw = useColorScheme();
  const scheme: ColorScheme = raw === 'dark' ? 'dark' : 'light';

  // The root view's colour behind the app, seen during a screen transition and
  // under the keyboard; without it Android shows the launch theme's white.
  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(colors[scheme].background);
  }, [scheme]);

  return (
    <ThemeContext value={{ scheme, colors: colors[scheme] }}>
      <NavigationTheme value={navigationThemes[scheme]}>
        <View style={[{ flex: 1 }, rootVariables[scheme]]}>{children}</View>
      </NavigationTheme>
    </ThemeContext>
  );
}

/**
 * The active scheme and its colours, for screens still styled with `StyleSheet`.
 * New UI reads the same values through `className` instead.
 */
export function useTheme(): ThemeContextValue {
  const ctx = use(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
