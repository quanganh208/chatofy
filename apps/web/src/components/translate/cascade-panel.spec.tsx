// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UseStreamingTranslate } from '@/hooks/use-streaming-translate';
import type { UseConversationSave } from '@/hooks/use-conversation-save';
import { CascadePanel } from './cascade-panel';
import { LocaleProvider } from '@/i18n/provider';
import { ChromeSlotsProvider, useChromeSlots } from '@/components/layout/chrome-slots';
import {
  DEFAULT_TRANSLATE_SETTINGS,
  languageVoicePatch,
  type ConversationMode,
  type TranslateSettings,
} from '@/lib/translate-settings';
import { en } from '@chatofy/i18n';

/**
 * What a failed save is allowed to take away from the screen.
 *
 * Minutes are drawn from the STORED conversation, so a conversation that never
 * landed has nothing to summarize and the panel goes. A conversation that DID
 * land keeps it: the failure after that belongs to an edit, and the row it edits
 * is still in the database — with a summary possibly already on screen, drawn
 * from it.
 */

const useStreamingTranslate = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/use-streaming-translate', () => ({ useStreamingTranslate }));

const useConversationSave = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/use-conversation-save', () => ({ useConversationSave }));

// Outcomes are toasts now; the host is not mounted here, so the calls are the claim.
const notify = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn<(message: string, options?: { id?: string; retry?: () => void }) => void>(),
  info: vi.fn(),
  dismiss: vi.fn(),
}));
vi.mock('@/lib/notify', () => ({ notify }));

// The readiness banner probes the service, and an unmocked `checkHealth` is a real
// `fetch` at the API base URL — a suite that reaches the network, passes or fails on
// whether a dev server happens to be up, and settles state outside `act`.
const checkHealth = vi.hoisted(() => vi.fn<() => Promise<void>>());
// The recording upload. Mocked rather than left real for the same reason
// `checkHealth` is: `useConversationAudioUpload` is the real hook here, and an
// unmocked call is `undefined`, not a network request that happens to fail.
const uploadConversationAudio = vi.hoisted(() => vi.fn<() => Promise<void>>());
// The AI Context library. The panel resolves the stored selection into hints
// itself, because `client.session.start` fires once per TURN and a server that
// looked the id up would read the row on every one of them.
const listTranslationContexts = vi.hoisted(() => vi.fn<() => Promise<unknown>>());
// The banner's balance read. Never answering keeps it silent — a balance it has
// not read is not a problem to report — without a promise settling outside `act`.
vi.mock('@/clients/api-client', () => ({
  getCreditBalance: () => new Promise(() => {}),
  checkHealth: () => checkHealth(),
  uploadConversationAudio: (...args: unknown[]) => uploadConversationAudio(...(args as [])),
  listTranslationContexts: () => listTranslationContexts(),
  saveTranslationContext: vi.fn(),
  deleteTranslationContext: vi.fn(),
}));

// The banner reads the browser, not a prop. Without these it reports `unknown`,
// renders nothing, and a test about what it renders would pass on an empty DOM.
type FakePermissionStatus = Pick<PermissionStatus, 'state'> & {
  addEventListener: () => void;
  removeEventListener: () => void;
};
const permissionQuery = vi.fn<() => Promise<FakePermissionStatus>>();
Object.defineProperty(navigator, 'permissions', {
  configurable: true,
  value: { query: () => permissionQuery() },
});
Object.defineProperty(navigator, 'mediaDevices', {
  configurable: true,
  value: {
    enumerateDevices: () => Promise.resolve([{ kind: 'audioinput' }]),
    addEventListener: () => {},
    removeEventListener: () => {},
  },
});

let container: HTMLDivElement;
let root: Root;

/** A finished conversation with one block in it, held at one identity. */
const conversation: UseStreamingTranslate = {
  status: 'idle',
  turns: [
    {
      id: 'seg-a',
      sessionId: 'a',
      speakerRole: 'speaker_a',
      sourceLanguages: ['vi'],
      translations: { en: 'hello' },
      sourceText: 'xin chào',
      audioUrl: null,
      createdAt: '2026-09-03T00:00:00.000Z',
    },
  ],
  liveTurns: [],
  speakers: [],
  attributions: {},
  captures: { a: { openedAt: 1_000, cutForced: false, closedAt: 3_000 } },
  unheard: {},
  displays: {},
  blockTranslations: {},
  stats: {
    totalTurns: 1,
    confirmed: 0,
    automatic: 0,
    pending: 0,
    fallback: 1,
    tapRate: 0,
    suggestions: { confirmedMatching: 0, corrected: 0, unreviewed: 0 },
  },
  addSpeaker: vi.fn(),
  renameSpeaker: vi.fn(),
  removeSpeaker: vi.fn(),
  attributeTurn: vi.fn(),
  unattributeTurn: vi.fn(),
  echoHeard: 0,
  micPaused: false,
  error: null,
  notice: null,
  level: 0,
  conversationId: 'c-1',
  startedAt: '2026-09-03T00:00:00.000Z',
  languagePair: { source: 'vi', target: 'en' },
  twoWayRequested: false,
  languageMode: null,
  languageModes: {},
  // No recording by default: happy-dom has no `MediaRecorder`, so this is also
  // the state a browser without one produces — the transcript half unaffected.
  recording: null,
  recordingStartedAtMs: null,
  pauses: [],
  pausedMs: 0,
  offsetPauses: [],
  start: vi.fn(),
  stop: vi.fn(),
  pause: vi.fn(),
  resume: vi.fn(),
  end: vi.fn(),
  setVolume: vi.fn(),
};

