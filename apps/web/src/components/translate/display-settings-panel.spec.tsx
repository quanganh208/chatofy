// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DisplaySettingsPanel } from './display-settings-panel';
import { LocaleProvider } from '@/i18n/provider';
import { DEFAULT_TRANSLATE_SETTINGS, type TranslateSettings } from '@/lib/translate-settings';
import { accentFilledControls } from '@/design/accent-count';

/**
 * The panel in two named groups: what the transcript holds, and how the page
 * draws it. Read through the accessibility tree — the group's name and the
 * controls inside it — because that is what a reader without the layout gets.
 */

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

function render(
  overrides: Partial<TranslateSettings> = {},
  onChange: (patch: Partial<TranslateSettings>) => void = () => {},
) {
  act(() => {
    root.render(
      <LocaleProvider locale="en">
        <DisplaySettingsPanel
          settings={{ ...DEFAULT_TRANSLATE_SETTINGS, ...overrides }}
          onChange={onChange}
        />
      </LocaleProvider>,
    );
  });
}

/** Each group's accessible name and the names of the controls it holds, in order. */
function groups(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const group of container.querySelectorAll('[role="group"][aria-labelledby]')) {
    const name = document.getElementById(group.getAttribute('aria-labelledby')!)?.textContent;
    out[name ?? ''] = Array.from(
      group.querySelectorAll('[role="switch"][aria-label], [role="radiogroup"][aria-label]'),
    ).map((control) => control.getAttribute('aria-label')!);
  }
  return out;
}

describe('DisplaySettingsPanel groups', () => {
  it('puts order, following and names under Transcript, and the layout under Presentation', () => {
    render();
    const named = groups();
    expect(Object.keys(named)).toEqual(['Transcript', 'Presentation']);
    expect(named.Transcript).toEqual(['Transcript order', 'Free scroll', 'Speaker labels']);
    expect(named.Presentation?.slice(0, 3)).toEqual(['Translation only', 'Display mode', 'Layout']);
    expect(container.textContent).toContain('Text size');
  });

  it('keeps a control that does not apply absent, inside its group', () => {
    render({ displayMode: 'list' });
    expect(groups().Presentation).not.toContain('Layout');

    render({ translationOnly: true });
    expect(groups().Presentation).not.toContain('Display mode');
    expect(groups().Presentation).not.toContain('Layout');
    // The order is about reading, so it stays whatever is drawn.
    expect(groups().Transcript).toContain('Transcript order');
  });

  it('writes the transcript order the reader picks', () => {
    const onChange = vi.fn();
    render({}, onChange);
    const order = container.querySelector('[role="radiogroup"][aria-label="Transcript order"]')!;
    const newest = Array.from(order.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Newest first'),
    );
    expect(newest, 'no "Newest first" option').toBeDefined();
    act(() => newest!.click());
    expect(onChange).toHaveBeenCalledWith({ transcriptOrder: 'newest-first' });
  });

  it('spends no accent fill', () => {
    // Counted the way the screen gates count it: the text size's slider range is
    // a readout, not an action.
    render({ transcriptOrder: 'newest-first' });
    expect(accentFilledControls(container)).toEqual([]);
  });
});
