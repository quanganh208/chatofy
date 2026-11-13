// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { followHistoryForTests, useTestSearchParams } from './settings-dialog-test-location';

/**
 * The Settings dialog's shell: which view the address opens, how the list and the pane
 * share a wide screen and take turns on a phone, and where focus goes.
 *
 * Each tab's real content is rendered and counted by `design/accent-budget-app.spec.tsx`,
 * one row per tab over a page; here it is a stub that names the tab it was given, so
 * these cases are about the shell alone.
 */
vi.mock('next/navigation', () => ({ useSearchParams: () => useTestSearchParams() }));
vi.mock('./settings-dialog-tab-content', () => ({
  SettingsTabContent: ({ tab }: { tab: string }) => <p data-stub-tab={tab}>content of {tab}</p>,
}));

const { SettingsDialog } = await import('./settings-dialog');
const { LocaleProvider } = await import('@/i18n/provider');

let root: Root | undefined;
let unfollow: () => void;

function wideScreen(wide: boolean) {
  window.matchMedia = vi.fn().mockReturnValue({
    matches: wide,
    addEventListener: () => {},
    removeEventListener: () => {},
  });
}

async function openAt(search: string) {
  window.history.replaceState(null, '', `/history${search}`);
  await act(async () => {
    root = createRoot(document.createElement('div'));
    root.render(
      <LocaleProvider>
        <SettingsDialog />
      </LocaleProvider>,
    );
    await Promise.resolve();
  });
}

const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');
const tabButton = (id: string) =>
  document.querySelector<HTMLButtonElement>(`[role="dialog"] button[data-settings-tab="${id}"]`);
const paneTitle = () => document.querySelector<HTMLElement>('[data-settings-pane] h2');
const view = () => new URLSearchParams(window.location.search).get('settings');
const listColumn = () => tabButton('general')?.closest('nav')?.parentElement;
const pane = () => document.querySelector<HTMLElement>('[data-settings-pane]');

beforeEach(() => {
  unfollow = followHistoryForTests();
  wideScreen(true);
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  unfollow();
  window.history.replaceState(null, '', '/');
  vi.restoreAllMocks();
});

describe('the settings dialog', () => {
  it('draws nothing while the address has no ?settings=', async () => {
    await openAt('?q=hello');
    expect(dialog()).toBeNull();
  });

  it('opens on the tab the address names, titled Settings, the tab current in its list', async () => {
    await openAt('?settings=billing');
    const id = dialog()?.getAttribute('aria-labelledby');
    expect(document.getElementById(id ?? '')?.textContent).toBe('Settings');
    expect(tabButton('billing')?.getAttribute('aria-current')).toBe('page');
    expect(tabButton('general')?.hasAttribute('aria-current')).toBe(false);
    expect(paneTitle()?.textContent).toBe('Billing');
    expect(document.querySelector('[data-stub-tab]')?.getAttribute('data-stub-tab')).toBe(
      'billing',
    );
  });

  it('lists five tabs in two captioned groups', async () => {
    await openAt('?settings=general');
    const nav = document.querySelector('[role="dialog"] nav');
    expect(nav?.getAttribute('aria-label')).toBe('Settings sections');
    expect(
      [...(nav?.querySelectorAll('[data-settings-tab]') ?? [])].map((b) =>
        b.getAttribute('data-settings-tab'),
      ),
    ).toEqual(['general', 'translation', 'ai-context', 'account', 'billing']);
    expect(nav?.textContent).toContain('Personal');
    expect(nav?.textContent).toContain('Account');
  });

  it('switches tab in place when one is chosen', async () => {
    await openAt('?settings=general');
    act(() => {
      tabButton('account')?.click();
    });
    expect(view()).toBe('account');
    expect(paneTitle()?.textContent).toBe('Account');
    expect(tabButton('account')?.getAttribute('aria-current')).toBe('page');
  });

  it('moves between tabs with the arrow keys, Home and End', async () => {
    await openAt('?settings=general');
    const nav = document.querySelector<HTMLElement>('[role="dialog"] nav')!;
    const press = (key: string) =>
      act(() => {
        nav.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
      });
    tabButton('general')?.focus();
    press('ArrowDown');
    expect(document.activeElement).toBe(tabButton('translation'));
    press('ArrowUp');
    press('ArrowUp');
    expect(document.activeElement).toBe(tabButton('billing'));
    press('Home');
    expect(document.activeElement).toBe(tabButton('general'));
    press('End');
    expect(document.activeElement).toBe(tabButton('billing'));
  });

  it('closes from its ✕, taking ?settings= off the address and keeping the rest', async () => {
    await openAt('?q=hi&settings=account');
    const close = document.querySelector<HTMLButtonElement>(
      '[role="dialog"] [data-slot="dialog-close"]',
    );
    expect(close?.textContent).toBe('Close');
    act(() => {
      close?.click();
    });
    expect(window.location.search).toBe('?q=hi');
  });

  it('closes on Escape', async () => {
    await openAt('?settings=general');
    act(() => {
      dialog()?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(view()).toBeNull();
  });

  it('names the first tab in the address when a wide screen is shown the list', async () => {
    await openAt('?settings=menu');
    expect(view()).toBe('general');
    expect(paneTitle()?.textContent).toBe('General');
  });

  describe('on a phone', () => {
    beforeEach(() => wideScreen(false));

    it('shows the list alone first, and no tab as current', async () => {
      await openAt('?settings=menu');
      expect(view()).toBe('menu');
      expect(listColumn()?.className).not.toContain('max-sm:hidden');
      expect(pane()?.className).toContain('max-sm:hidden');
      expect(document.querySelector('[role="dialog"] [aria-current]')).toBeNull();
    });

    it('slides to a tab chosen from the list, focus on its title, and back again', async () => {
      await openAt('?settings=menu');
      act(() => {
        tabButton('billing')?.click();
      });
      expect(view()).toBe('billing');
      expect(listColumn()?.className).toContain('max-sm:hidden');
      expect(pane()?.className).not.toContain('max-sm:hidden');
      expect(document.activeElement).toBe(paneTitle());
      expect(paneTitle()?.textContent).toBe('Billing');

      const back = document.querySelector<HTMLButtonElement>('[data-settings-back]');
      expect(back?.getAttribute('aria-label')).toBe('Back to all settings');
      act(() => {
        back?.click();
      });
      expect(view()).toBe('menu');
      expect(pane()?.className).toContain('max-sm:hidden');
      // Back where the reader left the list.
      expect(document.activeElement).toBe(tabButton('billing'));
    });

    it('opens straight on the tab an address names', async () => {
      await openAt('?settings=account');
      expect(listColumn()?.className).toContain('max-sm:hidden');
      expect(paneTitle()?.textContent).toBe('Account');
    });
  });
});
