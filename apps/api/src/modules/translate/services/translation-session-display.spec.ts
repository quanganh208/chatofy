import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  AudioFrame,
  ServerEvent,
  TranslationDirection,
} from '@chatofy/types';
import {
  TranslationSessionService,
  type StreamSocket,
} from './translation-session.service';
import type {
  PipelineTranslatorService,
  TranslateTurnInput,
} from './pipeline-translator.service';
import type { TurnMetrics, TurnMetricsRecorder } from './turn-metrics.recorder';
import { encodePcm16Wav } from '../audio/wav-codec';
import type { SpeechLanguageSupport } from '../providers/speech-language-support';
import { DeclaredLanguageIdentifier } from '../session/language-identifier';

/**
 * Display typesetting on a finished turn.
 *
 * This replaces the display REPAIR, which was a second request to a reserve
 * model that answered a median of 25.1s after the line was already on screen and
 * then rewrote it. The rendering is now a pure function computed before the
 * transcript is emitted and carried ON that event, so the finished line arrives
 * correct and never visibly changes.
 *
 * The old rule under test was "a repair can never change what a turn did"; it
 * survives, and matters MORE now rather than less. The repair was fire-and-
 * forget and could only ever add a late event. This runs inside the turn's own
 * `try`, before the transcript goes out, so an unguarded throw here would take
 * down the transcript AND the audio of a turn that was otherwise fine.
 */

const SAMPLE_RATE = 16000;

/**
 * The ITN, swappable for one test.
 *
 * Real by default — a spec that mocked it would assert the wiring against a
 * fiction and never notice the two disagreeing. The override exists for exactly
 * one case: proving a throwing ITN cannot fail a turn, which no real input
 * produces because the function is total.
 *
 * The `mock` prefix is what lets `vi.mock`'s hoisted factory close over it.
 */
const mockItn: { impl: ((text: string, language: string) => string) | null } = {
  impl: null,
};
const mockItnCalls: Array<{ text: string; language: string }> = [];

// Async factory because `importActual` returns a promise: the real ITN is what
// the default branch below delegates to, so it has to be resolved, not pending.
vi.mock('@chatofy/ai-providers', async () => {
  const actual = await vi.importActual<typeof import('@chatofy/ai-providers')>(
    '@chatofy/ai-providers',
  );
  return {
    ...actual,
    inverseNormalizeTranscript: (text: string, language: string) => {
      mockItnCalls.push({ text, language });
      return mockItn.impl
        ? mockItn.impl(text, language)
        : actual.inverseNormalizeTranscript(
            text,
            language as Parameters<typeof actual.inverseNormalizeTranscript>[1],
          );
    },
  };
});

class FakeSocket implements StreamSocket {
  readonly events: ServerEvent[] = [];

  send(data: string): void {
    this.events.push(JSON.parse(data) as ServerEvent);
  }

  ofType<T extends ServerEvent['type']>(
    type: T,
  ): Extract<ServerEvent, { type: T }>[] {
    return this.events.filter((e) => e.type === type) as Extract<
      ServerEvent,
      { type: T }
    >[];
  }
}

const frame = (sessionId: string): AudioFrame => ({
  sessionId,
  encoding: 'pcm16',
  sampleRate: SAMPLE_RATE,
  sequence: 0,
  timestamp: 0,
  payload: Buffer.alloc(Math.round(SAMPLE_RATE * 2 * 0.32)).toString('base64'),
});

const ttsWav = (): Uint8Array =>
  new Uint8Array(
    encodePcm16Wav({
      samples: Buffer.alloc(2400 * 2),
      sampleRate: 24000,
      channels: 1,
    }),
  );

interface Harness {
  service: TranslationSessionService;
  turns: TurnMetrics[];
  /** Every input the turn handed the pipeline, in call order. */
  inputs: TranslateTurnInput[];
  /** The spans each respelling call asked about, in call order. */
  respellCalls: string[][];
}

