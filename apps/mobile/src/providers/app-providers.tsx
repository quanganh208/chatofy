import { type ReactNode } from 'react';
import { QueryProvider } from './query-provider';
import { AuthProvider } from './auth-provider';
import { PreferencesProvider } from './preferences-provider';
import { ThemeProvider } from './theme-provider';

interface AppProvidersProps {
  children: ReactNode;
}

// Compose all app-wide providers in the correct dependency order:
// QueryClient → Auth (may use queries) → Preferences (needs the session) → Theme (visual only)
export function AppProviders({ children }: AppProvidersProps) {
  return (
    <QueryProvider>
      <AuthProvider>
        <PreferencesProvider>
          <ThemeProvider>{children}</ThemeProvider>
        </PreferencesProvider>
      </AuthProvider>
    </QueryProvider>
  );
}
