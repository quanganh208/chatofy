// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The one action a returning visitor should see, and where it goes.
 *
 * Offering "Sign in" and "Get started" to someone who is already signed in is the small
 * tell that a marketing page was written as if nobody ever comes back. The session is
 * read on the SERVER so the correct pair is in the first byte — a client check would
 * paint the signed-out pair and swap it after hydration, on the page most likely to be a
 * first impression.
 *
 * The destination matters as much as the count. It is `/dashboard`, not `/translate`:
 * the hub is what a returning visitor wants, and it is also where `DEFAULT_NEXT` sends
 * them, so the two ways back into the app agree.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const session = vi.fn<() => Promise<unknown>>();
vi.mock('@/../auth', () => ({ auth: () => session() }));

// `getT` resolves the locale from a cookie, which only exists inside a request. What
// this spec is about is which links the header renders, so the dictionary is handed
// over directly rather than resolved.
vi.mock('@/i18n/server', async () => {
  const { createTranslator, en } = await import('@chatofy/i18n');
  return { getT: () => Promise.resolve(createTranslator(en)) };
});

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

// The language switcher asks whether there is a row to write `User.locale` to. This
// spec renders the header outside a `SessionProvider`, which the real tree always has.
vi.mock('next-auth/react', () => ({ useSession: () => ({ status: 'unauthenticated' }) }));

const { MarketingHeader } = await import('./marketing-header');
const { LocaleProvider } = await import('@/i18n/provider');

let root: Root | undefined;
let container: HTMLElement;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  container.remove();
});

async function render() {
  const element = await MarketingHeader();
  await act(async () => {
    root = createRoot(container);
    root.render(<LocaleProvider>{element}</LocaleProvider>);
    await Promise.resolve();
  });
  return [...container.querySelectorAll('a[href]')].map((a) => a.getAttribute('href'));
}

describe('the marketing header', () => {
  it('offers both ways in to a visitor who is signed out', async () => {
    session.mockResolvedValue(null);
    const hrefs = await render();

    expect(hrefs).toContain('/login');
    expect(hrefs).toContain('/register');
    expect(hrefs).not.toContain('/dashboard');
  });

  it('offers one way back to a visitor who is signed in, and it is the hub', async () => {
    session.mockResolvedValue({ user: { email: 'a@b.co' } });
    const hrefs = await render();

    expect(hrefs).toContain('/dashboard');
    expect(hrefs).not.toContain('/login');
    expect(hrefs).not.toContain('/register');
  });

  it('links three sections, and only sections that exist', async () => {
    session.mockResolvedValue(null);
    const hrefs = await render();

    // Anchors and their targets land together — `Section` owns the ids. An anchor to a
    // missing id fails silently and only for the person who clicked it.
    expect(hrefs.filter((href) => href?.startsWith('#'))).toEqual([
      '#how-it-works',
      '#on-your-machine',
      '#where-it-runs',
    ]);
  });
});
