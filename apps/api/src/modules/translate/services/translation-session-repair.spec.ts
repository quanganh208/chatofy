import type { ConfigService } from '@nestjs/config';
import type { Env } from '../../../config/env.schema';
import type { AudioFrame, ServerEvent } from '@chatofy/types';
import {
  TranslationSessionService,
  type StreamSocket,
} from './translation-session.service';
import type {
  DisplayRepair,
  PipelineTranslatorService,
} from './pipeline-translator.service';
import type {
  DisplayRepairMetrics,
  TurnMetrics,
  TurnMetricsRecorder,
} from './turn-metrics.recorder';
import { encodePcm16Wav } from '../audio/wav-codec';
import { MAX_CONCURRENT_DISPLAY_REPAIRS } from '../session/turn-concurrency';

/**
 * The display repair, which is the one thing on this path that OUTLIVES its turn.
 *
 * A separate file from `translation-session.service.spec.ts` rather than more
 * cases in it: that file is already 1900 lines and every one of its harnesses is
 * built to count synthesized clauses and audio frames, none of which this
 * behaviour touches. What these tests need instead is control over when a repair
 * resolves — after the turn has closed, after the client has gone — which is a
 * different fixture, not a longer one.
 *
 * The rule under test throughout: **a repair can never change what a turn did.**
 * It cannot delay audio, cannot fail a turn, and cannot alter the record. The
 * only thing it may do is add one event, and only when a client asked.
 */

const SAMPLE_RATE = 16000;

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

/** The shape a successful repair resolves to. */
const repaired = (text: string): DisplayRepair => ({
  text,
  outcome: 'repaired',
  model: 'gemma-4-31b-it',
  residual: 0,
  ms: 15_600,
});

interface Harness {
  service: TranslationSessionService;
  repairDisplay: jest.Mock;
  repairs: DisplayRepairMetrics[];
  turns: TurnMetrics[];
}

function makeService(repairImpl?: jest.Mock, sourceText = 'xin chào'): Harness {
  const repairs: DisplayRepairMetrics[] = [];
  const turns: TurnMetrics[] = [];
  const repairDisplay =
    repairImpl ?? jest.fn().mockResolvedValue(repaired('Xin chào.'));

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
    // omitted: a turn that cannot run its preview throws inside `pushFrame`,
    // which would fail these tests for a reason that has nothing to do with
    // repairs.
    transcribe: jest.fn().mockResolvedValue(''),
    translate: jest.fn().mockResolvedValue(''),
    repairDisplay,
  } as unknown as PipelineTranslatorService;

  const metrics = {
    record: (m: TurnMetrics) => turns.push(m),
    recordClient: () => {},
    recordRepair: (m: DisplayRepairMetrics) => repairs.push(m),
  } as unknown as TurnMetricsRecorder;

  return {
    service: new TranslationSessionService(pipeline, metrics, {
      get: () => false,
    } as unknown as ConfigService<Env, true>),
    repairDisplay,
    repairs,
    turns,
  };
}

/** Open a turn, saying whether this client wants repaired display text. */
function open(
  service: TranslationSessionService,
  socket: FakeSocket,
  wantsRepair: boolean,
): string {
  service.start(socket, {
    direction: 'vi_to_en',
    voiceGender: 'female',
    ...(wantsRepair ? { repairDisplay: true } : {}),
  });
  return socket.ofType('server.session.ready').at(-1)!.sessionId;
}

/**
 * Let the fire-and-forget repair settle.
 *
 * `setImmediate` rather than a chain of `Promise.resolve()`: the repair goes
 * through `.then().finally()`, and counting microtask ticks by hand is the kind
 * of coupling that breaks when a link is added to that chain.
 */
const settle = () => new Promise((resolve) => setImmediate(resolve));

/** Run one whole turn to completion. */
async function runTurn(
  service: TranslationSessionService,
  socket: FakeSocket,
  wantsRepair = true,
): Promise<string> {
  const sessionId = open(service, socket, wantsRepair);
  service.pushFrame(socket, frame(sessionId));
  await service.end(socket, sessionId);
  return sessionId;
}

