// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The popup, rendered.
 *
 * A fast loop under the e2e suite, not a replacement for it: this has no Chrome,
 * so it cannot say whether a real popup lays out inside 320px, whether the
 * settings pane scrolls sideways, or whether MV3's policy allows what the bundle
 * does. What it does cover is the wiring — that the tree mounts at all, that the
 * notice gates the primary action, and that changing a setting reaches the worker
 * rather than storage — none of which needs a browser and all of which used to
 * cost a full extension build to check.
 *
 * Everything is stubbed before the module is imported. `consent-gate` reads
 * storage and attaches a listener at module load, deliberately, so a static import
 * would run it against a bare happy-dom and leave the notice in whatever state
 * the first test produced.
 */

interface Stubs {
  consentSeen?: boolean;
  /** A stored access token. Defaulted on, so the capture UI is what renders. */
  signedIn?: boolean;
  permission?: PermissionState;
  tabUrl?: string;
  overlay?: unknown;
  /** What `GET /translation-contexts` answers with. Empty hides the picker. */
  contexts?: unknown[];
  /** Merged over the stored settings, for cases that turn on one of them. */
  settings?: Record<string, unknown>;
}

const sent: unknown[] = [];
const written: Record<string, unknown> = {};
let root: Root | undefined;

function installChrome({
  consentSeen = true,
  signedIn = true,
  permission = 'granted',
  tabUrl = 'https://meet.google.com/abc-defg-hij',
  overlay = { capturing: false, lines: [], outbound: 'off', errors: {} },
  contexts = [],
  settings = {},
}: Stubs) {
  const store: Record<string, unknown> = {
    'chatofy.settings': {
      direction: 'en_to_vi',
      mode: 'cascade',
      voiceGender: 'female',
      reportMetrics: true,
      outbound: false,
      ...settings,
    },
    'chatofy.sites': { enabled: true, disabledSites: [] },
  };
  if (consentSeen) store['chatofy.recordingNoticeSeen'] = true;
  if (signedIn) store['chatofy.accessToken'] = 'a-stored-access-token';

  (globalThis as Record<string, unknown>).chrome = {
    storage: {
      local: {
        get: (key: string) => Promise.resolve({ [key]: store[key] }),
        set: (values: Record<string, unknown>) => {
          Object.assign(written, values);
          return Promise.resolve();
        },
        remove: () => Promise.resolve(),
      },
    },
    tabs: { query: () => Promise.resolve([{ id: 1, url: tabUrl, active: true }]) },
    runtime: {
      sendMessage: (message: { type: string }) => {
        sent.push(message);
        return Promise.resolve(message.type === 'query' ? overlay : undefined);
      },
      getURL: (path: string) => `chrome-extension://test/${path}`,
    },
  };

  Object.defineProperty(navigator, 'permissions', {
    configurable: true,
    value: { query: () => Promise.resolve({ state: permission }) },
  });

  // The popup revalidates its stored token against GET /auth/me on mount, and
  // now also fetches GET /translation-contexts. Left unstubbed, both are REAL
  // requests to whatever `apiBaseUrl` resolves to — localhost:3000 by default,
  // which on a developer's machine is the api they have running. The auth check
  // would answer 401 to this fake token, the popup signs itself out, and every
  // assertion about the capture UI fails. CI has nothing on that port, so the
  // suite passes there and fails on the machines that matter.
  //
  // Routed by path: `/auth/me` answers per `signedIn`, so the stub says the
  // same thing storage does; `/translation-contexts` answers with `contexts`.
  vi.stubGlobal('fetch', (url: string) => {
    if (typeof url === 'string' && url.endsWith('/translation-contexts')) {
      return Promise.resolve({
        status: 200,
        ok: true,
        json: () => Promise.resolve({ success: true, data: { contexts } }),
      } as Response);
    }
    return Promise.resolve({ status: signedIn ? 200 : 401 } as Response);
  });
}

