import type { ConversationSummary } from '@chatofy/types';

/** One calendar day of conversations, newest day first. */
export interface DayGroup {
  /** The local calendar day, `YYYY-MM-DD`. Stable across a re-render and a re-fetch. */
  key: string;
  /** What the reader sees above the rows: "Today", "Yesterday", or the date. */
  label: string;
  conversations: ConversationSummary[];
}

/**
 * Group the loaded conversations by the day they started, in the reader's locale.
 *
 * The row then carries only a time. Printing a full date on every row repeats the
 * same eight characters down the column and gives the eye nothing to anchor on,
 * which is what the day heading is for.
 *
 * **Grouping is over what is loaded, never over what exists.** Paging is keyset,
 * so a page boundary can fall in the middle of a day; the last group here grows
 * when the next page arrives. That is also why no group carries a count — it
 * would be wrong for exactly one group and there is no way to know which.
 */
export function groupByDay(conversations: ConversationSummary[], locale: string): DayGroup[] {
  const groups: DayGroup[] = [];

  for (const conversation of conversations) {
    const started = new Date(conversation.startedAt);
    const key = dayKey(started);
    const last = groups.at(-1);
    // Same day as the row above: extend that group. The list arrives sorted, so
    // a day can only ever be the one still open — no lookup by key is needed,
    // and none is wanted, because a day that reappeared later would mean the
    // sort broke and silently merging it would hide that.
    if (last?.key === key) {
      last.conversations.push(conversation);
      continue;
    }
    groups.push({ key, label: dayLabel(started, locale), conversations: [conversation] });
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
 * Whole minutes, rounded up, so a 40-second conversation does not read "0 min".
 *
 * Both timestamps come from a browser clock, which is why the API bounds them at
 * the boundary — an unbounded pair could render a duration measured in years.
 */
export function durationMinutes(conversation: ConversationSummary): number {
  const ms = Date.parse(conversation.endedAt) - Date.parse(conversation.startedAt);
  return Math.max(1, Math.round(ms / 60_000));
}
