// @vitest-environment happy-dom
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HISTORY_LIMITS } from '@chatofy/types';
import { ApiClientError } from '@chatofy/api-client';
import {
  useConversationAudioUpload,
  type ConversationAudioUploadInput,
  type UseConversationAudioUpload,
} from './use-conversation-audio-upload';

/**
 * When the recording is sent, and — mostly — when it is NOT.
 *
 * Almost every case here is a refusal, because the ways this hook can be wrong
 * are all ways of sending too much: a transcript re-save re-firing it, an upload
 * racing ahead of the row it has to point at, or one conversation's blob landing
 * on the next conversation's id. The transcript save re-fires on every speaker
 * rename (coalesced at 800ms), so "once per conversation" is not a nicety — it is
 * what keeps a rename from re-sending megabytes.
 */

/**
 * The client call, typed at the mock so a case can read the timings back.
 *
 * Spelled inline rather than through an alias: `vi.hoisted` is lifted above every
 * declaration in this file, so a type declared here is not in scope inside it and
 * the mock degrades to `any` — which the lint catches as an unsafe return.
 */
const uploadConversationAudio = vi.hoisted(() =>
  vi.fn<
    (
      conversationId: string,
      blob: Blob,
      timing: { offsetMs: number; durationMs: number },
    ) => Promise<void>
  >(),
);
vi.mock('@/clients/api-client', () => ({ uploadConversationAudio }));

const STARTED_AT = '2026-09-14T10:00:00.000Z';

/** A finished recording, at the shape `useConversationRecording` resolves. */
const recording = (
  over: Partial<{ blob: Blob | null; startedAtMs: number; durationMs: number }> = {},
) => ({
  blob: new Blob(['audio']),
  // 1.4s after the conversation started: the permission prompt and the worklet.
  startedAtMs: Date.parse(STARTED_AT) + 1_400,
  durationMs: 60_000,
  ...over,
});

let container: HTMLDivElement;
let root: Root;

// Published from an effect rather than written during render — see
// `use-conversation-recording.spec.tsx` for why the compiler rule requires it.
const held: { current: UseConversationAudioUpload | null } = { current: null };
const upload = (): UseConversationAudioUpload => {
  if (!held.current) throw new Error('the probe never rendered');
  return held.current;
};

function Probe(props: ConversationAudioUploadInput) {
  const value = useConversationAudioUpload(props);
  useEffect(() => {
    held.current = value;
  }, [value]);
  return null;
}

const base: ConversationAudioUploadInput = {
  conversationId: 'c-1',
  startedAt: STARTED_AT,
  recording: recording(),
  saved: true,
};

async function render(props: Partial<ConversationAudioUploadInput> = {}) {
  await act(async () => {
    root.render(<Probe {...base} {...props} />);
    await Promise.resolve();
  });
}

