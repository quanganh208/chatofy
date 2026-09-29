import { describe, expect, it } from 'vitest';
import {
  HISTORY_LIMITS,
  saveConversationTurnSchema,
  saveConversationRequestSchema,
  uploadConversationAudioQuerySchema,
  conversationResponseSchema,
  conversationSummaryResponseSchema,
  conversationListResponseSchema,
} from './conversations.js';

/** A turn the strict schema accepts, so each case can vary one field. */
const turn = (over: Record<string, unknown> = {}) => ({
  position: 0,
  speakerRole: 'speaker_a',
  speakerLabel: null,
  sourceText: 'xin chào',
  displayText: null,
  sourceLanguages: ['vi'],
  translations: { en: 'hello' },
  targetText: 'hello',
  offsetMs: 1_200,
  ...over,
});

/** The same turn as a legacy client — before this migration — sent it. */
const legacyTurn = (over: Record<string, unknown> = {}) => {
  const { sourceLanguages: _sl, translations: _t, ...rest } = turn(over);
  return rest;
};

describe('saveConversationTurnSchema.offsetMs', () => {
  it('accepts null — the client had no capture record for the block', () => {
    expect(saveConversationTurnSchema.safeParse(turn({ offsetMs: null })).success).toBe(true);
  });

  it('accepts zero and the duration ceiling', () => {
    expect(saveConversationTurnSchema.safeParse(turn({ offsetMs: 0 })).success).toBe(true);
    expect(
      saveConversationTurnSchema.safeParse(turn({ offsetMs: HISTORY_LIMITS.MAX_DURATION_MS }))
        .success,
    ).toBe(true);
  });

  it('refuses a negative offset', () => {
    expect(saveConversationTurnSchema.safeParse(turn({ offsetMs: -1 })).success).toBe(false);
  });

  it('refuses a non-integer offset', () => {
    expect(saveConversationTurnSchema.safeParse(turn({ offsetMs: 12.5 })).success).toBe(false);
  });

  it('refuses an offset past the duration ceiling', () => {
    // The value is client-reported; unbounded, it renders a time measured in years.
    expect(
      saveConversationTurnSchema.safeParse(turn({ offsetMs: HISTORY_LIMITS.MAX_DURATION_MS + 1 }))
        .success,
    ).toBe(false);
  });

  it('accepts a body with no offset at all, and reads it as null', () => {
    // The stale-bundle case, and the reason this field is optional rather than
    // required-nullable: a browser holding the previous bundle keeps sending
    // bodies without it for as long as its tab stays open, and refusing those
    // would lose the conversation rather than the timestamp.
    const { offsetMs: _omitted, ...without } = turn();
    const parsed = saveConversationTurnSchema.safeParse(without);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.offsetMs).toBeNull();
  });
});

describe('saveConversationTurnSchema.sourceLanguages/translations', () => {
  it('requires both fields — the shape toConversationTurns always builds', () => {
    const parsed = saveConversationTurnSchema.safeParse(turn());
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.sourceLanguages).toEqual(['vi']);
    expect(parsed.success && parsed.data.translations).toEqual({ en: 'hello' });
  });

  it('refuses a turn missing them — the legacy shape only the whole request schema fills', () => {
    expect(saveConversationTurnSchema.safeParse(legacyTurn()).success).toBe(false);
  });

  it('refuses an empty sourceLanguages when the field is sent at all', () => {
    expect(saveConversationTurnSchema.safeParse(turn({ sourceLanguages: [] })).success).toBe(false);
  });

  it('refuses a translations key outside the registry', () => {
    expect(
      saveConversationTurnSchema.safeParse(turn({ translations: { fr: 'bonjour' } })).success,
    ).toBe(false);
  });

  it('accepts a mixed turn translated into every conversation language', () => {
    // Two sources, both destinations filled — the shape a turn spoken partly in
    // each language takes (`translationTargets`, domain/languages.ts). Sent
    // ALONGSIDE `targetText`, which the schema still requires either way.
    expect(
      saveConversationTurnSchema.safeParse(
        turn({ sourceLanguages: ['vi', 'en'], translations: { vi: 'ok', en: 'ok' } }),
      ).success,
    ).toBe(true);
  });
});

