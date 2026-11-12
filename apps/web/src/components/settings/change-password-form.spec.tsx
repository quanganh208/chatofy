// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { en } from '@chatofy/i18n';

type SignInResult = { error?: string; code?: string; ok: boolean } | undefined;
const signIn =
  vi.fn<(provider: string, options: Record<string, unknown>) => Promise<SignInResult>>();

vi.mock('next-auth/react', () => ({
  signIn: (provider: string, options: Record<string, unknown>) => signIn(provider, options),
  useSession: () => ({ data: { accessToken: 'live.access.token' }, status: 'authenticated' }),
}));

const { ChangePasswordForm } = await import('./change-password-form');
const { LocaleProvider } = await import('@/i18n/provider');

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let container: HTMLElement;
const onDone = vi.fn();
const onCancel = vi.fn();

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  signIn.mockReset();
  onDone.mockReset();
  onCancel.mockReset();
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
        <ChangePasswordForm onDone={onDone} onCancel={onCancel} />
      </LocaleProvider>,
    );
    await Promise.resolve();
  });
}

const inputById = (id: string) => container.querySelector<HTMLInputElement>(`#${id}`)!;

/**
 * Filled straight into the DOM, the way an autofill before hydration would. The
 * fields are uncontrolled and the submit reads FormData, so this is also the test
 * that the values come from the form rather than from React state.
 */
async function submit(current: string, next: string, confirm = next) {
  inputById('current-password').value = current;
  inputById('new-password').value = next;
  inputById('confirm-password').value = confirm;
  await act(async () => {
    container
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    for (let tick = 0; tick < 5; tick += 1) await Promise.resolve();
  });
}

const alertText = () => container.querySelector('#change-password-error')?.textContent ?? '';

describe('ChangePasswordForm', () => {
  it('sends the change through the password-change provider, on the server', async () => {
    signIn.mockResolvedValue({ ok: true });
    await render();
    await submit('the-old-one', 'a-brand-new-password');

    expect(signIn).toHaveBeenCalledWith('password-change', {
      accessToken: 'live.access.token',
      currentPassword: 'the-old-one',
      newPassword: 'a-brand-new-password',
      redirect: false,
    });
    expect(onDone).toHaveBeenCalledOnce();
  });

  it('refuses mismatched new passwords without sending anything', async () => {
    await render();
    await submit('the-old-one', 'a-brand-new-password', 'a-brand-new-passwerd');

    expect(signIn).not.toHaveBeenCalled();
    expect(alertText()).toBe(en['web.account.passwordsDoNotMatch']);
    expect(onDone).not.toHaveBeenCalled();
  });

  it.each([
    ['wrong-current', 'web.account.currentPasswordWrong'],
    ['no-password', 'web.account.noPasswordYet'],
    ['invalid', 'web.account.changePasswordInvalid'],
    ['rate-limited', 'web.account.changePasswordThrottled'],
    ['session-expired', 'web.account.changePasswordSessionExpired'],
  ] as const)('tells the reader what %s means', async (code, key) => {
    signIn.mockResolvedValue({ error: 'CredentialsSignin', code, ok: false });
    await render();
    await submit('the-old-one', 'a-brand-new-password');

    expect(alertText()).toBe(en[key]);
    expect(onDone).not.toHaveBeenCalled();
  });

  it('reports a fault as nothing changed, never as a wrong password', async () => {
    signIn.mockResolvedValue({ error: 'CallbackRouteError', ok: false });
    await render();
    await submit('the-old-one', 'a-brand-new-password');

    expect(alertText()).toBe(en['web.account.changePasswordFailed']);
  });

  it('ignores a code it does not know rather than rendering it', async () => {
    signIn.mockResolvedValue({ error: 'CredentialsSignin', code: 'toString', ok: false });
    await render();
    await submit('the-old-one', 'a-brand-new-password');

    expect(alertText()).toBe(en['web.account.changePasswordFailed']);
  });

  it('survives signIn itself rejecting', async () => {
    signIn.mockRejectedValue(new Error('network'));
    await render();
    await submit('the-old-one', 'a-brand-new-password');

    expect(alertText()).toBe(en['web.account.changePasswordFailed']);
    expect(container.querySelector<HTMLButtonElement>('#change-password-submit')!.disabled).toBe(
      false,
    );
  });
});