/**
 * The mount starts the readiness probes and the context list; each settles a
 * microtask or two later. Letting them land inside the same `act` keeps their
 * state updates from arriving after it, unwrapped.
 */
async function settleProbes(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

async function render(save: Pick<UseConversationSave, 'saved' | 'failure'>): Promise<void> {
  checkHealth.mockResolvedValue(undefined);
  permissionQuery.mockResolvedValue({
    state: 'granted',
    addEventListener() {},
    removeEventListener() {},
  });
  useStreamingTranslate.mockReturnValue(conversation);
  useConversationSave.mockReturnValue({ ...save, saving: false, retry: vi.fn() });
  await act(async () => {
    root.render(
      <LocaleProvider>
        <CascadePanel
          conversationMode="one-way"
          settings={DEFAULT_TRANSLATE_SETTINGS}
          onChange={vi.fn()}
          getVolume={() => 1}
        />
      </LocaleProvider>,
    );
    await settleProbes();
  });
}

const generateButton = (): HTMLButtonElement | undefined =>
  Array.from(container.querySelectorAll('button')).find((button) =>
    /Generate|Regenerate/.test(button.textContent ?? ''),
  );

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  uploadConversationAudio.mockResolvedValue(undefined);
  // No contexts unless a case seeds them: the picker then renders nothing at all,
  // which is what leaves every case here about the save or the banner unchanged.
  listTranslationContexts.mockResolvedValue({ contexts: [] });
  // Shared across cases, so the hints assertions below would otherwise read the
  // first case's call.
  (conversation.start as ReturnType<typeof vi.fn>).mockClear();
  for (const fn of Object.values(notify)) fn.mockClear();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

describe('CascadePanel', () => {
  it('does not say the same thing twice when a microphone is refused', async () => {
    // A refused microphone calls `stop()` before `onError`, so the session is back
    // to `idle` by the time the error lands and the pre-flight banner is eligible
    // to render again. Both would carry `web.translate.micDenied` — one from
    // `open-microphone.ts`, one from the banner — as two assertive live regions.
    useStreamingTranslate.mockReturnValue({
      ...conversation,
      turns: [],
      error: en['web.translate.micDenied'],
    });
    useConversationSave.mockReturnValue({
      saved: false,
      failure: null,
      saving: false,
      retry: vi.fn(),
    });
    checkHealth.mockResolvedValue(undefined);
    permissionQuery.mockResolvedValue({
      state: 'denied',
      addEventListener() {},
      removeEventListener() {},
    });
    await act(async () => {
      root.render(
        <LocaleProvider>
          <CascadePanel
            conversationMode="one-way"
            settings={DEFAULT_TRANSLATE_SETTINGS}
            onChange={vi.fn()}
            getVolume={() => 1}
          />
        </LocaleProvider>,
      );
      for (let i = 0; i < 5; i += 1) await Promise.resolve();
    });

    // Said once, as the toast about the attempt just made; the pre-flight banner
    // that would say the same sentence stays down.
    const alerts = [...container.querySelectorAll('[role="alert"]')].filter((el) =>
      el.textContent?.includes(en['web.translate.micDenied']),
    );
    expect(alerts, 'the banner repeated the fault').toHaveLength(0);
    const toasts = notify.error.mock.calls.filter(
      ([message]) => message === en['web.translate.micDenied'],
    );
    expect(toasts.length, 'the fault is reported once, by the reactive path').toBe(1);
  });

  it('says credits are low as a readout while the conversation keeps going', async () => {
    useStreamingTranslate.mockReturnValue({
      ...conversation,
      status: 'listening',
      notice: 'About 2 credits left. Translation keeps going until they run out.',
    });
    useConversationSave.mockReturnValue({
      saved: false,
      failure: null,
      saving: false,
      retry: vi.fn(),
    });
    await act(async () => {
      root.render(
        <LocaleProvider>
          <CascadePanel
            conversationMode="one-way"
            settings={DEFAULT_TRANSLATE_SETTINGS}
            onChange={vi.fn()}
            getVolume={() => 1}
          />
        </LocaleProvider>,
      );
      await settleProbes();
    });

    const notice = container.querySelector('[data-conversation-notice]');
    expect(notice?.getAttribute('role')).toBe('status');
    expect(notice?.textContent).toContain('About 2 credits left');
    // A notice is not a failure: no assertive alert says it.
    const alerts = [...container.querySelectorAll('[role="alert"]')].filter((el) =>
      el.textContent?.includes('credits left'),
    );
    expect(alerts).toHaveLength(0);
  });

  it('keeps the minutes panel when a stored conversation fails a later edit', async () => {
    // The conversation was written; renaming a speaker afterwards was refused
    // for good. Nothing about that unstores the row, so the summary stays
    // reachable — and one already generated stays on screen.
    await render({ saved: true, failure: 'terminal' });

    expect(container.textContent).toContain('Meeting minutes');
    expect(generateButton()?.disabled).toBe(false);
  });

  it('drops the minutes panel when nothing was stored and no retry can change that', async () => {
    await render({ saved: false, failure: 'terminal' });

    expect(container.textContent).not.toContain('Meeting minutes');
  });

  it('keeps the minutes panel while a failed save can still be retried', async () => {
    await render({ saved: false, failure: 'retryable' });

    expect(container.textContent).toContain('Meeting minutes');
    // Not yet stored, so there is nothing to summarize from until the retry
    // lands — the panel says so rather than disappearing.
    expect(generateButton()?.disabled).toBe(true);
  });

  it('saves the pair the conversation was captured with, not a later swap', async () => {
    // The language pickers stay live once `running` is false, so a reader can
    // swap it between End and pressing Start again for the NEXT conversation.
    // The already-finished one on screen must still be stored under the
    // language it was actually spoken in.
    checkHealth.mockResolvedValue(undefined);
    permissionQuery.mockResolvedValue({
      state: 'granted',
      addEventListener() {},
      removeEventListener() {},
    });
    useStreamingTranslate.mockReturnValue({
      ...conversation,
      languagePair: { source: 'vi', target: 'en' },
    });
    useConversationSave.mockReturnValue({
      saved: true,
      failure: null,
      saving: false,
      retry: vi.fn(),
    });
    await act(async () => {
      root.render(
        <LocaleProvider>
          <CascadePanel
            conversationMode="one-way"
            settings={{
              ...DEFAULT_TRANSLATE_SETTINGS,
              languagePair: { source: 'en', target: 'vi' },
            }}
            onChange={vi.fn()}
            getVolume={() => 1}
          />
        </LocaleProvider>,
      );
      await settleProbes();
    });

    expect(useConversationSave).toHaveBeenCalledWith(
      expect.objectContaining({ languagePair: { source: 'vi', target: 'en' } }),
    );
  });
});

/**
 * The recording's own failure toast — separate from the transcript's — and the
 * upload in flight said on the page, so pressing Retry has something to show for
 * itself instead of nothing until it fails again.
 */
describe('the recording upload toast', () => {
  const recordingConversation: UseStreamingTranslate = {
    ...conversation,
    recording: {
      blob: new Blob(['audio']),
      startedAtMs: Date.parse(conversation.startedAt as string) + 500,
      durationMs: 5_000,
    },
  };

  async function renderWithRecording(
    save: Pick<UseConversationSave, 'saved' | 'failure'>,
  ): Promise<void> {
    checkHealth.mockResolvedValue(undefined);
    permissionQuery.mockResolvedValue({
      state: 'granted',
      addEventListener() {},
      removeEventListener() {},
    });
    useStreamingTranslate.mockReturnValue(recordingConversation);
    useConversationSave.mockReturnValue({ ...save, saving: false, retry: vi.fn() });
    await act(async () => {
      root.render(
        <LocaleProvider>
          <CascadePanel
            conversationMode="one-way"
            settings={DEFAULT_TRANSLATE_SETTINGS}
            onChange={vi.fn()}
            getVolume={() => 1}
          />
        </LocaleProvider>,
      );
      await settleProbes();
    });
  }

  it('says the failure as a toast with Retry, and the retry in flight on the page', async () => {
    uploadConversationAudio.mockRejectedValueOnce(new Error('down'));
    await renderWithRecording({ saved: true, failure: null });
    // The automatic upload the effect fires on mount: the fetch starts, the
    // rejection settles it, the alert renders on the render after that.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const failed = notify.error.mock.calls.find(
      ([message]) => message === en['web.translate.recordingFailedRetryable'],
    );
    expect(failed, 'the failure was not said').toBeDefined();
    const retry = failed?.[1]?.retry;
    expect(retry, 'no Retry for a retryable recording failure').toBeTypeOf('function');

    // A resend that does not resolve on its own tick, so the transient
    // "uploading" frame is actually observable rather than settling in the same
    // microtask the click itself ran in.
    let resolveResend: () => void = () => {};
    uploadConversationAudio.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveResend = resolve;
        }),
    );
    await act(async () => {
      retry?.();
      // `retry` clears `failure` synchronously before the resend settles — this
      // is the frame that used to render nothing at all.
      await Promise.resolve();
    });
    // The upload in flight is a state, said on the page; the failure toast is down.
    expect(container.textContent).toContain(en['web.translate.recordingUploading']);
    expect(notify.dismiss).toHaveBeenCalledWith('translate-recording');

    await act(async () => {
      resolveResend();
      await Promise.resolve();
    });
    expect(container.textContent).not.toContain(en['web.translate.recordingUploading']);
    expect(
      notify.error.mock.calls.filter(
        ([message]) => message === en['web.translate.recordingFailedRetryable'],
      ),
      'a second failure toast after the retry succeeded',
    ).toHaveLength(1);
  });
});

