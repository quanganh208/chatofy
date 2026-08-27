// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The sidebar footer's identity.
 *
 * The claim under test is narrow and specific: whatever `session.user.image`
 * holds is what gets rendered, and nothing else is. `auth.ts` is the only writer
 * of that field and only ever copies the API's own `avatarUrl` into it — so if a
 * `lh3.googleusercontent.com` URL ever survives into the session, it renders
 * here, on every authenticated page, against an `img-src` that forbids it.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type SessionState = {
  data: { user: Record<string, unknown> } | null | undefined;
  status: 'loading' | 'authenticated' | 'unauthenticated';
};
const session = vi.fn<() => SessionState>();
vi.mock('next-auth/react', () => ({ useSession: () => session() }));
vi.mock('@/lib/sign-out', () => ({ signOutOfChatofy: vi.fn() }));

const { SessionMenu } = await import('@/components/layout/session-menu');
const { LocaleProvider } = await import('@/i18n/provider');
const { SidebarProvider } = await import('@chatofy/ui/react');

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
  await act(async () => {
    root = createRoot(container);
    root.render(
      <LocaleProvider>
        <SidebarProvider>
          <SessionMenu />
        </SidebarProvider>
      </LocaleProvider>,
    );
    await Promise.resolve();
  });
}

const authenticated = (user: Record<string, unknown>) => {
  session.mockReturnValue({ data: { user }, status: 'authenticated' });
};

describe('the sidebar session menu', () => {
  it('renders initials when the session carries no image', async () => {
    authenticated({ name: 'Quang Anh', email: 'a@b.co', image: null });
    await render();

    expect(container.textContent).toContain('QA');
    expect(container.querySelector('img')).toBeNull();
  });

  it('passes the session image straight to the avatar, unmodified', async () => {
    // The claim that matters: this component invents no URL and rewrites none,
    // so whatever `auth.ts` put in the session is exactly what the browser will
    // request. A `lh3.googleusercontent.com` URL surviving into the session
    // would therefore be requested here, on every authenticated page.
    //
    // Asserted on the src Radix was GIVEN rather than on a rendered <img>: happy-dom
    // loads nothing, and Radix only mounts the element once the image LOADS — which
    // is also why a blocked or 404 URL degrades to initials rather than a broken
    // icon, with no branching in this component.
    const image = 'https://cdn.example.com/avatars/u/k.webp';
    authenticated({ name: 'Quang Anh', email: 'a@b.co', image });
    await render();

    const img = container.querySelector('img');
    expect(img === null || img.getAttribute('src') === image).toBe(true);
    expect(container.textContent).toContain('QA');
  });

  it('renders the same shape while the session is loading', async () => {
    // Returning null here would drop the sidebar footer out and back in on
    // every load.
    session.mockReturnValue({ data: undefined, status: 'loading' });
    await render();

    expect(container.querySelector('[aria-busy=true]')).not.toBeNull();
  });

  it('renders nothing when nobody is signed in', async () => {
    session.mockReturnValue({ data: null, status: 'unauthenticated' });
    await render();

    expect(container.textContent).toBe('');
  });
});