describe('display repair on a finished turn', () => {
  it('sends the repaired text under the turn it belongs to', async () => {
    const { service } = makeService();
    const socket = new FakeSocket();

    const sessionId = await runTurn(service, socket);
    await settle();

    expect(socket.ofType('server.transcript.display')).toEqual([
      { type: 'server.transcript.display', sessionId, text: 'Xin chào.' },
    ]);
  });

  it('never holds up the turn, however long it takes', async () => {
    // A repair that NEVER answers. Measured at a median of 15.6s and up to
    // 92.6s against a turn that completes in about one, so "slower than the
    // turn" is the normal case rather than the edge — and the guarantee has to
    // be that the turn does not wait at all, not that it waits briefly.
    const { service } = makeService(
      jest.fn().mockReturnValue(new Promise(() => {})),
    );
    const socket = new FakeSocket();

    await runTurn(service, socket);
    await settle();

    // Everything the turn owes its client was delivered, in order, with the
    // repair still outstanding.
    expect(socket.events.map((e) => e.type)).toEqual([
      'server.session.ready',
      'server.transcript.final',
      'server.audio.frame',
      'server.session.ended',
    ]);
  });

  it('never lands before the transcript it renders', async () => {
    const { service } = makeService();
    const socket = new FakeSocket();

    await runTurn(service, socket);
    await settle();

    // Ordering, not timing. The client stores a repair by `sessionId` and
    // renders `display ?? sourceText`, so a repair arriving first would be held
    // against a turn the reader cannot see yet.
    const types = socket.events.map((e) => e.type);
    expect(types.indexOf('server.transcript.display')).toBeGreaterThan(
      types.indexOf('server.transcript.final'),
    );
  });

  it('leaves the persisted record raw, which is what every metric reads', async () => {
    const { service } = makeService();
    const socket = new FakeSocket();

    await runTurn(service, socket);
    await settle();

    // The repair said "Xin chào." — the segment must still say what the engine
    // did. A repaired string here would make the transcript stop being evidence
    // about the recognizer, and would carry ITN'd text into the WER path.
    const [final] = socket.ofType('server.transcript.final');
    expect(final!.segment.sourceText).toBe('xin chào');
  });

  it('repairs the source text, not the translation', async () => {
    const { service, repairDisplay } = makeService();
    const socket = new FakeSocket();

    await runTurn(service, socket);
    await settle();

    expect(repairDisplay).toHaveBeenCalledWith({
      text: 'xin chào',
      direction: 'vi_to_en',
    });
  });
});

describe('a client that did not ask is never sent one', () => {
  it('sends nothing and spends nothing when the option is absent', async () => {
    const { service, repairDisplay } = makeService();
    const socket = new FakeSocket();

    await runTurn(service, socket, false);
    await settle();

    // Both halves matter. No event, because a tab built before this event
    // existed parses server events against a strict union and would report an
    // error once per repaired turn. And no request, because a repair nobody
    // will see is quota spent for nothing.
    expect(socket.ofType('server.transcript.display')).toHaveLength(0);
    expect(repairDisplay).not.toHaveBeenCalled();
  });
});

describe('never issued for a speculation', () => {
  it('does not repair on a guess, only on the turn that finished', async () => {
    const { service, repairDisplay } = makeService();
    const socket = new FakeSocket();
    const sessionId = open(service, socket, true);
    service.pushFrame(socket, frame(sessionId));

    // A guess, and then another: the speaker paused twice. Neither is a turn.
    service.speculate(socket, sessionId);
    service.speculate(socket, sessionId);
    await settle();

    // Nothing yet. A speculation can be superseded by more speech, so repairing
    // one would typeset a sentence the speaker had not finished saying — and on
    // the dominant path three turns in four reuse a guess, so this would be most
    // of the traffic.
    expect(repairDisplay).not.toHaveBeenCalled();

    await service.end(socket, sessionId);
    await settle();

    // Exactly one, for the turn — not one per guess.
    expect(repairDisplay).toHaveBeenCalledTimes(1);
  });
});

