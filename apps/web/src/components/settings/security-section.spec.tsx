// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { en } from '@chatofy/i18n';

/**
 * Settings › Account (security): the password dialog, the sign-out confirmation, and the claim
 * this page must not make.
 *
 * Signing out here discards this browser's cookie. The API token it carried stays valid
 * until it expires, and other devices are untouched — the only thing that revokes
 * earlier tokens and closes open sockets is a completed password change. So "sign out of
 * all devices" would be a security claim the system does not implement, on the page
 * where a user goes specifically to find out what their options are. The ban is on the
 * phrasing rather than on any one string, because the failure arrives as a copy edit.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type SignInResult = { error?: string; code?: string; ok: boolean } | undefined;
const signIn =
  vi.fn<(provider: string, options: Record<string, unknown>) => Promise<SignInResult>>();
const signOut = vi.fn<(options: unknown) => Promise<unknown>>();
vi.mock('next-auth/react', () => ({
  signIn: (provider: string, options: Record<string, unknown>) => signIn(provider, options),
  signOut: (options: unknown) => signOut(options),
  useSession: () => ({ data: { accessToken: 'live.access.token' }, status: 'authenticated' }),
}));
const notify = vi.hoisted(() => ({
  success: vi.fn<(message: string, options?: { id?: string }) => void>(),
  error: vi.fn(),
  dismiss: vi.fn(),
}));
vi.mock('@/lib/notify', () => ({ notify }));

const { SecuritySection } = await import('./security-section');
const { LocaleProvider } = await import('@/i18n/provider');

let root: Root | undefined;
let container: HTMLElement;

beforeEach(() => {
  vi.clearAllMocks();
  container = document.createElement('div');
  document.body.appendChild(container);
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
        <SecuritySection />
      </LocaleProvider>,
    );
    await Promise.resolve();
  });
}

async function click(selector: string) {
  await act(async () => {
    document.querySelector<HTMLElement>(selector)!.click();
    for (let tick = 0; tick < 5; tick += 1) await Promise.resolve();
  });
}

describe('the security page', () => {
  it('never claims sign-out-everywhere, on the page or in its confirmation', async () => {
    await render();
    await click('#sign-out-account');
    const text = document.body.textContent ?? '';

    expect(text.length, 'the page rendered nothing at all').toBeGreaterThan(50);
    expect(text).not.toMatch(/all (?:your )?devices|everywhere|every device|all sessions/i);
    // The accurate version is present, not merely the wrong one absent.
    expect(text).toContain('this browser only');
  });

  it('is the "Security" group', async () => {
    await render();
    expect(container.querySelector('[data-slot="settings-section"] h3')?.textContent).toBe(
      en['web.account.security'],
    );
  });

  it('spends no accent: both actions are outline', async () => {
    await render();
    expect(container.querySelector('.bg-primary')).toBeNull();
    for (const id of ['#change-password-open', '#sign-out-account']) {
      expect(container.querySelector(id)?.getAttribute('data-variant')).toBe('outline');
    }
  });
});

describe('the change password dialog', () => {
  it('opens on the row, and Cancel closes it without a toast', async () => {
    await render();
    await click('#change-password-open');
    expect(document.querySelector('[role=dialog] #current-password')).not.toBeNull();

    const cancel = [...document.querySelectorAll<HTMLButtonElement>('[role=dialog] button')].find(
      (button) => button.textContent === en['web.account.changePasswordCancel'],
    );
    await act(async () => {
      cancel!.click();
      await Promise.resolve();
    });
    expect(document.querySelector('[role=dialog]')).toBeNull();
    expect(notify.success).not.toHaveBeenCalled();
  });

  it('closes on success and says so with a toast', async () => {
    signIn.mockResolvedValue({ ok: true });
    await render();
    await click('#change-password-open');
    for (const [id, value] of [
      ['current-password', 'the-old-one'],
      ['new-password', 'a-brand-new-password'],
      ['confirm-password', 'a-brand-new-password'],
    ] as const) {
      document.querySelector<HTMLInputElement>(`#${id}`)!.value = value;
    }
    await act(async () => {
      document
        .querySelector('[role=dialog] form')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      for (let tick = 0; tick < 5; tick += 1) await Promise.resolve();
    });

    expect(signIn).toHaveBeenCalledWith('password-change', expect.anything());
    expect(document.querySelector('[role=dialog]')).toBeNull();
    expect(notify.success).toHaveBeenCalledWith(en['web.account.passwordChanged'], {
      id: 'password-change',
    });
  });

  it('keeps a refusal inline in the dialog, not in a toast', async () => {
    signIn.mockResolvedValue({ ok: false, error: 'CredentialsSignin', code: 'wrong-current' });
    await render();
    await click('#change-password-open');
    for (const id of ['current-password', 'new-password', 'confirm-password']) {
      document.querySelector<HTMLInputElement>(`#${id}`)!.value = 'a-brand-new-password';
    }
    await act(async () => {
      document
        .querySelector('[role=dialog] form')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      for (let tick = 0; tick < 5; tick += 1) await Promise.resolve();
    });

    expect(document.querySelector('[role=dialog]')).not.toBeNull();
    expect(document.querySelector('#change-password-error')?.textContent).toBe(
      en['web.account.currentPasswordWrong'],
    );
    expect(notify.success).not.toHaveBeenCalled();
  });
});

function pressEscape() {
  return act(async () => {
    document.activeElement?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );
    for (let tick = 0; tick < 5; tick += 1) await Promise.resolve();
  });
}

describe('closing while a request is in flight', () => {
  it('holds the password dialog open, so a refusal still lands in it', async () => {
    let answer: (result: SignInResult) => void = () => {};
    signIn.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    await render();
    await click('#change-password-open');
    for (const id of ['current-password', 'new-password', 'confirm-password']) {
      document.querySelector<HTMLInputElement>(`#${id}`)!.value = 'a-brand-new-password';
    }
    await act(async () => {
      document
        .querySelector('[role=dialog] form')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });

    await pressEscape();
    expect(document.querySelector('[role=dialog]')).not.toBeNull();

    await act(async () => {
      answer({ ok: false, error: 'CredentialsSignin', code: 'wrong-current' });
      for (let tick = 0; tick < 5; tick += 1) await Promise.resolve();
    });
    expect(document.querySelector('#change-password-error')?.textContent).toBe(
      en['web.account.currentPasswordWrong'],
    );

    // Settled, it closes again as any dialog does.
    await pressEscape();
    expect(document.querySelector('[role=dialog]')).toBeNull();
  });

  it('holds the sign-out confirmation open while signing out', async () => {
    signOut.mockReturnValue(new Promise(() => {}));
    await render();
    await click('#sign-out-account');
    await click('#sign-out-confirm');
    await pressEscape();
    expect(document.querySelector('[role=alertdialog]')).not.toBeNull();
  });

  it('lets the sign-out confirmation close before it is confirmed', async () => {
    await render();
    await click('#sign-out-account');
    await pressEscape();
    expect(document.querySelector('[role=alertdialog]')).toBeNull();
  });
});

describe('sign out', () => {
  it('asks first, and signs out only on confirm', async () => {
    signOut.mockReturnValue(new Promise(() => {}));
    await render();
    await click('#sign-out-account');
    expect(document.querySelector('[role=alertdialog]')?.textContent).toContain(
      en['web.settings.signOutTitle'],
    );
    expect(signOut).not.toHaveBeenCalled();

    await click('#sign-out-confirm');
    expect(signOut).toHaveBeenCalledWith({ redirectTo: '/login' });
    // Held open, disabled, while the redirect is on its way.
    expect(document.querySelector<HTMLButtonElement>('#sign-out-confirm')?.disabled).toBe(true);
  });

  it('says so with a toast when signing out fails, and lets the reader try again', async () => {
    signOut.mockRejectedValue(new Error('offline'));
    await render();
    await click('#sign-out-account');
    await click('#sign-out-confirm');
    expect(notify.error).toHaveBeenCalledWith(en['web.settings.signOutFailed'], { id: 'sign-out' });
    expect(document.querySelector<HTMLButtonElement>('#sign-out-confirm')?.disabled).toBe(false);
  });
});
