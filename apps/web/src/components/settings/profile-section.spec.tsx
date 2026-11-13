// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClientError } from '@chatofy/api-client';
import { en } from '@chatofy/i18n';

/**
 * Settings › Profile and its Change photo dialog: what they must get right, and
 * what they deliberately cannot test.
 *
 * The four failure messages are four because the next step differs each time —
 * pick another file, pick a smaller one, retry, or tell whoever runs the server.
 * A single "upload failed" would collapse them, and the regression would read
 * as a copy simplification rather than a bug.
 *
 * There is NO spec here asserting the produced blob is 128x128 or "not
 * squashed". `vitest.config.mts` sets `environment: 'node'` and the only DOM
 * available is happy-dom — no canvas raster backend, no `createImageBitmap`, no
 * working `toBlob`, and no canvas package in the dependency tree. Such a spec
 * could only assert against its own stubs. The geometry is proved by
 * `avatar-crop-geometry.spec.ts`, which is a pure function precisely so it can be.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Typed so the mocked module keeps a real signature — an untyped `vi.fn()` here
 *  makes every call site an `any`, which the lint rules reject and which would
 *  also stop the compiler catching a contract change. */
type Userish = { avatarUrl: string | null };
const uploadAvatar = vi.fn<(body: { image: string }) => Promise<Userish>>();
const deleteAvatar = vi.fn<() => Promise<Userish>>();
const update = vi.fn<() => Promise<null>>(() => Promise.resolve(null));
const resizeAvatar = vi.fn<(file: File) => Promise<string>>();

vi.mock('@/clients/api-client', () => ({
  uploadAvatar: (body: { image: string }) => uploadAvatar(body),
  deleteAvatar: () => deleteAvatar(),
}));
vi.mock('next-auth/react', () => ({ useSession: () => ({ update }) }));
const notify = vi.hoisted(() => ({
  success: vi.fn<(message: string, options?: { id?: string }) => void>(),
  error: vi.fn<(message: string, options?: { id?: string; retry?: () => void }) => void>(),
  dismiss: vi.fn(),
}));
vi.mock('@/lib/notify', () => ({ notify }));
vi.mock('@/lib/resize-avatar', async () => {
  const actual = await vi.importActual<typeof import('@/lib/resize-avatar')>('@/lib/resize-avatar');
  return { ...actual, resizeAvatar: (file: File) => resizeAvatar(file) };
});

const { ProfileSection } = await import('./profile-section');
const { LocaleProvider } = await import('@/i18n/provider');
const { AvatarResizeError } = await import('@/lib/resize-avatar');

let root: Root | undefined;
let container: HTMLElement;

beforeEach(() => {
  vi.clearAllMocks();
  resizeAvatar.mockResolvedValue('cmF3');
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  container.remove();
});

async function render(
  avatarUrl: string | null | undefined,
  sessionImage?: string | null,
  memberSince?: string | null,
) {
  await act(async () => {
    root = createRoot(container);
    root.render(
      <LocaleProvider>
        <ProfileSection
          name="Quang Anh"
          email="a@b.co"
          avatarUrl={avatarUrl}
          sessionImage={sessionImage}
          memberSince={memberSince}
        />
      </LocaleProvider>,
    );
    await Promise.resolve();
  });
}

/** The open dialog, which portals to `document.body`. */
const dialog = () => document.querySelector<HTMLElement>('[role=dialog]');

const buttonIn = (scope: ParentNode | null, text: string) =>
  [...(scope?.querySelectorAll('button') ?? [])].find((b) => b.textContent?.includes(text));

async function openDialog() {
  await act(async () => {
    document.querySelector<HTMLButtonElement>('#photo-change-open')!.click();
    await Promise.resolve();
  });
  expect(dialog()).not.toBeNull();
}

/** Drives the hidden file input "Choose an image" clicks for the user. */
async function pickFile() {
  const input = document.querySelector('[data-photo-input]') as HTMLInputElement;
  Object.defineProperty(input, 'files', {
    configurable: true,
    value: [new File(['x'], 'a.png', { type: 'image/png' })],
  });
  await act(async () => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
    for (let i = 0; i < 4; i += 1) await Promise.resolve();
  });
}

describe('the profile rows', () => {
  it('shows who this is in the header, then name and email as rows', async () => {
    await render(null, null, 'January 9, 2026');
    const header = container.querySelector('[data-account-header]');
    expect(header?.textContent).toContain('Quang Anh');
    expect(header?.textContent).toContain('a@b.co');
    expect(header?.textContent).toContain(`${en['web.account.memberSince']} January 9, 2026`);
    // Change photo belongs to the photo it changes.
    expect(header?.querySelector('#photo-change-open')).not.toBeNull();
    const box = container.querySelector('[data-slot="settings-section-box"]');
    expect(container.querySelector('[data-slot="settings-section"] h3')?.textContent).toBe(
      en['web.settings.profile'],
    );
    expect(box?.textContent).toContain('Quang Anh');
    expect(box?.textContent).toContain('a@b.co');
  });

  it('says the details did not load rather than drawing a date that never came', async () => {
    await render(null, null, null);
    expect(container.textContent).toContain('Could not load your account details');
  });

  it('falls back to initials rather than a broken image', async () => {
    await render(null);
    expect(container.textContent).toContain('QA');
  });

  it('spends no accent on the page: Change photo is outline', async () => {
    await render('https://cdn.example.com/a/k.webp');
    expect(container.querySelector('.bg-primary')).toBeNull();
    expect(document.querySelector('#photo-change-open')?.getAttribute('data-variant')).toBe(
      'outline',
    );
  });
});

