'use client';

import { cn } from '@/lib/utils';

/**
 * The square that stands for a workspace wherever one is named: the switcher, the
 * mobile chip, the Settings › Team header, the team rows and the shared-library note.
 *
 * A team gets the first letter of its name on the muted ground — never the accent,
 * since a tile is a readout of where you are, not an action. Personal gets the first
 * letter of the signed-in user's name, in a circle, so the two read apart at a glance.
 *
 * `Array.from` keeps a Vietnamese precomposed letter whole; `toLocaleUpperCase` keeps
 * "đ" as "Đ".
 */
export function WorkspaceTile({
  kind,
  name,
  size = 'md',
  className,
}: {
  kind: 'personal' | 'team';
  /** The team's name, or the user's name (or email) for personal. */
  name: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const letter = (Array.from(name.trim())[0] ?? '?').toLocaleUpperCase();
  return (
    <span
      aria-hidden
      data-workspace-tile={kind}
      className={cn(
        'bg-muted text-foreground inline-flex shrink-0 items-center justify-center font-semibold select-none',
        kind === 'team' ? 'rounded-md' : 'rounded-full',
        size === 'sm' && 'text-label size-5',
        size === 'md' && 'text-label size-6',
        size === 'lg' && 'text-body size-9',
        className,
      )}
    >
      {letter}
    </span>
  );
}
