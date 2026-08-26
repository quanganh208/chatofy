import type { MessageKey, Translate } from '@chatofy/i18n';

/**
 * The microphone, asked for in the reader's language when it cannot be had.
 *
 * Every surface that captures audio went through `navigator.mediaDevices.getUserMedia`
 * directly and reported `err.message` — which is a string the BROWSER wrote, in the
 * browser's own words and in English on a bilingual product. A Vietnamese reader with
 * nothing plugged in was shown "Requested device not found", which names the failure
 * without naming the fix.
 *
 * So the rejection is classified here, once, and turned into a sentence from the
 * dictionary that says what to do next. The classification is on `name`, not on
 * `message`: the name is the spec'd, stable half of a `DOMException` and the message is
 * explicitly implementation-defined prose that differs between browsers and versions.
 *
 * The original is kept as `cause` rather than discarded. What reaches the UI is a
 * sentence for a person; what a developer needs in the console is the exception the
 * browser actually threw, and only one of those two can be the message.
 *
 * Throwing a plain `Error` whose `message` is ALREADY the translated sentence is what
 * lets this work through `realtime-client` unchanged: `ConversationSession` reports a
 * failed start as `err.message`, and it has no dictionary and should not grow one — it
 * is shared with the extension.
 */

/**
 * `DOMException.name` → what to tell the reader.
 *
 * `OverconstrainedError` joins `NotFoundError`: both mean nothing matched, and the
 * distinction — no device at all versus no device meeting the constraints — is a
 * distinction the person holding the microphone cannot act on differently.
 *
 * `SecurityError` joins `NotAllowedError` for the same reason: from where the reader
 * sits, a blocked permission and a blocked document are the same wall.
 *
 * `AbortError` joins `NotReadableError`: a device that exists, was allowed, and still
 * would not open is a device something else is holding.
 */
const FAULT_KEY: Record<string, MessageKey> = {
  NotFoundError: 'web.translate.micNotFound',
  OverconstrainedError: 'web.translate.micNotFound',
  NotAllowedError: 'web.translate.micDenied',
  SecurityError: 'web.translate.micDenied',
  NotReadableError: 'web.translate.micBusy',
  AbortError: 'web.translate.micBusy',
};

/**
 * What the conversation paths ask for.
 *
 * The browser's own cleanup is free and helps the detector; it is not a substitute for
 * muting, which is what stops the acoustic loop. The baseline lab route deliberately
 * does NOT use these — it records raw audio to be measured against, and processing its
 * input would change what the comparison is comparing.
 */
export const CONVERSATION_AUDIO: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
};

export async function openMicrophone(
  t: Translate,
  audio: MediaStreamConstraints['audio'] = CONVERSATION_AUDIO,
): Promise<MediaStream> {
  try {
    return await navigator.mediaDevices.getUserMedia({ audio });
  } catch (err) {
    const key = err instanceof DOMException ? FAULT_KEY[err.name] : undefined;
    // The fallback is not a guess dressed as a diagnosis: an unrecognised name says
    // the microphone did not open and nothing more, which is all this knows.
    throw new Error(t(key ?? 'web.translate.micFailed'), { cause: err });
  }
}
