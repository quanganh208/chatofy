// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * What this holds is the two rules the compiler cannot.
 *
 * **The sidebar links only routes that exist.** `typedRoutes: true` already fails the
 * build on an `href` to a missing route, so that half is covered — what it cannot see
 * is a route arriving before its nav item is wanted, or a nav item pointing at a real
 * route that is deliberately unlisted. `/translate/live` is a real route and must never
 * appear here.
 *
 * **The rail's names do not come from the tooltip.** Collapsed, each item is an icon
 * with a `Tooltip`, and a tooltip is not an accessible name: it is absent from the
 * accessibility tree until it opens, and it never opens for a screen reader. Delete the
 * `aria-label` and the sidebar still looks right in every screenshot.
 */

const pathname = vi.fn(() => '/translate');
vi.mock('next/navigation', () => ({ usePathname: () => pathname() }));

const session = vi.fn(() => ({ data: undefined, status: 'loading' }));
vi.mock('next-auth/react', () => ({
  useSession: () => session(),
  signOut: vi.fn(),
}));

const { AppChrome } = await import('./app-chrome');
const { LocaleProvider } = await import('@/i18n/provider');

let root: Root | undefined;
let container: HTMLElement;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  pathname.mockReturnValue('/translate');
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  container.remove();
});

function render() {
  act(() => {
    root = createRoot(container);
    root.render(
      <LocaleProvider>
        <AppChrome>
          <p>page</p>
        </AppChrome>
      </LocaleProvider>,
    );
  });
  // The mobile sheet renders a second copy of the nav into a portal; the desktop
  // sidebar is the one the assertions below are about.
  return container.querySelector('[data-slot="sidebar"]') ?? container;
}

describe('the product sidebar', () => {
  it('lists exactly the routes that exist, and only those', () => {
    const links = [...render().querySelectorAll('a[href]')].map((a) => a.getAttribute('href'));
    // The brand is a link too, so the nav items are what remains after it.
    const navLinks = links.filter((href) => href !== '/');
    expect(navLinks).toEqual(['/translate']);
  });

  it('never links the unlisted lab routes', () => {
    const html = render().innerHTML;
    expect(html).not.toContain('/translate/live');
    expect(html).not.toContain('/translate/baseline');
  });

  it('names its icon-only items without relying on the tooltip', () => {
    const item = render().querySelector('a[href="/translate"]');
    expect(item?.getAttribute('aria-label')).toBe('Translate');
  });

  it('marks the current route active', () => {
    expect(render().querySelector('a[href="/translate"]')?.getAttribute('data-active')).toBe(
      'true',
    );
  });
});

describe('the product frame', () => {
  it('gives the skip link a target focus can actually land on', () => {
    render();
    const main = container.querySelector('#main');
    // Without `tabindex`, the fragment changes and focus stays in the nav — a skip
    // link that looks implemented and skips nothing.
    expect(main?.getAttribute('tabindex')).toBe('-1');
    expect(main?.tagName).toBe('MAIN');
  });

  it('puts the skip link ahead of every focusable thing in the group', () => {
    // Read from the source: the ordering is a property of the layout, and the layout
    // is not what this file renders. `import.meta.url` is a vite:// URL under this
    // transformer, so the path is resolved from the project root instead.
    const source = readFileSync(resolve(process.cwd(), 'app/(app)/layout.tsx'), 'utf8');
    const skip = source.indexOf('<SkipLink');
    const chrome = source.indexOf('<AppChrome');
    expect(skip, 'the skip link is gone').toBeGreaterThan(-1);
    expect(skip, 'the chrome renders before the skip link, so the nav comes first').toBeLessThan(
      chrome,
    );
  });

  it('holds the footer shape while the session resolves', () => {
    render();
    // Not `null` while loading: an identity that appears after a beat moves the
    // sidebar's footer, and the sign-out behind it, under the pointer.
    expect(container.querySelector('[data-slot="skeleton"]')).not.toBeNull();
    expect(container.querySelector('#sign-out')).toBeNull();
  });
});
