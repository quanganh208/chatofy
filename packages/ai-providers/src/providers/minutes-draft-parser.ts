// The minutes JSON a model returns, read into a draft — shared by every host
// that writes minutes, so what counts as a usable answer is decided once.
import { ProviderResponseError } from '../errors/provider-errors.js';
import type { MeetingMinutesDraft } from '../interfaces/summarization-provider.js';

/** The JSON the model is asked to return, before the app adds ids/timestamps. */
interface RawMinutes {
  summary?: unknown;
  keyPoints?: unknown;
  decisions?: unknown;
  actionItems?: unknown;
}

/**
 * Parse the model's JSON into a draft, defensively.
 *
 * A malformed body is a response-shape failure, not a transport one — the
 * request succeeded and the model simply did not produce the object it was
 * asked for. Every array coerces to `[]` and every missing string to `''`
 * rather than throwing on a partial object: a minutes pass over a short
 * exchange legitimately has no decisions or action items, and that must read
 * as an empty list, not as a failed generation.
 */
export function parseMinutesDraft(body: string, model: string): MeetingMinutesDraft {
  let raw: RawMinutes;
  try {
    raw = JSON.parse(body) as RawMinutes;
  } catch {
    throw new ProviderResponseError(`${model} returned non-JSON minutes`);
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new ProviderResponseError(`${model} returned non-JSON minutes`);
  }
  return {
    summary: typeof raw.summary === 'string' ? raw.summary : '',
    keyPoints: asStringArray(raw.keyPoints),
    decisions: asStringArray(raw.decisions),
    actionItems: asActionItems(raw.actionItems),
    model,
  };
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

function asActionItems(value: unknown): MeetingMinutesDraft['actionItems'] {
  if (!Array.isArray(value)) return [];
  const items: MeetingMinutesDraft['actionItems'] = [];
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) continue;
    const e = entry as Record<string, unknown>;
    if (typeof e.description !== 'string' || !e.description) continue;
    items.push({
      description: e.description,
      owner: typeof e.owner === 'string' ? e.owner : null,
      dueDate: typeof e.dueDate === 'string' ? e.dueDate : null,
    });
  }
  return items;
}
