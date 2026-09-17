// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UseStreamingTranslate } from '@/hooks/use-streaming-translate';
import { accentFilledControls } from './accent-count';
import { elevatedSurfaces } from './surface-count';

/**
 * One accent-filled control per app screen, mechanically.
 *
 * `accent-budget.spec.tsx` next door holds the marketing page, where the unit is
 * the SECTION. Nothing held the app screens, and
 * `.claude/rules/development-rules.md` says exactly why that gap was left open —
 * "per viewport" is a visual fact — and what to do when it starts costing:
 * "a spec per screen, not a louder checklist".
 *
 * ## A screen is not a section: it has states
 *
 * A marketing section renders one way. An app screen renders differently before
 * you start, while it runs, and after it stops — and the accent budget can be
 * correct in two of those and wrong in the third, which is precisely the bug
 * recorded below. So the unit here is the screen-state pair.
 *
 * ## `KNOWN_VIOLATIONS` shrinks and never grows
 *
 * This spec ships with a violation already in it, because writing it green
 * against a screen that is about to be rebuilt would prove nothing: it could only
 * ever confirm the end state, never that the fix landed.
 *
 * The table is enforced in BOTH directions. A listed screen-state that no longer
 * violates fails as stale, so the phase that fixes one cannot forget to delete
 * its row — the suite says so. That is what keeps this from decaying into a list
 * of excuses nobody revisits.
 *
 * ## What this does not cover
 *
 * The mocked states only. The failures each screen can actually reach are now
 * among them — a list that would not load, a conversation that is gone, a profile
 * request that failed — because four of the five screens used to be fixtured in
 * exactly one state and it was always the thinnest one: every list empty, every
 * record absent. A screen with no rows on it cannot draw a card per row.
 *
 * WIDTH is still outside, and so is anything measured in pixels: happy-dom has no
 * box model, so alignment and overflow stay review items the same way the
 * marketing spec is honest about covering sections rather than the composed page.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const useStreamingTranslate = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/use-streaming-translate', () => ({ useStreamingTranslate }));

const useConversationSave = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/use-conversation-save', () => ({ useConversationSave }));

// Typed so the factory does not hand `any` back into the component under test —
// an untyped mock silences the very type errors this file exists to notice.
const listConversations = vi.hoisted(() => vi.fn<() => Promise<unknown>>());
const getMe = vi.hoisted(() => vi.fn<() => Promise<unknown>>());
const listVoices = vi.hoisted(() => vi.fn<() => Promise<unknown>>());
const getConversation = vi.hoisted(() => vi.fn<() => Promise<unknown>>());
// `/translate` probes the service for its readiness banner. Resolving by default
// means the banner stays silent, which is the state these counts describe.
const checkHealth = vi.hoisted(() => vi.fn<() => Promise<unknown>>());
// The recording bytes. Mocked rather than left real because happy-dom has no
// network and no `MediaRecorder`: a row that renders the bar must not depend on
// either. Rejecting by default is the honest resting state — nothing here ever
// presses play, so nothing should look loaded.
const fetchConversationAudio = vi.hoisted(() => vi.fn<() => Promise<Blob>>());
// The recording upload. Resolving by default, like every other mock here — the
// one row that wants the failure alert overrides it for itself.
const uploadConversationAudio = vi.hoisted(() => vi.fn<() => Promise<unknown>>());
// The AI Context library, defaulting to an empty one in `beforeEach`.
const listTranslationContexts = vi.hoisted(() => vi.fn<() => Promise<unknown>>());
vi.mock('@/clients/api-client', () => ({
  listConversations: () => listConversations(),
  getMe: () => getMe(),
  listVoices: () => listVoices(),
  checkHealth: () => checkHealth(),
  getConversation: () => getConversation(),
  fetchConversationAudio: () => fetchConversationAudio(),
  uploadConversationAudio: () => uploadConversationAudio(),
  deleteConversation: vi.fn(),
  // The AI Context library. Answering with NOTHING by default is what keeps every
  // existing row of this table unchanged: `ContextPicker` renders nothing at all
  // for an empty list, exactly as `VoicePicker` does, so only the two rows that
  // seed contexts below see a picker at all.
  listTranslationContexts: () => listTranslationContexts(),
  saveTranslationContext: vi.fn(),
  deleteTranslationContext: vi.fn(),
}));

// The detail screen fetches minutes of its own. Its generate button is the one
// accent on that screen and it renders whether or not minutes exist, so both are
// worth counting — the hook is a mock a row can set rather than a fixed stub.
const useMinutes = vi.hoisted(() => vi.fn<() => unknown>());
vi.mock('@/hooks/use-minutes', () => ({ useMinutes: () => useMinutes() }));

// The query string, as a box rather than a `let`: `vi.mock` factories are hoisted
// above every declaration in this file, so a factory can only close over
// something `vi.hoisted` made. `/history` seeds its search term from here, which
// is the only way to reach the "nothing matched" state — the same empty list
// means something else entirely without a term in the URL.
const url = vi.hoisted(() => ({ query: '' }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/history',
  useSearchParams: () => new URLSearchParams(url.query),
}));

vi.mock('next-auth/react', () => ({
  signOut: vi.fn(),
  useSession: () => ({ data: null, status: 'unauthenticated' }),
}));

const { CascadePanel } = await import('@/components/translate/cascade-panel');
const { HistoryScreen } = await import('@/components/history/history-screen');
const { ConversationDetail } = await import('@/components/history/conversation-detail');
const { default: PreferencesPage } = await import('../../app/(app)/preferences/page');
const { default: AccountPage } = await import('../../app/(app)/account/page');
const { LocaleProvider } = await import('@/i18n/provider');
const { DEFAULT_TRANSLATE_SETTINGS, saveTranslateSettings } =
  await import('@/lib/translate-settings');

/** A conversation with one finished block, held at one identity. */
const oneTurn: UseStreamingTranslate['turns'] = [
  {
    id: 'seg-a',
    sessionId: 'a',
    speakerRole: 'speaker_a',
    direction: 'vi_to_en',
    sourceText: 'xin chào',
    targetText: 'hello',
    audioUrl: null,
    createdAt: '2026-09-03T00:00:00.000Z',
  },
];

