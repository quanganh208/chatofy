'use client';

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { fetchConversationAudio } from '@/clients/api-client';

export interface UseConversationPlayer {
  /** The blob URL, or null until the first press of play. */
  src: string | null;
  /** The recording is sounding. */
  playing: boolean;
  /** Fetching the bytes. */
  loading: boolean;
  /** The recording could not be loaded. */
  failed: boolean;
  /** Position in the media, in ms. */
  positionMs: number;
  /** Play if paused, pause if playing. Loads on the first call. */
  toggle: () => void;
  /**
   * Jump to a position and PLAY, loading first if necessary.
   *
   * What a gutter timestamp does: pressing a time is a request to hear that line,
   * so it starts playback even from a standing stop.
   */
  seekTo: (ms: number) => void;
  /**
   * Move the position WITHOUT starting playback.
   *
   * What the scrubber does. Dragging a slider to look at a different part of a
   * paused recording should not start it sounding — that is a different intent
   * from pressing a timestamp, and collapsing the two makes the slider
   * unusable while paused.
   */
  scrubTo: (ms: number) => void;
}

/**
 * Plays a stored conversation's recording.
 *
 * ## Why the bytes come through `fetch`
 *
 * Two independent reasons, either sufficient on its own. The download route is
 * bearer-authenticated — `JwtAuthGuard` is a global `APP_GUARD` — and an
 * `<audio src>` cannot send a header. And the page's CSP is
 * `media-src 'self' blob:`, which admits no API origin. A `blob:` URL satisfies
 * both, and needs no CSP change to do it.
 *
 * ## Why the element is passed IN rather than created here
 *
 * The `<audio>` element belongs to the component that renders it, so its ref is
 * created there and handed down. Two alternatives were tried and are both wrong:
 * returning a ref object from this hook makes every property read on the returned
 * value look like a ref access during render, and holding the element in
 * `useState` makes it immutable — `audio.currentTime = …` is then a mutation of
 * state, which is exactly what it must not be. A ref passed in is the shape where
 * reading and mutating the element inside effects and handlers is legal, which is
 * all this hook ever does with it.
 *
 * ## Why nothing is fetched on mount
 *
 * Most readers open a conversation to READ it. Fetching up to 32 MB for everyone
 * who opens a detail page would spend the bandwidth of the feature on the people
 * not using it, so the first press of play is what loads.
 *
 * ## Why the total does not come from the element
 *
 * `MediaRecorder` writes no Duration into the WebM Segment Info, so
 * `audio.duration` on the resulting blob commonly reads `Infinity`. The caller
 * passes the stored `audioDurationMs` instead — see `Conversation`. This hook
 * therefore reports only a POSITION and never a total.
 *
 * ## Why a fetch carries a generation, not just an abort signal
 *
 * `conversationId` can change under a live hook instance — the reset effect
 * below exists for exactly that, because nothing today guarantees this
 * component remounts between two detail pages. An in-flight fetch that resolves
 * after the id has moved on must neither attach its bytes under the new id nor
 * report the new id's player as failed. The generation counter is what tells a
 * settling fetch whether it is still the one anyone asked for; the
 * `AbortController` is what stops the network request from finishing at all,
 * so a reader who navigates away does not keep pulling 32 MB in the background.
 */
