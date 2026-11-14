import { describe, expect, it } from 'vitest';
import {
  canEditRow,
  mintTeamScope,
  personalScope,
  scopeLockKey,
  scopeWhere,
} from './library-scope';

describe('library scope', () => {
  it('confines a personal scope to the caller rows that belong to no team', () => {
    // `teamId: null` is the whole point: without it, the author's team rows
    // match a personal query too.
    expect(scopeWhere(personalScope('u'))).toEqual({
      ownerId: 'u',
      teamId: null,
    });
  });

  it('confines a team scope to the team rows, whoever authored them', () => {
    expect(scopeWhere(mintTeamScope('u', 't', 'member'))).toEqual({
      teamId: 't',
    });
  });

  it('lets the caller edit every personal row', () => {
    expect(canEditRow(personalScope('u'), 'u')).toBe(true);
  });

  it('lets a team owner and admin edit any team row', () => {
    expect(canEditRow(mintTeamScope('u', 't', 'owner'), 'someone-else')).toBe(
      true,
    );
    expect(canEditRow(mintTeamScope('u', 't', 'admin'), 'someone-else')).toBe(
      true,
    );
  });

  it('lets a plain member edit only the team rows they authored', () => {
    const member = mintTeamScope('u', 't', 'member');
    expect(canEditRow(member, 'u')).toBe(true);
    expect(canEditRow(member, 'someone-else')).toBe(false);
  });

  it('keys the lock on the user for personal and on the team for a team', () => {
    expect(scopeLockKey(personalScope('u'))).toBe('u');
    expect(scopeLockKey(mintTeamScope('u', 't', 'admin'))).toBe('t');
  });
});