describe('saveConversationRequestSchema', () => {
  const body = (turns: unknown[]) => ({
    direction: 'vi_to_en',
    languages: ['vi', 'en'],
    startedAt: new Date(Date.now() - 60_000).toISOString(),
    endedAt: new Date().toISOString(),
    turns,
  });

  it('requires languages — the shape apps/web always sends', () => {
    const parsed = saveConversationRequestSchema.safeParse(body([turn()]));
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.languages).toEqual(['vi', 'en']);
    expect(parsed.success && parsed.data.turns[0]).toMatchObject({
      sourceLanguages: ['vi'],
      translations: { en: 'hello' },
    });
  });

  it('fills languages and every turn from direction/speakerRole/targetText — a tab holding an older bundle', () => {
    const { languages: _l, ...legacyBody } = body([legacyTurn()]);
    const parsed = saveConversationRequestSchema.safeParse(legacyBody);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.languages).toEqual(['vi', 'en']);
    expect(parsed.success && parsed.data.turns[0]).toMatchObject({
      sourceLanguages: ['vi'],
      translations: { en: 'hello' },
    });
  });

  it('accepts offsets that run backwards across positions', () => {
    // Deliberate. An earlier draft refined these to be non-decreasing, which
    // made ONE bad offset cost the WHOLE transcript — a 400 on a body whose text
    // was perfectly good. A timestamp that disagrees with its neighbours is a
    // wrong number in a gutter; a refused save is a lost conversation.
    const parsed = saveConversationRequestSchema.safeParse(
      body([turn({ position: 0, offsetMs: 9_000 }), turn({ position: 1, offsetMs: 1_000 })]),
    );
    expect(parsed.success).toBe(true);
  });

  it('still refuses a body over the total character ceiling, counting targetText', () => {
    // The offset field must not have weakened the bound that actually protects
    // the row. A legacy turn — no `translations` sent — has it derived from
    // `targetText` by the preprocess before this refine ever runs, so the huge
    // value still reaches the ceiling.
    const huge = 'x'.repeat(HISTORY_LIMITS.MAX_TURN_CHARS);
    const { languages: _l, ...legacyBody } = body(
      Array.from({ length: 40 }, (_unused, position) =>
        legacyTurn({ position, sourceText: huge, displayText: huge, targetText: huge }),
      ),
    );
    expect(saveConversationRequestSchema.safeParse(legacyBody).success).toBe(false);
  });

  it('sums every translation on a turn that sends them, not only targetText', () => {
    // A turn with two filled destinations must count both against the ceiling —
    // counting only `targetText` would let a fanned-out conversation store far
    // past HISTORY_LIMITS.MAX_TOTAL_CHARS while every turn looks small on its
    // own (`targetText` itself stays short here, which is what proves the sum
    // came from `translations` and not from it).
    const half = 'x'.repeat(Math.ceil(HISTORY_LIMITS.MAX_TOTAL_CHARS / 2) + 1);
    const parsed = saveConversationRequestSchema.safeParse(
      body([
        turn({
          sourceLanguages: ['vi', 'en'],
          translations: { vi: half, en: half },
          sourceText: '',
          targetText: '',
        }),
      ]),
    );
    expect(parsed.success).toBe(false);
  });

  it('still refuses two turns sharing a position', () => {
    expect(
      saveConversationRequestSchema.safeParse(body([turn({ position: 0 }), turn({ position: 0 })]))
        .success,
    ).toBe(false);
  });

  describe("cross-field checks on a turn's language fields", () => {
    // The `sourceLanguages ⊆ languages` arm has no test here on purpose: with
    // today's two-language registry, `languageCodeSchema` already accepts
    // only `vi`/`en`, and `conversationLanguagesSchema.min(2)` forces
    // `languages` to BE exactly that pair whenever it validates at all — so
    // every value that can pass the per-field registry check is already a
    // subset of `languages`, by construction, and no code exists that is
    // "in the registry but outside this conversation" to send. A test
    // reaching for one (a code like `fr`, or a placeholder like `xx`) would
    // only prove the pre-existing per-field enum check runs before this
    // refine does — it can never reach the refine itself. This stops being
    // vacuous the day a third language joins the registry.

    it('refuses a translation keyed by the language the turn was spoken in', () => {
      // A single-source turn's only valid target is the OTHER conversation
      // language — see `translationTargets`. Keying the translation by its own
      // source is a shape the server never builds and never reads back.
      expect(
        saveConversationRequestSchema.safeParse(
          body([turn({ sourceLanguages: ['vi'], translations: { vi: 'xin chào' } })]),
        ).success,
      ).toBe(false);
    });

    it('accepts a mixed turn translated into every conversation language, sources included', () => {
      // The one case where a translation key legitimately NAMES a source: a
      // turn spoken partly in each language goes to the whole conversation set
      // (`translationTargets`), because every listener needs the whole turn in
      // their own language, including the part already in it.
      expect(
        saveConversationRequestSchema.safeParse(
          body([turn({ sourceLanguages: ['vi', 'en'], translations: { vi: 'ok', en: 'ok' } })]),
        ).success,
      ).toBe(true);
    });

    it('refuses a turn with spoken text and no translation for it at all', () => {
      expect(
        saveConversationRequestSchema.safeParse(
          body([turn({ translations: {}, targetText: 'xin chào' })]),
        ).success,
      ).toBe(false);
    });

    it('accepts a turn with no translation when targetText is genuinely empty', () => {
      // Not every turn has something to translate — the empty case must stay
      // reachable rather than being folded into the refusal above.
      expect(
        saveConversationRequestSchema.safeParse(body([turn({ translations: {}, targetText: '' })]))
          .success,
      ).toBe(true);
    });

    it('does not silently fill an EMPTY translations sent alongside a non-empty targetText', () => {
      // The legacy-fill preprocess only backfills a MISSING field; `translations`
      // present-but-empty is not that case, and reaching the refine above (a
      // 400) rather than a silently accepted, permanently empty translation is
      // the point of this whole check.
      const parsed = saveConversationRequestSchema.safeParse(
        body([turn({ translations: {}, targetText: 'xin chào' })]),
      );
      expect(parsed.success).toBe(false);
    });

    it('still accepts a legacy payload carrying only direction/targetText', () => {
      // The preprocess derives sourceLanguages/translations from
      // speakerRole/targetText for a tab that predates the language-keyed
      // fields — this must keep working under the new cross-field refine.
      const { languages: _l, ...legacyBody } = body([legacyTurn()]);
      expect(saveConversationRequestSchema.safeParse(legacyBody).success).toBe(true);
    });

    it('refuses a single-source turn whose speaker role contradicts its language', () => {
      // `speaker_a` is the registry-first language's side, so an English turn
      // labelled `speaker_a` would read one way through `speakerRole` and
      // another through `sourceLanguages`.
      const parsed = saveConversationRequestSchema.safeParse(
        body([
          turn({
            speakerRole: 'speaker_a',
            sourceLanguages: ['en'],
            translations: { vi: 'xin chào' },
            targetText: 'xin chào',
          }),
        ]),
      );
      expect(parsed.success).toBe(false);
      expect(parsed.error?.issues.map((issue) => issue.path)).toContainEqual([
        'turns',
        0,
        'speakerRole',
      ]);
    });

    it('ties the role to the registry order, not the order the conversation declared', () => {
      // An en-first conversation still has Vietnamese as `speaker_a`.
      const enFirst = { ...body([]), direction: 'en_to_vi', languages: ['en', 'vi'] };
      const english = turn({
        speakerRole: 'speaker_b',
        sourceLanguages: ['en'],
        translations: { vi: 'xin chào' },
        targetText: 'xin chào',
      });
      expect(
        saveConversationRequestSchema.safeParse({ ...enFirst, turns: [english] }).success,
      ).toBe(true);
      expect(
        saveConversationRequestSchema.safeParse({
          ...enFirst,
          turns: [{ ...english, speakerRole: 'speaker_a' }],
        }).success,
      ).toBe(false);
    });

    it('does not tie a mixed turn to either role', () => {
      for (const speakerRole of ['speaker_a', 'speaker_b']) {
        expect(
          saveConversationRequestSchema.safeParse(
            body([
              turn({
                speakerRole,
                sourceLanguages: ['vi', 'en'],
                translations: { vi: 'ok', en: 'ok' },
              }),
            ]),
          ).success,
        ).toBe(true);
      }
    });

    it('still accepts what apps/web sends today: languages plus every turn field', () => {
      expect(saveConversationRequestSchema.safeParse(body([turn()])).success).toBe(true);
    });
  });
});

