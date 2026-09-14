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

  // Forget everything when the screen is pointed at a different conversation.
  //
  // `conversation-detail.tsx` resets its own state for exactly this reason and
  // says why — "one line, and the day a link is added it is silent". The player
  // needs the same line and for a worse failure: `load()` returns early while
  // `src` is set, so without this, pressing play on conversation B would sound
  // conversation A's audio under B's transcript.
  useEffect(() => {
    setSrc((previous) => {
      if (previous) URL.revokeObjectURL(previous);
      return null;
    });
    setPlaying(false);
    setFailed(false);
    setPositionMs(0);
    pendingSeekRef.current = null;
  }, [conversationId]);

  // Revoke on unmount. A blob URL pins its bytes in memory for the life of the
  // document otherwise, and a reader moving through several conversations would
  // accumulate every recording they pressed play on.
  useEffect(() => {
    return () => {
      if (src) URL.revokeObjectURL(src);
    };
  }, [src]);

  const load = useCallback(async (): Promise<void> => {
    if (src || loading) return;
    setLoading(true);
    setFailed(false);
    try {
      const blob = await fetchConversationAudio(conversationId);
      setSrc(URL.createObjectURL(blob));
    } catch {
      // One state for every cause. A 404 (no recording, or not the caller's), a
      // 409 (storage unreachable) and a network failure are the same fact to
      // someone holding a play button: it did not load.
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [conversationId, loading, src]);

  // Everything that touches the element, in one place that runs once the source
  // is attached: the listeners, and a seek that was requested before there was
  // anything to seek.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !src) return;

    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onTimeUpdate = () => setPositionMs(Math.round(audio.currentTime * 1000));
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('ended', onPause);
    audio.addEventListener('timeupdate', onTimeUpdate);

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
    };
  }, [audioRef, src]);

  const toggle = useCallback(() => {
    const audio = audioRef.current;
    if (audio && src) {
      if (audio.paused) void audio.play();
      else audio.pause();
      return;
    }
    void load();
  }, [audioRef, load, src]);

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
      setPositionMs(ms);
      if (!audio || !src) return;
      audio.currentTime = ms / 1000;
    },
    [audioRef, src],
  );

  return { src, playing, loading, failed, positionMs, toggle, seekTo, scrubTo };
}
