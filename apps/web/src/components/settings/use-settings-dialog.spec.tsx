// @vitest-environment happy-dom
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { followHistoryForTests, useTestSearchParams } from './settings-dialog-test-location';

/**
 * Opening and closing Settings through the address: push to open so Back closes,
 * replace to switch, and close back to exactly the address the page had.
 */
vi.mock('next/navigation', () => ({ useSearchParams: () => useTestSearchParams() }));

const { useSettingsDialog, openSettingsDialog } = await import('./use-settings-dialog');
type Dialog = ReturnType<typeof useSettingsDialog>;

let root: Root;
let container: HTMLElement;
let latest: Dialog;
let unfollow: () => void;

function Probe() {
  const value = useSettingsDialog();
  React.useEffect(() => {
    latest = value;
  });
  return null;
}

function wideScreen(wide: boolean) {
  window.matchMedia = vi.fn().mockReturnValue({ matches: wide }) as typeof window.matchMedia;
}

/** Back, and the `popstate` it fires, settled. */
async function back() {
  await act(async () => {
    window.history.back();
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

beforeEach(() => {
  unfollow = followHistoryForTests();
  window.history.replaceState(null, '', '/translate/one-way?keep=1');
  wideScreen(true);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => root.render(<Probe />));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  unfollow();
  vi.restoreAllMocks();
});

const here = () => `${window.location.pathname}${window.location.search}`;

describe('useSettingsDialog', () => {
  it('is closed without ?settings=', () => {
    expect(latest.isOpen).toBe(false);
    expect(latest.view).toBeNull();
  });

  it('opens on a tab by pushing, keeping the page and its query', () => {
    const before = window.history.length;
    act(() => latest.open('billing'));
    expect(here()).toBe('/translate/one-way?keep=1&settings=billing');
    expect(window.history.length).toBe(before + 1);
    expect(latest.isOpen).toBe(true);
    expect(latest.view).toBe('billing');
  });

  it('opens without a tab on the first tab where the list sits beside the pane', () => {
    act(() => openSettingsDialog());
    expect(latest.view).toBe('general');
  });

  it('opens without a tab on the list on a phone', () => {
    wideScreen(false);
    act(() => openSettingsDialog());
    expect(here()).toBe('/translate/one-way?keep=1&settings=menu');
    expect(latest.isOpen).toBe(true);
    expect(latest.view).toBeNull();
  });

  it('switches tabs in place, without a history entry per tab', () => {
    act(() => latest.open('general'));
    const opened = window.history.length;
    act(() => latest.show('account'));
    act(() => latest.show(null));
    expect(window.history.length).toBe(opened);
    expect(latest.view).toBeNull();
    // Opening again while open switches too, rather than stacking.
    act(() => latest.open('billing'));
    expect(window.history.length).toBe(opened);
    expect(latest.view).toBe('billing');
  });

  it('closes on Back, back to the address it opened over', async () => {
    act(() => latest.open('account'));
    await back();
    expect(here()).toBe('/translate/one-way?keep=1');
    expect(latest.isOpen).toBe(false);
  });

  it('closes by going back when it pushed the entry, even after switching tabs', async () => {
    act(() => latest.open('general'));
    act(() => latest.show('billing'));
    const opened = window.history.length;
    await act(async () => {
      latest.close();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(here()).toBe('/translate/one-way?keep=1');
    expect(latest.isOpen).toBe(false);
    // Went back rather than pushing a closed address on top.
    expect(window.history.length).toBe(opened);
  });

  it('closes an address that arrived open by replacing it, dropping the checkout return', () => {
    // A redirect from `/settings/billing?checkout=done`: nothing of ours to go back to.
    act(() =>
      window.history.replaceState(
        null,
        '',
        '/translate/one-way?checkout=done&settings=billing&keep=1',
      ),
    );
    expect(latest.view).toBe('billing');
    const length = window.history.length;
    act(() => latest.close());
    expect(here()).toBe('/translate/one-way?keep=1');
    expect(window.history.length).toBe(length);
    expect(latest.isOpen).toBe(false);
  });

  it('does nothing on close when already closed', () => {
    const length = window.history.length;
    act(() => latest.close());
    expect(here()).toBe('/translate/one-way?keep=1');
    expect(window.history.length).toBe(length);
  });
});