describe('response wire schemas (API-rollback tolerance)', () => {
  /** What a stored, migrated conversation looks like on the wire today. */
  const conversation = () => ({
    conversationId: 'c1',
    direction: 'vi_to_en',
    languages: ['vi', 'en'],
    startedAt: '2026-01-01T00:00:00.000Z',
    endedAt: '2026-01-01T00:01:00.000Z',
    turnCount: 1,
    preview: 'xin chào',
    hasMinutes: false,
    turns: [
      {
        position: 0,
        speakerRole: 'speaker_a',
        speakerLabel: null,
        sourceText: 'xin chào',
        displayText: null,
        sourceLanguages: ['vi'],
        translations: { en: 'hello' },
        targetText: 'hello',
        offsetMs: null,
      },
    ],
    hasRecording: false,
    audioOffsetMs: null,
    audioDurationMs: null,
  });

  it('parses a conversation already carrying languages/sourceLanguages/translations', () => {
    expect(conversationResponseSchema.safeParse({ conversation: conversation() }).success).toBe(
      true,
    );
  });

  it('fills languages/sourceLanguages/translations on a response from a rolled-back API', () => {
    const { languages: _l, ...rest } = conversation();
    const legacy = {
      ...rest,
      turns: rest.turns.map(({ sourceLanguages: _sl, translations: _t, ...turn }) => turn),
    };
    const parsed = conversationResponseSchema.safeParse({ conversation: legacy });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.conversation.languages).toEqual(['vi', 'en']);
    expect(parsed.success && parsed.data.conversation.turns[0]).toMatchObject({
      sourceLanguages: ['vi'],
      translations: { en: 'hello' },
    });
  });

  it('fills a rolled-back summary in the list and the PUT response', () => {
    const { languages: _l, ...legacySummary } = conversation();
    const {
      turns: _turns,
      hasRecording: _hr,
      audioOffsetMs: _ao,
      audioDurationMs: _ad,
      ...summary
    } = legacySummary;

    const list = conversationListResponseSchema.safeParse({
      conversations: [summary],
      nextCursor: null,
    });
    expect(list.success).toBe(true);
    expect(list.success && list.data.conversations[0]?.languages).toEqual(['vi', 'en']);

    const put = conversationSummaryResponseSchema.safeParse({ conversation: summary });
    expect(put.success).toBe(true);
    expect(put.success && put.data.conversation.languages).toEqual(['vi', 'en']);
  });
});

