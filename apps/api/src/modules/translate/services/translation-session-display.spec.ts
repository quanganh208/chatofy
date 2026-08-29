import type { ConfigService } from '@nestjs/config';
import type { Env } from '../../../config/env.schema';
import type {
  AudioFrame,
  ServerEvent,
  TranslationDirection,
} from '@chatofy/types';
import {
  TranslationSessionService,
  type StreamSocket,
} from './translation-session.service';
import type { PipelineTranslatorService } from './pipeline-translator.service';
import type { TurnMetrics, TurnMetricsRecorder } from './turn-metrics.recorder';
import { encodePcm16Wav } from '../audio/wav-codec';

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
 * The `mock` prefix is what lets `jest.mock`'s hoisted factory close over it.
 */
const mockItn: { impl: ((text: string, language: string) => string) | null } = {
  impl: null,
};
const mockItnCalls: Array<{ text: string; language: string }> = [];

jest.mock('@chatofy/ai-providers', () => {
  const actual = jest.requireActual<typeof import('@chatofy/ai-providers')>(
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
}

function makeService(sourceText: string): Harness {
  const turns: TurnMetrics[] = [];

  const pipeline = {
    transcribeAndTranslate: jest.fn().mockResolvedValue({
      // Lowercase and unpunctuated, as the Vietnamese recognizer actually emits.
      sourceText,
      targetText: 'hello',
      targetLanguage: 'en',
    }),
    synthesize: jest
      .fn()
      .mockResolvedValue({ bytes: ttsWav(), mimeType: 'audio/wav' }),
    embedSpeaker: jest.fn().mockResolvedValue(null),
    // The live preview reaches for these on every frame. Stubbed rather than
    // omitted: a turn that cannot run its preview throws inside `pushFrame`.
    transcribe: jest.fn().mockResolvedValue(''),
    translate: jest.fn().mockResolvedValue(''),
  } as unknown as PipelineTranslatorService;

  const metrics = {
    record: (m: TurnMetrics) => turns.push(m),
    recordClient: () => {},
  } as unknown as TurnMetricsRecorder;

  return {
    service: new TranslationSessionService(pipeline, metrics, {
      get: () => false,
    } as unknown as ConfigService<Env, true>),
    turns,
  };
}

async function runTurn(
  service: TranslationSessionService,
  socket: FakeSocket,
  {
    wantsDisplay = true,
    direction = 'vi_to_en',
  }: { wantsDisplay?: boolean; direction?: TranslationDirection } = {},
): Promise<string> {
  service.start(socket, {
    direction,
    voiceGender: 'female',
    ...(wantsDisplay ? { repairDisplay: true } : {}),
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
