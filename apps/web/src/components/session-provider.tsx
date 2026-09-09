'use client';

import { SessionProvider } from 'next-auth/react';

/**
 * Makes the session readable from client components.
 *
 * A thin `'use client'` wrapper because the root layout is a server component
 * and Auth.js's provider is not. Nothing is passed in: the provider fetches
 * `/api/auth/session` itself, which keeps the token out of the server-rendered
 * HTML — where it would sit in the page source of every response.
 */
export function AppSessionProvider({ children }: { children: React.ReactNode }) {
  return <SessionProvider>{children}</SessionProvider>;
}
