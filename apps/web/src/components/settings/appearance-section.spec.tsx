// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { en, vi as viDict } from '@chatofy/i18n';

/**
 * Settings › Appearance: the two controls that left the topbar, each confirming
 * with a toast that can undo it.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Toast = { id?: string; undo?: () => void; retry?: () => void };
const notify = vi.hoisted(() => ({
  success: vi.fn<(message: string, options?: Toast) => void>(),
  error: vi.fn<(message: string, options?: Toast) => void>(),
  dismiss: vi.fn(),
}));
vi.mock('@/lib/notify', () => ({ notify }));
const updateMe = vi.hoisted(() => vi.fn<(body: unknown) => Promise<unknown>>());
vi.mock('@/clients/api-client', () => ({ updateMe: (body: unknown) => updateMe(body) }));
const refresh = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
vi.mock('next-auth/react', () => ({ useSession: () => ({ status: 'authenticated' }) }));

const { AppearanceSection } = await import('./appearance-section');
const { LocaleProvider } = await import('@/i18n/provider');

let root: Root;
let container: HTMLElement;

beforeEach(async () => {
  vi.clearAllMocks();
  localStorage.clear();
  updateMe.mockResolvedValue({});
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <LocaleProvider>
        <AppearanceSection />
      </LocaleProvider>,
    );
    await Promise.resolve();
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const radio = (name: string) =>
  [...document.querySelectorAll<HTMLElement>('[role=radio]')].find(
    (el) => el.getAttribute('aria-label') === name || el.textContent === name,
  );

/** Opens the language menu and picks Vietnamese, as a pointer does. */
async function pickVietnamese() {
  const trigger = container.querySelector<HTMLElement>('button[aria-label^="Language"]')!;
  await act(async () => {
    trigger.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
    await Promise.resolve();
  });
  const item = [...document.querySelectorAll<HTMLElement>('[role=menuitemradio]')].find(
    (el) => el.textContent === en['common.language.vietnamese'],
  )!;
  await act(async () => {
    item.click();
    for (let i = 0; i < 4; i += 1) await Promise.resolve();
  });
}

describe('AppearanceSection', () => {
  it('confirms a theme pick with a toast whose undo puts the old one back', () => {
    const dark = radio(en['common.theme.dark']);
    expect(dark, 'the theme control should render a Dark option').toBeDefined();
    act(() => {
      dark!.click();
    });
    const [message, options] = notify.success.mock.calls.at(-1)!;
    expect(message).toBe(`${en['common.theme.label']} saved`);
    expect(options?.id).toBe('setting-theme');
    expect(document.documentElement.classList.contains('dark')).toBe(true);

    act(() => options?.undo?.());
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('confirms a language switch in the language just chosen', async () => {
    await pickVietnamese();
    expect(refresh).toHaveBeenCalled();
    expect(updateMe).toHaveBeenCalledWith({ locale: 'vi' });
    const [message, options] = notify.success.mock.calls.at(-1)!;
    expect(message).toBe(
      viDict['web.settings.saved'].replace('{setting}', viDict['common.language.label']),
    );
    expect(options?.id).toBe('setting-locale');
    expect(typeof options?.undo).toBe('function');
  });

  it('turns the toast into an error with Retry when the account write fails', async () => {
    updateMe.mockRejectedValueOnce(new Error('offline'));
    await pickVietnamese();
    const [, options] = notify.error.mock.calls.at(-1)!;
    expect(options?.id).toBe('setting-locale');

    await act(async () => {
      options?.retry?.();
      for (let i = 0; i < 4; i += 1) await Promise.resolve();
    });
    expect(updateMe).toHaveBeenCalledTimes(2);
    expect(notify.success.mock.calls.at(-1)?.[1]?.id).toBe('setting-locale');
  });
});
