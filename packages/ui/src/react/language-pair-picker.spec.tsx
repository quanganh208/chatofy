// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  LANGUAGE_CODES,
  allLanguagePairs,
  type LanguagePair,
  type SessionLanguagePair,
} from '@chatofy/types';
import { LanguagePairPicker, pairAfterPick } from './language-pair-picker.js';

beforeAll(() => {
  // Radix Select reaches for pointer capture and scrolling that jsdom lacks.
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});

afterEach(cleanup);

describe('pairAfterPick', () => {
  // Every pair, every side, every language: the one rule both surfaces share.
  for (const pair of allLanguagePairs(LANGUAGE_CODES)) {
    for (const side of ['source', 'target'] as const) {
      for (const code of LANGUAGE_CODES) {
        it(`${pair.source}→${pair.target}, ${side} := ${code}`, () => {
          const { source, target } = pairAfterPick(pair, side, code);
          expect(source).not.toBe(target);
          expect(side === 'source' ? source : target).toBe(code);
        });
      }
    }
  }

  it('keeps the other side when it can, and swaps only on a collision', () => {
    expect(pairAfterPick({ source: 'vi', target: 'en' }, 'target', 'zh')).toEqual({
      source: 'vi',
      target: 'zh',
    });
    expect(pairAfterPick({ source: 'vi', target: 'en' }, 'source', 'zh')).toEqual({
      source: 'zh',
      target: 'en',
    });
    expect(pairAfterPick({ source: 'vi', target: 'en' }, 'source', 'en')).toEqual({
      source: 'en',
      target: 'vi',
    });
    expect(pairAfterPick({ source: 'vi', target: 'en' }, 'target', 'vi')).toEqual({
      source: 'en',
      target: 'vi',
    });
    expect(pairAfterPick({ source: 'vi', target: 'en' }, 'source', 'vi')).toEqual({
      source: 'vi',
      target: 'en',
    });
  });

  it('picking detect keeps the target, and a detect pair never collides into a reverse', () => {
    expect(pairAfterPick({ source: 'vi', target: 'en' }, 'source', 'detect')).toEqual({
      source: 'detect',
      target: 'en',
    });
    expect(pairAfterPick({ source: 'detect', target: 'en' }, 'target', 'zh')).toEqual({
      source: 'detect',
      target: 'zh',
    });
    expect(pairAfterPick({ source: 'detect', target: 'en' }, 'source', 'vi')).toEqual({
      source: 'vi',
      target: 'en',
    });
    // "Detect" has no reverse, so the picked language stays where it was picked
    // and the translation moves to the first other registry language.
    expect(pairAfterPick({ source: 'detect', target: 'en' }, 'source', 'en')).toEqual({
      source: 'en',
      target: 'vi',
    });
    expect(pairAfterPick({ source: 'detect', target: 'vi' }, 'source', 'vi')).toEqual({
      source: 'vi',
      target: 'en',
    });
  });
});

function renderPicker(
  value: LanguagePair,
  extra: Partial<React.ComponentProps<typeof LanguagePairPicker>> = {},
) {
  const onChange = vi.fn();
  render(<LanguagePairPicker value={value} onChange={onChange} {...extra} />);
  return onChange;
}

const optionNames = () => screen.getAllByRole('option').map((option) => option.textContent);

