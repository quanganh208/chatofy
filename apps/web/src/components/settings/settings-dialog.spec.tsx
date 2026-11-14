// @vitest-environment happy-dom
import { act, useEffect } from 'react';
import type * as React from 'react';
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
  SettingsTabContent: ({ tab }: { tab: string }) => (
    <>
      <p data-stub-tab={tab}>content of {tab}</p>
      {tab === 'billing' ? <ToastsOnceOnMount /> : null}
    </>
  ),
}));

/**
 * Billing on a Polar return: its first effect raises "payment finished", ONCE. The
 * real section's effect may run again on a later render and hide a late host; this
 * one cannot.
 */
function ToastsOnceOnMount() {
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('checkout') === 'done') {
      notify.success('Payment finished');
    }
  }, []);
  return null;
}

const { SettingsDialog } = await import('./settings-dialog');
const { AppToaster } = await import('@/components/layout/app-toaster');
const { notify } = await import('@/lib/notify');
const { useReportUnsavedSettingsDraft } = await import('@/hooks/use-unsaved-settings-draft');

/** Something in the dialog holding unsaved typing, as the AI Context editor reports. */
function UnsavedDraft() {
  useReportUnsavedSettingsDraft(true);
  return null;
}
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

async function openAt(search: string, extra?: React.ReactNode) {
  window.history.replaceState(null, '', `/history${search}`);
  await act(async () => {
    // In the document, so what is rendered in place (the toast host) can be found.
    root = createRoot(document.body.appendChild(document.createElement('div')));
    root.render(
      <LocaleProvider>
        <SettingsDialog />
        {extra}
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
  document.body.replaceChildren();
  // Toasts live in sonner's module state, not the tree: one a case left up (an error
  // stays until dismissed) would be replayed into the next case's hosts.
  notify.dismiss();
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

  it('puts focus on the current tab when it opens, not on the first one', async () => {
    const focus = vi.spyOn(HTMLElement.prototype, 'focus');
    await openAt('?settings=translation');
    expect(document.activeElement).toBe(tabButton('translation'));
    // Nobody pressed a key, so the browser is told not to draw the keyboard ring.
    const call = focus.mock.contexts.findIndex((el) => el === tabButton('translation'));
    expect(focus.mock.calls[call]?.[0]).toMatchObject({ focusVisible: false });
  });

  it('lists six tabs in two captioned groups', async () => {
    await openAt('?settings=general');
    const nav = document.querySelector('[role="dialog"] nav');
    expect(nav?.getAttribute('aria-label')).toBe('Settings sections');
    expect(
      [...(nav?.querySelectorAll('[data-settings-tab]') ?? [])].map((b) =>
        b.getAttribute('data-settings-tab'),
      ),
    ).toEqual(['general', 'translation', 'ai-context', 'account', 'team', 'billing']);
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
      expect(document.activeElement).toBe(paneTitle());
      expect(listColumn()?.className).toContain('max-sm:hidden');
      expect(paneTitle()?.textContent).toBe('Account');
    });
  });

  /** A press as a pointer makes it: Radix decides "outside" on `pointerdown`. */
  const pressAsPointer = (target: Element | null | undefined) =>
    act(() => {
      target?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
      target?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
      target?.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0 }));
      target?.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
    });

  it("undoes from a toast's Undo without closing Settings", async () => {
    await openAt('?settings=general', <AppToaster />);
    const undo = vi.fn();
    await act(async () => {
      notify.success('Theme saved', { undo });
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    const button = [...document.querySelectorAll('[data-sonner-toaster] button')].find(
      (b) => b.textContent === 'Undo',
    );
    expect(button, 'the toast never showed its Undo').toBeDefined();
    // Inside the dialog, so the modal's `pointer-events: none` on the body does not
    // reach it and a press on it is not a press beside the dialog.
    expect(button?.closest('[role="dialog"]')).toBe(dialog());
    pressAsPointer(button);
    expect(undo).toHaveBeenCalledTimes(1);
    expect(view()).toBe('general');
    expect(dialog()).not.toBeNull();
  });

  it('puts the toast in its own host inside the dialog, so Undo is reachable by keyboard', async () => {
    // The page's host is mounted too, as the app layout mounts it; it shows nothing
    // raised while Settings is open.
    await openAt('?settings=general', <AppToaster />);
    const undo = vi.fn();
    await act(async () => {
      notify.success('Theme saved', { undo });
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(document.querySelectorAll('[data-sonner-toast]')).toHaveLength(1);
    const button = [
      ...document.querySelectorAll<HTMLButtonElement>('[data-sonner-toaster] button'),
    ].find((b) => b.textContent === 'Undo');
    expect(button?.closest('[role="dialog"]'), 'the toast is outside the focus trap').toBe(
      dialog(),
    );
    // Inside the trap, focus stays where it is put — outside, FocusScope pulled it back.
    act(() => button?.focus());
    expect(document.activeElement).toBe(button);
    act(() => button?.click());
    expect(undo).toHaveBeenCalledTimes(1);
    expect(view()).toBe('general');
  });

  it('never brings a toast back on the page after Settings closes, so Undo cannot run twice', async () => {
    await openAt('?settings=general', <AppToaster />);
    const undo = vi.fn();
    await act(async () => {
      notify.success('Theme saved', { undo });
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    const button = [
      ...document.querySelectorAll<HTMLButtonElement>('[data-sonner-toaster] button'),
    ].find((b) => b.textContent === 'Undo');
    // Undo, then Esc inside the toast's 200ms leave.
    act(() => button?.click());
    act(() => {
      dialog()?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
      );
    });
    expect(view()).toBeNull();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 400));
    });
    // The page's host shows nothing: the toast belonged to the Settings host.
    expect(document.querySelectorAll('[data-sonner-toast]')).toHaveLength(0);
    for (const b of document.querySelectorAll<HTMLButtonElement>('[data-sonner-toaster] button')) {
      if (b.textContent === 'Undo') b.click();
    }
    expect(undo).toHaveBeenCalledTimes(1);
  });

  it('still closes on a press on the dimmed page beside it', async () => {
    await openAt('?settings=general');
    pressAsPointer(document.querySelector('[data-slot="dialog-overlay"]') ?? document.body);
    expect(view()).toBeNull();
  });

  describe('with unsaved typing in a tab', () => {
    it('ignores Esc and a press beside it, so the draft is not lost to a reflex', async () => {
      await openAt('?settings=ai-context', <UnsavedDraft />);
      act(() => {
        // Cancelable, as a real key press is: the guard is a `preventDefault`.
        dialog()?.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
        );
      });
      expect(view()).toBe('ai-context');
      pressAsPointer(document.querySelector('[data-slot="dialog-overlay"]') ?? document.body);
      expect(view()).toBe('ai-context');
    });

    it('holds a switch to another tab, and says why', async () => {
      await openAt('?settings=ai-context', <UnsavedDraft />);
      const info = vi.spyOn(notify, 'info');
      act(() => {
        tabButton('general')?.click();
      });
      expect(view()).toBe('ai-context');
      expect(info).toHaveBeenCalledWith(
        'Save or cancel the AI context you are writing first.',
        expect.anything(),
      );
    });

    it("holds a phone's back-to-list too", async () => {
      wideScreen(false);
      await openAt('?settings=ai-context', <UnsavedDraft />);
      act(() => {
        document.querySelector<HTMLButtonElement>('[data-settings-back]')?.click();
      });
      expect(view()).toBe('ai-context');
    });

    it('still closes from its ✕, which is a decision rather than a reflex', async () => {
      await openAt('?settings=ai-context', <UnsavedDraft />);
      act(() => {
        document
          .querySelector<HTMLButtonElement>('[role="dialog"] [data-slot="dialog-close"]')
          ?.click();
      });
      expect(view()).toBeNull();
    });
  });

  it("drops Polar's checkout return on a tab switch, so Billing does not announce it twice", async () => {
    await openAt('?checkout=done&settings=billing');
    act(() => {
      tabButton('general')?.click();
    });
    expect(window.location.search).toBe('?settings=general');
  });

  describe('when Settings closes over toasts it holds', () => {
    const toastTexts = () =>
      [...document.querySelectorAll('[data-sonner-toast]')].map((el) => ({
        text: el.textContent ?? '',
        inDialog: el.closest('[role="dialog"]') !== null,
      }));

    it("moves the page's error to the page's host, Retry and all — a conversation that failed", async () => {
      await openAt('?settings=general', <AppToaster />);
      const retry = vi.fn();
      await act(async () => {
        // What `useErrorToast` raises from a running `/translate` under Settings.
        notify.error('The conversation stopped. Try again.', {
          id: 'translate-conversation',
          retry,
        });
        notify.success('Theme saved', { undo: vi.fn() });
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
      expect(toastTexts().every((shown) => shown.inDialog)).toBe(true);

      act(() => {
        document
          .querySelector<HTMLButtonElement>('[role="dialog"] [data-slot="dialog-close"]')
          ?.click();
      });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 400));
      });
      expect(view()).toBeNull();
      // The error is on the page, still with Retry; the Saved toast went with Settings.
      const shown = toastTexts();
      expect(shown).toHaveLength(1);
      expect(shown[0]?.text).toContain('The conversation stopped. Try again.');
      expect(shown[0]?.inDialog).toBe(false);
      const button = [
        ...document.querySelectorAll<HTMLButtonElement>('[data-sonner-toast] button'),
      ].find((b) => b.textContent === 'Retry');
      act(() => button?.click());
      expect(retry).toHaveBeenCalledTimes(1);
    });

    it('does not bring back an error closed by its ✕ just before Settings closed', async () => {
      // sonner takes ~200 ms to animate a dismissed toast out; Settings closing inside
      // that window must not find it still active and move it onto the page.
      await openAt('?settings=general', <AppToaster />);
      await act(async () => {
        notify.error('Could not save', { id: 'just-closed' });
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
      const close = document.querySelector<HTMLButtonElement>(
        '[role="dialog"] [data-sonner-toast] [data-close-button]',
      );
      expect(close, 'the error toast has no ✕').not.toBeNull();
      act(() => close?.click());
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 60));
      });
      act(() => {
        document
          .querySelector<HTMLButtonElement>('[role="dialog"] [data-slot="dialog-close"]')
          ?.click();
      });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 400));
      });
      expect(toastTexts()).toHaveLength(0);
    });

    it('does not bring back an error whose Retry was pressed just before Settings closed', async () => {
      await openAt('?settings=general', <AppToaster />);
      const retry = vi.fn();
      await act(async () => {
        notify.error('Could not save', { retry });
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
      const button = [
        ...document.querySelectorAll<HTMLButtonElement>(
          '[role="dialog"] [data-sonner-toast] button',
        ),
      ].find((b) => b.textContent === 'Retry');
      act(() => button?.click());
      act(() => {
        document
          .querySelector<HTMLButtonElement>('[role="dialog"] [data-slot="dialog-close"]')
          ?.click();
      });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 400));
      });
      expect(retry).toHaveBeenCalledTimes(1);
      expect(toastTexts()).toHaveLength(0);
    });

    it('does not bring back an error the reader dismissed while Settings was open', async () => {
      await openAt('?settings=general', <AppToaster />);
      await act(async () => {
        notify.error('Could not save', { id: 'gone' });
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
      act(() => notify.dismiss('gone'));
      act(() => {
        document
          .querySelector<HTMLButtonElement>('[role="dialog"] [data-slot="dialog-close"]')
          ?.click();
      });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 400));
      });
      expect(toastTexts()).toHaveLength(0);
    });
  });

  it("puts a toast a tab raises as it mounts in Settings' own host — a Polar return", async () => {
    await openAt('?checkout=done&settings=billing', <AppToaster />);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    const shown = [...document.querySelectorAll('[data-sonner-toast]')];
    expect(shown).toHaveLength(1);
    expect(shown[0]?.textContent).toContain('Payment finished');
    expect(shown[0]?.closest('[role="dialog"]')).toBe(dialog());
  });
});
