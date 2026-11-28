/**
 * Which dictionary sentence says why `getUserMedia` failed.
 *
 * Chosen by `DOMException.name`, never by the exception's message: the message is
 * the browser's own English and would land inside a Vietnamese or Chinese sentence.
 */
export type MicrophoneFailureKey =
  | 'extension.microphone.refused'
  | 'extension.microphone.notFound'
  | 'extension.microphone.inUse'
  | 'extension.microphone.openFailed';

export function microphoneFailureKey(err: unknown): MicrophoneFailureKey {
  const name = err instanceof DOMException ? err.name : undefined;
  switch (name) {
    case 'NotAllowedError':
      return 'extension.microphone.refused';
    case 'NotFoundError':
      return 'extension.microphone.notFound';
    case 'NotReadableError':
    case 'AbortError':
      return 'extension.microphone.inUse';
    default:
      return 'extension.microphone.openFailed';
  }
}