function conversation(over: Partial<UseStreamingTranslate> = {}): UseStreamingTranslate {
  return {
    status: 'idle',
    turns: [],
    liveTurns: [],
    speakers: [],
    attributions: {},
    captures: {},
    unheard: {},
    displays: {},
    stats: {
      totalTurns: 0,
      confirmed: 0,
      automatic: 0,
      pending: 0,
      fallback: 0,
      tapRate: 0,
      suggestions: { confirmedMatching: 0, corrected: 0, unreviewed: 0 },
    },
    addSpeaker: vi.fn(),
    renameSpeaker: vi.fn(),
    removeSpeaker: vi.fn(),
    attributeTurn: vi.fn(),
    unattributeTurn: vi.fn(),
    echoHeard: 0,
    error: null,
    level: 0,
    conversationId: 'c-1',
    startedAt: '2026-09-03T00:00:00.000Z',
    recording: null,
    recordingStartedAtMs: null,
    start: vi.fn(),
    stop: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    end: vi.fn(),
    setVolume: vi.fn(),
    ...over,
  };
}

const translate = (settings: Partial<typeof DEFAULT_TRANSLATE_SETTINGS> = {}) =>
  function Translate() {
    return (
      <CascadePanel
        settings={{ ...DEFAULT_TRANSLATE_SETTINGS, ...settings }}
        onChange={vi.fn()}
        getVolume={() => 1}
      />
    );
  };

/** The idle mocks, shared by the arrangement rows below. */
function idle() {
  useStreamingTranslate.mockReturnValue(conversation({ turns: oneTurn }));
  useConversationSave.mockReturnValue({
    saved: false,
    failure: null,
    saving: false,
    retry: vi.fn(),
  });
}

/** A stored conversation, at the shape `/history/[conversationId]` reads. */
function stored(over: Record<string, unknown> = {}) {
  return {
    conversationId: 'c-1',
    direction: 'vi_to_en',
    startedAt: '2026-09-03T12:00:00.000Z',
    endedAt: '2026-09-03T12:10:00.000Z',
    turnCount: 4,
    preview: 'xin chào',
    hasMinutes: false,
    turns: [
      {
        position: 0,
        speakerRole: 'speaker_a',
        speakerLabel: null,
        sourceText: 'xin chào',
        displayText: null,
        targetText: 'hello',
        offsetMs: 6_200,
      },
    ],
    // No recording by default, so the existing rows describe the screen exactly as
    // they did before this feature. The rows that want the bar override these.
    hasRecording: false,
    audioOffsetMs: null,
    audioDurationMs: null,
    ...over,
  };
}

/**
 * Three conversations over two days, which is what `/history` actually draws.
 *
 * Two days rather than one: the list is grouped by day, so a single-day fixture
 * would never render a second heading — and the day grouping is the part of this
 * screen the redesign rewrote.
 */
