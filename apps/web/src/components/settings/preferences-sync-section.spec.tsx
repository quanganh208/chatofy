// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClientError } from '@chatofy/api-client';
import { en } from '@chatofy/i18n';
import { LocaleProvider } from '@/i18n/provider';
import { activePreferences } from '@/lib/preferences/active-preferences';
import {
  fakePreferencesServer,
  signInPreferences,
  type FakePreferencesServer,
} from '@/lib/preferences/preferences.fixture';
import { PreferencesSyncNote, PreferencesSyncSection } from './preferences-sync-section';

const notify = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), dismiss: vi.fn() }));
vi.mock('@/lib/notify', () => ({ notify }));

let container: HTMLDivElement;
let root: Root;
let server: FakePreferencesServer;

function render(node: React.ReactNode) {
  act(() => root.render(<LocaleProvider>{node}</LocaleProvider>));
}

const settle = (ms = 0) => act(() => vi.advanceTimersByTimeAsync(ms));
const note = () => container.querySelector('[data-preferences-sync]');

beforeEach(async () => {
  vi.useFakeTimers();
  localStorage.clear();
  server = fakePreferencesServer();
  signInPreferences(server);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await settle();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  notify.success.mockClear();
  vi.useRealTimers();
});

describe('the sync line', () => {
  it('says where the settings live, then how the last change went', async () => {
    render(<PreferencesSyncNote />);
    expect(note()?.textContent).toBe(en['common.preferences.syncNote']);

    act(() => activePreferences().update({ theme: 'dark' }));
    await settle(60);
    expect(note()?.textContent).toContain(en['common.preferences.saved']);
  });

  it('says a failed save is being retried, then that it went through', async () => {
    render(<PreferencesSyncNote />);
    server.failing = true;
    act(() => activePreferences().update({ theme: 'dark' }));
    await settle(60);
    expect(note()?.getAttribute('data-preferences-sync')).toBe('error');
    expect(note()?.textContent).toContain(en['common.preferences.saveRetrying']);

    server.failing = false;
    await settle(1_100);
    expect(note()?.textContent).toContain(en['common.preferences.saved']);
    expect(server.stored().theme).toBe('dark');
  });

  it('says a refused save was not kept, apart from a retry, until the next change', async () => {
    render(<PreferencesSyncNote />);
    // The web transport's own error for a 4xx: the store reads its `status`.
    vi.spyOn(server.transport, 'save').mockRejectedValueOnce(
      new ApiClientError({ code: 'VALIDATION_FAILED', message: 'refused' }, 400),
    );
    act(() => activePreferences().update({ theme: 'dark' }));
    await settle(60);
    expect(note()?.getAttribute('data-preferences-sync')).toBe('refused');
    expect(note()?.textContent).toContain(en['common.preferences.saveRefused']);
    expect(note()?.textContent).not.toContain(en['common.preferences.saveRetrying']);
    expect(note()?.querySelector('.text-destructive')).not.toBeNull();
    // Dropped, not retried: the screen shows what the server holds.
    await settle(2_000);
    expect(server.stored().theme).toBe('system');
    expect(activePreferences().getSnapshot().preferences.theme).toBe('system');

    act(() => activePreferences().update({ theme: 'light' }));
    await settle(60);
    expect(note()?.textContent).toContain(en['common.preferences.saved']);
    expect(server.stored().theme).toBe('light');
  });

  it('is not drawn for a signed-out visitor, whose choices stay in this browser', async () => {
    const { resetActivePreferences } = await import('@/lib/preferences/active-preferences');
    resetActivePreferences('en');
    render(<PreferencesSyncSection />);
    expect(container.textContent).toBe('');
  });
});

describe('Reset to defaults', () => {
  const press = (selector: string) =>
    act(() => document.querySelector<HTMLElement>(selector)!.click());

  it('asks first, then drops the account back to its defaults', async () => {
    act(() => activePreferences().update({ theme: 'dark', translateMode: 'two-way' }));
    await settle(60);
    render(<PreferencesSyncSection />);

    const trigger = container.querySelector<HTMLButtonElement>('[data-preferences-reset] button')!;
    expect(trigger.textContent).toBe(en['common.preferences.reset']);
    // Never the screen's accent.
    expect(trigger.className).not.toContain('bg-primary');

    press('[data-preferences-reset] button');
    expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain(
      en['common.preferences.resetNote'],
    );
    press('[role="alertdialog"] [data-slot="alert-dialog-action"]');
    await settle();

    expect(server.stored()).toMatchObject({ theme: 'system', translateMode: 'one-way' });
    expect(activePreferences().getSnapshot().preferences.theme).toBe('system');
    expect(notify.success).toHaveBeenCalledWith(en['common.preferences.resetDone'], {
      id: 'preferences-reset',
    });
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
  });

  it('keeps the confirmation open with the failure inside it when the server refuses', async () => {
    render(<PreferencesSyncSection />);
    server.failing = true;
    press('[data-preferences-reset] button');
    press('[role="alertdialog"] [data-slot="alert-dialog-action"]');
    await settle();

    expect(document.querySelector('[role="alertdialog"] [role="alert"]')?.textContent).toBe(
      en['common.preferences.resetFailed'],
    );
    expect(notify.success).not.toHaveBeenCalled();
  });
});