function makeService(
  sourceText: string,
  restored?: string,
  {
    translation = 'hello',
    blockRestored,
    respell = {},
    respellGate,
    respellThrows = false,
  }: {
    translation?: string;
    /** What the sidecar answers for a whole block; undefined is no answer. */
    blockRestored?: (text: string) => string | undefined;
    /** What the respelling model proposes, keyed by span. */
    respell?: Record<string, string | null>;
    /** Held until this settles, to model a slow respelling. */
    respellGate?: Promise<void>;
    /** Model a respelling that fails outright. */
    respellThrows?: boolean;
  } = {},
): Harness {
  const turns: TurnMetrics[] = [];
  const inputs: TranslateTurnInput[] = [];
  const respellCalls: string[][] = [];

  const pipeline = {
    transcribeAndTranslate: vi.fn((input: TranslateTurnInput) => {
      inputs.push(input);
      return Promise.resolve({
        // Lowercase and unpunctuated, as the Vietnamese recognizer actually emits.
        sourceText,
        translations: { en: translation },
        ...(restored === undefined ? {} : { restored }),
      });
    }),
    translateAll: vi.fn().mockResolvedValue({ en: translation }),
    restoreDisplay: vi.fn((text: string) =>
      Promise.resolve(blockRestored?.(text)),
    ),
    canRespellLoanwords: vi.fn(() => true),
    respellLoanwords: vi.fn(async (_text: string, spans: string[]) => {
      respellCalls.push(spans);
      await respellGate;
      if (respellThrows) throw new Error('respeller exploded');
      return respell;
    }),
    synthesize: vi
      .fn()
      .mockResolvedValue({ bytes: ttsWav(), mimeType: 'audio/wav' }),
    // A backend without a stream, so these turns speak clause by clause.
    synthesizeStream: vi.fn().mockResolvedValue(null),
    embedSpeaker: vi.fn().mockResolvedValue(null),
    // The live preview reaches for these on every frame. Stubbed rather than
    // omitted: a turn that cannot run its preview throws inside `pushFrame`.
    transcribe: vi.fn().mockResolvedValue(''),
    translate: vi.fn().mockResolvedValue(''),
  } as unknown as PipelineTranslatorService;

  const metrics = {
    record: (m: TurnMetrics) => turns.push(m),
    recordClient: () => {},
  } as unknown as TurnMetricsRecorder;

  const languageSupport = {
    refusal: () => null,
  } as unknown as SpeechLanguageSupport;

  return {
    service: new TranslationSessionService(
      pipeline,
      metrics,
      languageSupport,
      new DeclaredLanguageIdentifier(),
    ),
    turns,
    inputs,
    respellCalls,
  };
}

async function runTurn(
  service: TranslationSessionService,
  socket: FakeSocket,
  {
    wantsDisplay = true,
    direction = 'vi_to_en',
    continuesCut,
    hotwords,
  }: {
    wantsDisplay?: boolean;
    direction?: TranslationDirection;
    continuesCut?: boolean;
    hotwords?: string[];
  } = {},
): Promise<string> {
  service.start(socket, {
    direction,
    voiceGender: 'female',
    ...(wantsDisplay ? { repairDisplay: true } : {}),
    ...(continuesCut ? { continuesCut } : {}),
    ...(hotwords ? { hints: { hotwords } } : {}),
  });
  const sessionId = socket.ofType('server.session.ready').at(-1)!.sessionId;
  service.pushFrame(socket, frame(sessionId));
  await service.end(socket, sessionId);
  return sessionId;
}

beforeEach(() => {
  mockItn.impl = null;
  mockItnCalls.length = 0;
});

describe('the finished line carries its digits when it first paints', () => {
  it('typesets the source text onto the transcript event itself', async () => {
    const { service } = makeService('cuộc họp lúc mười bốn giờ ba mươi phút');
    const socket = new FakeSocket();
    await runTurn(service, socket);

    const final = socket.ofType('server.transcript.final').at(-1)!;
    expect(final.display).toBe('cuộc họp lúc 14:30');
  });

  it('A6 — sends it on ONE event, in the same tick, and never a second one', async () => {
    // Two emits are two frames, and the words-form was visible in the first.
    const { service } = makeService('cuộc họp lúc mười bốn giờ ba mươi phút');
    const socket = new FakeSocket();
    await runTurn(service, socket);

    expect(socket.ofType('server.transcript.final')).toHaveLength(1);
    expect(socket.ofType('server.transcript.display')).toHaveLength(0);
  });

  it('A5 — leaves the persisted record raw, which is what every metric reads', async () => {
    const raw = 'cuộc họp lúc mười bốn giờ ba mươi phút';
    const { service } = makeService(raw);
    const socket = new FakeSocket();
    await runTurn(service, socket);

    const final = socket.ofType('server.transcript.final').at(-1)!;
    expect(final.segment.sourceText).toBe(raw);
    expect(final.display).not.toBe(final.segment.sourceText);
  });

  it('typesets the SOURCE text, not the translation', async () => {
    const { service } = makeService('cuộc họp lúc mười bốn giờ ba mươi phút');
    const socket = new FakeSocket();
    await runTurn(service, socket);

    expect(mockItnCalls.map((call) => call.text)).toEqual([
      'cuộc họp lúc mười bốn giờ ba mươi phút',
    ]);
  });
});

