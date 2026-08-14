import { describe, expect, it } from 'vitest';
import { harness } from './fake-meeting-audio';
import { MeetingCapture } from './meeting-capture';
import type { CaptureSettings } from './messages';

/**
 * The sequencing of a two-way capture.
 *
 * Every test here stands for a failure that a green build did not catch and a
 * code review did: a refused microphone taking the whole meeting down, a dead
 * inbound direction leaving a recording indicator lit over nothing, a teardown
 * re-entering itself, and the transcript being wiped at the exact moment
 * something went wrong. None of them are visible from the type system and none
 * of them would show up without a meeting to run.
 */

const settings = (overrides: Partial<CaptureSettings> = {}): CaptureSettings => ({
  direction: 'en_to_vi',
  mode: 'cascade',
  voiceGender: 'female',
  apiBaseUrl: 'http://localhost:3000',
  reportMetrics: false,
  outbound: false,
  ...overrides,
});

describe('MeetingCapture', () => {
  describe('starting', () => {
    it('asks the server to speak clauses mid-turn, in both directions', async () => {
      // The flag is what makes the whole feature happen, and it is invisible
      // everywhere else: a turn that does not send it behaves exactly as it did
      // before, silently. Both directions must agree — one side hearing
      // mid-sentence translation while the other waits for the turn to end gives
      // the two halves of one conversation different latency.
      const h = harness();
      await new MeetingCapture(h.deps).begin('stream-1', settings({ outbound: true }));

      expect(h.sessions.inbound?.startOptions[0]?.streaming).toBe(true);
      expect(h.sessions.outbound?.startOptions[0]?.streaming).toBe(true);
    });

    it('makes the meeting audible before it waits on the microphone prompt', async () => {
      // `tabCapture` mutes the tab, so between opening the stream and connecting
      // the passthrough the user hears nothing. The permission prompt in between
      // waits for a human, which is seconds of silence, not milliseconds.
      const h = harness();
      await new MeetingCapture(h.deps).begin('stream-1', settings({ outbound: true }));

      expect(h.events.indexOf('passthrough')).toBeLessThan(h.events.indexOf('microphone'));
    });

    it('translates the user in the opposite direction to the meeting', async () => {
      const h = harness();
      await new MeetingCapture(h.deps).begin('stream-1', settings({ outbound: true }));

      expect(h.sessions.inbound!.deps.direction).toBe('en_to_vi');
      expect(h.sessions.outbound!.deps.direction).toBe('vi_to_en');
    });

    it('opens no microphone and no second session when outbound is off', async () => {
      const h = harness();
      await new MeetingCapture(h.deps).begin('stream-1', settings({ outbound: false }));

      expect(h.microphones).toHaveLength(0);
      expect(h.sessions.outbound).toBeUndefined();
      expect(h.events).not.toContain('microphone');
    });
  });

  describe('a microphone the user refuses', () => {
    it('leaves the meeting translating and blames the right direction', async () => {
      const h = harness();
      h.microphoneError.current = new Error('Permission denied');
      const capture = new MeetingCapture(h.deps);

      await capture.begin('stream-1', settings({ outbound: true }));

      expect(capture.isCapturing).toBe(true);
      expect(h.sessions.inbound!.stopped).toBe(0);
      expect(h.tabStream.stopped).toBe(false);
      expect(h.context.closed).toBe(0);

      const status = h.statuses[h.statuses.length - 1]!;
      expect(status.errors.outbound).toBe('Permission denied');
      expect(status.errors.inbound).toBeUndefined();
      expect(status.outbound).toBe('off');
    });
  });

  describe('a direction that dies on its own', () => {
    it('ends the capture when the inbound one goes', async () => {
      // Losing this direction means the capture is translating nothing at all.
      // Leaving it running holds a recording indicator over a dead pipeline.
      const h = harness();
      const capture = new MeetingCapture(h.deps);
      await capture.begin('stream-1', settings({ outbound: true }));

      h.sessions.inbound!.dropConnection();
      await Promise.resolve();

      expect(capture.isCapturing).toBe(false);
      expect(h.tabStream.stopped).toBe(true);
      expect(h.microphones[0]!.stopped).toBe(1);
      expect(h.context.closed).toBe(1);
    });

    it('keeps the meeting when the outbound one goes', async () => {
      // The mirror image, and the reason the two are not symmetric: the meeting's
      // audio only reaches the user through the graph in this context. Tearing it
      // down here would silence the call over a microphone failure.
      const h = harness();
      const capture = new MeetingCapture(h.deps);
      await capture.begin('stream-1', settings({ outbound: true }));

      h.sessions.outbound!.dropConnection();
      await Promise.resolve();

      expect(capture.isCapturing).toBe(true);
      expect(h.context.closed).toBe(0);
      expect(h.tabStream.stopped).toBe(false);
      expect(h.sessions.inbound!.stopped).toBe(0);
      // The microphone is this direction's alone; holding it open would keep the
      // recording indicator lit for something that has stopped.
      expect(h.microphones[0]!.stopped).toBe(1);

      const status = h.statuses[h.statuses.length - 1]!;
      expect(status.capturing).toBe(true);
      expect(status.outbound).toBe('off');
      expect(status.errors.outbound).toBe('Connection to the translator dropped');
    });

    it('does not close the context twice when teardown re-enters itself', async () => {
      // `end()` stops the inbound session, which announces itself, which calls
      // `end()`. Without the guard that is a second teardown of a context that is
      // already closed.
      const h = harness();
      const capture = new MeetingCapture(h.deps);
      await capture.begin('stream-1', settings({ outbound: true }));

      await capture.stop();

      expect(h.context.closed).toBe(1);
      expect(h.tabStream.tracks[0]!.stopped).toBe(1);
      expect(h.microphones[0]!.stopped).toBe(1);
    });
  });

  describe('the transcript', () => {
    it('survives the direction that produced it', async () => {
      // A dropped socket is exactly when the user wants to read what was said.
      const h = harness();
      const capture = new MeetingCapture(h.deps);
      await capture.begin('stream-1', settings({ outbound: true }));

      h.sessions.inbound!.deps.onServerEvent({
        type: 'server.transcript.partial',
        sessionId: 's1',
        text: 'hello there',
        speaker: 'speaker_a',
        direction: 'en_to_vi',
      });
      h.sessions.outbound!.dropConnection();
      await Promise.resolve();

      const lines = h.transcripts[h.transcripts.length - 1]!;
      expect(lines.map((line) => line.sourceText)).toContain('hello there');
    });
  });

  describe('the microphone gate', () => {
    it('stays shut while either direction is still audible', async () => {
      // The failure this prevents: the outbound turn draining 200ms after the
      // inbound one starts reports "nothing is playing", the gate opens, and on a
      // loudspeaker the microphone hears the inbound translation and translates
      // it back.
      const h = harness();
      await new MeetingCapture(h.deps).begin('stream-1', settings({ outbound: true }));
      const microphone = h.microphones[0]!;

      h.sessions.inbound!.deps.onSounding(true);
      h.sessions.outbound!.deps.onSounding(true);
      expect(microphone.suppressed).toBe(true);

      h.sessions.outbound!.deps.onSounding(false);
      expect(microphone.suppressed).toBe(true);

      h.sessions.inbound!.deps.onSounding(false);
      expect(microphone.suppressed).toBe(false);
    });

    /**
     * The gate assumes playback has gaps. The continuous backend has none.
     *
     * It trails the speaker by seconds and keeps talking through their pauses, so
     * "is anything audible" is true for almost the whole meeting. Gating on it
     * there does not quieten the microphone between sentences — it holds it at
     * zero from the first translated sample onward, and the user gets to say
     * exactly one sentence before nothing they say is ever heard again.
     */
    it('does NOT hold the microphone shut on audible playback in live mode', async () => {
      const h = harness();
      await new MeetingCapture(h.deps).begin(
        'stream-1',
        settings({ mode: 'live', outbound: true }),
      );
      const microphone = h.microphones[0]!;

      h.sessions.inbound!.deps.onSounding(true);

      expect(microphone.suppressed).toBe(false);
    });

    it('still shuts the microphone when the meeting client mutes it in live mode', async () => {
      // The privacy rule is not a mode setting. Whatever the backend, speech the
      // user believes is private must never be captured, translated, or handed
      // to the page.
      const h = harness();
      const capture = new MeetingCapture({
        ...h.deps,
        createPageSink: () => ({
          enqueue: () => {},
          isPlayingTurn: () => false,
          isPlaying: false,
          stop: () => {},
          stopTurn: () => {},
        }),
      });
      await capture.begin('stream-1', settings({ mode: 'live', outbound: true }), true);

      capture.setTransmitting(false);

      expect(h.microphones[0]!.suppressed).toBe(true);
    });

    it('measures echo against audible inbound playback only', async () => {
      // `isBusy` opens when the REMOTE speaker starts talking, before a single
      // translated sample exists, so anything the user said in that window would
      // be counted as our own translation coming back.
      const h = harness();
      await new MeetingCapture(h.deps).begin('stream-1', settings({ outbound: true }));
      const echo = h.echoes[0]!;

      h.sessions.inbound!.deps.onBusy(true);
      expect(echo.isPlaying()).toBe(false);

      h.sessions.inbound!.deps.onSounding(true);
      expect(echo.isPlaying()).toBe(true);

      h.sessions.outbound!.deps.onSounding(true);
      h.sessions.inbound!.deps.onSounding(false);
      expect(echo.isPlaying()).toBe(false);
    });
  });

  describe('speaking into the meeting', () => {
    const sending = () => {
      const h = harness();
      const sent: string[] = [];
      const sink = {
        enqueue: () => sent.push('audio'),
        isPlayingTurn: () => false,
        get isPlaying() {
          return false;
        },
        stop: () => sent.push('stop'),
        stopTurn: () => sent.push('stopTurn'),
      };
      h.deps.createPageSink = () => sink;
      return { h, sent, capture: new MeetingCapture(h.deps) };
    };

    it('only sends into a page that carries the patch', async () => {
      const unpatched = sending();
      await unpatched.capture.begin('stream-1', settings({ outbound: true }), false);
      expect(unpatched.h.statuses.at(-1)!.outbound).toBe('monitor');

      const patched = sending();
      await patched.capture.begin('stream-1', settings({ outbound: true }), true);
      // Muted until the page says otherwise — see the next test.
      expect(patched.h.statuses.at(-1)!.outbound).toBe('muted');
    });

    it('ends the capture when the captured tab goes away', async () => {
      // Reloading the meeting page ends the tab's captured track, and nothing
      // downstream notices on its own: the microphone lives in the offscreen
      // document and keeps producing transcript, so the overlay went on reporting
      // a healthy two-way capture over a dead one. Worse, the page-world patch
      // arrives with the NEW document while `sending` was fixed at the previous
      // `begin` — so the user's speech was transcribed, shown to them, and sent
      // nowhere, with nothing on screen saying so.
      const h = sending();
      await h.capture.begin('stream-1', settings({ outbound: true }), false);
      expect(h.h.statuses.at(-1)!.outbound).toBe('monitor');

      h.h.tabStream.getTracks()[0]!.end();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(h.h.statuses.at(-1)!.capturing).toBe(false);
      expect(h.h.microphones[0]!.stopped).toBe(1);
    });

    it('assumes muted until the page says otherwise', async () => {
      // The page world starts when the PAGE loads and reports on change; the
      // offscreen document starts later, when the user invokes capture. Assuming
      // the client is transmitting would mean sending the first sentences of a
      // call the user may have muted.
      const h = sending();
      await h.capture.begin('stream-1', settings({ outbound: true }), true);

      expect(h.h.microphones[0]!.suppressed).toBe(true);
      expect(h.h.statuses.at(-1)!.outbound).toBe('muted');
    });

    it('opens the microphone once the page reports the client transmitting', async () => {
      const h = sending();
      await h.capture.begin('stream-1', settings({ outbound: true }), true);

      h.capture.setTransmitting(true);

      expect(h.h.microphones[0]!.suppressed).toBe(false);
      expect(h.h.statuses.at(-1)!.outbound).toBe('sending');
    });

    it('stops capturing and drops audio in flight when the client mutes', async () => {
      // The privacy rule: a user who mutes to say something private must not
      // have it captured, translated, or handed to the page.
      const h = sending();
      await h.capture.begin('stream-1', settings({ outbound: true }), true);
      h.capture.setTransmitting(true);
      h.sent.length = 0;

      h.capture.setTransmitting(false);

      expect(h.h.microphones[0]!.suppressed).toBe(true);
      expect(h.sent).toContain('stop');
      expect(h.h.statuses.at(-1)!.outbound).toBe('muted');
    });

    it('does not gate the microphone on its own translation once it is sending', async () => {
      // That audio plays in the meeting, not on these speakers, so there is no
      // path back into this microphone to protect against — and gating anyway
      // would mute the user for the length of every sentence they speak.
      const h = sending();
      await h.capture.begin('stream-1', settings({ outbound: true }), true);
      h.capture.setTransmitting(true);

      h.h.sessions.outbound!.deps.onSounding(true);

      expect(h.h.microphones[0]!.suppressed).toBe(false);
    });
  });

  describe('ducking the meeting', () => {
    it('follows the inbound direction and ignores the outbound one', async () => {
      // Ducking lowers what the USER is listening to. Their own translation is a
      // monitor of what the other participants will hear, so quietening the
      // meeting under it is wrong in every phase.
      const h = harness();
      await new MeetingCapture(h.deps).begin('stream-1', settings({ outbound: true }));
      const gain = h.context.gains[0]!;
      const before = [...gain.targets];

      h.sessions.outbound!.deps.onBusy(true);
      expect(gain.targets).toEqual(before);

      h.sessions.inbound!.deps.onBusy(true);
      expect(gain.targets.length).toBeGreaterThan(before.length);
    });
  });

  describe('a stop that arrives mid-start', () => {
    it('abandons the graph instead of installing it behind the stop', async () => {
      // The window is the microphone permission prompt, which waits for a human.
      // A graph installed after the stop is a microphone and a tab capture with
      // nothing left holding a reference to either.
      const h = harness();
      const capture = new MeetingCapture(h.deps);

      const starting = capture.begin('stream-1', settings({ outbound: true }));
      await capture.stop();
      await starting.catch(() => undefined);

      expect(capture.isCapturing).toBe(false);
      expect(h.context.closed).toBeGreaterThan(0);
      expect(h.tabStream.stopped).toBe(true);
      for (const microphone of h.microphones) expect(microphone.stopped).toBe(1);
    });
  });
});