describe('the dock, pausing and resuming', () => {
  async function renderAt(
    status: UseStreamingTranslate['status'],
    overrides: Partial<UseStreamingTranslate> = {},
  ) {
    checkHealth.mockResolvedValue(undefined);
    permissionQuery.mockResolvedValue({
      state: 'granted',
      addEventListener() {},
      removeEventListener() {},
    });
    useStreamingTranslate.mockReturnValue({ ...conversation, status, ...overrides });
    useConversationSave.mockReturnValue({
      saved: false,
      failure: null,
      saving: false,
      retry: vi.fn(),
    });
    await act(async () => {
      root.render(
        <LocaleProvider>
          <CascadePanel
            conversationMode="one-way"
            settings={DEFAULT_TRANSLATE_SETTINGS}
            onChange={vi.fn()}
            getVolume={() => 1}
          />
        </LocaleProvider>,
      );
      await settleProbes();
    });
  }

  const buttonSaying = (text: string): HTMLButtonElement | undefined =>
    Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === text,
    );

  it('says the microphone is paused while half duplex ignores it', async () => {
    await renderAt('listening', { micPaused: true });
    expect(container.textContent).toContain(en['web.translate.micPausedDuringPlayback']);
  });

  it('says nothing about the microphone while it is being listened to', async () => {
    await renderAt('listening', { micPaused: false });
    expect(container.textContent).not.toContain(en['web.translate.micPausedDuringPlayback']);
  });

  it('offers Pause beside End while listening', async () => {
    await renderAt('listening');

    expect(buttonSaying(en['web.translate.pause'])).toBeDefined();
    expect(buttonSaying(en['web.translate.end'])).toBeDefined();
    expect(buttonSaying(en['web.translate.resume'])).toBeUndefined();
  });

  it('swaps Pause for Resume once paused, and keeps End reachable', async () => {
    await renderAt('paused');

    expect(buttonSaying(en['web.translate.resume'])).toBeDefined();
    expect(buttonSaying(en['web.translate.end'])).toBeDefined();
    expect(buttonSaying(en['web.translate.pause'])).toBeUndefined();
  });

  it('calls pause and resume rather than stop', async () => {
    await renderAt('listening');
    act(() => buttonSaying(en['web.translate.pause'])!.click());
    expect(conversation.pause).toHaveBeenCalledTimes(1);

    await renderAt('paused');
    act(() => buttonSaying(en['web.translate.resume'])!.click());
    expect(conversation.resume).toHaveBeenCalledTimes(1);
    // The conversation must survive a pause; stopping it is the other button.
    expect(conversation.stop).not.toHaveBeenCalled();
  });

  it('shows the elapsed clock while paused, because the conversation is still open', async () => {
    await renderAt('paused');

    // Named rather than matched on digits: the value moves every second.
    expect(container.querySelector(`[aria-label="${en['web.translate.elapsedLabel']}"]`)).not.toBe(
      null,
    );
  });

  it('reports a paused conversation as still running to everything below the dock', async () => {
    await renderAt('paused');

    // What appears only after a conversation has ENDED. Its absence here is the
    // observable form of "pause did not end anything".
    expect(container.textContent).not.toContain('Meeting minutes');
  });

  it('ends gracefully rather than cutting, so the last translation is spoken', async () => {
    await renderAt('listening');
    act(() => buttonSaying(en['web.translate.end'])!.click());

    expect(conversation.end).toHaveBeenCalledTimes(1);
    // `stop` tears down at once, which would discard the tail. It is for the
    // page going away, not for a button.
    expect(conversation.stop).not.toHaveBeenCalled();
  });

  it('offers nothing to pause while the microphone prompt is still open', async () => {
    await renderAt('connecting');

    // There is no microphone open to turn off yet, so Pause here could only be
    // a control that does nothing for as long as the prompt is on screen.
    expect(buttonSaying(en['web.translate.pause'])).toBeUndefined();
    expect(buttonSaying(en['web.translate.resume'])).toBeUndefined();
    // End stays, and it cancels the start rather than sitting inert.
    expect(buttonSaying(en['web.translate.end'])).toBeDefined();
  });

  it('offers nothing to pause while the conversation is finishing', async () => {
    await renderAt('finishing');

    expect(buttonSaying(en['web.translate.pause'])).toBeUndefined();
    expect(buttonSaying(en['web.translate.resume'])).toBeUndefined();
    // End stays, and pressing it again is what cuts the tail short.
    expect(buttonSaying(en['web.translate.end'])).toBeDefined();
  });
});