describe('restored punctuation and case', () => {
  it('typesets the restored line, so marks, case and digits arrive together', async () => {
    const { service } = makeService(
      'cuộc họp lúc mười bốn giờ ba mươi phút',
      'Cuộc họp lúc mười bốn giờ ba mươi phút.',
    );
    const socket = new FakeSocket();
    await runTurn(service, socket);

    const final = socket.ofType('server.transcript.final').at(-1)!;
    expect(final.display).toBe('Cuộc họp lúc 14:30.');
    expect(final.segment.sourceText).toBe(
      'cuộc họp lúc mười bốn giờ ba mươi phút',
    );
  });

  it('discards a restore that changed the words, keeping the recognizer\u2019s', async () => {
    // The restorer promises marks and case only. A line that broke that promise
    // would put words on screen the speaker never said.
    const { service } = makeService(
      'mô hình ai của openai',
      'Mô hình AI của Google.',
    );
    const socket = new FakeSocket();
    await runTurn(service, socket);

    expect(
      socket.ofType('server.transcript.final').at(-1)!.display,
    ).toBeUndefined();
  });

  it('asks for a restore on a Vietnamese turn, with the session hotwords as terms', async () => {
    const { service, inputs } = makeService('mô hình ai của openai');
    await runTurn(service, new FakeSocket(), { hotwords: ['VNeID'] });

    expect(inputs.at(-1)?.restoreDisplay).toEqual({ terms: ['VNeID'] });
  });

  it('reads the utterance a forced cut split off as the context of the rest', async () => {
    const { service, inputs } = makeService('xác thực điện tử');
    const socket = new FakeSocket();
    await runTurn(service, socket);
    await runTurn(service, socket, { continuesCut: true });

    expect(inputs.at(-1)?.restoreDisplay).toEqual({
      context: 'xác thực điện tử',
      terms: [],
    });
  });

  it('gives a turn that starts its own utterance no context', async () => {
    const { service, inputs } = makeService('xác thực điện tử');
    const socket = new FakeSocket();
    await runTurn(service, socket);
    await runTurn(service, socket);

    expect(inputs.at(-1)?.restoreDisplay).toEqual({ terms: [] });
  });

  it('asks for nothing on an English recognition, which is already cased', async () => {
    const { service, inputs } = makeService('meet at three');
    await runTurn(service, new FakeSocket(), { direction: 'en_to_vi' });

    expect(inputs.at(-1)?.restoreDisplay).toBeUndefined();
  });

  it('asks for nothing from a client that renders the raw line', async () => {
    const { service, inputs } = makeService('mô hình ai của openai');
    await runTurn(service, new FakeSocket(), { wantsDisplay: false });

    expect(inputs.at(-1)?.restoreDisplay).toBeUndefined();
  });
});

describe('sends nothing when there is nothing to say', () => {
  it('omits the field entirely when the text did not change', async () => {
    // Load-bearing rather than an optimization: the client reads presence as
    // "this line differs from the recognizer's output" and shows a "show
    // original" disclosure on it. Most turns hold no numerals, so emitting
    // always would put that disclosure under every line in the conversation
    // with the original identical to the text above it.
    const { service } = makeService('tôi sinh ra ở đà nẵng');
    const socket = new FakeSocket();
    await runTurn(service, socket);

    const final = socket.ofType('server.transcript.final').at(-1)!;
    expect(final.display).toBeUndefined();
    expect(Object.keys(final)).not.toContain('display');
  });

  it('omits the field when only canonicalization changed the string', async () => {
    // The ITN canonicalizes its input before it does anything else, so the
    // string to COMPARE against is the canonical one, not the raw one. Compared
    // against the raw text, a transcript that merely arrived with a doubled
    // space or in NFD "differs" with no numeral in it anywhere — and every such
    // turn would carry a display, putting the disclosure under a line whose
    // original reads identically to it.
    const { service } = makeService('tôi sinh ra ở  đà nẵng ');
    const socket = new FakeSocket();
    await runTurn(service, socket);

    const final = socket.ofType('server.transcript.final').at(-1)!;
    expect(final.display).toBeUndefined();
    expect(Object.keys(final)).not.toContain('display');
  });

  it('still sends one when a numeral changed as well', async () => {
    // Canonicalization alone is not a difference; a digit still is.
    const { service } = makeService('cuộc họp lúc  mười bốn giờ ba mươi phút ');
    const socket = new FakeSocket();
    await runTurn(service, socket);

    expect(socket.ofType('server.transcript.final').at(-1)!.display).toBe(
      'cuộc họp lúc 14:30',
    );
  });

  it('says nothing to a client that did not ask', async () => {
    const { service } = makeService('cuộc họp lúc mười bốn giờ ba mươi phút');
    const socket = new FakeSocket();
    await runTurn(service, socket, { wantsDisplay: false });

    expect(
      socket.ofType('server.transcript.final').at(-1)!.display,
    ).toBeUndefined();
    expect(mockItnCalls).toHaveLength(0);
  });

  it('does not typeset a turn with no words', async () => {
    const { service } = makeService('   ');
    const socket = new FakeSocket();
    await runTurn(service, socket);

    expect(
      socket.ofType('server.transcript.final').at(-1)!.display,
    ).toBeUndefined();
    expect(mockItnCalls).toHaveLength(0);
  });
});

