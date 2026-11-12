// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Settings › Profile with its data: the session paints the identity at once, and a
 * profile lookup that fails is reported, never acted on.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const me = vi.fn<() => Promise<unknown>>();
vi.mock('@/clients/api-client', () => ({
  getMe: () => me(),
  uploadAvatar: vi.fn(),
  deleteAvatar: vi.fn(),
}));
vi.mock('next-auth/react', () => ({
  useSession: () => ({
    data: { user: { name: 'Quang Anh', email: 'a@b.co' } },
    status: 'authenticated',
    update: vi.fn(),
  }),
}));

const { ProfileSettings } = await import('./profile-section');
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
  await act(async () => {
    root = createRoot(container);
    root.render(
      <LocaleProvider>
        <ProfileSettings />
      </LocaleProvider>,
    );
    await Promise.resolve();
  });
}

describe('ProfileSettings', () => {
  it('shows identity from the session before the profile lands', async () => {
    me.mockReturnValue(new Promise(() => {}));
    await render();
    expect(container.textContent).toContain('a@b.co');
    expect(container.textContent).toContain('Quang Anh');
  });

  it('adds the join date once the profile answers', async () => {
    me.mockResolvedValue({
      id: 'u1',
      email: 'a@b.co',
      name: 'Quang Anh',
      avatarUrl: null,
      createdAt: '2026-01-09T12:00:00.000Z',
    });
    await render();
    expect(container.textContent).toMatch(/2026/);
  });

  it('survives a profile lookup that fails, without signing anyone out', async () => {
    me.mockRejectedValue(new Error('401'));
    await render();
    // Reporting the failure is this page's job; acting on a 401 belongs to
    // `use-auth-recovery.ts`, which the socket and HTTP paths already run.
    expect(container.textContent).toContain('a@b.co');
    expect(container.textContent).toContain('Could not load your account details');
  });
});
