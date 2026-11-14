'use client';

import { useEffect, useId, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { ApiClientError } from '@chatofy/api-client';
import type { InvitePreviewResponse } from '@chatofy/types';
import { Button } from '@chatofy/ui/react';
import { AuthAlert } from '@/components/auth/auth-alert';
import {
  acceptTeamInvite,
  inviteRefusalStatus,
  previewTeamInvite,
} from '@/clients/teams-api-client';
import { useTranslate } from '@/i18n/provider';
import {
  INVITE_TOKEN_PATTERN,
  clearPendingInvite,
  readPendingInvite,
  savePendingInvite,
} from '@/lib/pending-invite';
import { writeStoredWorkspace } from '@/lib/workspace-store';
import { FINAL_OUTCOMES, InviteOutcome, type Outcome } from './invite-outcome';

type View =
  | { kind: 'loading' }
  | { kind: 'pending'; preview: InvitePreviewResponse }
  | { kind: 'outcome'; outcome: Outcome }
  | { kind: 'load-failed' };

/**
 * Take the token out of the URL before anything else runs, so it sits in the
 * address bar and history for no longer than this read. Runs in the state
 * initializer rather than an effect: the first client render already knows the
 * token, and repeating it is harmless (the URL is stripped, the save is the same).
 */
function takeToken(fromUrl: string | null): string | null | undefined {
  if (typeof window === 'undefined') return undefined;
  if (fromUrl !== null) {
    window.history.replaceState(null, '', '/invite');
    if (INVITE_TOKEN_PATTERN.test(fromUrl)) savePendingInvite(fromUrl);
  }
  return readPendingInvite();
}

const isStatus = (err: unknown, status: number) =>
  err instanceof ApiClientError && err.status === status;

/**
 * The page a team-invite mail links to. Signed out, it offers sign-in or a new
 * account and never puts the token in either link; after sign-in (including a new
 * account's verify, which continues here) it previews the invite, which spends
 * nothing, and joins on one button. The team name is the creator's own text, so it
 * renders on its own line as plain text and never inside a sentence.
 */
export function InviteAcceptClient() {
  const t = useTranslate();
  const params = useSearchParams();
  const { data, status } = useSession();
  const userId = data?.user?.id;
  const nameLabelId = useId();

  const [token] = useState(() => takeToken(params.get('token')));
  const [view, setView] = useState<View>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [joining, setJoining] = useState(false);
  const [joinFailed, setJoinFailed] = useState(false);

  useEffect(() => {
    if (!token || status !== 'authenticated') return;
    let cancelled = false;
    previewTeamInvite(token).then(
      (preview) => {
        if (cancelled) return;
        setView(
          preview.status === 'pending'
            ? { kind: 'pending', preview }
            : { kind: 'outcome', outcome: preview.status },
        );
      },
      (err: unknown) => {
        if (cancelled) return;
        const gone = isStatus(err, 404) || isStatus(err, 400);
        setView(gone ? { kind: 'outcome', outcome: 'invalid' } : { kind: 'load-failed' });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [token, status, attempt]);

  const outcome: Outcome | null =
    token === null ? 'invalid' : view.kind === 'outcome' ? view.outcome : null;

  useEffect(() => {
    if (outcome && FINAL_OUTCOMES.has(outcome)) clearPendingInvite();
  }, [outcome]);

  if (status === 'loading' || token === undefined) return null;

  if (token === null) return <InviteOutcome outcome="invalid" />;
  if (outcome) return <InviteOutcome outcome={outcome} />;

  if (status !== 'authenticated') {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-prose">{t('web.invite.signInPrompt')}</p>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link href="/login?next=%2Finvite">{t('common.auth.signIn')}</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/register?next=%2Finvite">{t('web.invite.createAccount')}</Link>
          </Button>
        </div>
      </div>
    );
  }

  if (view.kind === 'load-failed') {
    return (
      <div className="flex flex-col items-start gap-4">
        <p role="alert" className="text-destructive text-prose">
          {t('web.invite.loadFailed')}
        </p>
        <Button
          variant="outline"
          onClick={() => {
            setView({ kind: 'loading' });
            setAttempt((n) => n + 1);
          }}
        >
          {t('web.team.retry')}
        </Button>
      </div>
    );
  }

  if (view.kind !== 'pending') return null;

  const { preview } = view;
  const join = () => {
    setJoining(true);
    setJoinFailed(false);
    acceptTeamInvite(token).then(
      ({ team }) => {
        if (userId) writeStoredWorkspace(userId, team.id);
        setView({ kind: 'outcome', outcome: 'joined' });
      },
      (err: unknown) => {
        setJoining(false);
        const refusal = inviteRefusalStatus(err);
        if (refusal) setView({ kind: 'outcome', outcome: refusal });
        else if (isStatus(err, 403)) setView({ kind: 'outcome', outcome: 'wrong-account' });
        else if (isStatus(err, 404)) setView({ kind: 'outcome', outcome: 'invalid' });
        else setJoinFailed(true);
      },
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-prose">
        {t(preview.role === 'admin' ? 'web.invite.pendingAdmin' : 'web.invite.pendingMember')}
      </p>
      <div role="group" aria-labelledby={nameLabelId} className="flex flex-col gap-1">
        <span id={nameLabelId} className="text-muted-foreground text-hint">
          {t('web.invite.teamNameLabel')}
        </span>
        <p className="text-prose break-words">{preview.teamName}</p>
      </div>
      {preview.inviterEmail && (
        <p className="text-muted-foreground text-prose break-words">
          {t('web.invite.invitedBy', { email: preview.inviterEmail })}
        </p>
      )}
      <AuthAlert id="invite-error" message={joinFailed ? t('web.team.actionFailed') : undefined} />
      <Button id="invite-join" type="button" className="w-full" disabled={joining} onClick={join}>
        {t('web.invite.join')}
      </Button>
    </div>
  );
}
