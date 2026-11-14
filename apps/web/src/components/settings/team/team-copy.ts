import { ApiClientError } from '@chatofy/api-client';
import type { MessageKey } from '@chatofy/i18n';
import type { TeamRole } from '@chatofy/types';

/** A role's display name. */
export const ROLE_KEY: Record<TeamRole, MessageKey> = {
  owner: 'web.team.roleOwner',
  admin: 'web.team.roleAdmin',
  member: 'web.team.roleMember',
};

/**
 * Copy for a refused request, by HTTP status only: the API's message is English
 * server copy and is never matched. Anything without its own line gets the
 * generic one.
 */
export function refusalKey(
  err: unknown,
  byStatus: Partial<Record<number, MessageKey>>,
): MessageKey {
  if (err instanceof ApiClientError) return byStatus[err.status] ?? 'web.team.actionFailed';
  return 'web.team.actionFailed';
}
