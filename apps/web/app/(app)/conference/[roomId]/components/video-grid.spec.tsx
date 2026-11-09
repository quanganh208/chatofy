// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { VideoGrid } from './video-grid';

/**
 * A tile with no picture still has to look like a person is there.
 *
 * Joining with audio only (no camera, or permission refused) left a tile that was
 * a blank rectangle with a name chip in the corner, which reads as a broken page.
 * It now shows the person's initials.
 */
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const audioOnly = {
  getVideoTracks: () => [],
  getAudioTracks: () => [{}],
} as unknown as MediaStream;
const withVideo = {
  getVideoTracks: () => [{}],
  getAudioTracks: () => [{}],
} as unknown as MediaStream;

function render(stream: MediaStream, videoEnabled: boolean) {
  act(() => {
    root.render(
      <VideoGrid
        localStream={stream}
        localLabel="UX Audit A"
        localMuted={false}
        localVideoEnabled={videoEnabled}
        peers={new Map()}
        waitingLabel="Waiting"
      />,
    );
  });
}

describe('VideoGrid tile without a picture', () => {
  it('shows initials when the stream has no video track, even if video is "enabled"', () => {
    render(audioOnly, true);
    expect(container.querySelector('[data-slot="tile-avatar"]')?.textContent).toBe('UA');
  });

  it('shows initials when the camera is switched off', () => {
    render(withVideo, false);
    expect(container.querySelector('[data-slot="tile-avatar"]')?.textContent).toBe('UA');
  });

  it('shows no avatar while a picture is playing', () => {
    render(withVideo, true);
    expect(container.querySelector('[data-slot="tile-avatar"]')).toBeNull();
  });
});

describe('VideoGrid proportions on a wide stage', () => {
  it('keeps each tile 16:9 and centres the rows, instead of stretching tall strips', () => {
    // Two people side by side on a wide stage were two 540x700 strips, cropping a
    // 16:9 webcam hard on both sides. From the stage's own 42rem up, tiles keep the
    // camera's shape and the rows sit in the middle of the stage.
    render(withVideo, true);
    const grid = container.firstElementChild as HTMLElement;
    expect(grid.className).toContain('@2xl:content-center');
    expect(grid.className).toContain('@2xl:auto-rows-auto');
    const tile = grid.firstElementChild as HTMLElement;
    expect(tile.className).toContain('@2xl:aspect-video');
  });
});

describe('VideoGrid listening preferences', () => {
  const peers = (subtitle?: string) =>
    new Map([
      [
        'p1',
        { displayName: 'Bình', stream: withVideo, muted: false, videoEnabled: true, subtitle },
      ],
    ]) as unknown as React.ComponentProps<typeof VideoGrid>['peers'];

  function renderWith(extra: Partial<React.ComponentProps<typeof VideoGrid>>) {
    act(() => {
      root.render(
        <VideoGrid
          localStream={withVideo}
          localLabel="Lan"
          localMuted={false}
          localVideoEnabled
          peers={peers('Hello there')}
          waitingLabel="Waiting"
          {...extra}
        />,
      );
    });
  }

  it('hides the subtitle when captions are off', () => {
    renderWith({ captions: true });
    expect(container.querySelector('[aria-live="polite"]')).not.toBeNull();
    renderWith({ captions: false });
    expect(container.querySelector('[aria-live="polite"]')).toBeNull();
  });

  it('passes the caption size to the subtitle', () => {
    renderWith({ captions: true, captionSize: 'xl' });
    expect(container.querySelector('[aria-live="polite"] p')?.className).toContain('text-heading');
  });

  it('sets the volume of the other people original voices and never unmutes the local tile', () => {
    renderWith({ originalVolume: 0.3 });
    const videos = [...container.querySelectorAll('video')] as HTMLVideoElement[];
    expect(videos.length).toBe(2);
    expect(videos[0]?.muted).toBe(true);
    expect(videos[1]?.volume).toBeCloseTo(0.3, 2);
  });
});
