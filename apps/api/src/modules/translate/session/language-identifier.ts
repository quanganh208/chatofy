import type { LanguageCode } from '@chatofy/types';

/** DI token for {@link LanguageIdentifier} — registered in `translate.module.ts`. */
export const LANGUAGE_IDENTIFIER = Symbol('LANGUAGE_IDENTIFIER');

/**
 * Decides which language(s) a turn was actually spoken in.
 *
 * Called once per turn — every WS turn (`TurnSession`) and every REST call
 * (`TranslateController`) — with the language the CLIENT declared for the
 * conversation, not with audio. Today's only implementation trusts that
 * declaration outright; a real identifier would read the turn's audio instead,
 * which is why this takes a turn-shaped argument rather than a bare code: the
 * seam is here so that replacement can add fields (a sample rate, a byte
 * buffer) without another interface change.
 *
 * Returns MORE than one code for a turn that mixed languages — the seam this
 * plan builds for, deferred until a real identifier exists (see
 * `docs/system-architecture.md`, "LID and audio-based detection").
 */
export interface LanguageIdentifier {
  identify(turn: { declared: LanguageCode }): readonly LanguageCode[];
}

/**
 * Trusts the client's declared language outright.
 *
 * The only implementation today, and the DEFAULT `TurnSessionDeps.identifier`
 * (see `turn-session.ts`) — a real policy every turn runs, not a branch only a
 * test takes. A turn is never reported as mixed-language until a real
 * identifier replaces this one.
 */
export class DeclaredLanguageIdentifier implements LanguageIdentifier {
  identify(turn: { declared: LanguageCode }): readonly LanguageCode[] {
    return [turn.declared];
  }
}
