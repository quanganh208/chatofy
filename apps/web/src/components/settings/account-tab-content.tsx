'use client';

import { ProfileSettings } from './profile-section';
import { SecuritySection } from './security-section';

/**
 * Settings › Account: the profile header, then the "Security" group.
 *
 * One column at the dialog's group rhythm (24px), the same gap every tab uses
 * between its groups, so the header reads as the top of the tab rather than as a
 * group of its own.
 */
export function AccountTabContent() {
  return (
    <div className="flex flex-col gap-6">
      <ProfileSettings />
      <SecuritySection />
    </div>
  );
}