const STORED_CONVERSATIONS = [
  { ...stored(), hasMinutes: true },
  {
    ...stored(),
    conversationId: 'c-2',
    direction: 'en_to_vi',
    startedAt: '2026-09-03T09:30:00.000Z',
    endedAt: '2026-09-03T09:35:00.000Z',
    turnCount: 2,
    preview: 'good morning',
  },
  {
    ...stored(),
    conversationId: 'c-3',
    startedAt: '2026-09-02T18:00:00.000Z',
    endedAt: '2026-09-02T18:20:00.000Z',
    turnCount: 9,
    preview: 'cảm ơn nhiều',
  },
];

/** A finished minutes artifact, so the panel draws its body and its copy control. */
const READY_MINUTES = {
  conversationId: 'c-1',
  status: 'ready',
  summary: 'Two people greeted each other.',
  keyPoints: ['A greeting was exchanged.'],
  decisions: [],
  actionItems: [{ id: 'a-1', description: 'Say hello back', owner: null, dueDate: null }],
  generatedAt: '2026-09-03T12:11:00.000Z',
  model: 'test-model',
};

/** What a running speech backend answers with, as opposed to a stopped one. */
/** Three saved contexts, so both rows below have a library to render. */
const CONTEXTS = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Thesis defense',
    topic: 'thesis defense committee meeting',
    hotwords: ['VinFast'],
    glossary: [{ vi: 'hội đồng phản biện', en: 'thesis defense committee' }],
    style: 'formal' as const,
    updatedAt: '2026-09-17T00:00:00.000Z',
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    name: 'Hotel check-in',
    topic: null,
    hotwords: [],
    glossary: [],
    style: null,
    updatedAt: '2026-09-16T00:00:00.000Z',
  },
  {
    id: '33333333-3333-4333-8333-333333333333',
    name: 'Cardiology consult',
    topic: null,
    hotwords: [],
    glossary: [],
    style: null,
    updatedAt: '2026-09-15T00:00:00.000Z',
  },
];

const VOICES = [
  { token: 'v-1', label: 'Ngọc Lan', gender: 'female' },
  { token: 'v-2', label: 'Minh', gender: 'male' },
];

/** One screen in one state: what it renders, and the two counts it is allowed. */
interface ScreenState {
  name: string;
  filled: number;
  surfaces: number;
  setup: () => void;
  render: () => React.ReactElement;
  /**
   * A trigger to click once the screen is up, by selector.
   *
   * Popovers portal to `document.body` and render nothing until they are opened,
   * so a table that only ever mounts screens counts the two densest control
   * surfaces on `/translate` as if they did not exist.
   */
  open?: string;
  /**
   * A control to press once the screen is up, by selector.
   *
   * `open` above asserts a popover appeared and is only for popovers. This is the
   * plainer case: a state a screen can only REACH by being used. The recording
   * bar's failed state is the one that needs it — `failed` is set inside the
   * player's `load()`, which runs only from a press, so a row that merely mounts
   * the bar is counting the untouched state no matter what its fixtures say.
   */
  press?: string;
  /**
   * A selector that must match once the row is up, by which the row proves it
   * mounted what its name claims.
   *
   * Counts alone do not: a control that renders NOTHING counts the same as one
   * that renders correctly, so a fixture whose mock never reached the component
   * passes silently and the table claims coverage it does not have.
   */
  shows?: string;
}

/**
 * Every screen-state this spec holds, with the two counts it is allowed and the
 * `setup` that puts the mocks into the state the name describes.
 *
 * `surfaces` is the second rule that had no gate: **at most two elevated surfaces
 * per screen.** A card is for a thing you act on as a unit, and the redesign spent
 * most of its effort deleting cards that were not — a card per conversation row, a
 * card per settings concern, a card around a loading sentence. Counted here so the
 * grammar cannot creep back one card at a time.
 *
 * Zero is normal and correct. `/translate` is the whole screen, `/history` is a
 * list on the page ground; only the two records on a stored conversation and the
 * one settings panel each earn one.
 */
/**
 * The arrangements, added when `/translate` grew six display settings.
 *
 * Before them this table saw ONE state of a screen that now has several: the
 * default `split` + `row`, popovers closed. `list`, `column` and `translationOnly`
 * each change how many panes, headers and scroll regions are drawn — which is
 * exactly the axis along which a stray card or a second accent-filled control
 * would arrive, and none of it was counted.
 *
 * One turn in and stopped, so the counts are the ones the `ended` row above
 * already establishes: Start is back and spends the screen's one accent, and the
 * finished conversation earns its one surface below the dock. Identical in all
 * three, and that is the assertion — an arrangement changes how the transcript is
 * laid out and nothing else, so a second card or a second filled control that
 * appears in ONE of them is exactly what these rows catch.
 */
