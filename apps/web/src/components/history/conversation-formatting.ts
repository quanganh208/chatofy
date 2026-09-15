import type { ConversationSummary } from '@chatofy/types';

/** One run of consecutive conversations that share a calendar day. */
export interface DayGroup {
  /**
   * React's key for this group.
   *
   * The day alone is NOT unique — see `groupByDay` — so it is the id of the first
   * conversation in the run, which is unique and does not move: a group's first
   * member is fixed when the group is created, and paging only ever appends.
   */
  id: string;
  /** What the reader sees above the rows: "Today", "Yesterday", or the date. */
  label: string;
  conversations: ConversationSummary[];
}

/**
 * Head each run of same-day conversations, in the reader's locale.
 *
 * The row then carries only a time. Printing a full date on every row repeats the
 * same eight characters down the column and gives the eye nothing to anchor on,
 * which is what the day heading is for.
 *
 * **Grouping is over what is loaded, never over what exists.** Paging is keyset,
 * so a page boundary can fall in the middle of a day; the last group here grows
 * when the next page arrives, because the whole array is regrouped on every
 * render. That is also why no group carries a count — it would be wrong for
 * exactly one group and there is no way to know which.
 *
 * ## Why a day can appear twice, and why that is the right answer
 *
 * This groups CONSECUTIVE rows and never merges a day back into an earlier one.
 * That is not an optimisation; it is the only honest reading of the data,
 * because the list is ordered by one clock and headed by another:
 *
 * - the API orders by the server-stamped `createdAt` — "the only ordering the
 *   API can vouch for", `prisma-conversation.store.ts`;
 * - the heading is read off `startedAt`, which the BROWSER reports and the write
 *   schema accepts up to a day either side of the server's clock.
 *
 * So a conversation saved late (a retried save) or recorded on a second machine
 * with a skewed clock can carry an older `startedAt` than the row above it.
 * Merging it upward would move the row away from its position in the ordering
 * the server vouches for — reordering the list to make a heading look tidy.
 * Sorting by `startedAt` instead would hand the list's order to a clock that can
 * lie. The heading repeats instead, which is what actually happened.
 */
export function groupByDay(conversations: ConversationSummary[], locale: string): DayGroup[] {
  const groups: DayGroup[] = [];
  let openDay: string | undefined;

  for (const conversation of conversations) {
    const started = new Date(conversation.startedAt);
    const day = dayKey(started);
    const last = groups.at(-1);

    if (last && openDay === day) {
      last.conversations.push(conversation);
      continue;
    }

    openDay = day;
    groups.push({
      id: conversation.conversationId,
      label: dayLabel(started, locale),
      conversations: [conversation],
    });
  }

  return groups;
}

/** The time of day a conversation started, in the reader's locale. */
export function formatTime(iso: string, locale: string): string {
  return new Date(iso).toLocaleTimeString(locale, { timeStyle: 'short' });
}

/** Local calendar day, not UTC: the heading has to match the reader's own midnight. */
function dayKey(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * "Today" / "Yesterday" for the two days that have names, the date otherwise.
 *
 * No dictionary key for either: `RelativeTimeFormat` with `numeric: 'auto'` is
 * what produces a NAME rather than "0 days ago", and it already has both locales.
 * It returns them lowercase, so the first letter is raised here — with the
 * locale's own casing rules, since a heading is not an ASCII operation.
 */
function dayLabel(date: Date, locale: string): string {
  const days = daysFromToday(date);
  if (days === 0 || days === -1) {
    const relative = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(days, 'day');
    return relative.charAt(0).toLocaleUpperCase(locale) + relative.slice(1);
  }
  return date.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'short' });
}

/** Whole calendar days between today and `date`, negative into the past. */
function daysFromToday(date: Date): number {
  const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return Math.round((midnight(date) - midnight(new Date())) / 86_400_000);
}

/**
 * Whole minutes, to the NEAREST, and never fewer than one.
 *
 * Nearest rather than up, because this reads as a length rather than as a bill: a
 * conversation of 6m10s that reported "7 min" would be wrong by more than a tenth
 * in the direction that flatters it. The floor is what keeps a 40-second
 * conversation from reading "0 min" — rounding is not doing that job.
 *
 * Both timestamps come from a browser clock, which is why the API bounds them at
 * the boundary — an unbounded pair could render a duration measured in years.
 */
export function durationMinutes(conversation: ConversationSummary): number {
  const ms = Date.parse(conversation.endedAt) - Date.parse(conversation.startedAt);
  return Math.max(1, Math.round(ms / 60_000));
}

/**
 * A position inside a recording, as `m:ss` — or `h:mm:ss` past an hour.
 *
 * **No dictionary key, and that is deliberate rather than an omission.** Both
 * locales write these with latin digits and a colon, so `00:06` reads identically
 * on either — a key would be a "translation" that can never differ from its
 * source, and the compiler-enforced parity would then guard nothing. It is
 * `padStart`, not `Intl`.
 *
 * Seconds are FLOORED, not rounded. This labels a moment a reader can seek to: a
 * line that begins at 5.9s and reads "0:06" sends the player past its own first
 * syllable, while "0:05" lands just before it. Early is recoverable by listening;
 * late has already cut the word off.
 *
 * A negative — which `mediaOffset` clamps away before this is reached — renders
 * as `0:00` rather than `-0:01`, because a gutter is not the place to report a
 * clock disagreement.
 */
export function formatOffset(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const seconds = `${total % 60}`.padStart(2, '0');
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);
  return hours > 0
    ? `${hours}:${`${minutes}`.padStart(2, '0')}:${seconds}`
    : `${minutes}:${seconds}`;
}

/**
 * Where a stored turn sits in the RECORDING, given where the recording began.
 *
 * A turn's `offsetMs` is measured from the conversation's `startedAt`, which is
 * stamped before the microphone is even requested; the recording begins later, by
 * however long the permission prompt, the worklet load and the socket connect
 * took. Subtracting `audioOffsetMs` is what turns conversation time into media
 * time.
 *
 * **This must be used for the DISPLAYED number as well as for the seek.** An
 * earlier draft subtracted only when seeking, which left the gutter reading one
 * time and the player's own readout another — the two disagreeing by exactly that
 * startup interval, which is small enough to look like a rounding bug and large
 * enough to miss a short sentence.
 *
 * Null in, null out: a turn with no capture record has no position to show.
 */
export function mediaOffset(offsetMs: number | null, audioOffsetMs: number | null): number | null {
  if (offsetMs === null) return null;
  return Math.max(0, offsetMs - (audioOffsetMs ?? 0));
}
