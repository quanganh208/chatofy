// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  LANGUAGE_CODES,
  TRANSLATION_DIRECTIONS,
  directionLanguages,
  type TranslationDirection,
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
  for (const pair of TRANSLATION_DIRECTIONS) {
    for (const side of ['source', 'target'] as const) {
      for (const code of LANGUAGE_CODES) {
        it(`${pair}, ${side} := ${code}`, () => {
          const next = pairAfterPick(pair, side, code);
          const { source, target } = directionLanguages(next);
          expect(source).not.toBe(target);
          expect(side === 'source' ? source : target).toBe(code);
        });
      }
    }
  }

  it('keeps the other side when it can, and swaps only on a collision', () => {
    expect(pairAfterPick('vi_to_en', 'target', 'zh')).toBe('vi_to_zh');
    expect(pairAfterPick('vi_to_en', 'source', 'zh')).toBe('zh_to_en');
    expect(pairAfterPick('vi_to_en', 'source', 'en')).toBe('en_to_vi');
    expect(pairAfterPick('vi_to_en', 'target', 'vi')).toBe('en_to_vi');
    expect(pairAfterPick('vi_to_en', 'source', 'vi')).toBe('vi_to_en');
  });
});

function renderPicker(
  value: TranslationDirection,
  extra: Partial<React.ComponentProps<typeof LanguagePairPicker>> = {},
) {
  const onChange = vi.fn();
  render(<LanguagePairPicker value={value} onChange={onChange} {...extra} />);
  return onChange;
}

const optionNames = () => screen.getAllByRole('option').map((option) => option.textContent);

describe('LanguagePairPicker', () => {
  it('names each side with its label and shows the chosen languages', () => {
    renderPicker('vi_to_zh');
    // Each language by its own name, as web names them.
    expect(screen.getByRole('combobox', { name: 'Source' }).textContent).toContain('Tiếng Việt');
    expect(screen.getByRole('combobox', { name: 'Translation' }).textContent).toContain('简体中文');
  });

  it('offers every registry language on a side', async () => {
    renderPicker('vi_to_en');
    await userEvent.click(screen.getByRole('combobox', { name: 'Translation' }));
    expect(optionNames()).toEqual(['Tiếng Việt', 'English', '简体中文']);
  });

  it('a languages prop narrows what either side offers', async () => {
    renderPicker('vi_to_en', { languages: ['vi', 'en'] });
    await userEvent.click(screen.getByRole('combobox', { name: 'Source' }));
    expect(optionNames()).toEqual(['Tiếng Việt', 'English']);
  });

  it('picking a language goes through pairAfterPick', async () => {
    const onChange = renderPicker('vi_to_en');
    await userEvent.click(screen.getByRole('combobox', { name: 'Translation' }));
    await userEvent.click(screen.getByRole('option', { name: '简体中文' }));
    expect(onChange).toHaveBeenCalledWith('vi_to_zh');
  });

  it('the swap reverses the pair, and says so in its name', async () => {
    const onChange = renderPicker('en_to_zh');
    await userEvent.click(
      screen.getByRole('button', {
        name: 'Swap direction — translate 简体中文 into English',
      }),
    );
    expect(onChange).toHaveBeenCalledWith('zh_to_en');
  });

  it('disabled blocks all three controls', () => {
    renderPicker('vi_to_en', { disabled: true });
    for (const name of ['Source', 'Translation']) {
      expect((screen.getByRole('combobox', { name }) as HTMLButtonElement).disabled).toBe(true);
    }
    expect(
      (screen.getByRole('button', { name: /Swap direction/ }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('takes its words and its language names from the caller', () => {
    renderPicker('vi_to_en', {
      labels: {
        direction: 'Chiều dịch',
        source: 'Nguồn',
        translation: 'Bản dịch',
        swap: (from, to) => `Đổi chiều: dịch ${from} sang ${to}`,
      },
      nameLanguage: (code) => ({ vi: 'Tiếng Việt', en: 'Tiếng Anh', zh: 'Tiếng Trung' })[code],
    });
    expect(screen.getByRole('combobox', { name: 'Nguồn' }).textContent).toContain('Tiếng Việt');
    expect(
      screen.getByRole('button', { name: 'Đổi chiều: dịch Tiếng Anh sang Tiếng Việt' }),
    ).toBeTruthy();
  });

  it('spends no accent: no control here is filled with the primary colour', () => {
    const { container } = render(<LanguagePairPicker value="vi_to_en" onChange={() => {}} />);
    expect(container.querySelector('.bg-primary')).toBeNull();
  });
});