describe('uploadConversationAudioQuerySchema', () => {
  it('coerces the query strings a URL actually carries', () => {
    const parsed = uploadConversationAudioQuerySchema.safeParse({
      offsetMs: '1200',
      durationMs: '65000',
    });
    expect(parsed.success && parsed.data).toEqual({ offsetMs: 1_200, durationMs: 65_000 });
  });

  it('refuses a negative or absent duration', () => {
    expect(
      uploadConversationAudioQuerySchema.safeParse({ offsetMs: '0', durationMs: '-1' }).success,
    ).toBe(false);
    expect(uploadConversationAudioQuerySchema.safeParse({ offsetMs: '0' }).success).toBe(false);
  });
});

describe('HISTORY_LIMITS.MAX_CONVERSATION_AUDIO_BYTES', () => {
  it('is the 32 MB the recorder bitrate was chosen against', () => {
    // Read from the shared constant rather than hard-coded: a hard-coded 24_000
    // here would stay green if the recorder's own bitrate changed and broke this
    // pairing, which is exactly the drift `AUDIO_RECORDER_BITS_PER_SECOND` being
    // exported exists to make visible.
    expect(HISTORY_LIMITS.MAX_CONVERSATION_AUDIO_BYTES).toBe(32 * 1024 * 1024);
    const secondsAtRecorderBitrate =
      HISTORY_LIMITS.MAX_CONVERSATION_AUDIO_BYTES /
      (HISTORY_LIMITS.AUDIO_RECORDER_BITS_PER_SECOND / 8);
    expect(Math.round(secondsAtRecorderBitrate)).toBe(11_185);
    expect(secondsAtRecorderBitrate).toBeGreaterThan(3 * 3600);
  });

  it('stays under the duration ceiling a lying clock could claim', () => {
    expect(HISTORY_LIMITS.MAX_DURATION_MS).toBeGreaterThan(
      (HISTORY_LIMITS.MAX_CONVERSATION_AUDIO_BYTES /
        (HISTORY_LIMITS.AUDIO_RECORDER_BITS_PER_SECOND / 8)) *
        1_000,
    );
  });
});
