import { describe, expect, it } from 'vitest';
import { OFFSCREEN_PATH, OffscreenHost, type OffscreenHostDeps } from './offscreen-host';

/**
 * The offscreen document's lifecycle, which MV3 makes easy to get wrong.
 *
 * Chrome allows one document per extension: creating a second throws, and
 * closing one that is not there throws too. Both mistakes are invisible until a
 * meeting is running, which is why they are pinned here instead.
 */
function harness(open = false) {
  const calls: string[] = [];
  let exists = open;
  const deps: OffscreenHostDeps = {
    hasDocument: () => {
      calls.push('has');
      return Promise.resolve(exists);
    },
    createDocument: (path) => {
      calls.push(`create:${path}`);
      exists = true;
      return Promise.resolve();
    },
    closeDocument: () => {
      calls.push('close');
      exists = false;
      return Promise.resolve();
    },
    send: (message) => {
      calls.push(`send:${(message as { type: string }).type}`);
      return Promise.resolve();
    },
  };
  return { calls, deps, host: new OffscreenHost(deps), isOpen: () => exists };
}

describe('OffscreenHost', () => {
  describe('ensure', () => {
    it('creates the document when there is none', async () => {
      const h = harness(false);

      await h.host.ensure();

      expect(h.calls).toEqual(['has', `create:${OFFSCREEN_PATH}`]);
      expect(h.isOpen()).toBe(true);
    });

    it('does not create a second document when one is already open', async () => {
      const h = harness(true);

      await h.host.ensure();

      // Creating one that exists throws, and that throw is indistinguishable
      // from a real failure to create.
      expect(h.calls).toEqual(['has']);
    });

    it('is safe to call twice in a row', async () => {
      const h = harness(false);

      await h.host.ensure();
      await h.host.ensure();

      expect(h.calls.filter((c) => c.startsWith('create'))).toHaveLength(1);
    });
  });

  describe('endCapture', () => {
    it('stops the audio before closing the document', async () => {
      const h = harness(true);

      await h.host.endCapture();

      expect(h.calls).toEqual(['has', 'send:end', 'close']);
      expect(h.isOpen()).toBe(false);
    });

    it('does nothing when no document is open', async () => {
      const h = harness(false);

      await h.host.endCapture();

      // Closing a document that is not there throws; a stop racing another stop
      // must not fail the second caller.
      expect(h.calls).toEqual(['has']);
    });

    it('is safe to call twice', async () => {
      const h = harness(true);

      await h.host.endCapture();
      await expect(h.host.endCapture()).resolves.toBeUndefined();

      expect(h.calls.filter((c) => c === 'close')).toHaveLength(1);
    });
  });

  it('reports whether a document is open without changing anything', async () => {
    const h = harness(true);

    await expect(h.host.exists()).resolves.toBe(true);
    expect(h.calls).toEqual(['has']);
  });

  describe('requestStatus', () => {
    // The worker dies after ~30s of quiet; this document does not, because
    // USER_MEDIA carries no lifetime limit. So a restarted worker has to ask
    // whether a capture it has no record of is still running.
    it('asks a document that is already open', async () => {
      const h = harness(true);

      await expect(h.host.requestStatus()).resolves.toBe(true);

      expect(h.calls).toEqual(['has', 'send:status.query']);
    });

    it('creates nothing when there is no document, and says so', async () => {
      const h = harness(false);

      // Creating one here would answer its own question — an empty document
      // reports "not capturing" whether or not a capture was running before.
      await expect(h.host.requestStatus()).resolves.toBe(false);

      expect(h.calls).toEqual(['has']);
      expect(h.isOpen()).toBe(false);
    });

    it('does not stop the capture it is asking about', async () => {
      const h = harness(true);

      await h.host.requestStatus();

      expect(h.calls).not.toContain('send:end');
      expect(h.calls).not.toContain('close');
      expect(h.isOpen()).toBe(true);
    });
  });
});
