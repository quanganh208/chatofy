'use client';

import type { TeamMemberEntry, TeamRole } from '@chatofy/types';
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Badge,
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@chatofy/ui/react';
import { initials } from '@/components/layout/session-identity';
import { useTranslate } from '@/i18n/provider';
import { ROLE_KEY } from './team-copy';

/** The name a row shows: the member's name, else their email, else a placeholder. */
export function memberName(member: TeamMemberEntry, unnamed: string): string {
  return member.name ?? member.email ?? unnamed;
}

/** May `viewer` remove this row? The owner removes anyone else; an admin, members only. */
export function canRemoveMember(viewer: TeamRole, member: TeamMemberEntry): boolean {
  if (member.isSelf) return false;
  if (viewer === 'owner') return member.role !== 'owner';
  return viewer === 'admin' && member.role === 'member';
}

/**
 * One member: avatar, name, the email when the viewer may see it, and the role, as a
 * Select when the viewer is the owner. Rows are addressed by the membership id; no
 * user id ever reaches the client.
 */
export function TeamMemberRow({
  member,
  viewer,
  onRole,
  onRemove,
}: {
  member: TeamMemberEntry;
  viewer: TeamRole;
  onRole: (role: 'admin' | 'member') => void;
  onRemove: () => void;
}) {
  const t = useTranslate();
  const name = memberName(member, t('web.team.unnamed'));
  const canChangeRole = viewer === 'owner' && member.role !== 'owner';

  return (
    <div data-member-row={member.id} className="flex flex-wrap items-center gap-3 py-3">
      <Avatar className="size-8">
        <AvatarImage src={member.avatarUrl ?? undefined} alt="" />
        <AvatarFallback>
          {initials(member.name ?? undefined, member.email ?? undefined)}
        </AvatarFallback>
      </Avatar>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-body truncate">
          {name}
          {member.isSelf && <span className="text-muted-foreground"> ({t('web.team.you')})</span>}
        </span>
        {member.email && member.name && (
          <span className="text-muted-foreground text-hint truncate">{member.email}</span>
        )}
      </div>
      {canChangeRole ? (
        <Select value={member.role} onValueChange={(role) => onRole(role as 'admin' | 'member')}>
          <SelectTrigger size="sm" aria-label={t('web.team.roleLabel')} className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="admin">{t('web.team.roleAdmin')}</SelectItem>
            <SelectItem value="member">{t('web.team.roleMember')}</SelectItem>
          </SelectContent>
        </Select>
      ) : (
        <Badge variant="secondary">{t(ROLE_KEY[member.role])}</Badge>
      )}
      {canRemoveMember(viewer, member) && (
        <Button variant="ghost" size="sm" data-member-remove onClick={onRemove}>
          {t('web.team.remove')}
        </Button>
      )}
    </div>
  );
}
