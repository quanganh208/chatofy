// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LockIcon } from 'lucide-react';

const { AuthField } = await import('./auth-field');
const { LocaleProvider } = await import('@/i18n/provider');

let root: Root | undefined;
let container: HTMLElement;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  container.remove();
});

function render(field: React.ReactNode) {
  act(() => {
    root = createRoot(container);
    root.render(<LocaleProvider>{field}</LocaleProvider>);
  });
}

const input = () => container.querySelector<HTMLInputElement>('#pw')!;
const revealButton = () => container.querySelector<HTMLButtonElement>('button')!;

/** Type the way a person does: the DOM value changes, then `input` fires. */
function type(value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!.call(
      input(),
      value,
    );
    input().dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('AuthField', () => {
  it('keeps a password field a password field until the reveal button is pressed', () => {
    render(<AuthField id="pw" label="Password" icon={LockIcon} type="password" revealable />);

    expect(input().type).toBe('password');
    expect(revealButton().getAttribute('aria-pressed')).toBe('false');
    expect(revealButton().getAttribute('aria-controls')).toBe('pw');
    expect(revealButton().getAttribute('aria-label')).toBe('Show password');

    type('hunter22');
    act(() => revealButton().click());

    expect(input().type).toBe('text');
    // Switching type keeps what was typed: the uncontrolled forms read it from the DOM.
    expect(input().value).toBe('hunter22');
    expect(revealButton().getAttribute('aria-pressed')).toBe('true');
    expect(revealButton().getAttribute('aria-label')).toBe('Hide password');

    act(() => revealButton().click());
    expect(input().type).toBe('password');
  });

  it('hides a revealed password again when its form is submitted', () => {
    render(
      <form onSubmit={(event) => event.preventDefault()}>
        <AuthField id="pw" label="Password" icon={LockIcon} type="password" revealable />
      </form>,
    );
    act(() => revealButton().click());
    expect(input().type).toBe('text');

    act(() => {
      container
        .querySelector('form')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(input().type).toBe('password');
    expect(revealButton().getAttribute('aria-pressed')).toBe('false');
  });

  it('reads a value filled before hydration once, since no input event follows it', () => {
    render(
      <AuthField
        id="pw"
        label="Password"
        type="password"
        minLength={8}
        requirement="At least 8 characters"
        defaultValue="filled by a manager"
      />,
    );
    expect(container.querySelector<HTMLElement>('#pw-requirement')!.dataset.met).toBe('true');
  });

  it('draws no reveal button unless asked, so the Settings fields stay as they are', () => {
    render(<AuthField id="pw" label="Password" type="password" />);
    expect(container.querySelector('button')).toBeNull();
    expect(input().type).toBe('password');
  });

  it('ticks the requirement once the typed value reaches minLength, and describes the field with it', () => {
    render(
      <AuthField
        id="pw"
        label="Password"
        icon={LockIcon}
        type="password"
        minLength={8}
        requirement="At least 8 characters"
        revealable
      />,
    );
    const requirement = container.querySelector<HTMLElement>('#pw-requirement')!;

    expect(input().getAttribute('aria-describedby')).toBe('pw-requirement');
    expect(requirement.textContent).toBe('At least 8 characters');
    expect(requirement.dataset.met).toBeUndefined();

    type('short');
    expect(requirement.dataset.met).toBeUndefined();

    type('long enough');
    expect(requirement.dataset.met).toBe('true');

    type('short');
    expect(requirement.dataset.met).toBeUndefined();
  });
});
