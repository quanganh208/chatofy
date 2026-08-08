import { describe, expect, it } from 'vitest';
import {
  MicrophonePatchRegistry,
  type MicrophonePatchDeps,
  type PatchScript,
} from './microphone-patch-registry';

/**
 * The two ways the outbound patch fails silently.
 *
 * Registering an id that already exists throws `Duplicate script ID`, and
 * unregistering one that does not exist throws too — so a worker restart, which
 * Chrome does constantly, walks straight into both. And a tab wrongly remembered
 * as patched has the overlay telling someone their speech reaches the meeting
 * while it goes nowhere.
 */
const SCRIPTS: PatchScript[] = [
  { id: 'chatofy-microphone-patch', js: ['content-scripts/inject.js'] },
];

function harness(options: { patched?: number[]; registered?: string[]; stored?: number[] } = {}) {
  const calls: string[] = [];
  const patchedTabs = new Set(options.patched ?? []);
  const registered = new Set(options.registered ?? []);
  let persisted: number[] = options.stored ?? [];

  const deps: MicrophonePatchDeps = {
    probe: (tabId) => Promise.resolve(patchedTabs.has(tabId)),
    getRegistered: (ids) => {
      calls.push('getRegistered');
      return Promise.resolve(ids.filter((id) => registered.has(id)).map((id) => ({ id })));
    },
    register: (scripts) => {
      calls.push(`register:${scripts.map((s) => s.id).join(',')}`);
      for (const s of scripts) {
        if (registered.has(s.id)) throw new Error('Duplicate script ID');
        registered.add(s.id);
      }
      return Promise.resolve();
    },
    unregister: (ids) => {
      calls.push(`unregister:${ids.join(',')}`);
      for (const id of ids) {
        if (!registered.has(id)) throw new Error('No script with ID');
        registered.delete(id);
      }
      return Promise.resolve();
    },
    persist: (tabIds) => {
      persisted = [...tabIds];
      return Promise.resolve();
    },
    restore: () => Promise.resolve(persisted),
  };

  return {
    calls,
    deps,
    patchedTabs,
    persisted: () => persisted,
    isRegistered: (id: string) => registered.has(id),
    registry: new MicrophonePatchRegistry(deps, SCRIPTS),
  };
}

describe('MicrophonePatchRegistry', () => {
  describe('refresh', () => {
    it('records a tab that now carries the patch and says it changed', async () => {
      const h = harness({ patched: [5] });

      await expect(h.registry.refresh(5)).resolves.toBe(true);

      expect(h.registry.has(5)).toBe(true);
      expect(h.persisted()).toEqual([5]);
    });

    it('reports no change when the answer is the same as before', async () => {
      const h = harness({ patched: [5] });
      await h.registry.refresh(5);

      await expect(h.registry.refresh(5)).resolves.toBe(false);
    });

    it('drops a tab that no longer carries the patch', async () => {
      const h = harness({ patched: [5] });
      await h.registry.refresh(5);

      h.patchedTabs.delete(5);
      await expect(h.registry.refresh(5)).resolves.toBe(true);

      expect(h.registry.has(5)).toBe(false);
      expect(h.persisted()).toEqual([]);
    });
  });

  describe('forget', () => {
    it('removes a remembered tab and reports the change', async () => {
      const h = harness({ patched: [5] });
      await h.registry.refresh(5);

      await expect(h.registry.forget(5)).resolves.toBe(true);
      expect(h.registry.has(5)).toBe(false);
    });

    it('reports no change for a tab it never knew about', async () => {
      const h = harness();

      await expect(h.registry.forget(99)).resolves.toBe(false);
    });
  });

  describe('restore', () => {
    it('brings the remembered set back after a worker restart', async () => {
      const h = harness({ stored: [3, 4] });

      await h.registry.restore();

      expect(h.registry.has(3)).toBe(true);
      expect(h.registry.has(4)).toBe(true);
    });
  });

  describe('sync', () => {
    it('registers the script when the setting turns on', async () => {
      const h = harness();

      await h.registry.sync(true);

      expect(h.isRegistered('chatofy-microphone-patch')).toBe(true);
    });

    it('does not register a script Chrome already persisted', async () => {
      const h = harness({ registered: ['chatofy-microphone-patch'] });

      // Would throw `Duplicate script ID` if it registered blindly — the exact
      // case a restarted worker hits.
      await expect(h.registry.sync(true)).resolves.toBeUndefined();
      expect(h.calls.some((c) => c.startsWith('register'))).toBe(false);
    });

    it('unregisters when the setting turns off', async () => {
      const h = harness({ registered: ['chatofy-microphone-patch'] });

      await h.registry.sync(false);

      expect(h.isRegistered('chatofy-microphone-patch')).toBe(false);
    });

    it('does not unregister a script that is not there', async () => {
      const h = harness();

      // Unregistering an absent id throws too.
      await expect(h.registry.sync(false)).resolves.toBeUndefined();
      expect(h.calls.some((c) => c.startsWith('unregister'))).toBe(false);
    });

    it('serialises overlapping runs instead of racing into a duplicate id', async () => {
      const h = harness();

      // Worker start, a storage change, and the settings handler all drive this;
      // unchained, both reads see "nothing registered" and the second register
      // throws.
      await Promise.all([h.registry.sync(true), h.registry.sync(true), h.registry.sync(true)]);

      expect(h.calls.filter((c) => c.startsWith('register'))).toHaveLength(1);
    });

    it('lets a lookup failure surface rather than registering blindly', async () => {
      const h = harness();
      h.deps.getRegistered = () => Promise.reject(new Error('cannot read registrations'));

      await expect(h.registry.sync(true)).rejects.toThrow('cannot read registrations');
    });

    it('recovers on the next run after a failure instead of staying broken', async () => {
      const h = harness();
      const working = h.deps.getRegistered;
      // One transient failure — an extension update race, a worker shutting
      // down mid-call — and then Chrome answers normally again.
      h.deps.getRegistered = () => Promise.reject(new Error('cannot read registrations'));

      await expect(h.registry.sync(true)).rejects.toThrow('cannot read registrations');
      h.deps.getRegistered = working;

      // The chain exists to serialise runs, not to remember that one failed. A
      // queue left holding the rejection would skip `apply` from here on, so the
      // patch would never register again for the life of the worker and every
      // later sync would report the same stale reason.
      await expect(h.registry.sync(true)).resolves.toBeUndefined();
      expect(h.calls.filter((c) => c.startsWith('register'))).toHaveLength(1);
    });
  });
});
