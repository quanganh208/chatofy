import { describe, expect, it } from 'vitest';
import type { OverlayState } from './messages';
import {
  MAX_OVERLAY_LINES,
  OverlayPublisher,
  type OverlayPublisherDeps,
} from './overlay-publisher';

/**
 * What the overlay is told, and what it is never allowed to lose.
 *
 * Each test here stands for something a user would see and misread: a shortcut
 * hint dropped from a push, so someone in a toolbar-less call window has no way
 * to stop; a capture error wiped by an unrelated status update; the previous
 * meeting's transcript rendered into the next one's overlay.
 */
function harness() {
  const rendered: { tabId: number; state: OverlayState }[] = [];
  let menuRefreshes = 0;
  const patchedTabs = new Set<number>();
  const deps: OverlayPublisherDeps = {
    render: (tabId, state) => rendered.push({ tabId, state }),
    refreshMenuTitle: () => {
      menuRefreshes += 1;
    },
    patchedFor: (tabId) => (tabId === null ? undefined : patchedTabs.has(tabId)),
  };
  return {
    rendered,
    patchedTabs,
    menuRefreshes: () => menuRefreshes,
    publisher: new OverlayPublisher(deps),
    last: () => rendered[rendered.length - 1]?.state,
  };
}

const line = (text: string) => ({ id: text, speaker: 'them', text }) as never;