describe('LanguagePairPicker', () => {
  it('names each side with its label and shows the chosen languages', () => {
    renderPicker({ source: 'vi', target: 'zh' });
    // Each language by its English interface name, as the popup names them.
    expect(screen.getByRole('combobox', { name: 'Source' }).textContent).toContain('Vietnamese');
    expect(screen.getByRole('combobox', { name: 'Translation' }).textContent).toContain('Chinese');
  });

  it('offers every registry language on a side', async () => {
    renderPicker({ source: 'vi', target: 'en' });
    await userEvent.click(screen.getByRole('combobox', { name: 'Translation' }));
    expect(optionNames()).toEqual(['Vietnamese', 'English', 'Chinese']);
  });

  it('a languages prop narrows what either side offers', async () => {
    renderPicker({ source: 'vi', target: 'en' }, { languages: ['vi', 'en'] });
    await userEvent.click(screen.getByRole('combobox', { name: 'Source' }));
    expect(optionNames()).toEqual(['Vietnamese', 'English']);
  });

  it('picking a language goes through pairAfterPick', async () => {
    const onChange = renderPicker({ source: 'vi', target: 'en' });
    await userEvent.click(screen.getByRole('combobox', { name: 'Translation' }));
    await userEvent.click(screen.getByRole('option', { name: 'Chinese' }));
    expect(onChange).toHaveBeenCalledWith({ source: 'vi', target: 'zh' });
  });

  it('the swap reverses the pair, and says so in its name', async () => {
    const onChange = renderPicker({ source: 'en', target: 'zh' });
    await userEvent.click(
      screen.getByRole('button', {
        name: 'Swap languages — translate Chinese into English',
      }),
    );
    expect(onChange).toHaveBeenCalledWith({ source: 'zh', target: 'en' });
  });

  it('disabled blocks all three controls', () => {
    renderPicker({ source: 'vi', target: 'en' }, { disabled: true });
    for (const name of ['Source', 'Translation']) {
      expect((screen.getByRole('combobox', { name }) as HTMLButtonElement).disabled).toBe(true);
    }
    expect(
      (screen.getByRole('button', { name: /Swap languages/ }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('takes its words and its language names from the caller', () => {
    renderPicker(
      { source: 'vi', target: 'en' },
      {
        labels: {
          pair: 'Ngôn ngữ',
          source: 'Nguồn',
          translation: 'Bản dịch',
          swap: (from, to) => `Đổi chiều: dịch ${from} sang ${to}`,
        },
        nameLanguage: (code) => ({ vi: 'Tiếng Việt', en: 'Tiếng Anh', zh: 'Tiếng Trung' })[code],
      },
    );
    expect(screen.getByRole('combobox', { name: 'Nguồn' }).textContent).toContain('Tiếng Việt');
    expect(
      screen.getByRole('button', { name: 'Đổi chiều: dịch Tiếng Anh sang Tiếng Việt' }),
    ).toBeTruthy();
  });

  it('spends no accent: no control here is filled with the primary colour', () => {
    const { container } = render(
      <LanguagePairPicker value={{ source: 'vi', target: 'en' }} onChange={() => {}} />,
    );
    expect(container.querySelector('.bg-primary')).toBeNull();
  });

  it('without a detect option, offers exactly the registry — what the popup renders', async () => {
    renderPicker({ source: 'vi', target: 'en' });
    expect(
      (screen.getByRole('button', { name: /Swap languages/ }) as HTMLButtonElement).disabled,
    ).toBe(false);
    await userEvent.click(screen.getByRole('combobox', { name: 'Source' }));
    expect(optionNames()).toEqual(['Vietnamese', 'English', 'Chinese']);
  });
});

describe('LanguagePairPicker with a detect option', () => {
  function renderSession(value: SessionLanguagePair) {
    const onChange = vi.fn();
    render(
      <LanguagePairPicker<SessionLanguagePair>
        value={value}
        onChange={onChange}
        detectOption={{ label: 'Auto-detect' }}
      />,
    );
    return onChange;
  }

  it('leads the source side with it, and only the source side', async () => {
    renderSession({ source: 'vi', target: 'en' });
    await userEvent.click(screen.getByRole('combobox', { name: 'Source' }));
    expect(optionNames()).toEqual(['Auto-detect', 'Vietnamese', 'English', 'Chinese']);
    await userEvent.keyboard('{Escape}');
    await userEvent.click(screen.getByRole('combobox', { name: 'Translation' }));
    expect(optionNames()).toEqual(['Vietnamese', 'English', 'Chinese']);
  });

  it('can be picked, and keeps the translation side', async () => {
    const onChange = renderSession({ source: 'vi', target: 'en' });
    await userEvent.click(screen.getByRole('combobox', { name: 'Source' }));
    await userEvent.click(screen.getByRole('option', { name: 'Auto-detect' }));
    expect(onChange).toHaveBeenCalledWith({ source: 'detect', target: 'en' });
  });

  it('shows it as the chosen source, with no swap to offer', () => {
    renderSession({ source: 'detect', target: 'en' });
    expect(screen.getByRole('combobox', { name: 'Source' }).textContent).toContain('Auto-detect');
    expect(
      (screen.getByRole('button', { name: /Swap languages/ }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});
