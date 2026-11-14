'use client';

import { useState } from 'react';
import type { MessageKey } from '@chatofy/i18n';
import type { TeamMemberEntry, TeamSummary } from '@chatofy/types';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  Skeleton,
} from '@chatofy/ui/react';
import type { TeamListStatus } from '@/hooks/use-team-list';
import { useTranslate } from '@/i18n/provider';
import { SettingsSection } from '../settings-section';
import { refusalKey } from './team-copy';
import { memberName, TeamMemberRow } from './team-member-row';

/**
 * The member list, with role changes for the owner and removal by role. Removal asks
 * first; the dialog keeps the member it opened for, and the whole view remounts on a
 * team switch (see `TeamTabContent`), so it can only ever act on the team it showed.
 */
export function TeamMembersSection({
  team,
  members,
  status,
  changeRole,
  remove,
  retry,
}: {
  team: TeamSummary;
  members: TeamMemberEntry[];
  status: TeamListStatus;
  changeRole: (memberId: string, role: 'admin' | 'member') => Promise<void>;
  remove: (memberId: string) => Promise<void>;
  retry: () => Promise<void>;
}) {
  const t = useTranslate();
  const [removing, setRemoving] = useState<TeamMemberEntry | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);
  const unnamed = t('web.team.unnamed');

  const act = (write: Promise<void>) =>
    write.catch((err: unknown) => setError(refusalKey(err, {})));

  let body: React.ReactNode;
  if (members.length === 0 && status === 'failed') {
    body = (
      <div className="flex items-center gap-3 py-3">
        <p role="alert" className="text-destructive text-prose flex-1">
          {t('web.team.loadFailed')}
        </p>
        <Button variant="outline" size="sm" onClick={() => void retry()}>
          {t('web.team.retry')}
        </Button>
      </div>
    );
  } else if (members.length === 0) {
    body = <Skeleton className="my-3 h-10" />;
  } else {
    body = members.map((member) => (
      <TeamMemberRow
        key={member.id}
        member={member}
        viewer={team.role}
        onRole={(role) => {
          setError(null);
          void act(changeRole(member.id, role));
        }}
        onRemove={() => {
          setError(null);
          setRemoving(member);
        }}
      />
    ));
  }

  return (
    <>
      <SettingsSection title={t('web.team.members')}>{body}</SettingsSection>
      {error && (
        <p role="alert" className="text-destructive text-hint -mt-4 px-1">
          {t(error)}
        </p>
      )}
      <AlertDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setRemoving(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('web.team.removeConfirmTitle', {
                name: removing ? memberName(removing, unnamed) : '',
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>{t('web.team.removeConfirmBody')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>{t('web.team.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={busy}
              onClick={(event) => {
                event.preventDefault();
                if (!removing) return;
                setBusy(true);
                void act(remove(removing.id)).finally(() => {
                  setBusy(false);
                  setRemoving(null);
                });
              }}
            >
              {t('web.team.remove')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
