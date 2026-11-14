/**
 * Which library a request reads or writes: the caller's personal one, or a
 * team's shared one.
 *
 * A team row keeps its author in `ownerId`, so a filter on `ownerId` alone
 * matches the author's team rows too — a personal route would list, rename,
 * count and delete them, even after the author left the team. Every library
 * store query therefore builds its `where` through {@link scopeWhere}, whose
 * personal form also requires `teamId: null`.
 *
 * A {@link TeamScope} is branded and minted only by {@link mintTeamScope},
 * which only the team-access service calls after reading the caller's
 * membership. Holding one is the proof that membership was checked; there is
 * no way to build one from a request parameter.
 */
import type { TeamRole } from '@chatofy/types';

declare const teamScopeBrand: unique symbol;

export interface PersonalScope {
  readonly kind: 'personal';
  readonly userId: string;
}

export interface TeamScope {
  readonly kind: 'team';
  readonly userId: string;
  readonly teamId: string;
  readonly role: TeamRole;
  readonly [teamScopeBrand]: true;
}

export type LibraryScope = PersonalScope | TeamScope;

export function personalScope(userId: string): PersonalScope {
  return { kind: 'personal', userId };
}

/** ONLY TeamAccessService may call this: it is the proof that membership was read. */
export function mintTeamScope(
  userId: string,
  teamId: string,
  role: TeamRole,
): TeamScope {
  return { kind: 'team', userId, teamId, role } as TeamScope;
}

/** The `where` fragment that confines a query to one scope's rows. */
export function scopeWhere(
  scope: LibraryScope,
): { ownerId: string; teamId: null } | { teamId: string } {
  return scope.kind === 'personal'
    ? { ownerId: scope.userId, teamId: null }
    : { teamId: scope.teamId };
}

/** Personal rows are always the caller's; a team member edits only what they authored. */
export function canEditRow(scope: LibraryScope, authorId: string): boolean {
  return (
    scope.kind === 'personal' ||
    scope.role !== 'member' ||
    authorId === scope.userId
  );
}

/** The second int of a library advisory lock: the user for personal, the team for a team. */
export function scopeLockKey(scope: LibraryScope): string {
  return scope.kind === 'personal' ? scope.userId : scope.teamId;
}
