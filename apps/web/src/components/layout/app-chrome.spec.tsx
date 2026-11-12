// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * What this holds is the two rules the compiler cannot.
 *
 * **The sidebar links only routes that exist.** `typedRoutes: true` already fails the
 * build on an `href` to a missing route, so that half is covered — what it cannot see
 * is a route arriving before its nav item is wanted.
 *
 * **The rail's names do not come from the tooltip.** Collapsed, each item is an icon
 * with a `Tooltip`, and a tooltip is not an accessible name: it is absent from the
 * accessibility tree until it opens, and it never opens for a screen reader. Delete the
 * `aria-label` and the sidebar still looks right in every screenshot.
 */

const pathname = vi.fn(() => '/translate/one-way');
vi.mock('next/navigation', () => ({
  usePathname: () => pathname(),
  useRouter: () => ({ refresh: vi.fn() }),
}));

// The footer's credit line reads the balance; a fixed answer keeps the frame's tests
// off the network.
vi.mock('@/clients/api-client', () => ({
  getCreditBalance: vi.fn(() => new Promise(() => {})),
  getCheckoutOrder: vi.fn(),
  listCreditUsage: vi.fn(),
}));

const session = vi.fn(() => ({ data: undefined, status: 'loading' }));
vi.mock('next-auth/react', () => ({
  useSession: () => session(),
  signOut: vi.fn(),
}));

const { AppChrome } = await import('./app-chrome');
const { TopbarActions, TopbarCrumb, useImmersiveChrome } = await import('./chrome-slots');
const { LocaleProvider } = await import('@/i18n/provider');
const { accentFilledControls } = await import('@/design/accent-count');
const { elevatedSurfaces } = await import('@/design/surface-count');

let root: Root | undefined;
let container: HTMLElement;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  pathname.mockReturnValue('/translate/one-way');
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  container.remove();
});