/**
 * The invariant the transcript's height rests on.
 *
 * `transcript-scroller.tsx` used to cap itself at 416px so the dock — status,
 * level, and the one action — could not be pushed under the fold. The cap is
 * gone and the transcript now takes the leftover height, which is only safe
 * because nothing renders BELOW the dock while a conversation is running: the
 * attribution stats and the minutes are both `!running`.
 *
 * That is an ordinary-looking pair of conditions holding up a layout decision
 * made in another file, which is exactly the kind of thing a later change
 * removes without noticing. Anything added under the dock has to be gated the
 * same way, or the transcript starts surrendering height mid-sentence — on the
 * screen whose whole job is to be readable while someone talks.
 */
describe('what sits below the dock', () => {
  const renderRunning = async () => {
    checkHealth.mockResolvedValue(undefined);
    permissionQuery.mockResolvedValue({
      state: 'granted',
      addEventListener() {},
      removeEventListener() {},
    });
    useStreamingTranslate.mockReturnValue({ ...conversation, status: 'listening' });
    useConversationSave.mockReturnValue({
      saved: false,
      failure: null,
      saving: false,
      retry: vi.fn(),
    });
    await act(async () => {
      root.render(
        <LocaleProvider>
          <CascadePanel
            conversationMode="one-way"
            settings={DEFAULT_TRANSLATE_SETTINGS}
            onChange={vi.fn()}
            getVolume={() => 1}
          />
        </LocaleProvider>,
      );
      await settleProbes();
    });
    return container.firstElementChild;
  };

  it('renders nothing after the dock while a conversation is running', async () => {
    // Asserted through position rather than through the absence of two known
    // strings: a third thing added under the dock would pass an absence check
    // and still break the layout.
    const panel = await renderRunning();
    const dock = panel?.lastElementChild;

    expect(dock?.textContent).toContain(en['web.translate.end']);
  });

  it('puts the results below the dock once the talking stops', async () => {
    // The other half of the same rule. Stats and minutes are meant to be down
    // there — the column simply grows past the viewport and the page scrolls,
    // which is fine when nobody is mid-sentence.
    await render({ saved: true, failure: null });
    const panel = container.firstElementChild;

    expect(panel?.lastElementChild?.textContent).toContain('Meeting minutes');
  });
});

