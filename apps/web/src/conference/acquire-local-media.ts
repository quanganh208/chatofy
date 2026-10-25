/**
 * Open the camera and microphone for a call, degrading to audio only.
 *
 * A refused or missing camera still lets the call proceed with audio; a
 * refused or missing microphone does not, because there is nothing to
 * translate without it.
 */

/** The microphone could not be opened. */
export class MediaPermissionError extends Error {
  constructor() {
    super('microphone unavailable');
    this.name = 'MediaPermissionError';
  }
}

const CAMERA_REFUSED = new Set(['NotAllowedError', 'PermissionDeniedError']);
const CAMERA_MISSING = new Set(['NotFoundError', 'DevicesNotFoundError', 'OverconstrainedError']);

export async function acquireLocalMedia(): Promise<{ stream: MediaStream; audioOnly: boolean }> {
  try {
    return {
      stream: await navigator.mediaDevices.getUserMedia({ audio: true, video: true }),
      audioOnly: false,
    };
  } catch (err) {
    const name = err instanceof Error ? err.name : '';
    if (!CAMERA_REFUSED.has(name) && !CAMERA_MISSING.has(name)) throw err;
  }
  try {
    return {
      stream: await navigator.mediaDevices.getUserMedia({ audio: true, video: false }),
      audioOnly: true,
    };
  } catch {
    throw new MediaPermissionError();
  }
}