/** The static half of the page, which `index.html` owns in the real build. */
function markup() {
  document.body.innerHTML = '';
  const consent = document.createElement('div');
  consent.id = 'consent';
  consent.hidden = true;
  consent.textContent = 'This records the meeting’s audio.';
  const ok = document.createElement('button');
  ok.id = 'consent-ok';
  consent.append(ok);
  const app = document.createElement('div');
  app.id = 'app';
  document.body.append(consent, app);
  return app;
}

/**
 * Do something, then let the tree finish reacting to it.
 *
 * The popup's bootstrap is a chain of awaited storage and tab reads, and the
 * consent gate resolves on its own promise. Each `await` yields, so a single tick
 * leaves the tree half-assembled and assertions read whichever state they caught.
 * Draining the microtask queue is the honest way to wait for work that never
 * touches a timer.
 */
async function settle(work: () => void) {
  await act(async () => {
    work();
    for (let tick = 0; tick < 10; tick += 1) await Promise.resolve();
  });
}

async function mount(stubs: Stubs = {}) {
  installChrome(stubs);
  const app = markup();
  vi.resetModules();
  const { Popup } = await import('../entrypoints/popup/popup');
  await settle(() => {
    root = createRoot(app);
    root.render(<Popup />);
  });
  return app;
}

const toggle = () => document.getElementById('toggle') as HTMLButtonElement | null;

beforeEach(() => {
  sent.length = 0;
  for (const key of Object.keys(written)) delete written[key];
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  vi.unstubAllGlobals();
});