function render(page: React.ReactNode = <p>page</p>, defaultOpen?: boolean) {
  act(() => {
    root = createRoot(container);
    root.render(
      <LocaleProvider>
        <AppChrome defaultOpen={defaultOpen}>{page}</AppChrome>
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
    // The brand is a link too, so the nav items are what remains after it. The last
    // is the footer's Settings entry; Account moved into the session menu.
    const navLinks = links.filter((href) => href !== '/');
    expect(navLinks).toEqual([
      '/translate/one-way',
      '/translate/two-way',
      '/conference',
      '/history',
      '/glossary',
      '/settings/appearance',
    ]);
  });

  it('captions its two groups, Translate and Library', () => {
    const sidebar = render();
    const captions = [...sidebar.querySelectorAll('[data-sidebar="group-label"]')].map(
      (label) => label.textContent,
    );
    expect(captions).toEqual(['Translate', 'Library']);
    // The captions carry the grouping now; a separator as well would draw it twice.
    expect(sidebar.querySelector('[data-sidebar="separator"]')).toBeNull();
  });

  it('puts Settings in the footer, active on the routes it stands for', () => {
    pathname.mockReturnValue('/settings/security');
    const footer = render().querySelector('[data-sidebar="footer"]');
    const settings = footer?.querySelector('a[href="/settings/appearance"]');
    expect(settings?.getAttribute('aria-label')).toBe('Settings');
    expect(settings?.getAttribute('aria-current')).toBe('page');
  });

  it('names its icon-only items without relying on the tooltip', () => {
    const item = render().querySelector('a[href="/translate/one-way"]');
    expect(item?.getAttribute('aria-label')).toBe('One-way translation');
  });

  it('marks the current page with aria-current and one dawn bar, and no other link', () => {
    const sidebar = render();
    const current = [...sidebar.querySelectorAll('a[aria-current="page"]')];
    expect(current.map((a) => a.getAttribute('href'))).toEqual(['/translate/one-way']);
    // Decoration only: hidden from assistive tech, and there is exactly one.
    const bars = sidebar.querySelectorAll('[data-slot="sidebar-active-bar"]');
    expect(bars.length).toBe(1);
    expect(bars[0]?.getAttribute('aria-hidden')).toBe('true');
  });

  it('marks the current route active', () => {
    expect(
      render().querySelector('a[href="/translate/one-way"]')?.getAttribute('data-active'),
    ).toBe('true');
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

  it('opens the translator the way the reader left the sidebar', () => {
    // No route decides this any more: the translator opens expanded for a reader
    // who never toggled, and as a rail for one whose cookie says they chose it.
    render();
    expect(container.querySelector('[data-state="expanded"]')).not.toBeNull();
    act(() => root?.unmount());

    pathname.mockReturnValue('/translate/two-way');
    render(undefined, false);
    expect(container.querySelector('[data-state="collapsed"]')).not.toBeNull();
  });

  it('keeps a toggle across navigation', () => {
    render();
    const toggle = container.querySelector<HTMLButtonElement>('[data-sidebar="trigger"]');
    act(() => toggle?.click());
    expect(container.querySelector('[data-state="collapsed"]')).not.toBeNull();

    pathname.mockReturnValue('/history');
    act(() =>
      root?.render(
        <LocaleProvider>
          <AppChrome>
            <p>page</p>
          </AppChrome>
        </LocaleProvider>,
      ),
    );
    expect(container.querySelector('[data-state="collapsed"]')).not.toBeNull();
  });

  it("opens the conference room as a rail without overwriting the reader's choice", () => {
    pathname.mockReturnValue('/conference/room-1');
    render();
    expect(container.querySelector('[data-state="collapsed"]')).not.toBeNull();

    pathname.mockReturnValue('/conference');
    act(() =>
      root?.render(
        <LocaleProvider>
          <AppChrome>
            <p>page</p>
          </AppChrome>
        </LocaleProvider>,
      ),
    );
    expect(container.querySelector('[data-state="expanded"]')).not.toBeNull();
  });

  it('holds the sidebar toggle and the breadcrumb, and nothing else of its own', () => {
    // Language and theme left for Settings; a page's actions arrive through
    // `TopbarActions`. A new control appearing here unasked is the regression.
    render();
    const bar = container.querySelector('[data-slot="app-topbar"]');
    const named = [...(bar?.querySelectorAll('[aria-label]') ?? [])].map((el) =>
      el.getAttribute('aria-label'),
    );
    expect(named).toEqual(['Toggle the sidebar', 'Breadcrumb']);
    expect(bar?.querySelector('[data-slot="topbar-actions"]')?.childElementCount).toBe(0);
  });

  it('hides the sidebar toggle below md, where the tab bar navigates', () => {
    render();
    const trigger = container.querySelector('[data-slot="app-topbar"] [data-sidebar="trigger"]');
    expect(trigger?.className).toContain('max-md:hidden');
    expect(trigger?.className).toContain('pointer-coarse:size-11');
  });

  it('spends no accent and draws no elevated surface of its own', () => {
    // The frame is on every screen, so anything it spent would come out of every
    // screen's one-accent, two-surface budget.
    render();
    expect(accentFilledControls(container)).toEqual([]);
    expect(elevatedSurfaces(container)).toEqual([]);
  });

  it('shares one balance read between the sidebar meter and the page', async () => {
    // The page below the frame reads the balance too (Billing, the readiness banner).
    // Without the frame's provider each reader would fetch on its own and drift apart.
    const { getCreditBalance } = await import('@/clients/api-client');
    const { useCreditBalance } = await import('@/hooks/use-credits');
    vi.mocked(getCreditBalance).mockClear();
    // Signed in, so the footer draws the meter and the page is the second reader.
    session.mockReturnValue({
      data: { user: { name: 'An', email: 'an@example.test' } },
      status: 'authenticated',
    } as unknown as ReturnType<typeof session>);
    function PageReader() {
      useCreditBalance();
      return null;
    }
    render(<PageReader />);
    expect(container.querySelector('[data-slot="credit-line"]')).not.toBeNull();
    expect(getCreditBalance).toHaveBeenCalledTimes(1);
    session.mockReturnValue({ data: undefined, status: 'loading' });
  });

  it('holds the footer shape while the session resolves', () => {
    render();
    // Not `null` while loading: an identity that appears after a beat moves the
    // sidebar's footer, and the sign-out behind it, under the pointer.
    expect(container.querySelector('[data-slot="skeleton"]')).not.toBeNull();
    expect(container.querySelector('#sign-out')).toBeNull();
  });
});

describe('the resizable sidebar', () => {
  const handle = () =>
    container.querySelector<HTMLElement>('[role="separator"][aria-label="Sidebar width"]');
  const wrapper = () => container.querySelector<HTMLElement>('[data-slot="sidebar-wrapper"]');

  beforeEach(() => localStorage.clear());

  it('offers a width handle where the sidebar is open', () => {
    pathname.mockReturnValue('/history');
    render();
    expect(handle()?.getAttribute('aria-valuenow')).toBe('256');
    expect(wrapper()?.style.getPropertyValue('--sidebar-width')).toBe('256px');
  });

  it('widens from the keyboard and remembers the width', () => {
    pathname.mockReturnValue('/history');
    render();
    act(() => {
      handle()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    });
    expect(handle()?.getAttribute('aria-valuenow')).toBe('272');
    expect(wrapper()?.style.getPropertyValue('--sidebar-width')).toBe('272px');
    expect(localStorage.getItem('chatofy.sidebar-width')).toBe('272');
  });

  it('starts from a remembered width', () => {
    localStorage.setItem('chatofy.sidebar-width', '320');
    pathname.mockReturnValue('/history');
    render();
    expect(wrapper()?.style.getPropertyValue('--sidebar-width')).toBe('320px');
  });

  it('has no handle on the icon rail', () => {
    render(undefined, false);
    expect(handle()).toBeNull();
  });
});

describe('the breadcrumb', () => {
  const h1s = () => [...container.querySelectorAll('h1')];
  const crumbs = () =>
    [
      ...container.querySelectorAll('nav[aria-label="Breadcrumb"] li[data-slot="breadcrumb-item"]'),
    ].map((li) => li.textContent);

  beforeEach(() => localStorage.clear());

  it.each([
    ['/translate/one-way', ['Translate', 'One-way translation']],
    ['/history', ['Library', 'History']],
    ['/history/abc', ['Library', 'History']],
    ['/glossary', ['Library', 'Glossary']],
    ['/settings/appearance', ['Settings', 'Appearance']],
    ['/settings/profile', ['Settings', 'Profile']],
  ])('reads %s as group › item, ending on the one h1', (route, trail) => {
    pathname.mockReturnValue(route);
    render();
    expect(crumbs()).toEqual(trail);
    expect(h1s().map((h) => h.textContent)).toEqual([trail.at(-1)]);
    expect(h1s()[0]?.closest('nav')?.getAttribute('aria-label')).toBe('Breadcrumb');
    expect(h1s()[0]?.getAttribute('aria-current')).toBe('page');
  });

  it('draws no page header in the content column any more', () => {
    pathname.mockReturnValue('/glossary');
    render();
    expect(container.querySelector('main header')).toBeNull();
  });

  it('renders no trail on a route under no item, rather than a guess', () => {
    pathname.mockReturnValue('/somewhere');
    render();
    expect(container.querySelector('nav[aria-label="Breadcrumb"]')).toBeNull();
  });
});

describe('the topbar slots', () => {
  it('lets a page append its own crumb, which becomes the h1', () => {
    pathname.mockReturnValue('/history/abc');
    render(<TopbarCrumb>Client call</TopbarCrumb>);

    const headings = [...container.querySelectorAll('h1')];
    expect(headings.map((h) => h.textContent)).toEqual(['Client call']);
    // The item before it turns into the way back.
    const back = container.querySelector('nav[aria-label="Breadcrumb"] a[href="/history"]');
    expect(back?.textContent).toBe('History');
  });

  it('drops the crumb with the page that set it', () => {
    pathname.mockReturnValue('/history/abc');
    render(<TopbarCrumb>Client call</TopbarCrumb>);
    act(() =>
      root?.render(
        <LocaleProvider>
          <AppChrome>
            <p>page</p>
          </AppChrome>
        </LocaleProvider>,
      ),
    );
    expect([...container.querySelectorAll('h1')].map((h) => h.textContent)).toEqual(['History']);
  });

  it("renders a page's actions in the topbar, keeping the page's state", () => {
    function Page() {
      const [count, setCount] = React.useState(0);
      return (
        <TopbarActions>
          <button type="button" onClick={() => setCount((n) => n + 1)}>
            Pressed {count}
          </button>
        </TopbarActions>
      );
    }
    pathname.mockReturnValue('/glossary');
    render(<Page />);

    const slot = container.querySelector('[data-slot="topbar-actions"]');
    const button = slot?.querySelector('button');
    expect(button?.textContent).toBe('Pressed 0');
    act(() => button?.click());
    expect(slot?.querySelector('button')?.textContent).toBe('Pressed 1');
  });
});

describe('the mobile tab bar', () => {
  const bar = () => container.querySelector('[data-slot="mobile-tab-bar"]');
  const tab = (label: string) =>
    [...(bar()?.querySelectorAll('a, button') ?? [])].find((el) => el.textContent === label);

  beforeEach(() => localStorage.clear());

  it('offers four tabs and marks the current one', () => {
    pathname.mockReturnValue('/history/abc');
    render();
    expect(bar()?.getAttribute('aria-label')).toBe('Main');
    expect([...(bar()?.querySelectorAll('li') ?? [])].map((li) => li.textContent)).toEqual([
      'Translate',
      'Meetings',
      'History',
      'More',
    ]);
    const current = [...(bar()?.querySelectorAll('[aria-current="page"]') ?? [])];
    expect(current.map((el) => el.textContent)).toEqual(['History']);
    // Hidden from md, and the content is padded by its height below it.
    expect(bar()?.className).toContain('md:hidden');
    expect(container.querySelector('#main')?.className).toContain('max-md:pb-');
  });

  it('marks More as current on the routes it covers, for assistive tech too', () => {
    for (const path of ['/glossary', '/settings/profile']) {
      pathname.mockReturnValue(path);
      render();
      const current = [...(bar()?.querySelectorAll('[aria-current="page"]') ?? [])];
      expect(
        current.map((el) => el.textContent),
        path,
      ).toEqual(['More']);
      act(() => root?.unmount());
      root = undefined;
    }
    pathname.mockReturnValue('/history');
    render();
    expect(tab('More')?.hasAttribute('aria-current')).toBe(false);
  });

  it('opens one-way from Translate until the reader has used two-way', () => {
    pathname.mockReturnValue('/history');
    render();
    expect(tab('Translate')?.getAttribute('href')).toBe('/translate/one-way');
    act(() => root?.unmount());

    pathname.mockReturnValue('/translate/two-way');
    render();
    expect(localStorage.getItem('chatofy.translate-mode')).toBe('/translate/two-way');
    expect(tab('Translate')?.getAttribute('href')).toBe('/translate/two-way');
    expect(tab('Translate')?.getAttribute('aria-current')).toBe('page');
  });

  it('falls back to one-way when storage refuses to be read', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    pathname.mockReturnValue('/history');
    render();
    expect(tab('Translate')?.getAttribute('href')).toBe('/translate/one-way');
    vi.restoreAllMocks();
  });

  it('steps aside in the conference room, which owns the screen', () => {
    pathname.mockReturnValue('/conference/room-1');
    render();
    expect(bar()).toBeNull();
    expect(container.querySelector('#main')?.className).not.toContain('max-md:pb-');
  });

  it('steps aside while a screen asks for immersion, and comes back after', () => {
    function Screen({ listening }: { listening: boolean }) {
      useImmersiveChrome(listening);
      return <p>translator</p>;
    }
    const draw = (listening: boolean) =>
      act(() =>
        root?.render(
          <LocaleProvider>
            <AppChrome>
              <Screen listening={listening} />
            </AppChrome>
          </LocaleProvider>,
        ),
      );
    render(<Screen listening />);
    expect(bar()).toBeNull();
    draw(false);
    expect(bar()).not.toBeNull();
    draw(true);
    expect(bar()).toBeNull();
  });
});

describe('the paned History frame', () => {
  const main = () => container.querySelector<HTMLElement>('#main');

  it.each(['/history', '/history/abc'])(
    'pins %s to the viewport from lg, so its panes scroll and the page does not',
    (route) => {
      pathname.mockReturnValue(route);
      render();
      expect(main()?.className).toContain('lg:h-svh');
      expect(main()?.className).toContain('lg:overflow-hidden');
      // The panes draw their own padding and measure; the content column's would
      // inset the list from the sidebar it sits against.
      expect(container.querySelector('main .max-w-6xl, main .max-w-2xl')).toBeNull();
    },
  );

  it('leaves every other route to scroll as a page', () => {
    pathname.mockReturnValue('/glossary');
    render();
    expect(main()?.className).not.toContain('lg:h-svh');
  });

  it('does not let a sibling path borrow the frame', () => {
    pathname.mockReturnValue('/historyx');
    render();
    expect(main()?.className).not.toContain('lg:h-svh');
  });
});
