// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { en } from '@chatofy/i18n';

/**
 * What replaced the hub, and the two ways replacing it could have gone wrong.
 *
 * The hub's readiness card was the only place a blocked microphone was reported
 * BEFORE a conversation was attempted. Deleting the route without moving that
 * would have been a silent regression: `open-microphone.ts` still reports the
 * same fault, but only once Start is pressed.
 *
 * So this holds both halves. It must speak when something is definitely wrong,
 * and — the half that is easy to lose — it must stay quiet otherwise. A banner
 * that fired on `prompt` would appear on every first visit, and one that fired
 * on `unknown` would appear on every visit in a browser whose Permissions API
 * does not answer for `microphone`. Neither is a fault; both are the absence of
 * an answer, and the reactive path covers them.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const checkHealth = vi.hoisted(() => vi.fn<() => Promise<void>>());
vi.mock('@/clients/api-client', () => ({ checkHealth: () => checkHealth() }));

type FakeStatus = Pick<PermissionStatus, 'state'> & {
  addEventListener: () => void;
  removeEventListener: () => void;
};
const query = vi.fn<() => Promise<FakeStatus>>();
Object.defineProperty(navigator, 'permissions', {
  configurable: true,
  value: { query: () => query() },
});

const enumerateDevices = vi.fn<() => Promise<MediaDeviceInfo[]>>();
Object.defineProperty(navigator, 'mediaDevices', {
  configurable: true,
  value: {
    enumerateDevices: () => enumerateDevices(),
    addEventListener: () => {},
    removeEventListener: () => {},
  },
});

const { ReadinessBanner } = await import('./readiness-banner');
const { LocaleProvider } = await import('@/i18n/provider');

let root: Root | undefined;
let container: HTMLElement;

/** One `audioinput`, which is what "a microphone exists" looks like. */
const oneMic = [{ kind: 'audioinput' }] as unknown as MediaDeviceInfo[];

function permission(state: PermissionStatus['state']): void {
  query.mockResolvedValue({ state, addEventListener() {}, removeEventListener() {} });
}

async function render(): Promise<void> {
  await act(async () => {
    root = createRoot(container);
    root.render(
      <LocaleProvider>
        <ReadinessBanner />
      </LocaleProvider>,
    );
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  });
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  checkHealth.mockResolvedValue(undefined);
  enumerateDevices.mockResolvedValue(oneMic);
  permission('granted');
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  container.remove();
  vi.clearAllMocks();
});

describe('ReadinessBanner', () => {
  it('says nothing when there is nothing wrong', async () => {
    await render();
    expect(container.textContent).toBe('');
  });

  it('stays quiet on prompt — nobody has been asked yet, which is not a fault', async () => {
    permission('prompt');
    await render();
    expect(container.textContent).toBe('');
  });

  it('stays quiet when the Permissions API will not answer', async () => {
    // Not a `PermissionState`. The hook reports `unknown` when `query` REJECTS,
    // which is what Safari has historically done for `microphone` — so this is
    // the browser refusing the question, not answering it.
    query.mockRejectedValue(new TypeError('microphone is not a valid name'));
    await render();
    expect(container.textContent).toBe('');
  });

  it('reports a refused permission before anything is pressed', async () => {
    permission('denied');
    await render();
    expect(container.textContent).toContain(en['web.translate.micDenied']);
  });

  it('reports a missing device once the browser had every reason to list it', async () => {
    // `granted`, from `beforeEach`. An empty list here means what it says.
    enumerateDevices.mockResolvedValue([]);
    await render();
    expect(container.textContent).toContain(en['web.translate.micNotFound']);
  });

  it('stays quiet about an empty device list before permission is decided', async () => {
    // The first-visit false alarm. Browsers are supposed to publish a blank
    // placeholder per kind before permission is granted; where one does not, the
    // list is empty until Allow is clicked — and every visitor with a working
    // microphone was told they had none.
    permission('prompt');
    enumerateDevices.mockResolvedValue([]);
    await render();
    expect(container.textContent).toBe('');
  });

  it('stays quiet about an empty device list when the permission cannot be read', async () => {
    query.mockRejectedValue(new TypeError('microphone is not a valid name'));
    enumerateDevices.mockResolvedValue([]);
    await render();
    expect(container.textContent).toBe('');
  });

  it('prefers "blocked" over "missing" when both are true', async () => {
    // A blocked browser can also be why the device list came back empty. Telling
    // someone who only has to click Allow that they have no microphone sends them
    // looking for a cable.
    permission('denied');
    enumerateDevices.mockResolvedValue([]);
    await render();
    expect(container.textContent).toContain(en['web.translate.micDenied']);
    expect(container.textContent).not.toContain(en['web.translate.micNotFound']);
  });

  it('reports an unreachable service', async () => {
    checkHealth.mockRejectedValue(new Error('offline'));
    await render();
    expect(container.textContent).toContain(en['web.translate.serviceUnreachable']);
  });

  it('reports both faults at once rather than picking one', async () => {
    permission('denied');
    checkHealth.mockRejectedValue(new Error('offline'));
    await render();
    expect(container.textContent).toContain(en['web.translate.micDenied']);
    expect(container.textContent).toContain(en['web.translate.serviceUnreachable']);
  });
});
