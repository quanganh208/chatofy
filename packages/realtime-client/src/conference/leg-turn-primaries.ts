import type { LanguageCode } from '@chatofy/types';

/**
 * The primary language each of a speaker's turns was STARTED in.
 *
 * The server translates and voices a turn in the target its start named, and it
 * says so on every audio frame only when the start asked for several languages.
 * The room the leg reads its targets from can change between that start and the
 * moment a frame or subtitle of the turn is relayed — a listener leaves, another
 * joins — so the live room is the wrong answer to "what language is this in":
 * read then, untagged English audio could go out tagged as Chinese. This keeps
 * the answer given at start, under the client's turn id (what playback keys
 * frames by) and, once `server.session.ready` names it, the server's session id
 * (what subtitles are keyed by).
 */

/** Ids remembered at once, of both kinds together. Oldest is forgotten first. */
const MAX_TRACKED_IDS = 256;

export class LegTurnPrimaries {
  private readonly primaries = new Map<string, LanguageCode>();
  /** Turns already logged for audio dropped with no known language. */
  private readonly dropsLogged = new Set<string>();

  /** A start went out for `turnId` with `primary` as its target. */
  started(turnId: string, primary: LanguageCode): void {
    remember(this.primaries, turnId, primary);
  }

  /** The server named the turn; its session id now answers too. */
  named(turnId: string, sessionId: string): void {
    const primary = this.primaries.get(turnId);
    if (primary !== undefined) remember(this.primaries, sessionId, primary);
  }

  /** The turn's primary, by either of its ids; undefined for a turn never seen starting. */
  get(id: string): LanguageCode | undefined {
    return this.primaries.get(id);
  }

  /** True the first time only, so a dropped turn is logged once rather than per frame. */
  firstDrop(turnId: string): boolean {
    if (this.dropsLogged.has(turnId)) return false;
    this.dropsLogged.add(turnId);
    while (this.dropsLogged.size > MAX_TRACKED_IDS) {
      const oldest = this.dropsLogged.values().next().value;
      if (oldest === undefined) break;
      this.dropsLogged.delete(oldest);
    }
    return true;
  }
}

function remember(map: Map<string, LanguageCode>, id: string, primary: LanguageCode): void {
  map.delete(id);
  map.set(id, primary);
  while (map.size > MAX_TRACKED_IDS) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
}
