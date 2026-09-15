// @vitest-environment happy-dom
import { act, useEffect, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useConversationPlayer, type UseConversationPlayer } from './use-conversation-player';

/**
 * The headline feature's own hook, with no spec until now — which is exactly
 * why a first press that loaded the bytes and never played them, a scrub that
 * got overwritten by the load it triggered, a silent decode failure, and a
 * fetch that could attach under the wrong conversation all passed CI.
 *
 * happy-dom's `<audio>` is a stub: `play()`/`pause()` are no-ops that never
 * fire an event on their own, and nothing here decodes a real container. That
 * is the right scope for this file — the hook owns the ORCHESTRATION (when to
 * fetch, what to attach, what counts as a fault), not whether a particular
 * browser can play WebM. Every transition below is driven by hand: a
 * `dispatchEvent` for what the element would fire, a spy on `play`/`pause` for
 * what the hook asks the element to do.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const fetchConversationAudio = vi.hoisted(() =>
  vi.fn<(conversationId: string, signal?: AbortSignal) => Promise<Blob>>(),
);
vi.mock('@/clients/api-client', () => ({
  fetchConversationAudio: (conversationId: string, signal?: AbortSignal) =>
    fetchConversationAudio(conversationId, signal),
}));

let container: HTMLDivElement;
let root: Root;

// Published from an effect rather than written during render — see
// `use-conversation-recording.spec.tsx` for why the compiler rule requires it.
const held: { current: UseConversationPlayer | null } = { current: null };
const player = (): UseConversationPlayer => {
  if (!held.current) throw new Error('the probe never rendered');
  return held.current;
};

/** The element the hook actually touches, published the same way. */
const heldAudio: { current: HTMLAudioElement | null } = { current: null };
const audio = (): HTMLAudioElement => {
  if (!heldAudio.current) throw new Error('the probe never rendered');
  return heldAudio.current;
};

function Probe({ conversationId }: { conversationId: string }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const value = useConversationPlayer(conversationId, audioRef);
  useEffect(() => {
    held.current = value;
    heldAudio.current = audioRef.current;
  });
  return <audio ref={audioRef} src={value.src ?? undefined} />;
}

/** A fetch a case can settle on its own schedule, to observe a state in between. */
function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

beforeEach(() => {
  fetchConversationAudio.mockReset();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('useConversationPlayer', () => {
  it('plays on the FIRST press, not only after a seek has primed it', async () => {
    // The regression: `toggle` on the unloaded path called only `load()`, and
    // the effect that seeks and plays once the source attaches only ever ran
    // for a `seekTo` — so the button went silent, disabled during the fetch,
    // re-enabled still showing "Play".
    fetchConversationAudio.mockResolvedValue(new Blob(['audio']));
    act(() => root.render(<Probe conversationId="c-1" />));
    const play = vi.spyOn(audio(), 'play');

    await act(async () => {
      player().toggle();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(player().src).not.toBeNull();
    expect(play).toHaveBeenCalledTimes(1);
    // The normal case — nobody scrubbed first — starts at the beginning.
    expect(audio().currentTime).toBe(0);
  });

  it('starts from the scrubbed position instead of restarting at 0:00', async () => {
    // A scrub while paused only ever moved the readout; it never told the
    // eventual `load()` where to seek to, so the display said 2:00 and playback
    // began at 0:00 the moment Play was pressed.
    fetchConversationAudio.mockResolvedValue(new Blob(['audio']));
    act(() => root.render(<Probe conversationId="c-1" />));
    const play = vi.spyOn(audio(), 'play');

    act(() => player().scrubTo(45_000));
    expect(player().positionMs).toBe(45_000);
    expect(fetchConversationAudio).not.toHaveBeenCalled();

    await act(async () => {
      player().toggle();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(audio().currentTime).toBe(45);
    expect(play).toHaveBeenCalledTimes(1);
  });

  it('surfaces an undecodable recording as `failed`, not a silent, stuck player', async () => {
    // The transport succeeded — `load()`'s catch never runs — and the failure
    // only shows up once the element tries to decode the bytes. Without a
    // listener for it, a WebM the browser cannot play just sits there looking
    // loaded.
    fetchConversationAudio.mockResolvedValue(new Blob(['audio']));
    act(() => root.render(<Probe conversationId="c-1" />));
    vi.spyOn(audio(), 'play');

    await act(async () => {
      player().toggle();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(player().failed).toBe(false);

    act(() => {
      audio().dispatchEvent(new Event('error'));
    });

    expect(player().failed).toBe(true);
    expect(player().loading).toBe(false);
  });

  it('does not attach a fetch, or report a failure, that settles after the conversation changed', async () => {
    const first = deferred<Blob>();
    fetchConversationAudio.mockReturnValueOnce(first.promise);
    act(() => root.render(<Probe conversationId="c-1" />));

    await act(async () => {
      player().toggle();
      await Promise.resolve();
    });
    expect(player().loading).toBe(true);
    const [conversationId, signal] = fetchConversationAudio.mock.calls[0]!;
    expect(conversationId).toBe('c-1');

    // The screen moves on to a different conversation before conversation A's
    // fetch ever settles. The network request is aborted outright — a reader
    // who navigates away must not keep pulling 32 MB in the background — and
    // whatever it eventually resolves with must not become conversation B's
    // audio, or set conversation B's player to `failed`.
    act(() => root.render(<Probe conversationId="c-2" />));
    expect(signal?.aborted, 'the superseded fetch was never aborted').toBe(true);
    expect(player().loading).toBe(false);

    await act(async () => {
      first.resolve(new Blob(['conversation A audio']));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(player().src).toBeNull();
    expect(player().failed).toBe(false);
    expect(player().loading).toBe(false);
  });

  it('toggles play and pause once loaded, without fetching again', async () => {
    fetchConversationAudio.mockResolvedValue(new Blob(['audio']));
    act(() => root.render(<Probe conversationId="c-1" />));
    const play = vi.spyOn(audio(), 'play');
    const pause = vi.spyOn(audio(), 'pause');

    await act(async () => {
      player().toggle();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(fetchConversationAudio).toHaveBeenCalledTimes(1);

    act(() => {
      audio().dispatchEvent(new Event('play'));
    });
    expect(player().playing).toBe(true);

    act(() => player().toggle());
    expect(pause).toHaveBeenCalledTimes(1);

    act(() => {
      audio().dispatchEvent(new Event('pause'));
    });
    expect(player().playing).toBe(false);

    act(() => player().toggle());
    expect(play).toHaveBeenCalledTimes(2);
    // Still one fetch — the source is already attached, so pressing Play again
    // must not re-download the recording.
    expect(fetchConversationAudio).toHaveBeenCalledTimes(1);
  });
});
