'use client';

import Link from 'next/link';
import type { MessageKey } from '@chatofy/i18n';
import { TEAM_LIMITS, type InvitePreviewStatus } from '@chatofy/types';
import { Button } from '@chatofy/ui/react';
import { useTranslate } from '@/i18n/provider';
import { signOutOfChatofy } from '@/lib/sign-out';

/** Where `/invite` ends up once there is nothing left to decide. */
export type Outcome = Exclude<InvitePreviewStatus, 'pending'> | 'invalid' | 'joined';

const OUTCOME_COPY: Record<Outcome, MessageKey> = {
  accepted: 'web.invite.used',
  revoked: 'web.invite.revoked',
  expired: 'web.invite.expired',
  'wrong-account': 'web.invite.wrongAccount',
  'already-member': 'web.invite.alreadyMember',
  'team-cap': 'web.invite.teamCap',
  'team-full': 'web.invite.teamFull',
  invalid: 'web.invite.invalid',
  joined: 'web.invite.joined',
};

/**
 * Over for good: the pending token is dropped. `wrong-account` keeps it, because the
 * next step is signing in as the invited address; the two caps keep it, because
 * leaving a team or a freed seat makes the same invite good again.
 */
export const FINAL_OUTCOMES: ReadonlySet<Outcome> = new Set([
  'accepted',
  'revoked',
  'expired',
  'already-member',
  'invalid',
  'joined',
]);

/** A status with nothing left to decide, and the one next step it allows. */
export function InviteOutcome({ outcome }: { outcome: Outcome }) {
  const t = useTranslate();
  const toGlossary = outcome === 'joined' || outcome === 'already-member';

  return (
    <div className="flex flex-col items-start gap-4">
      <p role="status" data-invite-outcome={outcome} className="text-prose">
        {t(OUTCOME_COPY[outcome], { max: TEAM_LIMITS.MAX_TEAMS_PER_USER })}
      </p>
      {toGlossary && (
        <Button asChild variant="outline">
          <Link href="/glossary">{t('web.invite.openGlossary')}</Link>
        </Button>
      )}
      {outcome === 'wrong-account' && (
        <Button variant="outline" onClick={() => void signOutOfChatofy('/login?next=%2Finvite')}>
          {t('common.auth.signOut')}
        </Button>
      )}
    </div>
  );
}