describe('OverlayPublisher', () => {
  describe('where renders go', () => {
    it('sends nothing while no tab is being captured', () => {
      const h = harness();

      h.publisher.publish(OverlayPublisher.blank());

      expect(h.rendered).toHaveLength(0);
    });

    it('still renames the menu item when there is no tab to render to', () => {
      const h = harness();

      h.publisher.publish(OverlayPublisher.blank());

      // A state change renames the item even with nowhere to push a render.
      expect(h.menuRefreshes()).toBe(1);
    });

    it('sends to the tab the worker named', () => {
      const h = harness();
      h.publisher.setTarget(7);

      h.publisher.publish(OverlayPublisher.blank());

      expect(h.rendered[0]!.tabId).toBe(7);
    });
  });

  describe('decorations ride along on every push', () => {
    it('carries the shortcut the worker learned', () => {
      const h = harness();
      h.publisher.setTarget(1);
      h.publisher.setShortcut('Alt+Shift+C');

      h.publisher.applyTranscript([line('hello')]);

      // The overlay is the only surface that can tell someone in a window with
      // no toolbar how to stop, and it cannot ask Chrome itself.
      expect(h.last()!.shortcut).toBe('Alt+Shift+C');
    });

    it('carries settings and patched state through an unrelated update', () => {
      const h = harness();
      h.publisher.setTarget(1);
      h.publisher.setSettings({ direction: 'en_to_vi', voiceGender: 'female', outbound: true });
      h.patchedTabs.add(1);

      h.publisher.applyStatus({ capturing: true, outbound: 'on', errors: {} } as never);

      expect(h.last()!.patched).toBe(true);
      expect(h.last()!.settings?.direction).toBe('en_to_vi');
    });

    it('asks again at publish time, so a newly patched tab is not stale', () => {
      const h = harness();
      h.publisher.setTarget(1);
      h.publisher.applyTranscript([line('one')]);

      h.patchedTabs.add(1);
      h.publisher.republish();

      expect(h.rendered).toHaveLength(2);
      expect(h.last()!.lines).toHaveLength(1);
      expect(h.last()!.patched).toBe(true);
    });
  });

  describe('applyStatus', () => {
    it('keeps the worker capture error while replacing the direction errors', () => {
      const h = harness();
      h.publisher.setTarget(1);
      h.publisher.publishCaptureError('tab went away');

      h.publisher.applyStatus({
        capturing: true,
        outbound: 'on',
        errors: { outbound: 'mic refused' },
      } as never);

      expect(h.last()!.errors.capture).toBe('tab went away');
      expect(h.last()!.errors.outbound).toBe('mic refused');
    });

    it('keeps the transcript already on screen', () => {
      const h = harness();
      h.publisher.setTarget(1);
      h.publisher.applyTranscript([line('a'), line('b')]);

      h.publisher.applyStatus({ capturing: true, outbound: 'off', errors: {} } as never);

      expect(h.last()!.lines).toHaveLength(2);
    });
  });

  describe('applyTranscript', () => {
    it('keeps only the newest lines', () => {
      const h = harness();
      h.publisher.setTarget(1);
      const many = Array.from({ length: MAX_OVERLAY_LINES + 10 }, (_, i) => line(`l${i}`));

      h.publisher.applyTranscript(many);

      expect(h.last()!.lines).toHaveLength(MAX_OVERLAY_LINES);
      // Newest last: the oldest ten are the ones dropped.
      expect(h.last()!.lines[0]).toEqual(many[10]);
    });

    it('leaves capture state and errors alone', () => {
      const h = harness();
      h.publisher.setTarget(1);
      h.publisher.applyStatus({ capturing: true, outbound: 'on', errors: {} } as never);

      h.publisher.applyTranscript([line('x')]);

      expect(h.last()!.capturing).toBe(true);
      expect(h.last()!.outbound).toBe('on');
    });
  });

  describe('reset', () => {
    it('drops the previous meeting transcript before the next one renders', () => {
      const h = harness();
      h.publisher.setTarget(1);
      h.publisher.applyTranscript([line('from meeting A')]);

      h.publisher.reset();
      h.publisher.setTarget(2);
      h.publisher.publish(OverlayPublisher.blank());

      // Capturing A, stopping, then capturing B in another tab used to render
      // A's lines into B's overlay — and hand them to B's popup too.
      expect(h.last()!.lines).toHaveLength(0);
    });

    it('does not render on its own', () => {
      const h = harness();
      h.publisher.setTarget(1);

      h.publisher.reset();

      expect(h.rendered).toHaveLength(0);
    });
  });

  describe('publishStopped', () => {
    it('clears capture but keeps the transcript readable', () => {
      const h = harness();
      h.publisher.setTarget(1);
      h.publisher.applyTranscript([line('said something')]);

      h.publisher.publishStopped();

      expect(h.last()!.capturing).toBe(false);
      expect(h.last()!.outbound).toBe('off');
      expect(h.last()!.lines).toHaveLength(1);
    });
  });

  describe('publishError', () => {
    it('merges into the errors already showing', () => {
      const h = harness();
      h.publisher.setTarget(1);
      h.publisher.publishCaptureError('capture failed');

      h.publisher.publishError('outbound', 'relay failed');

      expect(h.last()!.errors.capture).toBe('capture failed');
      expect(h.last()!.errors.outbound).toBe('relay failed');
    });
  });

  describe('while it does not know whether a capture is running', () => {
    /**
     * The worker is killed after about thirty seconds of quiet; the offscreen
     * document holding the audio graph is not. So a restarted worker can be
     * publishing into a meeting that is still being recorded while believing
     * nothing is — and the recording indicator would come down.
     *
     * Each test here is a path that publishes during that window.
     */
    const status = (capturing: boolean) => ({
      capturing,
      outbound: 'off' as const,
      errors: {},
      backlogTurns: 0,
      echoEvents: 0,
    });

    it('does not tell a tab that nothing is being captured', () => {
      const h = harness();
      h.publisher.setTarget(1);
      h.publisher.markCaptureUnknown();

      h.publisher.publishStopped();

      expect(h.rendered).toHaveLength(0);
    });

    it('still renders a state that says a capture IS running', () => {
      const h = harness();
      h.publisher.setTarget(1);
      h.publisher.markCaptureUnknown();

      h.publisher.applyStatus(status(true));

      expect(h.last()!.capturing).toBe(true);
    });

    it('keeps the suppressed state, so the next push is built on it', () => {
      const h = harness();
      h.publisher.setTarget(1);
      h.publisher.markCaptureUnknown();
      h.publisher.applyTranscript([line('said while we were guessing')]);

      // The transcript push was suppressed; the answer arrives and carries it.
      h.publisher.applyStatus(status(true));

      expect(h.last()!.lines).toHaveLength(1);
    });

    it('stops guessing once the offscreen document answers', () => {
      const h = harness();
      h.publisher.setTarget(1);
      h.publisher.markCaptureUnknown();
      h.publisher.applyStatus(status(false));

      h.publisher.publishStopped();

      // Two renders, not zero: the answer itself, and the ordinary push after it.
      expect(h.rendered).toHaveLength(2);
      expect(h.last()!.capturing).toBe(false);
    });

    it('makes a pulled answer wait, not just a pushed one', async () => {
      // The suppression in `publish` cannot reach a `query`, which is answered
      // from held state. A content script loading inside the window would be
      // handed `capturing: false` and hide the indicator on a live meeting.
      const h = harness();
      h.publisher.setTarget(1);
      h.publisher.markCaptureUnknown();

      let answered = false;
      void h.publisher.whenCaptureKnown().then(() => {
        answered = true;
      });
      await Promise.resolve();
      expect(answered).toBe(false);

      h.publisher.applyStatus(status(true));
      await h.publisher.whenCaptureKnown();
      expect(answered).toBe(true);
    });

    it('does not make anyone wait when it was never guessing', async () => {
      const h = harness();
      await expect(h.publisher.whenCaptureKnown()).resolves.toBeUndefined();
    });

    it('stops guessing when there was no document to ask', () => {
      const h = harness();
      h.publisher.setTarget(1);
      h.publisher.markCaptureUnknown();

      h.publisher.clearCaptureUnknown();
      h.publisher.publishStopped();

      expect(h.last()!.capturing).toBe(false);
    });

    it('renames the context menu even while suppressing the render', () => {
      const h = harness();
      h.publisher.setTarget(1);
      h.publisher.markCaptureUnknown();
      const before = h.menuRefreshes();

      h.publisher.publishStopped();

      expect(h.menuRefreshes()).toBe(before + 1);
    });
  });

  it('answers a late-loading content script from the state it holds', () => {
    const h = harness();
    h.publisher.setTarget(1);
    h.publisher.setShortcut('Alt+Shift+C');
    h.publisher.applyTranscript([line('caught up')]);

    expect(h.publisher.current.lines).toHaveLength(1);
    expect(h.publisher.current.shortcut).toBe('Alt+Shift+C');
  });
});
