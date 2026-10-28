// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppearanceSettingsPanel } from './appearance-settings-panel';
import { StageSettingsPanel } from './stage-settings-panel';
import { LocaleProvider } from '@/i18n/provider';
import { DEFAULT_READING_APPEARANCE, type ReadingAppearance } from '@/lib/reading-appearance';
import { DEFAULT_STAGE_APPEARANCE, type StageAppearance } from '@/lib/translate-settings';

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

function panel(patch: Partial<ReadingAppearance> = {}) {
  const onChange = vi.fn();
  act(() => {
    root.render(
      <LocaleProvider>
        <AppearanceSettingsPanel
          appearance={{ ...DEFAULT_READING_APPEARANCE, ...patch }}
          defaults={DEFAULT_READING_APPEARANCE}
          scheme="light"
          onChange={onChange}
        />
      </LocaleProvider>,
    );
  });
  return onChange;
}

function stage(patch: Partial<StageAppearance> = {}) {
  const onChange = vi.fn();
  act(() => {
    root.render(
      <LocaleProvider>
        <StageSettingsPanel
          stage={{ ...DEFAULT_STAGE_APPEARANCE, ...patch }}
          scheme="dark"
          onChange={onChange}
        />
      </LocaleProvider>,
    );
  });
  return onChange;
}

const text = () => container.textContent ?? '';
const button = (label: string, within: ParentNode = container) =>
  within.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
const fieldset = (legend: string) =>
  Array.from(container.querySelectorAll('fieldset')).find(
    (node) => node.querySelector('legend')?.textContent === legend,
  )!;

describe('AppearanceSettingsPanel', () => {
  it('offers every slot, face, spacing, weight, alignment and the time', () => {
    panel();
    for (const label of [
      'Translation color',
      'Original color',
      'Speaker name color',
      'Time color',
      'Background',
      'Font',
      'Line spacing',
      'Translation weight',
      'Alignment',
      'Show time',
    ]) {
      expect(text()).toContain(label);
    }
  });

  it('writes a swatch to the slot it sits under', () => {
    const onChange = panel();
    act(() => button('Amber', fieldset('Time color')).click());
    expect(onChange).toHaveBeenLastCalledWith({ timeColor: 'amber' });
  });

  it('measures each ink, so a reader sees the ratio before choosing badly', () => {
    panel();
    expect(fieldset('Translation color').textContent).toMatch(/Contrast \d+\.\d:1/);
    // A ground is measured by the inks on it, not on its own.
    expect(fieldset('Background').textContent).not.toMatch(/Contrast/);
  });

  it('offers opacity only once there is a background to make translucent', () => {
    panel();
    expect(text()).not.toContain('Background opacity');
    panel({ background: 'navy' });
    expect(text()).toContain('Background opacity');
  });

  it('resets to the defaults it was given', () => {
    const onChange = panel({ font: 'mono', targetColor: 'rose' });
    const reset = Array.from(container.querySelectorAll('button')).find(
      (node) => node.textContent === 'Reset to default',
    )!;
    act(() => reset.click());
    expect(onChange).toHaveBeenLastCalledWith(DEFAULT_READING_APPEARANCE);
  });
});

describe('StageSettingsPanel', () => {
  it('has its own size and appearance while it does not follow the page', () => {
    stage();
    expect(text()).toContain('Text size');
    expect(text()).toContain('Translation color');
  });

  it('drops every editor while it follows the page, and keeps what they held', () => {
    const onChange = stage({ followPage: true, background: 'navy' });
    expect(text()).not.toContain('Translation color');
    expect(text()).not.toContain('Text size');

    act(() => button('Same as page').click());
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ followPage: false, background: 'navy' }),
    );
  });

  it('resets to the caption look and size, not to the page defaults', () => {
    const onChange = stage({ background: 'cream', textSize: 2 });
    const reset = Array.from(container.querySelectorAll('button')).find(
      (node) => node.textContent === 'Reset to default',
    )!;
    act(() => reset.click());
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        background: 'black',
        targetWeight: 'bold',
        textSize: DEFAULT_STAGE_APPEARANCE.textSize,
      }),
    );
  });
});
