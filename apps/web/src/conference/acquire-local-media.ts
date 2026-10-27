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

/** The microphone and camera chosen before joining; unset means the system default. */
export interface PreferredDevices {
  audioDeviceId?: string;
  videoDeviceId?: string;
}

/**
 * A device id as an IDEAL constraint, never `{ exact }`: a device unplugged since
 * it was picked would raise `OverconstrainedError`, which reads below as "no
 * camera" and would silently drop video instead of using the default one.
 */
function constraint(deviceId: string | undefined): MediaTrackConstraints | true {
  return deviceId ? { deviceId } : true;
}

export async function acquireLocalMedia(
  devices: PreferredDevices = {},
): Promise<{ stream: MediaStream; audioOnly: boolean }> {
  const audio = constraint(devices.audioDeviceId);
  try {
    return {
      stream: await navigator.mediaDevices.getUserMedia({
        audio,
        video: constraint(devices.videoDeviceId),
      }),
      audioOnly: false,
    };
  } catch (err) {
    const name = err instanceof Error ? err.name : '';
    if (!CAMERA_REFUSED.has(name) && !CAMERA_MISSING.has(name)) throw err;
  }
  try {
    return {
      stream: await navigator.mediaDevices.getUserMedia({ audio, video: false }),
      audioOnly: true,
    };
  } catch {
    throw new MediaPermissionError();
  }
}
