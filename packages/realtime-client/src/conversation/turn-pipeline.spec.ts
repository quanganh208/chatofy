import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SessionOptions } from '@chatofy/types';
import { TurnPipeline, type TurnPipelineTransport } from './turn-pipeline.js';

const options: SessionOptions = { direction: 'vi_to_en', voiceGender: 'female' };

interface Sent {
  type: 'start' | 'audio' | 'speculate' | 'end';
  turnId?: string;
  sessionId?: string | null;
  sequence?: number;
  /** Tag from sample 0, so a test can name the block. */
  tag?: number;
}

class RecordingTransport implements TurnPipelineTransport {
  readonly sent: Sent[] = [];

  startSession(_options: SessionOptions, turnId: string): void {
    this.sent.push({ type: 'start', turnId });
  }

  /**
   * What `sendAudio` reports, so a spec can model a dead socket. The healthy
   * default is `true`: the real transport only answers `false` when the frame
   * never left the device.
   */
  sendAudioResult = true;

  sendAudio(sessionId: string, sequence: number, _sampleRate: number, payload: string): boolean {
    // Only a frame the socket carried is on the wire — the recording models
    // the wire, not the attempt, so a refused frame appears nowhere.
    if (this.sendAudioResult) {
      // The payload is base64 pcm16; sample 0 is the tag the test wrote.
      const bytes = Buffer.from(payload, 'base64');
      this.sent.push({
        type: 'audio',
        sessionId,
        sequence,
        tag: bytes.readInt16LE(0),
      });
    }
    return this.sendAudioResult;
  }

  speculate(sessionId: string | null): void {
    this.sent.push({ type: 'speculate', sessionId });
  }

  endSession(sessionId: string | null): void {
    this.sent.push({ type: 'end', sessionId });
  }

  ofType(type: Sent['type']): Sent[] {
    return this.sent.filter((s) => s.type === type);
  }

  get audio(): Sent[] {
    return this.ofType('audio');
  }
}

/** One 100ms block at 16 kHz, tagged in sample 0. */
const block = (tag: number): Int16Array => {
  const samples = new Int16Array(1600);
  samples[0] = tag;
  return samples;
};