const ARRANGEMENTS = [
  { name: '/translate — one merged list', settings: { displayMode: 'list' as const } },
  {
    name: '/translate — panes stacked',
    settings: { displayMode: 'split' as const, paneLayout: 'column' as const },
  },
  { name: '/translate — translation only', settings: { translationOnly: true } },
].map(({ name, settings }) => ({
  name,
  filled: 1,
  surfaces: 1,
  setup: idle,
  render: translate(settings),
}));

const SCREENS: ScreenState[] = [
  {
    name: '/translate — before anything starts',
    filled: 1,
    surfaces: 0,
    setup() {
      useStreamingTranslate.mockReturnValue(conversation());
      useConversationSave.mockReturnValue({
        saved: false,
        failure: null,
        saving: false,
        retry: vi.fn(),
      });
    },
    render: translate(),
  },
  {
    name: '/translate — running',
    filled: 0,
    surfaces: 0,
    setup() {
      useStreamingTranslate.mockReturnValue(conversation({ status: 'listening' }));
      useConversationSave.mockReturnValue({
        saved: false,
        failure: null,
        saving: false,
        retry: vi.fn(),
      });
    },
    render: translate(),
  },
  {
    // One, where `— running` spends none. The microphone is off and the screen
    // is waiting on a single decision, so Resume is the filled control; End
    // beside it is `live`, which is its own token and not the accent.
    //
    // Still zero surfaces: paused is a RUNNING state, so nothing that appears
    // after a conversation ends is on screen yet.
    name: '/translate — paused',
    filled: 1,
    surfaces: 0,
    setup() {
      useStreamingTranslate.mockReturnValue(conversation({ status: 'paused', turns: oneTurn }));
      useConversationSave.mockReturnValue({
        saved: false,
        failure: null,
        saving: false,
        retry: vi.fn(),
      });
    },
    render: translate(),
  },
  {
    // Zero, like `— running`. The conversation is ending on its own and the one
    // control left is End, which is `live` rather than the accent. There is
    // nothing here the reader has to do.
    name: '/translate — finishing',
    filled: 0,
    surfaces: 0,
    setup() {
      useStreamingTranslate.mockReturnValue(conversation({ status: 'finishing', turns: oneTurn }));
      useConversationSave.mockReturnValue({
        saved: false,
        failure: null,
        saving: false,
        retry: vi.fn(),
      });
    },
    render: translate(),
  },
  {
    name: '/translate — ended, turns stored',
    filled: 1,
    surfaces: 1,
    setup() {
      useStreamingTranslate.mockReturnValue(conversation({ turns: oneTurn }));
      useConversationSave.mockReturnValue({
        saved: true,
        failure: null,
        saving: false,
        retry: vi.fn(),
      });
    },
    render: translate(),
  },
  {
    // The recording failed to upload — a reachable screen-state no row here
    // exercised before: every other `/translate` row leaves `recording: null`.
    // The alert carries no elevation token, and its Retry is `outline`, so the
    // counts are identical to the row above; what changes is that this row
    // actually presses the code path that draws it.
    name: '/translate — the recording failed to upload',
    filled: 1,
    surfaces: 1,
    setup() {
      uploadConversationAudio.mockRejectedValue(new Error('down'));
      useStreamingTranslate.mockReturnValue(
        conversation({
          turns: oneTurn,
          recording: {
            blob: new Blob(['audio']),
            startedAtMs: Date.parse('2026-09-03T00:00:00.000Z') + 500,
            durationMs: 5_000,
          },
        }),
      );
      useConversationSave.mockReturnValue({
        saved: true,
        failure: null,
        saving: false,
        retry: vi.fn(),
      });
    },
    // The alert only mounts once the automatic upload has fired and failed —
    // proof the row actually reached that state rather than counting the
    // untouched screen above with a mock nobody exercised.
    shows: '[data-slot="alert"]',
    render: translate(),
  },
  {
    // Zero, not one. The screen's filled "Start a conversation" was deleted: it
    // offered the same destination the sidebar's Translate entry does on every
    // app screen. The rule is a ceiling, so a screen may spend none of it.
    name: '/history — nothing stored yet',
    filled: 0,
    surfaces: 0,
    setup() {
      listConversations.mockResolvedValue({ conversations: [], nextCursor: null });
    },
    render: () => <HistoryScreen />,
  },
  {
    // The state this screen is actually FOR, and the one the empty row above
    // cannot reach: day headings, rows on the page ground, a minutes badge, and
    // "Load more" under a further cursor. Every one of those is where a card or a
    // filled control would arrive, and none of them was ever mounted here.
    name: '/history — days of conversations, and more behind them',
    filled: 0,
    surfaces: 0,
    setup() {
      listConversations.mockResolvedValue({
        conversations: STORED_CONVERSATIONS,
        nextCursor: 'c-3',
      });
    },
    render: () => <HistoryScreen />,
  },
  {
    // The first page failed, so the screen is a notice and a retry. Outline, not
    // filled: a failure the reader did not cause is not the screen's action.
    name: '/history — the first page failed',
    filled: 0,
    surfaces: 0,
    setup() {
      listConversations.mockRejectedValue(new Error('offline'));
    },
    render: () => <HistoryScreen />,
  },
  {
    // "Nothing matched" is a different fact from "nothing stored", and it is only
    // reachable with a term in the URL — the list is empty either way.
    name: '/history — nothing matched the search',
    filled: 0,
    surfaces: 0,
    setup() {
      url.query = 'q=cảm ơn';
      listConversations.mockResolvedValue({ conversations: [], nextCursor: null });
    },
    render: () => <HistoryScreen />,
  },
  {
    // The other half of the history criterion, and the half that had no gate: the
    // "exactly one accent here" claim lived only in a doc comment. One, and it is
    // the minutes generate button — back is ghost, delete is outline then
    // `destructive`, which fills with `live-fill` rather than the accent.
    name: '/history/[conversationId] — no minutes yet',
    filled: 1,
    surfaces: 2,
    setup() {
      getConversation.mockResolvedValue({ conversation: stored() });
    },
    render: () => <ConversationDetail conversationId="c-1" />,
  },
  {
    // Minutes exist, so the panel draws its body and gains a copy control beside
    // the button. Still one accent and still two surfaces: regenerate is the same
    // default-variant control, copy is ghost, and the summary is content inside a
    // card that was already counted.
    name: '/history/[conversationId] — minutes generated',
    filled: 1,
    surfaces: 2,
    setup() {
      getConversation.mockResolvedValue({ conversation: stored({ hasMinutes: true }) });
      useMinutes.mockReturnValue({
        minutes: READY_MINUTES,
        loading: false,
        error: false,
        generate: vi.fn(),
        reset: vi.fn(),
      });
    },
    render: () => <ConversationDetail conversationId="c-1" />,
  },
  {
    // The state this feature adds, and the one both budgets were most likely to
    // break in. The recording bar draws a play button, a slider and a readout —
    // and it draws them on the page GROUND between hairlines, not in a card,
    // because the two surfaces are already spent on the transcript and the
    // minutes. Play is `outline`; the accent stays with Generate.
    //
    // The slider is the interesting half: its filled range carries `bg-primary`,
    // and it does NOT count, because `accentFilledControls` restricts to
    // `button, a, [role="button"]` and the range is a `div`. That exemption is
    // named in `accent-count.ts`'s own docblock as exactly this case, so this row
    // is what proves the exemption still holds rather than merely asserting it.
    name: '/history/[conversationId] — with a recording',
    filled: 1,
    surfaces: 2,
    setup() {
      getConversation.mockResolvedValue({
        conversation: stored({
          hasRecording: true,
          audioOffsetMs: 1_400,
          audioDurationMs: 600_000,
        }),
      });
    },
    render: () => <ConversationDetail conversationId="c-1" />,
  },
  {
    // A recording the reader has PRESSED PLAY on, which is the state the bar
    // spends most of its life in and the one the row above cannot reach: on a
    // detail screen nobody has touched, the player has fetched nothing and the
    // bar is identical to the row above.
    //
    // An earlier version of this row set `fetchConversationAudio` to reject and
    // claimed the failed line rendered by itself. It does not — `failed` is only
    // set inside `load()`, and `load()` only runs from `toggle` or `seekTo` —
    // so the row asserted nothing the row above had not already asserted. The
    // press is what makes it a distinct state.
    name: '/history/[conversationId] — the recording failed to load',
    filled: 1,
    surfaces: 2,
    setup() {
      getConversation.mockResolvedValue({
        conversation: stored({
          hasRecording: true,
          audioOffsetMs: 1_400,
          audioDurationMs: 600_000,
        }),
      });
      fetchConversationAudio.mockRejectedValue(new Error('offline'));
    },
    // Pressing play is what drives the player into its failed state, and the
    // failure must not be allowed to answer with a card or a filled retry.
    press: 'button[data-slot="button"][aria-label]',
    // The proof the press landed. Without it this row would silently go back to
    // counting the untouched bar the moment the selector stopped matching.
    shows: '[role="status"]',
    render: () => <ConversationDetail conversationId="c-1" />,
  },
  {
    // A foreign or deleted id. Zero of both: the records that earn the two
    // surfaces are the ones that did not load, and there is nothing to generate.
    name: '/history/[conversationId] — no longer here',
    filled: 0,
    surfaces: 0,
    setup() {
      getConversation.mockRejectedValue(new Error('not found'));
    },
    render: () => <ConversationDetail conversationId="c-1" />,
  },
  {
    // TWO surfaces since the AI Context library landed: the defaults panel and the
    // library, each a thing you sit down and work on as a unit. Two is the
    // ceiling on this screen, which is why the context editor expands inline.
    name: '/preferences — the catalog is empty',
    filled: 0,
    surfaces: 2,
    setup() {
      listVoices.mockResolvedValue({ voices: [] });
    },
    render: () => <PreferencesPage />,
  },
  {
    // The same screen with a backend that actually answers: the picker lists
    // voices instead of saying there are none.
    //
    // `en_to_vi` deliberately, and it is load-bearing rather than decorative.
    // `use-voice-catalog.ts` caches a list per OUTPUT LANGUAGE at module scope for
    // the life of the tab — so a second row asking for English would be handed the
    // empty answer the row above cached, and a fixture that cannot change what it
    // renders proves nothing. Vietnamese is a key nothing else in this table asks
    // for.
    name: '/preferences — voices listed',
    filled: 0,
    surfaces: 2,
    setup() {
      saveTranslateSettings({ ...DEFAULT_TRANSLATE_SETTINGS, direction: 'en_to_vi' });
      listVoices.mockResolvedValue({ voices: VOICES });
    },
    render: () => <PreferencesPage />,
  },
  {
    // The editor open, which is the ONE state on this screen that spends an
    // accent: Save is the thing you came here to do and it exists only while
    // there is something to save.
    //
    // Still TWO surfaces, and that is the assertion that matters. The editor
    // expands INLINE — a `Dialog` would portal into `document.body`, which
    // `surface-count.ts` queries precisely so portalled content is counted, and
    // the screen would be at three.
    //
    // `press`/`shows` rather than `open`: the `open` helper asserts a
    // `[data-slot="popover-content"]` appeared, and an inline editor portals
    // nothing.
    name: '/preferences — editing a context',
    filled: 1,
    surfaces: 2,
    setup() {
      listVoices.mockResolvedValue({ voices: [] });
      listTranslationContexts.mockResolvedValue({ contexts: CONTEXTS });
    },
    press: 'button[data-slot="button"]',
    shows: '[data-slot="textarea"]',
    render: () => <PreferencesPage />,
  },
  {
    name: '/account',
    filled: 0,
    surfaces: 1,
    setup() {
      getMe.mockResolvedValue({
        id: 'u1',
        email: 'a@b.co',
        name: 'Quang Anh',
        createdAt: '2026-01-09T00:00:00.000Z',
      });
    },
    render: () => <AccountPage />,
  },
  {
    // The profile request failed, which on this screen means the join date holds
    // a place and nothing else changes. The panel is still the screen's one
    // surface and sign-out is still ghost — a failure does not promote anything.
    name: '/account — the profile request failed',
    filled: 0,
    surfaces: 1,
    setup() {
      getMe.mockRejectedValue(new Error('unauthorized'));
    },
    render: () => <AccountPage />,
  },
  {
    // Open, because closed it renders nothing. Six settings sit behind this gear
    // and the surface they arrive on is the popover's own — so it must count as
    // one, and everything inside it must count too. The switches carry
    // `data-[state=checked]:bg-primary`, which is a state variant rather than an
    // accent; the slider paints its range on a `div`. Neither is a control that
    // reads as THE action, and `accent-count.ts` says why.
    name: '/translate — display settings open',
    filled: 1,
    surfaces: 1,
    open: 'button[aria-label="Display settings"]',
    setup() {
      useStreamingTranslate.mockReturnValue(conversation());
      useConversationSave.mockReturnValue({
        saved: false,
        failure: null,
        saving: false,
        retry: vi.fn(),
      });
      listVoices.mockResolvedValue({ voices: [] });
    },
    render: translate(),
  },
  {
    // The other popover, opened from the target panel header rather than the
    // dock. One surface — the popover — because `/translate` before a conversation
    // starts draws none of its own, and one accent, which is still Start behind it.
    //
    // `en_to_vi` for the same reason the `/preferences — voices listed` row gives:
    // `use-voice-catalog.ts` caches a list per OUTPUT LANGUAGE at module scope for
    // the life of the file, and English was cached EMPTY by the rows above. Asking
    // for it here handed `VoicePicker` an empty catalog, which is its render-nothing
    // case — so this row mounted an empty popover while being named for a full one,
    // and the counts matched either way. `shows` is what keeps it honest: the voice
    // Select exists only when there are voices to list.
    name: '/translate — voice settings open',
    filled: 1,
    surfaces: 1,
    open: 'button[aria-label^="Voice settings"]',
    shows: '[data-slot="popover-content"] [data-slot="select-trigger"]',
    setup() {
      useStreamingTranslate.mockReturnValue(conversation());
      useConversationSave.mockReturnValue({
        saved: false,
        failure: null,
        saving: false,
        retry: vi.fn(),
      });
      listVoices.mockResolvedValue({ voices: VOICES });
    },
    render: translate({ direction: 'en_to_vi' }),
  },
  {
    // A context selected, with the picker CLOSED. An open `Select` renders its
    // content on `shadow-elev-lg` into a portal, which this counter sees — so a
    // row that opened it would count one more surface than the same screen
    // closed. Assert the trigger, never the open menu.
    //
    // Zero surfaces and one accent: `/translate` before a conversation starts
    // draws none of its own, and Start remains the screen's single accent. The
    // picker is a `Select`, which spends none.
    name: '/translate — a context selected',
    filled: 1,
    surfaces: 0,
    setup() {
      saveTranslateSettings({
        ...DEFAULT_TRANSLATE_SETTINGS,
        contextId: CONTEXTS[0]!.id,
      });
      listTranslationContexts.mockResolvedValue({ contexts: CONTEXTS });
      useStreamingTranslate.mockReturnValue(conversation());
      useConversationSave.mockReturnValue({
        saved: false,
        failure: null,
        saving: false,
        retry: vi.fn(),
      });
    },
    shows: '[data-slot="select-trigger"]',
    render: translate(),
  },
  ...ARRANGEMENTS,
];