describe('a repair that does not arrive leaves the display raw', () => {
  const cases: { name: string; resolves: DisplayRepair }[] = [
    {
      name: 'the request failed, timed out, or was rate-limited',
      resolves: { text: null, outcome: 'failed', ms: 800 },
    },
    {
      name: 'the guard refused it as a paraphrase',
      resolves: {
        text: null,
        outcome: 'rejected',
        model: 'gemma-4-31b-it',
        residual: 0.25,
        ms: 15_000,
      },
    },
    {
      name: 'the configured provider cannot repair at all',
      resolves: { text: null, outcome: 'unsupported', ms: 0 },
    },
  ];

  it.each(cases)('$name', async ({ resolves }) => {
    const { service, repairs } = makeService(
      jest.fn().mockResolvedValue(resolves),
    );
    const socket = new FakeSocket();

    await runTurn(service, socket);
    await settle();

    // Nothing on the wire, so the client keeps rendering `segment.sourceText`.
    expect(socket.ofType('server.transcript.display')).toHaveLength(0);
    // The turn itself is untouched: it still delivered its transcript, its audio
    // and its close, and it is still recorded as completed.
    expect(socket.ofType('server.transcript.final')).toHaveLength(1);
    expect(socket.ofType('server.session.ended')).toHaveLength(1);
    // Recorded even so. A row only for repairs that worked cannot tell "no
    // rejections" from "rejections never written down" — and telling a refused
    // paraphrase from a spent quota is the only reason this row exists.
    expect(repairs).toEqual([
      expect.objectContaining({ outcome: resolves.outcome }),
    ]);
  });

  it('survives a repair that rejects rather than resolving', async () => {
    // `repairDisplay` promises never to throw, but a service that relied on that
    // promise would turn any future breach into an unhandled rejection, which
    // takes the process down for a turn that already succeeded.
    // `mockImplementation`, not `mockRejectedValue`: the latter builds the
    // rejected promise when the mock is created, so it is already unhandled
    // before the service can attach anything and the test fails on its own
    // fixture rather than on the code.
    const { service } = makeService(
      jest.fn().mockImplementation(() => Promise.reject(new Error('boom'))),
    );
    const socket = new FakeSocket();

    await expect(runTurn(service, socket)).resolves.toBeDefined();
    await settle();

    expect(socket.ofType('server.transcript.display')).toHaveLength(0);
    expect(socket.ofType('server.session.ended')).toHaveLength(1);
  });
});

describe('bounds', () => {
  it('says nothing to a client that has gone', async () => {
    let release: (value: DisplayRepair) => void = () => {};
    const pending = new Promise<DisplayRepair>((resolve) => {
      release = resolve;
    });
    const { service } = makeService(jest.fn().mockReturnValue(pending));
    const socket = new FakeSocket();

    await runTurn(service, socket);
    // The tab closes while the model is still typesetting — the likeliest case
    // of all at tens of seconds per repair.
    service.disconnect(socket);
    release(repaired('Xin chào.'));
    await settle();

    expect(socket.ofType('server.transcript.display')).toHaveLength(0);
  });

  it('stops starting repairs once too many are in flight', async () => {
    // Deliberately never resolved: these are the repairs still waiting.
    const { service, repairDisplay } = makeService(
      jest.fn().mockReturnValue(new Promise(() => {})),
    );
    const socket = new FakeSocket();

    for (let turn = 0; turn <= MAX_CONCURRENT_DISPLAY_REPAIRS; turn++) {
      await runTurn(service, socket);
    }
    await settle();

    // A repair outlives its turn by an order of magnitude, so with continuous
    // capture a speaker produces them faster than they retire. The ceiling is
    // what stops one session holding hundreds of open requests against a shared
    // daily quota; the turn over it simply keeps its raw transcript.
    expect(repairDisplay).toHaveBeenCalledTimes(MAX_CONCURRENT_DISPLAY_REPAIRS);
  });

  it('releases the slot when a repair finishes, so the ceiling is not one-way', async () => {
    // The counterpart to the test above, and the reason both are needed: that
    // one holds every repair open forever, so it would pass unchanged if the
    // slot were never released. A ceiling that only counts up disables display
    // repair permanently after the first eight turns of the process's life.
    const { service, repairDisplay } = makeService();
    const socket = new FakeSocket();

    const turns = MAX_CONCURRENT_DISPLAY_REPAIRS * 3;
    for (let turn = 0; turn < turns; turn++) {
      await runTurn(service, socket);
      await settle();
    }

    expect(repairDisplay).toHaveBeenCalledTimes(turns);
    expect(socket.ofType('server.transcript.display')).toHaveLength(turns);
  });

  it('releases the slot even when the repair rejects', async () => {
    // The failure path has to decrement too. A provider having a bad hour would
    // otherwise burn through the ceiling and leave the feature off for everyone
    // long after it recovered.
    const { service, repairDisplay } = makeService(
      jest.fn().mockImplementation(() => Promise.reject(new Error('boom'))),
    );
    const socket = new FakeSocket();

    const turns = MAX_CONCURRENT_DISPLAY_REPAIRS + 2;
    for (let turn = 0; turn < turns; turn++) {
      await runTurn(service, socket);
      await settle();
    }

    expect(repairDisplay).toHaveBeenCalledTimes(turns);
  });

  it('does not ask for a repair of a turn with no words', async () => {
    // A turn whose transcript is whitespace. There is nothing to typeset, so a
    // repair could only invent something — and it would be billed for the
    // privilege.
    const { service, repairDisplay } = makeService(undefined, '   ');
    const socket = new FakeSocket();

    await runTurn(service, socket);
    await settle();

    expect(repairDisplay).not.toHaveBeenCalled();
  });
});
