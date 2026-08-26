import { afterEach, describe, expect, it, vi } from 'vitest';
import { openMicrophone } from './open-microphone';
import type { Translate } from '@chatofy/i18n';

/**
 * The classification, which is the whole of this module and is otherwise only
 * observable by unplugging a microphone.
 *
 * The failure it exists to prevent is silent in the same way: a name this table does
 * not know falls through to the generic sentence and still READS correctly, so a
 * mapping that quietly stopped matching would look exactly like one that works.
 *
 * `t` is the identity of the key, so an assertion names the key it expects rather
 * than a sentence that will be reworded.
 */
const t = ((key: string) => key) as unknown as Translate;

/**
 * Typed `Error` for the lint rule's benefit, and one case below deliberately hands it
 * something that is not one — through a cast at the call site, because a rejection
 * that is not an `Error` is exactly what the last fallback exists for.
 */
function rejectWith(error: Error): void {
  vi.stubGlobal('navigator', {
    mediaDevices: { getUserMedia: () => Promise.reject(error) },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('openMicrophone', () => {
  it('passes the stream through when the microphone opens', async () => {
    const stream = {} as MediaStream;
    const getUserMedia = vi.fn(() => Promise.resolve(stream));
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });

    await expect(openMicrophone(t)).resolves.toBe(stream);
    expect(getUserMedia).toHaveBeenCalledWith({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
  });

  it('asks for raw audio when the caller says so', async () => {
    const getUserMedia = vi.fn(() => Promise.resolve({} as MediaStream));
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });

    await openMicrophone(t, true);
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true });
  });

  it.each([
    ['NotFoundError', 'web.translate.micNotFound'],
    ['OverconstrainedError', 'web.translate.micNotFound'],
    ['NotAllowedError', 'web.translate.micDenied'],
    ['SecurityError', 'web.translate.micDenied'],
    ['NotReadableError', 'web.translate.micBusy'],
    ['AbortError', 'web.translate.micBusy'],
  ])('reports %s as %s', async (name, key) => {
    rejectWith(new DOMException('Requested device not found', name));
    await expect(openMicrophone(t)).rejects.toThrow(key);
  });

  it('falls back to the generic sentence for a name it does not know', async () => {
    rejectWith(new DOMException('Something new', 'TypeError'));
    await expect(openMicrophone(t)).rejects.toThrow('web.translate.micFailed');
  });

  it('falls back for a rejection that is not a DOMException at all', async () => {
    rejectWith('not an error' as unknown as Error);
    await expect(openMicrophone(t)).rejects.toThrow('web.translate.micFailed');
  });

  it('keeps the browser exception as the cause', async () => {
    const original = new DOMException('Requested device not found', 'NotFoundError');
    rejectWith(original);
    // What reaches the UI is a sentence for a person; the console still needs the
    // exception the browser actually threw, and only one of them can be the message.
    await expect(openMicrophone(t)).rejects.toMatchObject({ cause: original });
  });
});
