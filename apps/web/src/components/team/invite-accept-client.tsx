'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
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
import { WorkspaceTile } from '@/components/workspace/workspace-tile';
import {
  clearPendingInvite,
  parkPendingInvite,
  rememberJoinedTeam,
  takeInviteFromUrl,
} from '@/lib/pending-invite';
import { isLiveSession } from '@/lib/session-guard';
import { writeStoredWorkspace } from '@/lib/workspace-store';
import { FINAL_OUTCOMES, InviteOutcome, type Outcome } from './invite-outcome';

type View =
  | { kind: 'loading' }
  | { kind: 'pending'; preview: InvitePreviewResponse }
  | { kind: 'outcome'; outcome: Outcome }
  | { kind: 'load-failed' }
  // Preview answered 401: the session is gone, and only signing in again helps.
  | { kind: 'needs-sign-in' };

const isStatus = (err: unknown, status: number) =>
  err instanceof ApiClientError && err.status === status;

/**
 * The page a team-invite mail links to. Signed out, it offers sign-in or a new
 * account and never puts the token in either link; after sign-in (including a new
 * account's verify, which continues here) it previews the invite, which spends
 * nothing, and joins on one button. The team name is the creator's own text, so it
 * renders as plain text, on its own line beside the team's tile.
 *
 * A join lands in the team: the stored workspace is set to it (this page is outside
 * the app shell, so there is no provider to ask), and the page moves on to
 * `/glossary`, which says "You joined …" once its toast host is up.
 */
export function InviteAcceptClient() {
  const t = useTranslate();
  const params = useSearchParams();
  const router = useRouter();
  const { data, status } = useSession();
  const userId = data?.user?.id;

  // `undefined` until mounted. The server has no URL to strip and no storage to
  // read, so resolving the token in a state initializer made the first client
  // render differ from the server's (a hydration mismatch on every visit). The
  // effect runs before the preview's, which waits on the token, so the URL is still
  // stripped before any request. Once only: the URL this page rewrites (to
  // `/invite`, then `/invite?joined=1`) must not be read again as a new link.
  const [token, setToken] = useState<string | null | undefined>(undefined);
  const firstLinkToken = useRef(params.get('token'));
  useEffect(() => {
    setToken(takeInviteFromUrl(firstLinkToken.current));
  }, []);
  // Set on the URL after a join, so a reload shows the join, not a spent link.
  const [joinedOnLoad] = useState(() => params.get('joined') === '1');
  // A session that can no longer renew is signed out for this page's purposes.
  const signedIn = status === 'authenticated' && isLiveSession(data);
  const [view, setView] = useState<View>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [joining, setJoining] = useState(false);
  const [joinFailed, setJoinFailed] = useState(false);

  useEffect(() => {
    if (!token || !signedIn) return;
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
        if (isStatus(err, 401)) setView({ kind: 'needs-sign-in' });
        else setView(gone ? { kind: 'outcome', outcome: 'invalid' } : { kind: 'load-failed' });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [token, signedIn, attempt]);

  const outcome: Outcome | null =
    token === null
      ? joinedOnLoad
        ? 'joined'
        : 'invalid'
      : view.kind === 'outcome'
        ? view.outcome
        : null;

  useEffect(() => {
    if (outcome && FINAL_OUTCOMES.has(outcome)) clearPendingInvite();
    else if (outcome === 'team-cap' || outcome === 'team-full') parkPendingInvite();
  }, [outcome]);

  if (status === 'loading' || token === undefined) return null;

  if (token === null) return <InviteOutcome outcome={joinedOnLoad ? 'joined' : 'invalid'} />;
  if (outcome) return <InviteOutcome outcome={outcome} />;

  if (!signedIn || view.kind === 'needs-sign-in') {
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
        rememberJoinedTeam(team.name);
        // Shown while the glossary loads, and on a reload if navigating fails.
        window.history.replaceState(null, '', '/invite?joined=1');
        setView({ kind: 'outcome', outcome: 'joined' });
        router.replace('/glossary');
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

  const asAdmin = preview.role === 'admin';
  return (
    <div className="flex flex-col gap-4">
      <div className="flex min-w-0 items-center gap-3">
        <WorkspaceTile kind="team" name={preview.teamName ?? ''} size="lg" />
        <p data-invite-team className="text-heading font-display min-w-0 break-words">
          {preview.teamName}
        </p>
      </div>
      <p className="text-muted-foreground text-prose break-words">
        {preview.inviterEmail
          ? t(asAdmin ? 'web.invite.invitedByAsAdmin' : 'web.invite.invitedByAsMember', {
              email: preview.inviterEmail,
            })
          : t(asAdmin ? 'web.invite.pendingAdmin' : 'web.invite.pendingMember')}
      </p>
      <p className="text-prose">{t('web.invite.whatJoiningMeans')}</p>
      <AuthAlert id="invite-error" message={joinFailed ? t('web.team.actionFailed') : undefined} />
      <Button id="invite-join" type="button" className="w-full" disabled={joining} onClick={join}>
        {t('web.invite.join')}
      </Button>
    </div>
  );
}