describe('A14 — direction selects the module, it does not gate the feature', () => {
  it('typesets an en_to_vi turn with the ENGLISH ITN', async () => {
    // The display path is bidirectional: on `en_to_vi` the transcript being
    // typeset is the English one. Letting `direction` decide WHETHER to run
    // would have stopped display on half the product while the schema went on
    // documenting it.
    const { service } = makeService('the meeting starts at nine o’clock');
    const socket = new FakeSocket();
    await runTurn(service, socket, { direction: 'en_to_vi' });

    expect(mockItnCalls.at(-1)?.language).toBe('en');
  });

  it('typesets a vi_to_en turn with the VIETNAMESE ITN', async () => {
    const { service } = makeService('cuộc họp lúc mười bốn giờ ba mươi phút');
    const socket = new FakeSocket();
    await runTurn(service, socket, { direction: 'vi_to_en' });

    expect(mockItnCalls.at(-1)?.language).toBe('vi');
  });

  it('never applies the Vietnamese convention to an English line', async () => {
    const { service } = makeService(
      'it cost two thousand five hundred dollars',
    );
    const socket = new FakeSocket();
    await runTurn(service, socket, { direction: 'en_to_vi' });

    const display = socket.ofType('server.transcript.final').at(-1)!.display;
    // English groups with a comma; `2.500` here would be the Vietnamese one.
    expect(display).toContain('2,500');
    expect(display).not.toContain('2.500');
  });
});

describe('A15 — a throwing ITN cannot fail the turn', () => {
  it('still delivers the transcript, the audio, and a completed turn', async () => {
    // This call sits inside the turn's `try`, BEFORE the transcript is emitted,
    // and that `catch` runs `record(false, 'error')` and closes the turn as
    // failed. Unguarded, a cosmetic display feature could silence the product —
    // no transcript, no audio — reproducibly, on every turn containing whatever
    // token triggered it.
    mockItn.impl = () => {
      throw new Error('boom');
    };
    const { service, turns } = makeService(
      'cuộc họp lúc mười bốn giờ ba mươi phút',
    );
    const socket = new FakeSocket();
    await runTurn(service, socket);

    expect(socket.ofType('server.transcript.final')).toHaveLength(1);
    expect(socket.ofType('server.audio.frame').length).toBeGreaterThan(0);
    expect(turns.at(-1)?.completed).toBe(true);
    expect(turns.at(-1)?.reason).toBeUndefined();
  });

  it('falls back to the raw line rather than blanking it', async () => {
    mockItn.impl = () => {
      throw new Error('boom');
    };
    const raw = 'cuộc họp lúc mười bốn giờ ba mươi phút';
    const { service } = makeService(raw);
    const socket = new FakeSocket();
    await runTurn(service, socket);

    const final = socket.ofType('server.transcript.final').at(-1)!;
    expect(final.display).toBeUndefined();
    expect(final.segment.sourceText).toBe(raw);
  });

  it('does not fail the turn when the ITN returns a blank line', async () => {
    // A pathological implementation that "succeeded" into nothing must not put
    // an empty string on screen in place of the words.
    mockItn.impl = () => '';
    const raw = 'cuộc họp lúc mười bốn giờ ba mươi phút';
    const { service, turns } = makeService(raw);
    const socket = new FakeSocket();
    await runTurn(service, socket);

    const final = socket.ofType('server.transcript.final').at(-1)!;
    expect(final.display ?? final.segment.sourceText).not.toBe('');
    expect(turns.at(-1)?.completed).toBe(true);
  });
});