/**
 * Screens that break the rule TODAY, with what clears each.
 *
 * **Empty, and that is the point.** It shipped holding one row: `/translate`
 * after a conversation ends drew Start and Generate at once, both filled. The
 * minutes panel now takes an emphasis, `/translate` asks for the quiet one, and
 * this table told the change to delete its own row — the spec fails a listed
 * screen that no longer violates, so the fix could not forget.
 *
 * A new row here is a deliberate, temporary admission, not a place to park one.
 */
const KNOWN_VIOLATIONS: Record<string, number> = {};

let root: Root | undefined;
let container: HTMLElement;

/**
 * What React complained about while rendering a screen.
 *
 * Invalid nesting — a `div` inside a `p`, most often a `Skeleton` dropped into a
 * line of text — is reported here and nowhere else. It renders, it looks right,
 * and it breaks HYDRATION: the browser closes the paragraph before the div, so
 * the tree the server sent and the tree the client builds disagree and the whole
 * subtree is thrown away and re-rendered. Nothing in a test that only reads the
 * DOM can see it, which is how one reached a real page.
 */
let reactErrors: string[];

beforeEach(() => {
  reactErrors = [];
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    reactErrors.push(args.map(String).join(' '));
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  localStorage.clear();
  url.query = '';
  // Here rather than in each `setup()`: a screen that forgot it would get
  // `undefined` back from the factory and the banner's `.catch` would throw.
  checkHealth.mockResolvedValue(undefined);
  // Rejecting by default: nothing in a counting test presses play, so no row
  // should be able to reach a loaded player by accident.
  fetchConversationAudio.mockRejectedValue(new Error('not fetched in this test'));
  uploadConversationAudio.mockResolvedValue(undefined);
  // No contexts, which is what every screen but the two named for them sees.
  listTranslationContexts.mockResolvedValue({ contexts: [] });
  // "None yet", which is what every screen but one sees. `reset` included:
  // `cascade-panel.tsx` calls it from an effect, so a stub missing it throws on
  // every `/translate` row rather than on the one screen the mock is for.
  useMinutes.mockReturnValue({
    minutes: null,
    loading: false,
    error: false,
    generate: vi.fn(),
    reset: vi.fn(),
  });
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  container.remove();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

async function mount(element: React.ReactElement): Promise<void> {
  await act(async () => {
    root = createRoot(container);
    root.render(<LocaleProvider>{element}</LocaleProvider>);
    await Promise.resolve();
  });
}

/**
 * Put a screen-state on screen: arrange its mocks, mount it, and open whatever
 * the row says has to be open.
 *
 * The open step is not cosmetic. Popover content does not exist until it is
 * asked for, and it lands in a portal at `document.body` rather than inside the
 * tree it is written in — so a table that only mounted screens counted the two
 * densest control surfaces on `/translate` as if they were not there. Both
 * assertions below fail loudly rather than silently counting a closed popover.
 *
 * `shows` is the same demand one level down: an open popover whose contents took
 * an early return is still an open popover, and the counts cannot tell the two
 * apart.
 */
async function show(screen: ScreenState): Promise<void> {
  screen.setup();
  await mount(screen.render());

  if (screen.open) {
    const trigger = document.querySelector<HTMLElement>(screen.open);
    expect(trigger, `${screen.name}: nothing matches ${screen.open}`).not.toBeNull();
    await act(async () => {
      trigger?.click();
      await Promise.resolve();
    });
    expect(
      document.querySelector('[data-slot="popover-content"]'),
      `${screen.name}: the popover never opened, so nothing inside it was counted`,
    ).not.toBeNull();
  }

  if (screen.press) {
    const control = document.querySelector<HTMLElement>(screen.press);
    expect(control, `${screen.name}: nothing matches ${screen.press}`).not.toBeNull();
    await act(async () => {
      control?.click();
      // Two turns: the click starts the fetch, the rejection settles it, and the
      // failed line renders on the render after that.
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  if (!screen.shows) return;
  expect(
    document.querySelector(screen.shows),
    `${screen.name}: nothing matches ${screen.shows}, so the row is not mounting what it is named for`,
  ).not.toBeNull();
}

describe('the accent counter', () => {
  it('does not count a checked Switch, whose accent is a state variant', async () => {
    // `/preferences` renders the speak-aloud Switch and `voiceOutput` defaults to
    // true, so a CHECKED switch is on screen carrying
    // `data-[state=checked]:bg-primary` in its class attribute. The substring
    // selector this helper replaced counts that; `classList.contains` does not.
    // Without this test the helper could quietly regress to a substring match and
    // every screen with a switch would start failing for the wrong reason.
    listVoices.mockResolvedValue({ voices: [] });
    await mount(<PreferencesPage />);

    const variantAccent = container.querySelectorAll('[class*="bg-primary"]');
    expect(variantAccent.length, 'expected a checked Switch on this screen').toBeGreaterThan(0);
    expect(accentFilledControls(container).length).toBe(0);
  });
});

describe('every screen is valid HTML', () => {
  it.each(SCREENS)('$name nests nothing the browser would reparent', async (screen) => {
    await show(screen);

    // A `div` inside a `p` renders fine and hydrates wrong: the browser closes
    // the paragraph early, so the server's tree and the client's disagree. React
    // says so on the console and nowhere else.
    const nesting = reactErrors.filter((message) => message.includes('cannot be a descendant'));
    expect(nesting, `${screen.name} renders invalid nesting`).toEqual([]);
  });
});

describe('the app accent budget', () => {
  it.each(SCREENS)('$name draws $filled accent-filled controls', async (screen) => {
    await show(screen);

    expect(container.textContent?.length ?? 0, 'the screen rendered nothing').toBeGreaterThan(20);

    // At most two, and exactly the number this screen is supposed to draw — a
    // ceiling alone would let a screen quietly lose the surface it needs.
    //
    // Counted over the DOCUMENT, not the render container: popovers and dialogs
    // portal to `document.body`, so a card inside an open one is invisible to a
    // scoped count — which is the case most worth catching.
    const surfaces = elevatedSurfaces(document.body).length;
    expect(surfaces, `${screen.name} draws ${surfaces} elevated surfaces`).toBe(screen.surfaces);
    expect(surfaces).toBeLessThanOrEqual(2);

    const known = KNOWN_VIOLATIONS[screen.name];
    // The same root as the surfaces above, and for the same reason. This counted
    // the render container while the comment two lines up argued that portalled
    // content is exactly what a scoped count misses — so a filled control inside
    // an open popover was structurally invisible to the accent half of the gate.
    const actual = accentFilledControls(document.body).length;

    if (known === undefined) {
      expect(actual).toBe(screen.filled);
      // The RULE, asserted separately from the number this row declares. Without
      // it the ceiling was enforced by the table alone: a second filled control
      // was made green by editing `filled` from 1 to 2 — one token, no row in
      // `KNOWN_VIOLATIONS`, and none of the stale-row checking that table exists
      // for. Surfaces have carried their ceiling since the day they were counted.
      expect(actual, `${screen.name} draws ${actual} accent-filled controls`).toBeLessThanOrEqual(
        1,
      );
      return;
    }

    // A listed violation must STILL be violating. Fixed and still listed is a
    // failure, so the table cannot rot into a list of excuses: whoever fixes the
    // screen is told to delete its row.
    expect(
      actual,
      `${screen.name} is listed in KNOWN_VIOLATIONS but now draws ${actual} — delete its row`,
    ).toBe(known);
    expect(known).toBeGreaterThan(screen.filled);
  });
});
