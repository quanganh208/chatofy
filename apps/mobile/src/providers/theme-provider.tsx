// ThemeProvider — exposes resolved theme colors based on system color scheme.
// useTheme() returns the active palette; swap to custom theme storage (zustand) later.
import { createContext, useContext, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import { colors, type ColorScheme, type ThemeColors } from '@/ui/theme';

interface ThemeContextValue {
  scheme: ColorScheme;
  colors: ThemeColors;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

interface ThemeProviderProps {
  children: ReactNode;
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  const systemScheme = useColorScheme();
  const scheme: ColorScheme = systemScheme === 'dark' ? 'dark' : 'light';

  return (
    <ThemeContext.Provider value={{ scheme, colors: colors[scheme] }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
