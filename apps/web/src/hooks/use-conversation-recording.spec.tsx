// @vitest-environment happy-dom
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  useConversationRecording,
  type UseConversationRecording,
} from './use-conversation-recording';

/**
 * The recorder, against the ORDERING the session actually produces.
 *
 * happy-dom has no `MediaRecorder`, so this supplies one — and the fake's whole
 * job is to reproduce the one behaviour that broke the feature: per the
 * MediaStream Recording spec, when every track of the recorded stream ends, the
 * user agent stops the recorder ITSELF. It fires `dataavailable`, then `stop`,
 * and goes `inactive`, without anyone calling `stop()`.
 *
 * That is exactly what `ConversationSession.finish()` causes — it stops the
 * microphone tracks, then drains for seconds waiting for the last translation to
 * be spoken, and only then emits `idle`. The hook's `finish()` runs at `idle`, by
 * which point the recorder has been inactive for the length of the drain.
 *
 * An earlier revision read `state === 'inactive'` as "nothing was recorded" and
 * returned no blob, discarding every recording on the normal End path — silently,
 * with no failure alert and nothing uploaded. Nothing could see it: there is no
 * `MediaRecorder` in this environment to notice, and the API tests are on the
 * other side of an upload that never happened.
 */

class FakeMediaRecorder {
  static supported = ['audio/webm;codecs=opus'];
  static isTypeSupported = (type: string) => FakeMediaRecorder.supported.includes(type);
  /** Every instance built, so a case can drive the one it is testing. */
  static instances: FakeMediaRecorder[] = [];

  state: 'inactive' | 'recording' | 'paused' = 'inactive';
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  readonly mimeType: string;
  /** Counts explicit `stop()` calls, to prove `finish()` does not double-stop. */
  explicitStops = 0;

  constructor(
    readonly stream: MediaStream,
    options: { mimeType: string; audioBitsPerSecond?: number },
  ) {
    this.mimeType = options.mimeType;
    FakeMediaRecorder.instances.push(this);
  }

  start(): void {
    this.state = 'recording';
  }

  stop(): void {
    this.explicitStops += 1;
    this.endOfStream();
  }

  /**
   * What the user agent does when the recorded stream's tracks all end: flush the
   * data, fire `stop`, go inactive. No caller involved.
   */
  endOfStream(bytes = 'audio-bytes'): void {
    if (this.state === 'inactive') return;
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob([bytes]) });
    this.onstop?.();
  }
}

/** A stream whose identity a case can assert is handed back untouched. */
const fakeStream = () => ({ id: 'mic' }) as unknown as MediaStream;

let container: HTMLDivElement;
let root: Root;

/**
 * The hook's value, published from an EFFECT rather than written during render.
 *
 * The React Compiler lint forbids a component writing to anything declared
 * outside it while rendering, and it is right to — that is the shape it exists to
 * catch. An effect is where reaching outward is legitimate, so the probe hands
 * its value out there. `attach` and `finish` are stable across renders, so one
 * publish is enough.
 */
const held: { current: UseConversationRecording | null } = { current: null };
const hookValue = (): UseConversationRecording => {
  if (!held.current) throw new Error('the probe never rendered');
  return held.current;
};

function Probe() {
  const value = useConversationRecording();
  useEffect(() => {
    held.current = value;
  }, [value]);
  return null;
}

beforeEach(() => {
  FakeMediaRecorder.instances = [];
  FakeMediaRecorder.supported = ['audio/webm;codecs=opus'];
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => root.render(<Probe />));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe('useConversationRecording', () => {
  it('hands the stream back untouched, so the session sees what it opened', () => {
    const stream = fakeStream();
    let returned: MediaStream | undefined;
    act(() => {
      returned = hookValue().attach(stream);
    });
    expect(returned).toBe(stream);
  });

  it('keeps the recording when the stream ended long before finish() is called', async () => {
    // THE REGRESSION. Tracks end at `session.finish()`, the drain runs for
    // seconds, and only then does `idle` call `finish()`. A recorder that is
    // already inactive still has a whole conversation in it.
    act(() => {
      hookValue().attach(fakeStream());
    });
    const recorder = FakeMediaRecorder.instances[0]!;

    act(() => recorder.endOfStream());
    expect(recorder.state).toBe('inactive');

    const result = await hookValue().finish();
    expect(result?.blob).not.toBeNull();
    expect(result?.blob?.type).toBe('audio/webm;codecs=opus');
    // `finish()` must not stop a recorder that already stopped itself.
    expect(recorder.explicitStops).toBe(0);
  });

  it('measures the duration to the STOP, not to the call that collects it', async () => {
    // The drain sits between the two. Measuring at collection time would add it
    // to every stored duration, and the scrubber's maximum would then sit past
    // the end of the audio.
    vi.useFakeTimers();
    try {
      const start = Date.now();
      act(() => {
        hookValue().attach(fakeStream());
      });
      const recorder = FakeMediaRecorder.instances[0]!;

      vi.advanceTimersByTime(60_000);
      act(() => recorder.endOfStream());

      // The drain: seconds of playback after the microphone has closed.
      vi.advanceTimersByTime(9_000);

      const result = await hookValue().finish();
      expect(result?.durationMs).toBe(60_000);
      expect(result?.startedAtMs).toBe(start);
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops a recorder that is still running, for a path that never ended the tracks', async () => {
    act(() => {
      hookValue().attach(fakeStream());
    });
    const recorder = FakeMediaRecorder.instances[0]!;
    expect(recorder.state).toBe('recording');

    const result = await hookValue().finish();
    expect(recorder.explicitStops).toBe(1);
    expect(result?.blob).not.toBeNull();
  });

  it('reports no blob, but still a start time, when no container is supported', async () => {
    // Safari without the MP4 entry, or any browser that supports none of them.
    // The TIMESTAMP half must not depend on the AUDIO half: a transcript with
    // correct times and no player is the intended degraded state.
    FakeMediaRecorder.supported = [];
    act(() => {
      hookValue().attach(fakeStream());
    });
    expect(FakeMediaRecorder.instances).toHaveLength(0);

    const result = await hookValue().finish();
    expect(result?.blob).toBeNull();
    expect(result?.startedAtMs).toBeGreaterThan(0);
  });

  it('reports no blob when the recorder produced nothing', async () => {
    // A conversation ended before a single chunk arrived. Not an error, and not
    // a zero-byte upload either — the route would refuse one with 415.
    act(() => {
      hookValue().attach(fakeStream());
    });
    const recorder = FakeMediaRecorder.instances[0]!;
    act(() => {
      recorder.state = 'inactive';
      recorder.onstop?.();
    });

    const result = await hookValue().finish();
    expect(result?.blob).toBeNull();
  });

  it('returns null when nothing was ever attached', async () => {
    await expect(hookValue().finish()).resolves.toBeNull();
  });

  it('does not carry one conversation recording into the next', async () => {
    act(() => {
      hookValue().attach(fakeStream());
    });
    act(() => FakeMediaRecorder.instances[0]!.endOfStream('first'));
    const first = await hookValue().finish();

    act(() => {
      hookValue().attach(fakeStream());
    });
    act(() => FakeMediaRecorder.instances[1]!.endOfStream('second'));
    const second = await hookValue().finish();

    expect(await first?.blob?.text()).toBe('first');
    // A shared chunk buffer would make this 'firstsecond' — which is how one
    // conversation's audio ends up attached to the next one's row.
    expect(await second?.blob?.text()).toBe('second');
  });
});
