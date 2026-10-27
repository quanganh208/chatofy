// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { acquireLocalMedia, MediaPermissionError } from './acquire-local-media';

const getUserMedia = vi.fn<(constraints: MediaStreamConstraints) => Promise<MediaStream>>();
// happy-dom has no `navigator.mediaDevices`, so there is nothing to spy on.
Object.defineProperty(navigator, 'mediaDevices', {
  value: { getUserMedia },
  configurable: true,
});

const stream = {} as MediaStream;
const named = (name: string) => Object.assign(new Error(name), { name });

describe('acquireLocalMedia', () => {
  beforeEach(() => getUserMedia.mockReset());

  it('asks for the default devices when none were picked', async () => {
    getUserMedia.mockResolvedValue(stream);
    await acquireLocalMedia();
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true, video: true });
  });

  it('prefers the devices picked before joining', async () => {
    getUserMedia.mockResolvedValue(stream);
    await acquireLocalMedia({ audioDeviceId: 'mic-1', videoDeviceId: 'cam-1' });
    expect(getUserMedia).toHaveBeenCalledWith({
      audio: { deviceId: 'mic-1' },
      video: { deviceId: 'cam-1' },
    });
  });

  it('keeps the picked microphone when the camera is refused', async () => {
    getUserMedia.mockRejectedValueOnce(named('NotAllowedError')).mockResolvedValueOnce(stream);
    const result = await acquireLocalMedia({ audioDeviceId: 'mic-1', videoDeviceId: 'cam-1' });
    expect(getUserMedia).toHaveBeenLastCalledWith({ audio: { deviceId: 'mic-1' }, video: false });
    expect(result.audioOnly).toBe(true);
  });

  it('fails when the microphone cannot be opened either', async () => {
    getUserMedia
      .mockRejectedValueOnce(named('NotAllowedError'))
      .mockRejectedValueOnce(named('NotAllowedError'));
    await expect(acquireLocalMedia()).rejects.toBeInstanceOf(MediaPermissionError);
  });
});
