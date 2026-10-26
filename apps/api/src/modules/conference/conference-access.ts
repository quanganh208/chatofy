import type { Prisma } from '@prisma/client';

/**
 * The rows a caller may read: the conference itself, if they own it or have a
 * participant row in it.
 *
 * One definition for every read that answers "not found" to anybody else — the
 * room detail and its minutes — so the minutes cannot quietly become readable
 * by a wider or narrower set of users than the room they summarize. `callerId`
 * is always the verified token's subject, never a path or body field.
 */
export function visibleToCaller(conferenceId: string, callerId: string) {
  return {
    id: conferenceId,
    OR: [
      { ownerId: callerId },
      { participants: { some: { userId: callerId } } },
    ],
  } satisfies Prisma.ConferenceWhereInput;
}
