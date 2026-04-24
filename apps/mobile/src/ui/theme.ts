// Design tokens — keep in sync with design-guidelines.md

export type ColorScheme = 'light' | 'dark';

export type ThemeColors = {
  background: string;
  surface: string;
  primary: string;
  primaryForeground: string;
  secondary: string;
  accent: string;
  destructive: string;
  border: string;
  text: string;
  textSecondary: string;
  muted: string;
};

// Widened Record type avoids union narrowing issues when indexing with ColorScheme variable
export const colors: Record<ColorScheme, ThemeColors> = {
  light: {
    background: '#FFFFFF',
    surface: '#F2F2F7',
    primary: '#007AFF',
    primaryForeground: '#FFFFFF',
    secondary: '#5856D6',
    accent: '#34C759',
    destructive: '#FF3B30',
    border: '#C6C6C8',
    text: '#000000',
    textSecondary: '#6E6E73',
    muted: '#AEAEB2',
  },
  dark: {
    background: '#000000',
    surface: '#1C1C1E',
    primary: '#0A84FF',
    primaryForeground: '#FFFFFF',
    secondary: '#5E5CE6',
    accent: '#30D158',
    destructive: '#FF453A',
    border: '#38383A',
    text: '#FFFFFF',
    textSecondary: '#EBEBF5',
    muted: '#636366',
  },
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  '2xl': 48,
  '3xl': 64,
} as const;

export const radii = {
  sm: 4,
  md: 8,
  lg: 16,
  full: 9999,
} as const;

export const typography = {
  size: {
    xs: 12,
    sm: 14,
    md: 16,
    lg: 18,
    xl: 22,
    '2xl': 28,
    '3xl': 36,
  },
  weight: {
    regular: '400' as const,
    medium: '500' as const,
    semibold: '600' as const,
    bold: '700' as const,
  },
} as const;
