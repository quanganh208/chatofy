// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SignInPane } from '../entrypoints/popup/sign-in-pane';

/**
 * The popup's half of "both sign-in surfaces fail the same way".
 *
 * `apps/web`'s form owns its message and a spec there pins the wording. This
 * surface owns something different and easier to lose: it does not have a
 * message of its own. `use-popup` sets `signInError` to `result.message` — the
 * API's own words — and the API answers a wrong password and an unknown email
 * identically on purpose. So what has to hold here is PASS-THROUGH: the pane
 * must not branch on the string, prefix it, or improve it.
 *
 * A prop diff cannot see that, which is why phase 4 wrote a test instead. The
 * pane was rewritten around this string — both fields became the shared `Input`
 * and the gaps changed — and a rewrite is exactly when someone helpfully makes
 * an error message more specific.
 */

let root: Root | undefined;
let container: HTMLElement;

const popupStub = (over: Partial<{ signInError: string; signingIn: boolean }> = {}) =>
  ({
    signInError: undefined,
    signingIn: false,
    actions: { submitSignIn: vi.fn() },
    ...over,
  }) as unknown as Parameters<typeof SignInPane>[0]['popup'];

function render(popup: ReturnType<typeof popupStub>) {
  act(() => {
    root = createRoot(container);
    root.render(<SignInPane popup={popup} hidden={false} />);
  });
}

beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  container.remove();
});

const inputById = (id: string) => container.querySelector<HTMLInputElement>(`#${id}`)!;

describe('the popup sign-in pane', () => {
  it('renders both fields with the attributes a password manager reads', () => {
    render(popupStub());

    expect(inputById('sign-in-email').type).toBe('email');
    expect(inputById('sign-in-email').required).toBe(true);
    expect(inputById('sign-in-email').autocomplete).toBe('username');

    expect(inputById('sign-in-password').type).toBe('password');
    expect(inputById('sign-in-password').required).toBe(true);
    expect(inputById('sign-in-password').autocomplete).toBe('current-password');

    // The shared primitive, not the class string this file used to declare.
    expect(inputById('sign-in-email').dataset.slot).toBe('input');
    expect(inputById('sign-in-password').dataset.slot).toBe('input');
  });

  it('renders whatever the API said, and nothing of its own', () => {
    // Three different answers the API could give. Each must come out verbatim
    // and alone — if the pane ever grew a branch, at least one of these would
    // come back rephrased.
    for (const message of [
      'That email and password did not match an account.',
      'Too many attempts. Try again in a minute.',
      'This account has been disabled.',
    ]) {
      render(popupStub({ signInError: message }));
      const shown = container.querySelectorAll('#sign-in-error');
      expect(shown).toHaveLength(1);
      expect(shown[0]!.textContent).toBe(message);
      act(() => root?.unmount());
      root = undefined;
    }
  });

  it('shows nothing at all until there is something to say', () => {
    render(popupStub());
    expect(container.querySelector('#sign-in-error')).toBeNull();
  });

  it('announces the failure rather than only showing it', () => {
    render(popupStub({ signInError: 'nope' }));
    // `Alert` carries role="alert" itself; asserted here because the wrapper is
    // what a restyle swaps out.
    expect(container.querySelector('#sign-in-error')!.getAttribute('role')).toBe('alert');
  });

  it('blocks a second submit while one is in flight', () => {
    render(popupStub({ signingIn: true }));
    const submit = container.querySelector<HTMLButtonElement>('#sign-in-submit')!;
    expect(submit.disabled).toBe(true);
    expect(submit.textContent).toBe('Signing in…');
  });
});
