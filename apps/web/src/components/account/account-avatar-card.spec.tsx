// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClientError } from '@chatofy/api-client';

/**
 * What this card must get right, and what it deliberately cannot test.
 *
 * The four failure messages are four because the next step differs each time —
 * pick another file, pick a smaller one, retry, or tell whoever runs the server.
 * A single "upload failed" would collapse them, and the regression would read
 * as a copy simplification rather than a bug.
 *
 * There is NO spec here asserting the produced blob is 128x128 or "not
 * squashed". `vitest.config.ts` sets `environment: 'node'` and the only DOM
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
vi.mock('@/lib/resize-avatar', async () => {
  const actual = await vi.importActual<typeof import('@/lib/resize-avatar')>('@/lib/resize-avatar');
  return { ...actual, resizeAvatar: (file: File) => resizeAvatar(file) };
});

const { AccountAvatarCard } = await import('@/components/account/account-avatar-card');
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

async function render(avatarUrl: string | null) {
  await act(async () => {
    root = createRoot(container);
    root.render(
      <LocaleProvider>
        <AccountAvatarCard name="Quang Anh" email="a@b.co" avatarUrl={avatarUrl} />
      </LocaleProvider>,
    );
    await Promise.resolve();
  });
}

const buttonSaying = (text: string) =>
  [...container.querySelectorAll('button')].find((b) => b.textContent?.includes(text));

/** Drives the hidden file input the Change button clicks for the user. */
async function pickFile() {
  const input = container.querySelector('input[type=file]') as HTMLInputElement;
  Object.defineProperty(input, 'files', {
    configurable: true,
    value: [new File(['x'], 'a.png', { type: 'image/png' })],
  });
  await act(async () => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await Promise.resolve();
  });
}

describe('the avatar card', () => {
  it('renders the image when there is one', async () => {
    await render('https://cdn.example.com/avatars/u/k.webp');
    // Radix mounts AvatarImage only once the URL loads, so the assertion is on
    // what the card was GIVEN rather than on Radix's loading state machine.
    expect(buttonSaying('Remove photo')).toBeDefined();
  });

  it('hides Remove when there is no photo, so nothing offers to delete nothing', async () => {
    await render(null);
    expect(buttonSaying('Remove photo')).toBeUndefined();
    expect(buttonSaying('Change photo')).toBeDefined();
  });

  it('falls back to initials rather than a broken image', async () => {
    await render(null);
    expect(container.textContent).toContain('QA');
  });

  it('uploads a picked file and tells the sidebar to re-read', async () => {
    uploadAvatar.mockResolvedValue({ avatarUrl: 'https://cdn.example.com/a/new.webp' });
    await render(null);
    await pickFile();

    expect(uploadAvatar).toHaveBeenCalledWith({ image: 'cmF3' });
    // No argument: `auth.ts` ignores whatever the browser sends and re-reads the
    // value from the API, so passing one would be a value nothing consumes.
    expect(update).toHaveBeenCalledWith();
    expect(buttonSaying('Remove photo')).toBeDefined();
  });

  it('removes the photo and hides its own control afterwards', async () => {
    deleteAvatar.mockResolvedValue({ avatarUrl: null });
    await render('https://cdn.example.com/a/k.webp');

    await act(async () => {
      buttonSaying('Remove photo')!.click();
      await Promise.resolve();
    });

    expect(deleteAvatar).toHaveBeenCalled();
    expect(buttonSaying('Remove photo')).toBeUndefined();
  });

  it('keeps the previous photo on screen when a change fails', async () => {
    // A failed change changed nothing; blanking the image would claim otherwise.
    uploadAvatar.mockRejectedValue(new Error('nope'));
    await render('https://cdn.example.com/a/k.webp');
    await pickFile();

    expect(buttonSaying('Remove photo')).toBeDefined();
    expect(container.querySelector('[role=alert]')?.textContent).toContain('Try again');
  });

  it('says a non-image is a non-image, not "upload failed"', async () => {
    resizeAvatar.mockRejectedValue(new AvatarResizeError('not-an-image'));
    await render(null);
    await pickFile();

    expect(container.querySelector('[role=alert]')?.textContent).toContain('not an image');
  });

  it('says the server has no storage when the API answers 409', async () => {
    // A 409, not a 5xx, is what carries this message at all — the API's error
    // filter rewrites every 5xx body to 'Internal server error'.
    uploadAvatar.mockRejectedValue(
      new ApiClientError({ code: 'CONFLICT', message: 'Avatar storage is not configured' }, 409),
    );
    await render(null);
    await pickFile();

    expect(container.querySelector('[role=alert]')?.textContent).toContain('nothing was changed');
  });

  it('says the image is too large when the API answers 400', async () => {
    uploadAvatar.mockRejectedValue(
      new ApiClientError({ code: 'VALIDATION_FAILED', message: 'too big' }, 400),
    );
    await render(null);
    await pickFile();

    expect(container.querySelector('[role=alert]')?.textContent).toContain('too large');
  });

  it('keeps the screen free of accent-filled controls', async () => {
    // `/account` has zero bg-primary controls and stays that way: changing a
    // photo is not what this screen is for.
    await render('https://cdn.example.com/a/k.webp');
    expect(container.querySelector('.bg-primary')).toBeNull();
  });
});