describe('names the restorer cannot case', () => {
  it('takes a mixed-case name from the turn\u2019s own translation', async () => {
    // The tagger writes each word lower, Capital or UPPER; "OpenAI" is none of
    // the three, and no list of such names could be complete.
    const { service } = makeService(
      'mô hình ai của openai',
      'Mô hình AI của Openai.',
      { translation: "OpenAI's AI model" },
    );
    const socket = new FakeSocket();
    await runTurn(service, socket);

    expect(socket.ofType('server.transcript.final').at(-1)!.display).toBe(
      'Mô hình AI của OpenAI.',
    );
  });

  it('leaves "ai" to the restorer, since it is also Vietnamese for "who"', async () => {
    const { service } = makeService(
      'em không biết ai đã gọi',
      'Em không biết ai đã gọi.',
      { translation: 'I do not know who called. AI' },
    );
    const socket = new FakeSocket();
    await runTurn(service, socket);

    expect(socket.ofType('server.transcript.final').at(-1)!.display).toBe(
      'Em không biết ai đã gọi.',
    );
  });
});

describe('a block typeset as one text', () => {
  /** Two finished turns on one socket, then a request for their block. */
  async function runBlock(harness: Harness): Promise<FakeSocket> {
    const socket = new FakeSocket();
    const first = await runTurn(harness.service, socket);
    const second = await runTurn(harness.service, socket, {
      continuesCut: true,
    });
    await harness.service.retranslateBlock(socket, [first, second], 'user-1');
    return socket;
  }

  it('restores the joined transcripts once and sends them typeset with the translation\u2019s names', async () => {
    const pieces = makeService('mô hình ai của openai', 'Mô hình AI.', {
      translation: "OpenAI's AI model",
      blockRestored: (text) =>
        text === 'mô hình ai của openai mô hình ai của openai'
          ? 'Mô hình AI của openai, mô hình AI của openai.'
          : undefined,
    });
    const socket = await runBlock(pieces);

    const answer = socket.ofType('server.block.translated').at(-1)!;
    expect(answer.display).toBe(
      'Mô hình AI của OpenAI, mô hình AI của OpenAI.',
    );
  });

  it('sends no display when the sidecar did not restore the block', async () => {
    const socket = await runBlock(
      makeService('mô hình ai của openai', 'Mô hình AI.'),
    );

    expect(socket.ofType('server.block.translated').at(-1)).not.toHaveProperty(
      'display',
    );
  });

  it('sends no display when the block restore changed the words', async () => {
    const socket = await runBlock(
      makeService('mô hình ai của openai', 'Mô hình AI.', {
        blockRestored: () => 'Mô hình AI của Google.',
      }),
    );

    expect(socket.ofType('server.block.translated').at(-1)).not.toHaveProperty(
      'display',
    );
  });

  it('sends no display to a client that renders the raw line', async () => {
    const harness = makeService('mô hình ai của openai', undefined, {
      blockRestored: (text) => `${text}.`,
    });
    const socket = new FakeSocket();
    const first = await runTurn(harness.service, socket, {
      wantsDisplay: false,
    });
    const second = await runTurn(harness.service, socket, {
      wantsDisplay: false,
    });
    await harness.service.retranslateBlock(socket, [first, second], 'user-1');

    expect(socket.ofType('server.block.translated').at(-1)).not.toHaveProperty(
      'display',
    );
  });
});

