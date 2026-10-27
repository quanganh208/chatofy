// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

/**
 * In a settings row the switcher has to say what it is set to; in the chrome the
 * icon alone is enough, because the page around it is the readout.
 */

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('next-auth/react', () => ({ useSession: () => ({ status: 'unauthenticated' }) }));

const { LocaleSwitcher } = await import('./locale-switcher');
const { LocaleProvider } = await import('@/i18n/provider');

function html(locale: 'en' | 'vi', showValue?: boolean) {
  return renderToStaticMarkup(
    <LocaleProvider locale={locale}>
      <LocaleSwitcher showValue={showValue} />
    </LocaleProvider>,
  );
}

describe('LocaleSwitcher', () => {
  it('shows the active language, in its own words, when asked to', () => {
    expect(html('vi', true)).toContain('Tiếng Việt');
    expect(html('en', true)).toContain('English');
  });

  it('keeps the visible name inside the accessible one', () => {
    expect(html('en', true)).toMatch(/aria-label="[^"]*English"/);
  });

  it('stays an icon in the chrome', () => {
    expect(html('en')).not.toContain('>English<');
  });

  it('announces the active language as the checked option', () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => {
      root.render(
        <LocaleProvider locale="vi">
          <LocaleSwitcher />
        </LocaleProvider>,
      );
    });
    const trigger = host.querySelector('button')!;
    act(() => {
      trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });

    const options = Array.from(document.querySelectorAll('[role="menuitemradio"]'));
    expect(options.map((option) => option.getAttribute('aria-checked'))).toEqual([
      expect.any(String),
      expect.any(String),
    ]);
    const checked = options.filter((option) => option.getAttribute('aria-checked') === 'true');
    expect(checked.map((option) => option.textContent)).toEqual(['Tiếng Việt']);

    act(() => root.unmount());
    host.remove();
  });
});