export function useConversationPlayer(
  conversationId: string,
  audioRef: RefObject<HTMLAudioElement | null>,
): UseConversationPlayer {
  const [src, setSrc] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [positionMs, setPositionMs] = useState(0);

  // Where to jump once the bytes arrive, when a seek happened before the load.
  const pendingSeekRef = useRef<number | null>(null);

  // Which fetch, if any, is still worth acting on, and the means to stop it.
  // `loading` is state and would double-fire two gutter clicks in one tick, so
  // the in-flight guard in `load` reads `abortRef` instead. The generation is
  // bumped whenever the fetch this hook is running no longer matters — a new
  // load, a conversation switch, or unmounting — so a stale `await` can tell it
  // no longer speaks for anything on screen.
  const abortRef = useRef<AbortController | null>(null);
  const generationRef = useRef(0);

  // Forget everything when the screen is pointed at a different conversation.
  //
  // `conversation-detail.tsx` resets its own state for exactly this reason and
  // says why — "one line, and the day a link is added it is silent". The player
  // needs the same line and for a worse failure: `load()` returns early while
  // `src` is set, so without this, pressing play on conversation B would sound
  // conversation A's audio under B's transcript.
  useEffect(() => {
    setSrc(null);
    setPlaying(false);
    setLoading(false);
    setFailed(false);
    setPositionMs(0);
    pendingSeekRef.current = null;
    return () => {
      // Runs before the next conversation's reset, and on unmount. Either way,
      // whatever this generation was fetching stops mattering here: abort it so
      // the bytes are not still arriving for a screen nobody can see, and bump
      // the counter so its `await`, if it settles anyway, recognizes itself as
      // superseded.
      generationRef.current += 1;
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, [conversationId]);

  // Revoke on unmount, and on every change away from a previous blob URL — the
  // cleanup below closes over whichever `src` it was declared for, so setting a
  // new one (or `null`) always revokes the one it replaces. A blob URL pins its
  // bytes in memory for the life of the document otherwise, and a reader moving
  // through several conversations would accumulate every recording they pressed
  // play on.
  useEffect(() => {
    return () => {
      if (src) URL.revokeObjectURL(src);
    };
  }, [src]);

  const load = useCallback(async (): Promise<void> => {
    // The ref, not `loading`: `loading` is state and would let two clicks inside
    // one tick both start a fetch before either re-render lands.
    if (src || abortRef.current) return;

    const controller = new AbortController();
    abortRef.current = controller;
    const generation = ++generationRef.current;

    setLoading(true);
    setFailed(false);
    try {
      const blob = await fetchConversationAudio(conversationId, controller.signal);
      // Superseded while the fetch was in flight — a newer load, a conversation
      // switch, or an unmount. Nothing here belongs to the current screen, so
      // the object URL is never even created: creating it and never attaching it
      // would be the leak this generation check exists to prevent.
      if (generation !== generationRef.current) return;
      setSrc(URL.createObjectURL(blob));
    } catch {
      if (generation !== generationRef.current) return;
      // One state for every cause. A 404 (no recording, or not the caller's), a
      // 409 (storage unreachable) and a network failure are the same fact to
      // someone holding a play button: it did not load.
      setFailed(true);
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      // A superseded generation's `loading` was already settled — either the
      // reset effect above cleared it for the new conversation, or a newer load
      // is still the one holding it true. Clearing it here for an old, unrelated
      // fetch would flip a spinner off mid-fetch for whatever replaced it.
      if (generation === generationRef.current) setLoading(false);
    }
  }, [conversationId, src]);

  // Everything that touches the element, in one place that runs once the source
  // is attached: the listeners, and a seek that was requested before there was
  // anything to seek.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !src) return;

    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onTimeUpdate = () => setPositionMs(Math.round(audio.currentTime * 1000));
    // An undecodable recording — a WebM the browser cannot play, or bytes
    // truncated in transit — fetches fine and only fails once the element tries
    // to decode it. Without this listener that failure is silent: `failed` is
    // otherwise set only inside `load()`'s catch, which never runs for a
    // transport success.
    const onError = () => {
      setFailed(true);
      setLoading(false);
    };
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('ended', onPause);
    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('error', onError);

    const pending = pendingSeekRef.current;
    if (pending !== null) {
      pendingSeekRef.current = null;
      audio.currentTime = pending / 1000;
      void audio.play();
    }

    return () => {
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('ended', onPause);
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('error', onError);
    };
  }, [audioRef, src]);

  const toggle = useCallback(() => {
    const audio = audioRef.current;
    if (audio && src) {
      if (audio.paused) void audio.play();
      else audio.pause();
      return;
    }
    // Unloaded: record where playback should start once the bytes arrive, THEN
    // load. `positionMs` is 0 unless a scrub already moved the readout while
    // paused — reading it here is what makes scrubbing before the first press
    // land at the scrubbed position instead of silently restarting at 0. The
    // effect above is the only place anything actually seeks or plays; this
    // only leaves it something to act on once the source is attached.
    pendingSeekRef.current = positionMs;
    void load();
  }, [audioRef, load, positionMs, src]);

  const seekTo = useCallback(
    (ms: number) => {
      const audio = audioRef.current;
      if (!audio || !src) {
        // Remember where to land; the effect above applies it once the source is
        // attached. Clicking a timestamp before ever pressing play is the normal
        // way into this feature, not an edge case.
        pendingSeekRef.current = ms;
        void load();
        return;
      }
      audio.currentTime = ms / 1000;
      setPositionMs(ms);
      void audio.play();
    },
    [audioRef, load, src],
  );

  const scrubTo = useCallback(
    (ms: number) => {
      const audio = audioRef.current;
      // Nothing loaded yet: move the readout so the control answers the drag,
      // and leave loading to an explicit play or a timestamp press. Fetching up
      // to 32 MB because someone brushed a slider is not what they asked for.
      // `toggle` reads this readout as the position to seek to once it loads, so
      // a scrub before the first press is not lost — it is remembered, not
      // fetched.
      setPositionMs(ms);
      if (!audio || !src) return;
      audio.currentTime = ms / 1000;
    },
    [audioRef, src],
  );

  return { src, playing, loading, failed, positionMs, toggle, seekTo, scrubTo };
}
