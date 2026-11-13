'use client';

import type { CreditBalance } from '@chatofy/types';
import { dawn, palettes } from '@chatofy/ui';
import { Badge } from '@chatofy/ui/react';
import { useCreditBalance } from '@/hooks/use-credits';
import { useTranslate } from '@/i18n/provider';
import { openSettingsDialog } from '@/components/settings/use-settings-dialog';
import { cn } from '@/lib/utils';

/**
 * The reader's plan — Free or Pro — beside their name in the chrome.
 *
 * **Free is quiet, Pro wears the dawn.** Free is an outline pill in muted ink: it is
 * the default, and a default should not ask to be looked at. Pro sits on the lotus's
 * dawn gradient, the one place the dawn is a ground behind text. That is an exception
 * to "dawn is never behind text" and it holds because the ink is fixed: the dawn stops
 * are light in both schemes, so the label is the LIGHT palette's text in dark mode too
 * — a scheme-following `foreground` would turn near-white on a pastel. The pairing is
 * measured in `plan-badge.spec.tsx` against every stop.
 *
 * **A readout, not the screen's action.** Neither treatment is `bg-primary`, so the
 * accent gate (`design/accent-count.ts`) never counts it — and must not: the plan is
 * on every screen, and it would spend each one's single accent.
 *
 * **Nothing until the balance lands, and nothing on failure.** The same rule as the
 * credit line beside it: a failed billing read is Settings › Billing's to explain. The
 * pill is shorter than the name's line, so its arrival does not move the footer.
 */
export type Plan = CreditBalance['plan'];

/** The plan as the chrome shows it: `null` while the balance loads or if it failed. */
export function usePlan(): Plan | null {
  return useCreditBalance().balance?.plan ?? null;
}

/** The plan's name in the reader's locale — the same words Settings › Billing uses. */
export function usePlanName(): (plan: Plan) => string {
  const t = useTranslate();
  return (plan) => t(plan === 'pro' ? 'common.billing.planPro' : 'common.billing.planFree');
}

const DAWN_GROUND = `linear-gradient(90deg, ${dawn.peach}, ${dawn.lavender}, ${dawn.mint})`;

/** The fixed ink on the dawn ground; see the component note. */
export const PRO_INK = palettes.light.text;

function planStyle(plan: Plan): React.CSSProperties | undefined {
  return plan === 'pro' ? { backgroundImage: DAWN_GROUND, color: PRO_INK } : undefined;
}

// `py-0 leading-4`: 18px tall with its border, under the name's line height, so the
// pill never makes the row taller than the name alone.
const PILL = 'py-0 leading-4';

/** The pill as text, for a row that is already a control (the More sheet's identity row). */
export function PlanBadge({ plan, className }: { plan: Plan; className?: string }) {
  const name = usePlanName();
  return (
    <Badge
      data-slot="plan-badge"
      data-plan={plan}
      variant={plan === 'pro' ? 'secondary' : 'outline'}
      className={cn(PILL, plan === 'free' && 'text-muted-foreground', className)}
      style={planStyle(plan)}
    >
      {name(plan)}
    </Badge>
  );
}

/**
 * The pill as a button that opens Settings › Billing — the sidebar footer's.
 *
 * Opened directly rather than through the account menu: the badge sits beside that
 * menu's trigger, not inside it, so focus is on the badge when the dialog opens and
 * the dialog hands it back there on close.
 */
export function PlanBadgeButton({ className }: { className?: string }) {
  const plan = usePlan();
  const t = useTranslate();
  const name = usePlanName();
  if (plan === null) return null;
  return (
    <Badge
      asChild
      variant={plan === 'pro' ? 'secondary' : 'outline'}
      className={cn(
        PILL,
        'cursor-pointer outline-none hover:ring-1 hover:ring-ring',
        plan === 'free' && 'text-muted-foreground hover:text-foreground',
        className,
      )}
      style={planStyle(plan)}
    >
      <button
        type="button"
        data-slot="plan-badge"
        data-plan={plan}
        data-settings-tab="billing"
        aria-haspopup="dialog"
        aria-label={t('web.chrome.planOpenBilling', { plan: name(plan) })}
        onClick={() => openSettingsDialog('billing')}
      >
        {name(plan)}
      </button>
    </Badge>
  );
}

/**
 * Pro's mark on the avatar when the sidebar is the icon rail, where the name and the
 * pill have no room. Decorative: the account menu's trigger names the plan.
 */
export function PlanDot({ plan }: { plan: Plan | null }) {
  if (plan !== 'pro') return null;
  return (
    <span
      aria-hidden
      data-slot="plan-dot"
      className="ring-sidebar absolute right-0 bottom-0 hidden size-2.5 rounded-full ring-2 group-data-[collapsible=icon]:block"
      style={{ backgroundImage: DAWN_GROUND }}
    />
  );
}
