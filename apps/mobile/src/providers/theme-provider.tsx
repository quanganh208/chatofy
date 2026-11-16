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

interface ThemeProviderProps {
  children: ReactNode;
}

/**
 * The account's theme choice, applied to everything the app draws.
 *
 * The choice is the `theme` field of the account preferences — the same one web
 * reads — and a signed-out visitor gets its default, `system`. It is applied
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
  const choice = useAccountPreferences().preferences.theme;
  useEffect(() => {
    Appearance.setColorScheme(appearanceFor(choice));
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