function harness(maxInFlight = 1) {
  const transport = new RecordingTransport();
  const opened: string[] = [];
  const ready: { turnId: string; sessionId: string }[] = [];
  const closed: { turnId: string; reason: string }[] = [];
  const logs: string[] = [];
  const pipeline = new TurnPipeline(
    transport,
    {
      onTurnOpened: (turnId) => opened.push(turnId),
      onTurnReady: (turnId, sessionId) => ready.push({ turnId, sessionId }),
      onTurnClosed: (turnId, reason) => closed.push({ turnId, reason }),
      onLog: (message) => logs.push(message),
    },
    maxInFlight,
  );
  pipeline.configure(options);
  return { pipeline, transport, opened, ready, closed, logs };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('TurnPipeline', () => {
  describe('a single turn, as apps/web drives it', () => {
    it('opens, holds audio through the handshake, then sends it in order', () => {
      const h = harness();

      const turnId = h.pipeline.openTurn([block(1), block(2)]);
      h.pipeline.pushAudio(block(3));

      // Nothing on the wire yet but the start: the turn has no id to route with.
      expect(h.transport.ofType('start')).toEqual([{ type: 'start', turnId }]);
      expect(h.transport.audio).toEqual([]);

      h.pipeline.onReady(turnId, 's1');

      expect(h.transport.audio.map((a) => a.tag)).toEqual([1, 2, 3]);
      expect(h.transport.audio.map((a) => a.sequence)).toEqual([0, 1, 2]);
      expect(h.transport.audio.every((a) => a.sessionId === 's1')).toBe(true);
    });

    it('streams straight out once the turn has an id', () => {
      const h = harness();
      const turnId = h.pipeline.openTurn([]);
      h.pipeline.onReady(turnId, 's1');

      h.pipeline.pushAudio(block(1));
      h.pipeline.pushAudio(block(2));

      expect(h.transport.audio.map((a) => a.sequence)).toEqual([0, 1]);
    });

    // The socket reports a frame it could not carry. The block must be held,
    // not counted as sent, and the sequence must not advance over the hole —
    // the server rejects a sequence that moved with a gap in it.
    it('holds a frame the socket refused, and sends it in order when the socket answers again', () => {
      const h = harness();
      const turnId = h.pipeline.openTurn([]);
      h.pipeline.onReady(turnId, 's1');

      h.pipeline.pushAudio(block(1));
      h.transport.sendAudioResult = false;
      h.pipeline.pushAudio(block(2));

      // Only the first frame went out; the refused one is neither on the wire
      // nor counted as captured — it is held, so the row reports it as audio
      // that never reached the server rather than audio that never existed.
      expect(h.transport.audio.map((a) => a.tag)).toEqual([1]);
      const mid = h.pipeline.metricsFor(turnId)!;
      expect(mid.capturedMs).toBe(100);
      expect(mid.heldMs).toBe(100);

      h.transport.sendAudioResult = true;
      h.pipeline.pushAudio(block(3));

      // The held frame resumes in order, ahead of the live one, and the
      // sequence runs 0, 1, 2 with no hole.
      expect(h.transport.audio.map((a) => a.tag)).toEqual([1, 2, 3]);
      expect(h.transport.audio.map((a) => a.sequence)).toEqual([0, 1, 2]);
      const after = h.pipeline.metricsFor(turnId)!;
      expect(after.capturedMs).toBe(300);
      expect(after.heldMs).toBe(0);
    });

    // A turn-scoped error can forget the turn while capture is still
    // mid-utterance. The blocks that keep arriving belong to no turn and reach
    // no transcript; before the counter existed they vanished without a trace.
    it('counts and logs audio that arrives for a turn that is already gone', () => {
      const h = harness();
      const turnId = h.pipeline.openTurn([]);
      h.pipeline.onReady(turnId, 's1');
      h.pipeline.pushAudio(block(1));

      h.pipeline.onServerClosed('completed', { sessionId: 's1' });
      h.pipeline.pushAudio(block(2));

      expect(h.pipeline.orphanedAudioMs).toBe(100);
      expect(h.logs.some((l) => l.includes('already closed'))).toBe(true);
      // The orphaned block never reached the wire.
      expect(h.transport.audio.map((a) => a.tag)).toEqual([1]);
    });

    it('closes the turn and reports it when the server confirms', () => {
      const h = harness();
      const turnId = h.pipeline.openTurn([]);
      h.pipeline.onReady(turnId, 's1');
      h.pipeline.pushAudio(block(1));

      h.pipeline.closeCapturedTurn();
      expect(h.transport.ofType('end')).toEqual([{ type: 'end', sessionId: 's1' }]);

      h.pipeline.onServerClosed('completed', { sessionId: 's1' });
      expect(h.closed).toEqual([{ turnId, reason: 'completed' }]);
    });

    // The gate can suspect the end before the handshake lands. The field is
    // optional on the wire and the server falls back to the socket's only turn.
    it('speculates with a null id when the handshake has not landed', () => {
      const h = harness();
      h.pipeline.openTurn([]);

      h.pipeline.speculate();

      expect(h.transport.ofType('speculate')).toEqual([{ type: 'speculate', sessionId: null }]);
    });

    it('ends a turn whose id arrived after capture had finished with it', () => {
      const h = harness();
      const turnId = h.pipeline.openTurn([block(1)]);

      h.pipeline.closeCapturedTurn(); // capture is done, still no id
      h.pipeline.onReady(turnId, 's1');

      // The held audio goes out, and only then the end.
      expect(h.transport.audio.map((a) => a.tag)).toEqual([1]);
      expect(h.transport.ofType('end')).toEqual([{ type: 'end', sessionId: 's1' }]);
    });
  });

  /**
   * The defect the forced cut exposes, and the reason all four fields are per turn.
   *
   * `ConversationSession` reset `sequence` to 0 and `sessionId` to null for the
   * whole conversation on every turn open. At a cut, the tail of turn N is flushed
   * after turn N+1 has already reset both — so turn N's audio went out under turn
   * N+1's session id with a sequence starting again at 0. The server then either
   * appended it to N+1's buffer, corrupting a sentence silently, or rejected it.
   */
  describe('two turns at once', () => {
    it('gives each turn its own session id and its own advancing sequence', () => {
      const h = harness(3);

      const a = h.pipeline.openTurn([]);
      h.pipeline.onReady(a, 'sa');
      h.pipeline.pushAudio(block(1));
      h.pipeline.pushAudio(block(2));
      h.pipeline.closeCapturedTurn();

      const b = h.pipeline.openTurn([]);
      h.pipeline.onReady(b, 'sb');
      h.pipeline.pushAudio(block(3));

      const forA = h.transport.audio.filter((x) => x.sessionId === 'sa');
      const forB = h.transport.audio.filter((x) => x.sessionId === 'sb');
      expect(forA.map((x) => x.tag)).toEqual([1, 2]);
      expect(forA.map((x) => x.sequence)).toEqual([0, 1]);
      // B starts its own sequence at 0 rather than continuing A's.
      expect(forB.map((x) => x.tag)).toEqual([3]);
      expect(forB.map((x) => x.sequence)).toEqual([0]);
    });

    it('attributes a block captured between two turns to neither', () => {
      const h = harness(3);
      const a = h.pipeline.openTurn([]);
      h.pipeline.onReady(a, 'sa');
      h.pipeline.closeCapturedTurn();

      // Capture is between turns; the gate has not opened the next one yet.
      h.pipeline.pushAudio(block(99));

      expect(h.transport.audio.some((x) => x.tag === 99)).toBe(false);
    });

    it('lets one turn finish while another is being captured', () => {
      const h = harness(3);
      const a = h.pipeline.openTurn([]);
      h.pipeline.onReady(a, 'sa');
      h.pipeline.closeCapturedTurn();
      const b = h.pipeline.openTurn([]);
      h.pipeline.onReady(b, 'sb');

      h.pipeline.onServerClosed('completed', { sessionId: 'sa' });
      h.pipeline.pushAudio(block(1));

      expect(h.closed).toEqual([{ turnId: a, reason: 'completed' }]);
      expect(h.transport.audio.at(-1)).toMatchObject({ sessionId: 'sb', tag: 1 });
    });
  });

  describe('the in-flight ceiling', () => {
    it('holds a turn back rather than opening more than the ceiling allows', () => {
      const h = harness(1);

      const a = h.pipeline.openTurn([]);
      h.pipeline.onReady(a, 'sa');
      h.pipeline.closeCapturedTurn();
      const b = h.pipeline.openTurn([block(1)]);

      // A is still open at the server, so B's start is withheld — but B exists,
      // has claimed its order, and is buffering.
      expect(h.transport.ofType('start').map((s) => s.turnId)).toEqual([a]);
      expect(h.pipeline.phaseOf(b)).toBe('waiting');
      expect(h.opened).toEqual([a, b]);
    });

    it('starts the waiting turn as soon as a slot frees', () => {
      const h = harness(1);
      const a = h.pipeline.openTurn([]);
      h.pipeline.onReady(a, 'sa');
      h.pipeline.closeCapturedTurn();
      const b = h.pipeline.openTurn([block(1)]);

      h.pipeline.onServerClosed('completed', { sessionId: 'sa' });

      expect(h.transport.ofType('start').map((s) => s.turnId)).toEqual([a, b]);
      expect(h.pipeline.phaseOf(b)).toBe('handshaking');

      // And the audio it buffered while waiting is not lost.
      h.pipeline.onReady(b, 'sb');
      expect(h.transport.audio.filter((x) => x.sessionId === 'sb').map((x) => x.tag)).toEqual([1]);
    });
  });

  describe('too_many_turns', () => {
    // The refusal happens inside the server's start(), before any session id
    // exists, so the turn is identifiable only by the name this client gave it.
    // A client that cannot identify it leaves the ordering layer waiting forever.
    it('keeps the turn and its audio, then retries when a slot frees', () => {
      const h = harness(3);
      const a = h.pipeline.openTurn([]);
      h.pipeline.onReady(a, 'sa');
      h.pipeline.closeCapturedTurn();
      const b = h.pipeline.openTurn([block(1)]);

      const handled = h.pipeline.onError('too_many_turns', { turnId: b });

      expect(handled).toBe(true);
      expect(h.pipeline.phaseOf(b)).toBe('waiting');
      // Not reported closed: it is going to be retried, not abandoned.
      expect(h.closed).toEqual([]);
      expect(h.logs.some((line) => line.includes('too_many_turns'))).toBe(true);

      h.pipeline.onServerClosed('completed', { sessionId: 'sa' });
      h.pipeline.onReady(b, 'sb');
      expect(h.transport.audio.filter((x) => x.sessionId === 'sb').map((x) => x.tag)).toEqual([1]);
    });

    it('ignores an error naming a turn it does not have', () => {
      const h = harness();
      h.pipeline.openTurn([]);

      expect(h.pipeline.onError('too_many_turns', { turnId: 'nobody' })).toBe(false);
    });

    /**
     * The two ceilings clear differently, and only one of them is observable here.
     *
     * A refusal by the server's per-socket ceiling clears when one of this client's own
     * turns closes, which the pipeline already reacts to. A refusal by its GLOBAL
     * ceiling clears when some other client finishes — nothing here can see that. A
     * client whose only turn is refused for that reason has nothing that will ever
     * close, so without a timer it translates nothing at all.
     */
    it('retries on its own when nothing of its own will ever close', () => {
      vi.useFakeTimers();
      const h = harness(3);
      const a = h.pipeline.openTurn([block(1)]);

      h.pipeline.onError('too_many_turns', { turnId: a });
      expect(h.pipeline.phaseOf(a)).toBe('waiting');
      expect(h.transport.ofType('start')).toHaveLength(1);

      vi.advanceTimersByTime(750);

      // Offered again without any turn of this client's having closed.
      expect(h.transport.ofType('start')).toHaveLength(2);
      expect(h.pipeline.phaseOf(a)).toBe('handshaking');
    });

    it('gives up after a bounded number of refusals, and says so', () => {
      vi.useFakeTimers();
      const h = harness(3);
      const a = h.pipeline.openTurn([block(1)]);

      // A server that is saturated for as long as anyone cares to wait.
      for (let i = 0; i < 6; i += 1) {
        h.pipeline.onError('too_many_turns', { turnId: a });
        vi.advanceTimersByTime(750);
      }

      expect(h.closed).toEqual([{ turnId: a, reason: 'too_many_turns' }]);
      expect(h.logs.some((line) => line.includes('giving up'))).toBe(true);
    });

    it('stops retrying once the conversation is torn down', () => {
      vi.useFakeTimers();
      const h = harness(3);
      const a = h.pipeline.openTurn([block(1)]);
      h.pipeline.onError('too_many_turns', { turnId: a });

      h.pipeline.reset();
      const before = h.transport.ofType('start').length;
      vi.advanceTimersByTime(10_000);

      expect(h.transport.ofType('start')).toHaveLength(before);
    });
  });

  describe('every path reports the turn closed exactly once', () => {
    it('reports a turn-level error', () => {
      const h = harness();
      const a = h.pipeline.openTurn([]);
      h.pipeline.onReady(a, 'sa');

      h.pipeline.onError('turn_failed', { sessionId: 'sa' });

      expect(h.closed).toEqual([{ turnId: a, reason: 'turn_failed' }]);
    });

    // A turn held back by the ceiling is still captured in full — the microphone
    // does not wait for a slot — so its audio is a complete utterance that is
    // merely late. Discarding it here would lose a whole sentence for no reason
    // other than that the client was busy when the speaker finished.
    it('keeps a fully captured turn that the ceiling withheld, and sends it later', () => {
      const h = harness(1);
      const a = h.pipeline.openTurn([]);
      h.pipeline.onReady(a, 'sa');
      h.pipeline.closeCapturedTurn();
      const b = h.pipeline.openTurn([block(1)]); // withheld by the ceiling

      h.pipeline.closeCapturedTurn(); // capture finishes with B too

      expect(h.closed).toEqual([]);
      expect(h.pipeline.phaseOf(b)).toBe('waiting');

      // A frees its slot; B starts, sends the audio it held, and closes at once.
      h.pipeline.onServerClosed('completed', { sessionId: 'sa' });
      h.pipeline.onReady(b, 'sb');

      expect(h.transport.audio.filter((x) => x.sessionId === 'sb').map((x) => x.tag)).toEqual([1]);
      expect(h.transport.ofType('end')).toContainEqual({ type: 'end', sessionId: 'sb' });
    });

    it('reports every open turn on reset', () => {
      const h = harness(3);
      const a = h.pipeline.openTurn([]);
      h.pipeline.onReady(a, 'sa');
      h.pipeline.closeCapturedTurn();
      const b = h.pipeline.openTurn([]);
      h.pipeline.onReady(b, 'sb');

      h.pipeline.reset();

      expect(h.closed.map((c) => c.turnId).sort()).toEqual([a, b].sort());
      expect(h.pipeline.inFlight).toBe(0);
    });
  });

  describe('the pending ceiling', () => {
    // A server that never answers a handshake left `pending` growing without
    // limit, which on a long meeting is a tab that runs out of memory rather
    // than a conversation that reports a problem.
    it('discards the audio of a turn the server may hold rather than forgetting it', () => {
      const h = harness(3);

      // Three starts sent, never answered, each fed a lot of audio.
      const ids: string[] = [];
      for (let t = 0; t < 3; t += 1) {
        ids.push(h.pipeline.openTurn([]));
        for (let i = 0; i < 120; i += 1) h.pipeline.pushAudio(block(i)); // 12s each
      }

      // Nothing is forgotten: a turn whose start went out may be holding a
      // server slot, and forgetting it under-counts this client against the
      // server until the idle sweep claims the orphan 30s later.
      expect(h.closed).toEqual([]);
      expect(h.logs.some((line) => line.includes('pending ceiling'))).toBe(true);
      // The shed audio stays visible to the metrics channel: `heldMs` is capture
      // that never reached the server, and a discard is exactly that. Without
      // the counter the row reads as a turn nobody spoke into.
      expect(h.pipeline.metricsFor(ids[0]!)?.heldMs).toBeGreaterThan(0);
      // The audio is still shed — that is the memory bound — so a late ready
      // arrives with nothing left to flush.
      for (const [index, id] of ids.entries()) {
        if (index === ids.length - 1) continue; // the turn being captured keeps its audio
        h.pipeline.onReady(id, `s${index}`);
        expect(h.transport.audio.filter((a) => a.sessionId === `s${index}`)).toEqual([]);
      }
    });

    it('forgets a waiting turn whole — the server never saw it', () => {
      const h = harness(1);

      // One start sent and never answered; a second turn waits behind the
      // ceiling and captures, then capture moves on to a third.
      const a = h.pipeline.openTurn([]); // handshaking: the only slot
      const b = h.pipeline.openTurn([]); // waiting
      for (let i = 0; i < 120; i += 1) h.pipeline.pushAudio(block(i)); // 12s on b
      h.pipeline.closeCapturedTurn(); // b fully captured, still waiting
      const c = h.pipeline.openTurn([]); // capture moves on
      for (let i = 0; i < 100; i += 1) h.pipeline.pushAudio(block(i)); // 10s on c

      // 12s + 10s is over the ceiling, and b is the only waiting turn
      // holding audio. Forgetting it leaks nothing: no start was ever sent.
      expect(h.closed).toEqual([{ turnId: b, reason: 'dropped_pending' }]);
      expect(h.logs.some((line) => line.includes('pending ceiling'))).toBe(true);
      // The started turn is untouched, whichever side of the ceiling it sits on.
      expect(h.pipeline.phaseOf(a)).toBe('handshaking');
      expect(h.pipeline.phaseOf(c)).toBe('waiting');
    });

    // The production race, from the log that diagnosed it: a turn waits behind
    // the ceiling gathering audio, its start goes out the moment a slot frees,
    // and the ceiling fires BEFORE the ready lands. Forgetting the turn there
    // leaked a server slot and every later start earned `too_many_turns`.
    it('keeps a turn whose start just went out, so the slot counts stay in step', () => {
      const h = harness(3);

      // Fill all three slots.
      const busy = [h.pipeline.openTurn([]), h.pipeline.openTurn([]), h.pipeline.openTurn([])];
      busy.forEach((id, i) => h.pipeline.onReady(id, `s${i}`));

      // A fourth turn waits, gathering 12s while it has no slot.
      const d = h.pipeline.openTurn([]);
      for (let i = 0; i < 120; i += 1) h.pipeline.pushAudio(block(i));
      h.pipeline.closeCapturedTurn(); // fully captured, still waiting

      // A slot frees: the start goes out, and the ready has NOT landed yet.
      h.pipeline.onServerClosed('completed', { sessionId: 's0' });
      expect(h.transport.ofType('start').map((s) => s.turnId)).toContain(d);
      expect(h.pipeline.phaseOf(d)).toBe('handshaking');

      // Someone else captures now, pushing the held total back over the ceiling.
      const e = h.pipeline.openTurn([]);
      for (let i = 0; i < 120; i += 1) h.pipeline.pushAudio(block(i)); // 12s on e

      // d was NOT forgotten — its audio was shed, its lifecycle was not.
      expect(h.closed.some((c) => c.turnId === d)).toBe(false);
      expect(h.pipeline.phaseOf(d)).toBe('handshaking');
      // e correctly stays waiting: d holds the freed slot at the server, so
      // starting e would be the fourth turn and earn the very refusal under test.
      expect(h.pipeline.phaseOf(e)).toBe('waiting');

      // The late ready lands: nothing to flush, and because capture had already
      // finished, the turn ends immediately — the server's slot is released by
      // the client's own hand rather than by a 30s idle sweep.
      h.pipeline.onReady(d, 'sd');
      expect(h.transport.audio.filter((a) => a.sessionId === 'sd')).toEqual([]);
      expect(h.transport.ofType('end')).toContainEqual({ type: 'end', sessionId: 'sd' });
    });
  });

  describe('matching an answer to its turn', () => {
    it('matches ready by the client’s own name', () => {
      const h = harness(3);
      const a = h.pipeline.openTurn([]);
      h.pipeline.closeCapturedTurn();
      const b = h.pipeline.openTurn([]);

      h.pipeline.onReady(b, 'sb');

      expect(h.ready).toEqual([{ turnId: b, sessionId: 'sb' }]);
      expect(h.pipeline.phaseOf(a)).toBe('ending');
    });

    // `turnId` is optional on the wire, so an older server may not echo it.
    it('falls back to the only turn awaiting an answer', () => {
      const h = harness();
      const a = h.pipeline.openTurn([]);

      h.pipeline.onReady(undefined, 'sa');

      expect(h.ready).toEqual([{ turnId: a, sessionId: 'sa' }]);
    });

    // Two turns can be waiting for an id at once without both being mid-handshake:
    // capture finishes with the first before its `ready` lands, leaving it in
    // `ending` with a null id while the second is still handshaking.
    it('refuses to guess when two turns are awaiting an id', () => {
      const h = harness(3);
      h.pipeline.openTurn([]); // handshaking, no id
      h.pipeline.closeCapturedTurn(); // now ending, still no id
      h.pipeline.openTurn([]); // handshaking, no id

      h.pipeline.onReady(undefined, 'somebody');

      // Guessing would route one turn's audio into another and corrupt it.
      expect(h.ready).toEqual([]);
    });
  });
});