describe('the Change photo dialog', () => {
  it('opens from the row and offers Remove only when there is a photo', async () => {
    await render('https://cdn.example.com/avatars/u/k.webp');
    await openDialog();
    expect(buttonIn(dialog(), 'Remove photo')).toBeDefined();
    expect(buttonIn(dialog(), 'Choose an image')).toBeDefined();
  });

  it('hides Remove when there is no photo, so nothing offers to delete nothing', async () => {
    await render(null);
    await openDialog();
    expect(buttonIn(dialog(), 'Remove photo')).toBeUndefined();
  });

  it('uploads a picked file, closes, confirms with a toast and tells the sidebar to re-read', async () => {
    uploadAvatar.mockResolvedValue({ avatarUrl: 'https://cdn.example.com/a/new.webp' });
    await render(null);
    await openDialog();
    await pickFile();

    expect(uploadAvatar).toHaveBeenCalledWith({ image: 'cmF3' });
    expect(dialog()).toBeNull();
    expect(notify.success).toHaveBeenCalledWith('Photo updated', { id: 'photo-change' });
    // An EMPTY OBJECT, not no argument: next-auth POSTs only when `update` is given
    // something, and only the POST carries `trigger: 'update'` into the callback
    // that re-reads the avatar.
    expect(update).toHaveBeenCalledWith({});
    await openDialog();
    expect(buttonIn(dialog(), 'Remove photo')).toBeDefined();
  });

  it('removes the photo, closes, and confirms with a toast', async () => {
    deleteAvatar.mockResolvedValue({ avatarUrl: null });
    await render('https://cdn.example.com/a/k.webp');
    await openDialog();
    await act(async () => {
      buttonIn(dialog(), 'Remove photo')!.click();
      for (let i = 0; i < 4; i += 1) await Promise.resolve();
    });

    expect(deleteAvatar).toHaveBeenCalled();
    expect(dialog()).toBeNull();
    expect(notify.success).toHaveBeenCalledWith('Photo removed', { id: 'photo-change' });
  });

  it('reports a server failure as a toast with Retry, keeping the dialog and the photo', async () => {
    uploadAvatar.mockRejectedValue(new Error('nope'));
    await render('https://cdn.example.com/a/k.webp');
    await openDialog();
    await pickFile();

    expect(dialog()).not.toBeNull();
    expect(buttonIn(dialog(), 'Remove photo')).toBeDefined();
    const [message, options] = notify.error.mock.calls[0]!;
    expect(message).toContain('Try again');

    uploadAvatar.mockResolvedValue({ avatarUrl: 'https://cdn.example.com/a/new.webp' });
    await act(async () => {
      options?.retry?.();
      for (let i = 0; i < 4; i += 1) await Promise.resolve();
    });
    expect(uploadAvatar).toHaveBeenCalledTimes(2);
    expect(dialog()).toBeNull();
  });

  it('says a non-image is a non-image, inline, not "upload failed"', async () => {
    resizeAvatar.mockRejectedValue(new AvatarResizeError('not-an-image'));
    await render(null);
    await openDialog();
    await pickFile();

    expect(dialog()?.querySelector('[role=alert]')?.textContent).toContain('not an image');
    expect(notify.error).not.toHaveBeenCalled();
  });

  it('says the image is too large, inline, when the API answers 400', async () => {
    uploadAvatar.mockRejectedValue(
      new ApiClientError({ code: 'VALIDATION_FAILED', message: 'too big' }, 400),
    );
    await render(null);
    await openDialog();
    await pickFile();

    expect(dialog()?.querySelector('[role=alert]')?.textContent).toContain('too large');
  });

  it('says the server has no storage when the API answers 409', async () => {
    // A 409, not a 5xx, is what carries this message at all — the API's error
    // filter rewrites every 5xx body to 'Internal server error'.
    uploadAvatar.mockRejectedValue(
      new ApiClientError({ code: 'CONFLICT', message: 'Avatar storage is not configured' }, 409),
    );
    await render(null);
    await openDialog();
    await pickFile();

    expect(notify.error.mock.calls[0]?.[0]).toContain('nothing was changed');
  });
});

/**
 * Before `GET /auth/me` answers — and if it never does — the session cookie is the
 * only thing that knows there is a photo at all.
 */
describe('the profile before the profile lands', () => {
  it('offers Remove straight away from the session photo', async () => {
    await render(undefined, 'https://cdn.example/from-session.png');
    await openDialog();
    expect(buttonIn(dialog(), 'Remove photo')).toBeDefined();
  });

  it('offers no Remove when neither source has a photo', async () => {
    await render(undefined, null);
    await openDialog();
    expect(buttonIn(dialog(), 'Remove photo')).toBeUndefined();
  });
});
