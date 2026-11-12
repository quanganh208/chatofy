// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { en } from '@chatofy/i18n';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const pathname = vi.hoisted(() => ({ value: '/settings/billing' }));
vi.mock('next/navigation', () => ({ usePathname: () => pathname.value }));

const { SettingsSubnav } = await import('./settings-subnav');
const { SETTINGS_SECTIONS } = await import('./settings-sections');
const { LocaleProvider } = await import('@/i18n/provider');

let root: Root;
let container: HTMLElement;

beforeEach(async () => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <LocaleProvider>
        <SettingsSubnav />
      </LocaleProvider>,
    );
    await Promise.resolve();
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('the settings sub-navigation', () => {
  it('links every section twice — the phone row and the grouped column', () => {
    for (const section of SETTINGS_SECTIONS) {
      expect(container.querySelectorAll(`a[href="${section.href}"]`)).toHaveLength(2);
    }
  });

  it('captions the column with the two groups', () => {
    expect(container.textContent).toContain(en['web.settings.groupPersonal']);
    expect(container.textContent).toContain(en['web.settings.groupAccount']);
  });

  it('marks only the current page, with aria-current and no accent fill', () => {
    const current = container.querySelectorAll('a[aria-current="page"]');
    expect(current).toHaveLength(2);
    for (const link of current) expect(link.getAttribute('href')).toBe('/settings/billing');
    expect(container.querySelector('.bg-primary')).toBeNull();
  });

  it('is a named navigation landmark', () => {
    expect(container.querySelector('nav')?.getAttribute('aria-label')).toBe(en['web.settings.nav']);
  });
});