describe('the popup', () => {
  it('renders its primary action', async () => {
    await mount();
    expect(toggle()?.textContent).toBe('Start');
    expect(toggle()?.disabled).toBe(false);
    expect(document.getElementById('status')?.textContent).toBe('Ready.');
  });

  /**
   * The notice gates the button, as state rather than as visibility. A hidden but
   * enabled control is one CSS change away from being live in front of someone who
   * has not been told what it does.
   */
  it('will not start before the recording notice has been acknowledged', async () => {
    await mount({ consentSeen: false });
    expect(document.getElementById('consent')?.hidden).toBe(false);
    expect(toggle()?.disabled).toBe(true);

    await settle(() => document.getElementById('consent-ok')?.click());
    expect(document.getElementById('consent')?.hidden).toBe(true);
    expect(toggle()?.disabled).toBe(false);
  });

  /**
   * Without a token the extension cannot open `/ws/translate` at all — the API
   * refuses the upgrade — so Start is not merely disabled, it is not the thing
   * on screen. Offering it would produce a failure nobody can act on from here.
   */
  it('asks for a sign-in before offering to capture', async () => {
    await mount({ signedIn: false });
    expect(document.getElementById('sign-in')?.hidden).toBe(false);
    expect(document.getElementById('settings')?.hidden).toBe(true);
    // Disabled as well as hidden: a hidden but enabled control is one CSS
    // change away from being live.
    expect(toggle()?.disabled).toBe(true);
  });

  /**
   * Consent outranks the token. The notice is about recording at all, which is a
   * larger question than whose account does the translating.
   */
  it('shows the recording notice before the sign-in form, not beside it', async () => {
    await mount({ consentSeen: false, signedIn: false });
    expect(document.getElementById('consent')?.hidden).toBe(false);
    expect(document.getElementById('sign-in')?.hidden).toBe(true);
  });

  /** A tab Chrome cannot capture: Start is refused, and the reason is next to it. */
  it('refuses a tab that is not a meeting, and says why', async () => {
    await mount({ tabUrl: 'https://example.com/' });
    expect(toggle()?.disabled).toBe(true);
    expect(document.getElementById('status')?.textContent).toBe('Not available on this tab.');
  });

  /** Stop stays available on a tab Start would be refused on. */
  it('keeps a running capture stoppable from the wrong tab', async () => {
    await mount({
      tabUrl: 'https://example.com/',
      overlay: { capturing: true, lines: [], outbound: 'off', errors: {} },
    });
    expect(toggle()?.textContent).toBe('Stop');
    expect(toggle()?.disabled).toBe(false);
  });

  /**
   * Direction, voice and outbound go to the worker, not to storage: a running
   * capture has to be reopened for a change to take effect, and only the worker can
   * do that.
   */
  it('sends a direction change to the worker rather than writing it', async () => {
    await mount();
    const swap = document.querySelector<HTMLButtonElement>('[aria-label^="Swap direction"]');
    expect(swap).not.toBeNull();
    await settle(() => swap?.click());

    const settings = sent.filter((m) => (m as { type: string }).type === 'settings');
    expect(settings).toHaveLength(1);
    expect(settings[0]).toMatchObject({ direction: 'vi_to_en', voiceGender: 'female' });
    expect(written['chatofy.settings']).toBeUndefined();
  });

  /**
   * `reportMetrics` has no control any more and must survive a save anyway — the
   * worker and the realtime client still read it. `apiBaseUrl` must not be written
   * back at all: the compile decides it.
   */
  it('carries the settings it does not show across a save', async () => {
    await mount();
    await settle(() => toggle()?.click());
    expect(written['chatofy.settings']).toMatchObject({ reportMetrics: true });
    expect(written['chatofy.settings']).not.toHaveProperty('apiBaseUrl');
  });

  /**
   * Every event below carries `pointerType: 'mouse'`. Radix `Select` branches on
   * it: a touch pointer defers opening to a trailing `click` the way a native
   * `<select>` does, and without the tag here the trigger's `pointerdown` is
   * read as that touch case and never opens the list.
   */
  const mouse = (type: string, target: EventTarget | null | undefined) =>
    target?.dispatchEvent(
      new PointerEvent(type, { bubbles: true, pointerType: 'mouse', button: 0 }),
    );

  describe('the AI Context picker', () => {
    // No control to hide it, and no editor either — the picker only ever
    // selects. Empty is also what a signed-out popup fetches
    // (`use-popup.ts`), so this is the one assertion for both cases.
    it('is hidden with no contexts', async () => {
      await mount({ contexts: [] });
      expect(document.getElementById('context')).toBeNull();
    });

    it('choosing one writes settings', async () => {
      await mount({
        contexts: [
          {
            id: 'a5f3e2b1-1234-4a5b-8c9d-000000000001',
            name: 'Sprint planning',
            topic: null,
            hotwords: [],
            glossary: [],
            style: null,
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
      });

      const trigger = document.getElementById('context');
      expect(trigger).not.toBeNull();
      await settle(() => mouse('pointerdown', trigger));

      const option = [...document.querySelectorAll('[role="option"]')].find(
        (el) => el.textContent === 'Sprint planning',
      );
      expect(option).toBeDefined();

      // A native select fires its choice on mouseUP over the option, after the
      // pointer has moved onto it; Radix mirrors that rather than reacting to
      // pointerDown alone, so all three land here.
      await settle(() => {
        mouse('pointermove', option);
        mouse('pointerdown', option);
        mouse('pointerup', option);
      });

      expect(written['chatofy.settings']).toMatchObject({
        contextId: 'a5f3e2b1-1234-4a5b-8c9d-000000000001',
      });
    });

    it('reads as no context when the stored id is not in the library', async () => {
      // A context deleted on web leaves its id in extension storage. Handed to
      // the picker unreconciled, the trigger shows neither a name nor the empty
      // label — it renders blank, and the meeting runs unhinted while the popup
      // looks like it has a selection.
      await mount({
        settings: { contextId: 'a5f3e2b1-1234-4a5b-8c9d-00000000dead' },
        contexts: [
          {
            id: 'a5f3e2b1-1234-4a5b-8c9d-000000000001',
            name: 'Sprint planning',
            topic: null,
            hotwords: [],
            glossary: [],
            style: null,
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
      });

      const trigger = document.getElementById('context');
      expect(trigger).not.toBeNull();
      expect(trigger?.textContent).toBe('No context');
    });
  });
});
