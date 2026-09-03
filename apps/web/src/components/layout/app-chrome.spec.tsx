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
vi.mock('next/navigation', () => ({
  usePathname: () => pathname(),
  // The topbar's language switcher asks the server to render again rather than
  // flipping a value in the provider — see `locale-switcher.tsx`.
  useRouter: () => ({ refresh: vi.fn() }),
}));

const session = vi.fn(() => ({ data: undefined, status: 'loading' }));
vi.mock('next-auth/react', () => ({
  useSession: () => session(),
  signOut: vi.fn(),
}));

const { AppChrome } = await import('./app-chrome');
const { TopbarSlot } = await import('./topbar-slot');
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

function render(page: React.ReactNode = <p>page</p>) {
  act(() => {
    root = createRoot(container);
    root.render(
      <LocaleProvider>
        <AppChrome>{page}</AppChrome>
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
    // The full set, in order. It is complete now, so this asserts against additions
    // as much as omissions. History arrived at PDR milestone 6, with its route —
    // which is the rule this assertion exists to hold anything else to.
    expect(navLinks).toEqual(['/dashboard', '/translate', '/history', '/preferences', '/account']);
  });

  it('never links the unlisted lab routes', () => {
    const html = render().innerHTML;
    expect(html).not.toContain('/translate/live');
    expect(html).not.toContain('/translate/baseline');
  });

  it('separates the two groups without captioning either', () => {
    const sidebar = render();
    // One separator, between the groups — never above the first, which would read as
    // a rule under the brand.
    expect(sidebar.querySelectorAll('[data-sidebar="separator"]').length).toBe(1);
    // No `SidebarGroupLabel`: the separator is what carries the grouping, and it is
    // the half that survives the rail collapsing the labels away.
    expect(sidebar.querySelector('[data-sidebar="group-label"]')).toBeNull();

    const first = sidebar.querySelector('[data-sidebar="separator"]');
    const preferences = sidebar.querySelector('a[href="/preferences"]');
    expect(first && preferences && first.compareDocumentPosition(preferences)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
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

  it('opens as a rail where the surface asked for one, and expanded everywhere else', () => {
    // The collapse rule is route-driven and lives in `RAIL_ROUTES`. The cookie the
    // primitive still writes is inert; if it ever becomes authoritative again this is
    // where the two mechanisms start disagreeing.
    render();
    expect(container.querySelector('[data-state="collapsed"]')).not.toBeNull();
    act(() => root?.unmount());

    pathname.mockReturnValue('/dashboard');
    render();
    expect(container.querySelector('[data-state="collapsed"]')).toBeNull();
    expect(container.querySelector('[data-state="expanded"]')).not.toBeNull();
  });

  it('puts a surface control in the topbar row, not the content column', () => {
    // `/translate` fills this with its settings gear. The assertion is about where it
    // lands rather than what it is: a slot that resolved to the content column would
    // look correct in this spec's DOM and wrong on the screen.
    render(
      <TopbarSlot>
        <button id="gear">gear</button>
      </TopbarSlot>,
    );
    const bar = container.querySelector('[data-sidebar="trigger"]')?.closest('div');
    expect(bar?.querySelector('#gear')).not.toBeNull();
  });

  it('holds the footer shape while the session resolves', () => {
    render();
    // Not `null` while loading: an identity that appears after a beat moves the
    // sidebar's footer, and the sign-out behind it, under the pointer.
    expect(container.querySelector('[data-slot="skeleton"]')).not.toBeNull();
    expect(container.querySelector('#sign-out')).toBeNull();
  });
});
