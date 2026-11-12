'use client';

import type { ReactNode } from 'react';
import { ChromeSlotsProvider, useChromeSlots } from '@/components/layout/chrome-slots';

/**
 * For specs: the two slots of the real topbar — its trailing crumb, read out as an
 * `h1`, and the box `TopbarActions` portals into — without the sidebar provider the
 * real `AppTopbar` needs. A screen that puts its title and actions in the topbar
 * renders neither outside the chrome, so a spec of that screen mounts it in this.
 */
export function ChromeSlotsTestHost({ children }: { children: ReactNode }) {
  return (
    <ChromeSlotsProvider>
      <TopbarSlots />
      {children}
    </ChromeSlotsProvider>
  );
}

function TopbarSlots() {
  const slots = useChromeSlots();
  return (
    <div data-slot="app-topbar">
      <h1 data-slot="topbar-crumb">{slots?.trailingCrumb ?? ''}</h1>
      <div ref={slots?.setActionsTarget} data-slot="topbar-actions" />
    </div>
  );
}