describe('garbled foreign words on the display', () => {
  it('shows a guarded respelling and leaves the transcript as heard', async () => {
    const { service } = makeService(
      'lợi dụng deep fred để lừa đảo',
      'Lợi dụng Deep Fred để lừa đảo.',
      {
        translation: 'exploiting deepfakes for fraud',
        respell: { 'deep fred': 'deepfake' },
      },
    );
    const socket = new FakeSocket();
    await runTurn(service, socket);

    const final = socket.ofType('server.transcript.final').at(-1)!;
    expect(final.display).toBe('Lợi dụng deepfake để lừa đảo.');
    expect(final.segment.sourceText).toBe('lợi dụng deep fred để lừa đảo');
  });

  it('keeps the restore when the proposal fails a guard', async () => {
    const { service } = makeService(
      'lợi dụng deep fred để lừa đảo',
      'Lợi dụng Deep Fred để lừa đảo.',
      {
        translation: 'exploiting fakes for fraud',
        respell: { 'deep fred': 'deepfake' },
      },
    );
    const socket = new FakeSocket();
    await runTurn(service, socket);

    expect(socket.ofType('server.transcript.final').at(-1)!.display).toBe(
      'Lợi dụng Deep Fred để lừa đảo.',
    );
  });

  it('asks nothing when the translation already spells every span as heard', async () => {
    const { service, respellCalls } = makeService(
      'mô hình của openai',
      undefined,
      {
        translation: "OpenAI's model",
      },
    );
    await runTurn(service, new FakeSocket());

    expect(respellCalls).toEqual([]);
  });

  it('asks nothing for a client that wants no display', async () => {
    const { service, respellCalls } = makeService(
      'lợi dụng deep fred',
      undefined,
      {
        translation: 'exploiting deepfakes',
      },
    );
    await runTurn(service, new FakeSocket(), { wantsDisplay: false });

    expect(respellCalls).toEqual([]);
  });

  it('biases the later turns of the same conversation towards what it learned', async () => {
    const { service, inputs } = makeService('lợi dụng deep fred', undefined, {
      translation: 'exploiting deepfakes',
      respell: { 'deep fred': 'deepfake' },
    });
    const socket = new FakeSocket();
    await runTurn(service, socket, { hotwords: ['Interpol'] });
    await runTurn(service, socket, { hotwords: ['Interpol'] });

    expect(inputs[0]!.learnedTerms).toEqual([]);
    expect(inputs[1]!.learnedTerms).toEqual(['deepfake']);
    expect(inputs[1]!.restoreDisplay?.terms).toEqual(['Interpol', 'deepfake']);
    // Never into the translation prompt: hints stay the user's own.
    expect(inputs[1]!.hints?.hotwords).toEqual(['Interpol']);
  });

  it('keeps what one conversation learned out of another', async () => {
    const { service, inputs } = makeService('lợi dụng deep fred', undefined, {
      translation: 'exploiting deepfakes',
      respell: { 'deep fred': 'deepfake' },
    });
    await runTurn(service, new FakeSocket());
    await runTurn(service, new FakeSocket());

    expect(inputs[1]!.learnedTerms).toEqual([]);
  });

  it('does not hold the speech back while a respelling is out', async () => {
    let release!: () => void;
    const gate = new Promise<void>((done) => (release = done));
    const { service } = makeService('lợi dụng deep fred', undefined, {
      translation: 'exploiting deepfakes',
      respell: { 'deep fred': 'deepfake' },
      respellGate: gate,
    });
    const socket = new FakeSocket();
    service.start(socket, {
      direction: 'vi_to_en',
      voiceGender: 'female',
      repairDisplay: true,
    });
    const sessionId = socket.ofType('server.session.ready').at(-1)!.sessionId;
    service.pushFrame(socket, frame(sessionId));
    const ending = service.end(socket, sessionId);

    await vi.waitFor(() =>
      expect(socket.ofType('server.audio.frame').length).toBeGreaterThan(0),
    );
    expect(socket.ofType('server.transcript.final')).toHaveLength(0);

    release();
    await ending;
    expect(socket.ofType('server.transcript.final').at(-1)!.display).toBe(
      'lợi dụng deepfake',
    );
  });

  it('keeps the old order — line before speech — on a turn with nothing to respell', async () => {
    const { service } = makeService('cuộc họp bắt đầu', undefined, {
      translation: 'the meeting starts',
    });
    const socket = new FakeSocket();
    await runTurn(service, socket);

    const types = socket.events.map((event) => event.type);
    expect(types.indexOf('server.transcript.final')).toBeGreaterThanOrEqual(0);
    expect(types.indexOf('server.transcript.final')).toBeLessThan(
      types.indexOf('server.audio.frame'),
    );
  });

  it('never fails a turn because the respelling failed', async () => {
    const { service } = makeService('lợi dụng deep fred', undefined, {
      translation: 'exploiting deepfakes',
      respellThrows: true,
    });
    const socket = new FakeSocket();
    await runTurn(service, socket);

    expect(socket.ofType('server.error')).toHaveLength(0);
    expect(
      socket.ofType('server.transcript.final').at(-1)!.segment.sourceText,
    ).toBe('lợi dụng deep fred');
  });
});