beforeEach(() => {
  uploadConversationAudio.mockReset();
  uploadConversationAudio.mockResolvedValue();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('useConversationAudioUpload', () => {
  it('sends the recording once the transcript row exists', async () => {
    await render();
    expect(uploadConversationAudio).toHaveBeenCalledTimes(1);
    expect(upload().uploaded).toBe(true);
  });

  it('measures the offset from the RECORDER, not from the conversation', async () => {
    // `startedAt` is stamped before the microphone is even requested, so the gap
    // absorbs the permission prompt. Deriving the offset from the conversation
    // instead would put every gutter timestamp out by that interval.
    await render();
    const [, , timing] = uploadConversationAudio.mock.calls[0]!;
    expect(timing).toEqual({ offsetMs: 1_400, durationMs: 60_000 });
  });

  it('waits for the row: nothing is sent while the transcript is unsaved', async () => {
    // The recording POINTS AT a conversation. Uploading first would answer 404
    // and burn the one attempt this hook makes.
    await render({ saved: false });
    expect(uploadConversationAudio).not.toHaveBeenCalled();

    await render({ saved: true });
    expect(uploadConversationAudio).toHaveBeenCalledTimes(1);
  });

  it('does not re-send when the transcript is re-saved', async () => {
    // A speaker rename re-fires the full-replacement transcript PUT. If that
    // re-fired this too, naming two people would re-upload the whole recording.
    await render();
    expect(uploadConversationAudio).toHaveBeenCalledTimes(1);

    await render({ recording: recording() });
    await render({ recording: recording() });
    expect(uploadConversationAudio).toHaveBeenCalledTimes(1);
  });

  it('sends the next conversation under its own id', async () => {
    await render();
    await render({ conversationId: 'c-2', recording: recording({ durationMs: 5_000 }) });

    expect(uploadConversationAudio).toHaveBeenCalledTimes(2);
    expect(uploadConversationAudio.mock.calls[0]![0]).toBe('c-1');
    expect(uploadConversationAudio.mock.calls[1]![0]).toBe('c-2');
  });

  it('does not carry a failure into the next conversation', async () => {
    // Conversation 1's upload fails; conversation 2 starts with nothing of its
    // own yet. Without a reset keyed to `conversationId`, the banner and its
    // (now inert) Retry would still be describing conversation 1.
    uploadConversationAudio.mockRejectedValueOnce(
      new ApiClientError({ code: 'INTERNAL_ERROR', message: 'down' }, 503),
    );
    await render();
    expect(upload().failure).toBe('retryable');

    await render({ conversationId: 'c-2', recording: null, saved: false });
    expect(upload().failure).toBeNull();
    expect(upload().uploaded).toBe(false);
  });

  it('ignores a resolution that arrives after the next conversation started', async () => {
    // A slow upload for conversation 1 that resolves only after conversation 2
    // has already begun must not attribute its result to conversation 2.
    let resolveUpload: () => void = () => {};
    uploadConversationAudio.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveUpload = resolve;
        }),
    );
    await render();
    expect(upload().uploading).toBe(true);

    await render({ conversationId: 'c-2', recording: null, saved: false });
    expect(upload().uploading).toBe(false);
    expect(upload().failure).toBeNull();

    await act(async () => {
      resolveUpload();
      await Promise.resolve();
    });
    expect(upload().uploaded).toBe(false);
    expect(upload().uploading).toBe(false);
  });

  it('sends nothing when the browser recorded nothing', async () => {
    // No supported container. The transcript and its timestamps still shipped.
    await render({ recording: recording({ blob: null }) });
    expect(uploadConversationAudio).not.toHaveBeenCalled();
    expect(upload().failure).toBeNull();
  });

  it('refuses an oversized recording locally, without spending the upload', async () => {
    // The parser would answer 413, which is correct and costs the whole body to
    // learn something the client already knows.
    const huge = { size: HISTORY_LIMITS.MAX_CONVERSATION_AUDIO_BYTES + 1 } as Blob;
    await render({ recording: recording({ blob: huge }) });

    expect(uploadConversationAudio).not.toHaveBeenCalled();
    expect(upload().failure).toBe('terminal');
  });

  it('offers a retry for a failure that resending could fix', async () => {
    uploadConversationAudio.mockRejectedValueOnce(
      new ApiClientError({ code: 'INTERNAL_ERROR', message: 'down' }, 503),
    );
    await render();
    expect(upload().failure).toBe('retryable');

    uploadConversationAudio.mockResolvedValue();
    await act(async () => {
      upload().retry();
      await Promise.resolve();
    });
    expect(uploadConversationAudio).toHaveBeenCalledTimes(2);
    expect(upload().uploaded).toBe(true);
  });

  it('offers no retry when the conversation was deleted mid-upload', async () => {
    // 404: the row this upload points at is gone — deleted, or never this
    // caller's — in the gap between the transcript save and this request.
    // Resending the same bytes cannot make it exist.
    uploadConversationAudio.mockRejectedValue(
      new ApiClientError({ code: 'NOT_FOUND', message: 'gone' }, 404),
    );
    await render();
    expect(upload().failure).toBe('terminal');

    await act(async () => {
      upload().retry();
      await Promise.resolve();
    });
    expect(uploadConversationAudio).toHaveBeenCalledTimes(1);
  });

  it('offers no retry for a failure that resending never could', async () => {
    // 415: those bytes are not a container this API stores. A different recording
    // might be; this one will not become one.
    uploadConversationAudio.mockRejectedValue(
      new ApiClientError({ code: 'VALIDATION_FAILED', message: 'bad' }, 415),
    );
    await render();
    expect(upload().failure).toBe('terminal');

    await act(async () => {
      upload().retry();
      await Promise.resolve();
    });
    expect(uploadConversationAudio).toHaveBeenCalledTimes(1);
  });
});
