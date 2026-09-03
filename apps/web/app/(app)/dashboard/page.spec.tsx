// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The rule this page exists to hold: **nothing on the hub is invented**.
 *
 * A metrics card was named as the single biggest failure mode of the hub revamp, and
 * nothing mechanical catches it. This does.
 *
 * The reason has narrowed since, and the rule has not. Conversations ARE stored now, so
 * a count would no longer be a number with no source — but there is still no usage
 * metering, a duration or a chart here would still be invented, and counting stored
 * conversations is the history screen's job on the page that lists them. What this
 * guards is the page a user sees first filling up with figures nobody decided to add.
 *
 * The digit ban below is the crude version of that and it is deliberate. A stat tile
 * cannot be added without a digit reaching the page. If a legitimate string ever needs
 * one, widening this is a two-line change someone has to make ON PURPOSE, which is the
 * whole point — the failure mode is a metric arriving without anyone deciding to add
 * one.
 */

// React wants this declared before an async `act`; without it every await here
// prints a warning about the environment rather than failing anything.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const health = vi.fn(() => Promise.resolve());
vi.mock('@/clients/api-client', () => ({ checkHealth: () => health() }));

/**
 * happy-dom ships a Permissions API that answers `granted` for everything, which is
 * exactly the wrong default to test against: a hook that never queried at all would
 * pass. Every case below states what the browser said.
 */
type FakePermissionStatus = Pick<PermissionStatus, 'state'> & {
  addEventListener: (type: string, listener: () => void) => void;
  removeEventListener: (type: string, listener: () => void) => void;
};
const permissions = vi.fn<() => Promise<FakePermissionStatus>>();
Object.defineProperty(navigator, 'permissions', {
  configurable: true,
  value: { query: () => permissions() },
});

const { default: DashboardPage } = await import('./page');
const { LocaleProvider } = await import('@/i18n/provider');

let root: Root | undefined;
let container: HTMLElement;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  health.mockReturnValue(Promise.resolve());
  localStorage.clear();
  permissions.mockReturnValue(
    Promise.resolve({ state: 'granted', addEventListener() {}, removeEventListener() {} }),
  );
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  container.remove();
});

async function render() {
  await act(async () => {
    root = createRoot(container);
    root.render(
      <LocaleProvider>
        <DashboardPage />
      </LocaleProvider>,
    );
    // The health probe and the permission query both settle on the microtask queue.
    // Yielding here lets them land inside this `act`, so the assertions read the page
    // as it looks once both answers are in rather than mid-flight.
    await Promise.resolve();
  });
}

describe('the dashboard hub', () => {
  it('shows no count, duration or chart', async () => {
    await render();

    const text = container.textContent ?? '';
    expect(text.length, 'the page rendered nothing at all').toBeGreaterThan(50);
    expect(text, `a digit reached the hub: ${text}`).not.toMatch(/\d/);
    expect(container.querySelector('svg[data-chart], canvas')).toBeNull();
  });

  it('offers exactly one accent-filled control', async () => {
    await render();

    // `default` is the filled variant; everything else on the hub is a readout or an
    // outline control. Two filled buttons would say the two are the same kind of thing.
    const filled = container.querySelectorAll('[data-variant="default"]');
    expect(filled.length).toBe(1);
    expect(filled[0]?.getAttribute('href')).toBe('/translate');
  });

  it('reports the service unreachable when the probe fails', async () => {
    health.mockReturnValue(Promise.reject(new Error('down')));
    await render();

    expect(container.textContent).toContain('Unreachable');
    expect(container.textContent).not.toContain('Reachable — ');
  });

  it('shows a denied microphone as denied', async () => {
    permissions.mockReturnValue(
      Promise.resolve({ state: 'denied', addEventListener() {}, removeEventListener() {} }),
    );
    await render();

    expect(container.textContent).toContain('Denied');
    expect(container.textContent).not.toContain('Granted');
  });

  it('follows a permission revoked after the page loaded', async () => {
    // Revocation happens in browser chrome this page cannot see. A one-shot read goes
    // stale silently and the card keeps saying `Granted` after the user turned it off.
    const listeners = new Set<() => void>();
    const status = {
      state: 'granted' as PermissionState,
      addEventListener: (_: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
    };
    permissions.mockReturnValue(Promise.resolve(status));
    await render();
    expect(container.textContent).toContain('Granted');

    act(() => {
      status.state = 'denied';
      for (const listener of listeners) listener();
    });
    expect(container.textContent).toContain('Denied');
  });

  it('never claims a permission it could not read', async () => {
    // A browser that does not answer for `microphone` rejects the query. Reporting
    // `Granted` there would be a claim about something never checked, and the user
    // would find out at the moment they started talking.
    permissions.mockReturnValue(Promise.reject(new Error('unsupported')));
    await render();

    expect(container.textContent).toContain('Cannot tell');
    expect(container.textContent).not.toContain('Granted');
  });
});
