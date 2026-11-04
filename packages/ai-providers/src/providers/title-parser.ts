// The title JSON a model returns, read into one display line — shared by every
// host, so what counts as a usable title is decided once.
import { ProviderResponseError } from '../errors/provider-errors.js';
import { TITLE_MAX_CHARS } from './title-prompt-builder.js';

/** One fenced block around the whole answer, which some proxies add in JSON mode. */
const FENCED = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i;

/** Quote marks a model wraps a title in, in the scripts the app serves. */
const QUOTES = `"'“”‘’«»「」『』`;

/**
 * Parse `{"title": string}` into a single plain line of at most
 * {@link TITLE_MAX_CHARS} characters.
 *
 * Normalised rather than trusted: the title is rendered on every history row,
 * so a newline, a wrapping quote or a run-on answer would show there as-is.
 * Cut at a word boundary when there is one, so a long title reads as shortened
 * rather than broken.
 */
export function parseTitle(text: string, model: string): string {
  const body = text.trim().replace(FENCED, '$1').trim();
  let raw: unknown;
  try {
    raw = (JSON.parse(body) as { title?: unknown } | null)?.title;
  } catch (err) {
    throw new ProviderResponseError(`${model} returned a title that is not JSON: ${String(err)}`);
  }
  if (typeof raw !== 'string') {
    throw new ProviderResponseError(`${model} returned no title string`);
  }

  let title = raw.replace(/\s+/g, ' ').trim();
  while (title.length > 0 && QUOTES.includes(title[0]!) && QUOTES.includes(title.at(-1)!)) {
    title = title.slice(1, -1).trim();
  }
  title = title.replace(/[.。]+$/u, '').trim();

  if (title.length > TITLE_MAX_CHARS) {
    const cut = title.slice(0, TITLE_MAX_CHARS);
    const space = cut.lastIndexOf(' ');
    title = (space > 0 ? cut.slice(0, space) : cut).trim();
  }

  if (!title) throw new ProviderResponseError(`${model} returned an empty title`);
  return title;
}
