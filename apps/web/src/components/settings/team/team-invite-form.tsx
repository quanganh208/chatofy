'use client';

import { useId, useState } from 'react';
import type { MessageKey } from '@chatofy/i18n';
import type { CreateTeamInviteRequest, InviteRole } from '@chatofy/types';
import {
  Button,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@chatofy/ui/react';
import { useTranslate } from '@/i18n/provider';
import { refusalKey } from './team-copy';

/**
 * Invite one address. Invite is the team view's one filled control.
 *
 * Refusals map by status: 409 (already a member, already invited, invited recently
 * or no seat), 403 (only the owner invites an admin), 429 (too many for now: the
 * throttle and the daily cap answer alike). The mail itself is never called "sent":
 * the mail guard may drop it, so the list says "pending".
 */
export function TeamInviteForm({
  canInviteAdmin,
  create,
}: {
  canInviteAdmin: boolean;
  create: (body: CreateTeamInviteRequest) => Promise<void>;
}) {
  const t = useTranslate();
  const id = useId();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<InviteRole>('member');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);

  return (
    <form
      className="flex flex-col gap-2 py-3.5"
      onSubmit={(event) => {
        event.preventDefault();
        const address = email.trim();
        if (!address || busy) return;
        setBusy(true);
        setError(null);
        create({ email: address, role }).then(
          () => {
            setBusy(false);
            setEmail('');
          },
          (err: unknown) => {
            setBusy(false);
            setError(
              refusalKey(err, {
                409: 'web.team.inviteRefused',
                403: 'web.team.inviteForbidden',
                429: 'web.team.inviteTooMany',
              }),
            );
          },
        );
      }}
    >
      <Label htmlFor={id}>{t('web.team.inviteEmail')}</Label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          id={id}
          type="email"
          name="invite-email"
          autoComplete="off"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="sm:flex-1"
        />
        {canInviteAdmin && (
          <Select value={role} onValueChange={(next) => setRole(next as InviteRole)}>
            <SelectTrigger aria-label={t('web.team.roleLabel')} className="sm:w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="member">{t('web.team.roleMember')}</SelectItem>
              <SelectItem value="admin">{t('web.team.roleAdmin')}</SelectItem>
            </SelectContent>
          </Select>
        )}
        <Button type="submit" disabled={busy}>
          {t('web.team.inviteSubmit')}
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-destructive text-hint">
          {t(error)}
        </p>
      )}
      <p className="text-muted-foreground text-hint">{t('web.team.inviteNote')}</p>
    </form>
  );
}