/**
 * What the selected AI Context puts on the wire.
 *
 * The resolution happens HERE, in the client, rather than server-side, because
 * `client.session.start` fires once per TURN — a server that looked the stored id
 * up would read the row on every turn of every conversation.
 *
 * The `undefined` case is the one that matters most: a request with no hints
 * produces a prompt byte-identical to the one without this feature, which is what
 * lets the recorded injection baseline keep describing the default path. An empty
 * object would not.
 */
describe('the context a conversation starts under', () => {
  const CONTEXT = {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Thesis defense',
    topic: 'thesis defense committee meeting',
    hotwords: ['VinFast'],
    glossary: [{ vi: 'hội đồng phản biện', en: 'thesis defense committee' }],
    style: 'formal' as const,
    updatedAt: '2026-09-17T00:00:00.000Z',
  };

  /** Mount `/translate` idle with these settings, then press Start. */
  async function startWith(contextId: string | null, contexts: unknown[]): Promise<void> {
    checkHealth.mockResolvedValue(undefined);
    permissionQuery.mockResolvedValue({
      state: 'granted',
      addEventListener() {},
      removeEventListener() {},
    });
    listTranslationContexts.mockResolvedValue({ contexts });
    useStreamingTranslate.mockReturnValue(conversation);
    useConversationSave.mockReturnValue({
      saved: false,
      failure: null,
      saving: false,
      retry: vi.fn(),
    });

    await act(async () => {
      root.render(
        <LocaleProvider>
          <CascadePanel
            conversationMode="one-way"
            settings={{ ...DEFAULT_TRANSLATE_SETTINGS, contextId }}
            onChange={vi.fn()}
            getVolume={() => 1}
          />
        </LocaleProvider>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    const start = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes(en['web.translate.startConversation']),
    );
    expect(start, 'the Start button is not on screen').toBeDefined();
    await act(async () => {
      start?.click();
      await Promise.resolve();
    });
  }

  const startedWith = () =>
    (conversation.start as unknown as { mock: { calls: [Record<string, unknown>][] } }).mock
      .calls[0]?.[0];

  it('sends a selected context as hints', async () => {
    await startWith(CONTEXT.id, [CONTEXT]);

    expect(startedWith()?.hints).toEqual({
      topic: 'thesis defense committee meeting',
      hotwords: ['VinFast'],
      // The stored `{vi, en}` pairs, untouched: which side is the source is
      // resolved server-side, because only the session knows its pair.
      glossary: [{ vi: 'hội đồng phản biện', en: 'thesis defense committee' }],
      style: 'formal',
    });
  });

  it('sends no hints key at all when nothing is selected', async () => {
    await startWith(null, [CONTEXT]);

    const options = startedWith();
    expect(options?.hints).toBeUndefined();
  });

  it('sends no hints for a contextId that no longer resolves', async () => {
    // The stale-reference rule: a deleted context reads as "no context" rather
    // than as an error, and the conversation still starts.
    await startWith('99999999-9999-4999-8999-999999999999', [CONTEXT]);

    expect(startedWith()?.hints).toBeUndefined();
  });
});

/**
 * What a stored selection must not be allowed to do while the library that
 * resolves it has not settled.
 *
 * `resolveContext` reads `contexts`, which is `[]` for as long as the request is
 * in the air — indistinguishable, at that moment, from an account with nothing
 * saved. A returning user with a stored id who presses Start in that window ran
 * a whole conversation with no hints, silently: the picker that could have said
 * so renders nothing outside `ready`.
 */
describe('a stored context that has not settled', () => {
  const startButton = (): HTMLButtonElement | undefined =>
    Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes(en['web.translate.startConversation']),
    );

  it('gates Start while the list is still loading', async () => {
    checkHealth.mockResolvedValue(undefined);
    permissionQuery.mockResolvedValue({
      state: 'granted',
      addEventListener() {},
      removeEventListener() {},
    });
    // Never resolved for the length of this test: the list is caught mid-flight.
    listTranslationContexts.mockReturnValue(new Promise(() => {}));
    useStreamingTranslate.mockReturnValue(conversation);
    useConversationSave.mockReturnValue({
      saved: false,
      failure: null,
      saving: false,
      retry: vi.fn(),
    });

    await act(async () => {
      root.render(
        <LocaleProvider>
          <CascadePanel
            conversationMode="one-way"
            settings={{ ...DEFAULT_TRANSLATE_SETTINGS, contextId: 'ctx-stored' }}
            onChange={vi.fn()}
            getVolume={() => 1}
          />
        </LocaleProvider>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(startButton()?.disabled).toBe(true);
    expect(container.textContent).toContain(en['web.translate.contextLoading']);
    // Pressing it anyway must not be possible to reach: the guard is the
    // `disabled` attribute above, not merely a click handler that no-ops.
    expect(conversation.start).not.toHaveBeenCalled();
  });

  it('does not gate Start when nothing is stored, even while the list loads', async () => {
    // The gate exists for a SELECTION that would otherwise resolve silently
    // against an empty list — an account with no stored id has nothing to
    // resolve, so there is nothing this window can get wrong for it.
    checkHealth.mockResolvedValue(undefined);
    permissionQuery.mockResolvedValue({
      state: 'granted',
      addEventListener() {},
      removeEventListener() {},
    });
    listTranslationContexts.mockReturnValue(new Promise(() => {}));
    useStreamingTranslate.mockReturnValue(conversation);
    useConversationSave.mockReturnValue({
      saved: false,
      failure: null,
      saving: false,
      retry: vi.fn(),
    });

    await act(async () => {
      root.render(
        <LocaleProvider>
          <CascadePanel
            conversationMode="one-way"
            settings={{ ...DEFAULT_TRANSLATE_SETTINGS, contextId: null }}
            onChange={vi.fn()}
            getVolume={() => 1}
          />
        </LocaleProvider>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(startButton()?.disabled).toBe(false);
  });

  it('warns rather than starting silently once a stored context fails to load', async () => {
    checkHealth.mockResolvedValue(undefined);
    permissionQuery.mockResolvedValue({
      state: 'granted',
      addEventListener() {},
      removeEventListener() {},
    });
    listTranslationContexts.mockRejectedValue(new Error('offline'));
    useStreamingTranslate.mockReturnValue(conversation);
    useConversationSave.mockReturnValue({
      saved: false,
      failure: null,
      saving: false,
      retry: vi.fn(),
    });

    await act(async () => {
      root.render(
        <LocaleProvider>
          <CascadePanel
            conversationMode="one-way"
            settings={{ ...DEFAULT_TRANSLATE_SETTINGS, contextId: 'ctx-stored' }}
            onChange={vi.fn()}
            getVolume={() => 1}
          />
        </LocaleProvider>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    // The account can still choose to proceed unhinted — Start stays pressable —
    // but it must not be able to do that without the words on screen first.
    expect(container.textContent).toContain(en['web.translate.contextUnavailable']);
    expect(startButton()?.disabled).toBe(false);
  });
});

/**
 * The page decides what a start asks for; the server decides what it
 * gets. Voices travel per language whenever the spoken language is decided per
 * turn, and the screen follows the server's answer rather than the request.
 */
describe('CascadePanel two-way and auto-detect', () => {
  async function mount(
    settings: Partial<TranslateSettings>,
    state: Partial<UseStreamingTranslate> = {},
    conversationMode: ConversationMode = 'two-way',
  ): Promise<void> {
    checkHealth.mockResolvedValue(undefined);
    permissionQuery.mockResolvedValue({
      state: 'granted',
      addEventListener() {},
      removeEventListener() {},
    });
    useStreamingTranslate.mockReturnValue({ ...conversation, ...state });
    useConversationSave.mockReturnValue({
      saved: false,
      failure: null,
      saving: false,
      retry: vi.fn(),
    });
    await act(async () => {
      root.render(
        <LocaleProvider>
          <CascadePanel
            conversationMode={conversationMode}
            settings={{ ...DEFAULT_TRANSLATE_SETTINGS, ...settings }}
            onChange={vi.fn()}
            getVolume={() => 1}
          />
        </LocaleProvider>,
      );
      await settleProbes();
    });
  }

  function pressStart(): Record<string, unknown> | undefined {
    const start = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes(en['web.translate.startConversation']),
    );
    act(() => start?.click());
    return (conversation.start as unknown as { mock: { calls: [Record<string, unknown>][] } }).mock
      .calls[0]?.[0];
  }

  /** The defaults with a voice token and a speak flag per language. */
  const voices = (
    tokens: Partial<Record<'vi' | 'en' | 'zh', string>>,
    muted: ReadonlyArray<'vi' | 'en' | 'zh'> = [],
  ): Pick<TranslateSettings, 'voiceByLanguage'> => {
    let next: Pick<TranslateSettings, 'voiceByLanguage'> = DEFAULT_TRANSLATE_SETTINGS;
    for (const [language, voice] of Object.entries(tokens)) {
      next = languageVoicePatch(next, language as 'vi' | 'en' | 'zh', { voice });
    }
    for (const language of muted) next = languageVoicePatch(next, language, { speak: false });
    return next;
  };

  it('sends each language of a two-way pair its own setup', async () => {
    await mount({
      twoWayPair: { source: 'vi', target: 'en' },
      ...voices({ vi: 'vi-voice', en: 'en-voice' }, ['vi']),
    });
    const options = pressStart();
    // A turn heard in English is answered in Vietnamese, so the map must carry
    // the Vietnamese setup — muted here, so the server speaks no Vietnamese.
    expect(options?.voiceByLanguage).toMatchObject({
      vi: { speak: false, voice: 'vi-voice' },
      en: { speak: true, voice: 'en-voice' },
    });
    // The target's own voice still rides flat, for an API older than the map.
    expect(options?.voice).toBe('en-voice');
    expect(options?.voiceOutput).toBe(true);
  });

  it('sends an auto-detected start only its target’s setup', async () => {
    await mount(
      { languagePair: { source: 'detect', target: 'en' }, ...voices({ en: 'en-voice' }) },
      {},
      'one-way',
    );
    expect(Object.keys(pressStart()?.voiceByLanguage as object)).toEqual(['en']);
  });

  it('sends a one-way start its target’s setup, flat and mapped', async () => {
    await mount(
      { languagePair: { source: 'vi', target: 'zh' }, ...voices({ zh: 'zh-voice' }, ['zh']) },
      {},
      'one-way',
    );
    const options = pressStart();
    expect(options?.voice).toBe('zh-voice');
    expect(options?.voiceOutput).toBe(false);
    expect(Object.keys(options?.voiceByLanguage as object)).toEqual(['zh']);
  });

  it('shows one-way when the server answers declared for a two-way start', async () => {
    await mount(
      {},
      {
        status: 'listening',
        twoWayRequested: true,
        languageMode: { mode: 'declared', reason: 'language_detection' },
      },
    );
    expect(container.textContent).toContain(
      'Translating one way for now: Vietnamese into English.',
    );
    expect(container.querySelector('[data-language-mode="declared"]')?.textContent).toBe(
      en['web.translate.modeOneWay'],
    );
  });

  it('says nothing extra when the server runs the two-way start it was asked for', async () => {
    await mount(
      {},
      { status: 'listening', twoWayRequested: true, languageMode: { mode: 'two-way' } },
    );
    expect(container.querySelector('[data-two-way-unavailable]')).toBeNull();
    expect(container.querySelector('[data-language-mode="two-way"]')?.textContent).toBe(
      en['web.translate.modeTwoWay'],
    );
  });

  it('does not call a declared answer a downgrade when two-way was never asked', async () => {
    await mount(
      { languagePair: { source: 'vi', target: 'zh' } },
      {
        status: 'listening',
        languagePair: { source: 'vi', target: 'zh' },
        twoWayRequested: false,
        languageMode: { mode: 'declared' },
      },
      'one-way',
    );
    expect(container.querySelector('[data-two-way-unavailable]')).toBeNull();
  });
});

describe('CascadePanel asks for two-way only on the two-way page', () => {
  async function startFrom(
    conversationMode: ConversationMode,
    settings: Partial<TranslateSettings>,
  ) {
    checkHealth.mockResolvedValue(undefined);
    permissionQuery.mockResolvedValue({
      state: 'granted',
      addEventListener() {},
      removeEventListener() {},
    });
    const start = vi.fn();
    useStreamingTranslate.mockReturnValue({ ...conversation, start });
    useConversationSave.mockReturnValue({
      saved: false,
      failure: null,
      saving: false,
      retry: vi.fn(),
    });
    await act(async () => {
      root.render(
        <LocaleProvider>
          <CascadePanel
            conversationMode={conversationMode}
            settings={{ ...DEFAULT_TRANSLATE_SETTINGS, ...settings }}
            onChange={vi.fn()}
            getVolume={() => 1}
          />
        </LocaleProvider>,
      );
      await settleProbes();
    });
    const button = Array.from(container.querySelectorAll('button')).find((candidate) =>
      candidate.textContent?.includes(en['web.translate.startConversation']),
    );
    act(() => button?.click());
    return start.mock.calls[0]?.[0] as Record<string, unknown> | undefined;
  }

  it('starts the one-way page in its own pair, one way', async () => {
    const options = await startFrom('one-way', {
      languagePair: { source: 'vi', target: 'en' },
      twoWayPair: { source: 'en', target: 'vi' },
    });
    expect(options).toMatchObject({
      languagePair: { source: 'vi', target: 'en' },
      mode: 'one-way',
    });
  });

  it('starts the two-way page in its own pair, both ways', async () => {
    const options = await startFrom('two-way', {
      languagePair: { source: 'detect', target: 'en' },
      twoWayPair: { source: 'en', target: 'vi' },
    });
    expect(options).toMatchObject({
      languagePair: { source: 'en', target: 'vi' },
      mode: 'two-way',
    });
  });
});

/**
 * The screen's other outcomes as toasts, and the tab bar stepping aside while a
 * conversation is open.
 */
describe('outcomes and the frame', () => {
  async function renderPanel(
    streaming: Partial<UseStreamingTranslate>,
    save: Pick<UseConversationSave, 'saved' | 'failure'> & { retry?: () => void },
    wrap: (node: React.ReactNode) => React.ReactNode = (node) => node,
  ): Promise<void> {
    checkHealth.mockResolvedValue(undefined);
    permissionQuery.mockResolvedValue({
      state: 'granted',
      addEventListener() {},
      removeEventListener() {},
    });
    useStreamingTranslate.mockReturnValue({ ...conversation, ...streaming });
    useConversationSave.mockReturnValue({ retry: vi.fn(), ...save, saving: false });
    await act(async () => {
      root.render(
        <LocaleProvider>
          {wrap(
            <CascadePanel
              conversationMode="one-way"
              settings={DEFAULT_TRANSLATE_SETTINGS}
              onChange={vi.fn()}
              getVolume={() => 1}
            />,
          )}
        </LocaleProvider>,
      );
      await settleProbes();
    });
  }

  it('says a retryable failed save as a toast whose Retry resends it', async () => {
    const retry = vi.fn();
    await renderPanel({}, { saved: false, failure: 'retryable', retry });
    const call = notify.error.mock.calls.find(
      ([message]) => message === en['web.translate.saveFailedRetryable'],
    );
    expect(call?.[1]).toMatchObject({ id: 'translate-save' });
    call?.[1]?.retry?.();
    expect(retry).toHaveBeenCalledTimes(1);
    // No inline alert says it a second time.
    expect(container.querySelector('[data-slot="alert"]')).toBeNull();
  });

  it('offers no Retry for a save that can never succeed', async () => {
    await renderPanel({}, { saved: false, failure: 'terminal' });
    const call = notify.error.mock.calls.find(
      ([message]) => message === en['web.translate.saveFailedTerminal'],
    );
    expect(call).toBeDefined();
    expect(call?.[1]?.retry).toBeUndefined();
  });

  it('says a failed start as a toast, once, however often the screen renders', async () => {
    await renderPanel(
      { turns: [], error: 'The translation service is unavailable.' },
      {
        saved: false,
        failure: null,
      },
    );
    await renderPanel(
      { turns: [], error: 'The translation service is unavailable.' },
      {
        saved: false,
        failure: null,
      },
    );
    expect(
      notify.error.mock.calls.filter(
        ([message]) => message === 'The translation service is unavailable.',
      ),
    ).toHaveLength(1);
  });

  it('hides the phone tab bar while a conversation is open, and gives it back after', async () => {
    let immersive: boolean | undefined;
    function Probe() {
      immersive = useChromeSlots()?.immersive;
      return null;
    }
    const wrap = (node: React.ReactNode) => (
      <ChromeSlotsProvider>
        {node}
        <Probe />
      </ChromeSlotsProvider>
    );
    await renderPanel({ status: 'listening' }, { saved: false, failure: null }, wrap);
    expect(immersive).toBe(true);
    await renderPanel({ status: 'idle' }, { saved: false, failure: null }, wrap);
    expect(immersive).toBe(false);
  });
});
