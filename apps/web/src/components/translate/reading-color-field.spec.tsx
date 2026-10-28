// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReadingColorField } from './reading-color-field';
import { LocaleProvider } from '@/i18n/provider';
import { INK_PRESETS, type InkContrast, type InkPreset } from '@/lib/reading-appearance';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(value: string, contrast?: InkContrast) {
  const onChange = vi.fn();
  act(() => {
    root.render(
      <LocaleProvider>
        <ReadingColorField<InkPreset>
          label="Translation color"
          value={value as InkPreset}
          presets={INK_PRESETS}
          presetLabel={(preset) => `preset ${preset}`}
          contrast={contrast}
          scheme="light"
          onChange={onChange}
        />
      </LocaleProvider>,
    );
  });
  return onChange;
}

const button = (label: string) =>
  container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;

function type(input: HTMLInputElement, value: string) {
  // Through the prototype setter: a plain assignment does not reach a controlled
  // input's React state — see `forgot-password-form.spec.tsx`.
  act(() => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!.call(
      input,
      value,
    );
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('ReadingColorField', () => {
  it('names every swatch by its word and marks the chosen one pressed', () => {
    render('amber');
    expect(button('preset amber').getAttribute('aria-pressed')).toBe('true');
    expect(button('Default').getAttribute('aria-pressed')).toBe('false');
    expect(container.querySelectorAll('button[aria-pressed]').length).toBe(
      Object.keys(INK_PRESETS).length + 2,
    );
  });

  it('never spends the accent on the chosen swatch', () => {
    render('amber');
    expect(container.innerHTML).not.toMatch(/\bbg-primary\b/);
  });

  it('picks a preset, or the default', () => {
    const onChange = render('default');
    act(() => button('preset sky').click());
    expect(onChange).toHaveBeenLastCalledWith('sky');
    act(() => button('Default').click());
    expect(onChange).toHaveBeenLastCalledWith('default');
  });

  it('takes a custom hex only once it is one, lowercased', () => {
    const onChange = render('default');
    act(() => button('Custom color').click());
    const field = container.querySelector<HTMLInputElement>('input[aria-label="Hex code"]')!;
    type(field, '#ABC');
    expect(onChange).not.toHaveBeenCalled();
    expect(field.getAttribute('aria-invalid')).toBe('true');
    type(field, '#AABBCC');
    expect(onChange).toHaveBeenLastCalledWith('#aabbcc');
  });

  it('opens on the custom editor when the value already is one', () => {
    render('#123456');
    expect(button('Custom color').getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelector('input[type="color"]')).not.toBeNull();
  });

  it('reads out the ratio, and warns in words under the floor without refusing', () => {
    render('#123456', { ratio: 7.24, failsInOtherScheme: false });
    expect(container.textContent).toContain('Contrast 7.2:1');
    expect(container.querySelector('[role="status"]')).toBeNull();

    render('#123456', { ratio: 2.1, failsInOtherScheme: false });
    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      'Hard to read: 2.1:1',
    );
    // Advises only: every swatch is still a live control.
    expect(container.querySelectorAll('button[disabled]').length).toBe(0);
  });

  it('says when a colour holds here and not in the other theme', () => {
    render('#222222', { ratio: 15, failsInOtherScheme: true });
    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      'Hard to read in the dark theme.',
    );
  });

  it('follows a value changed from outside, such as a reset', () => {
    render('#112233');
    expect(button('Custom color').getAttribute('aria-pressed')).toBe('true');
    render('default');
    expect(button('Custom color').getAttribute('aria-pressed')).toBe('false');
    expect(button('Default').getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelector('input[aria-label="Hex code"]')).toBeNull();
  });

  it('re-applies the last custom colour when Custom is pressed again', () => {
    render('#112233');
    const onChange = render('default');
    act(() => button('Custom color').click());
    expect(onChange).toHaveBeenLastCalledWith('#112233');
  });
});
