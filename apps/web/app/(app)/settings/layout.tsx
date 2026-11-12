import { SettingsSubnav } from '@/components/settings/settings-subnav';

/**
 * Every settings page: the sub-navigation beside a content column from `lg`, above it
 * below that (see `settings-subnav.tsx` for why not from `md`).
 *
 * The column is capped at 680px — rows of a label and a control read as a person's
 * settings at that width, and as a table across the full page measure. Session-gated
 * by `proxy.ts` like every other app route.
 */
export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:gap-10">
      <SettingsSubnav />
      <div className="w-full max-w-[680px] min-w-0">{children}</div>
    </div>
  );
}
