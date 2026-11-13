// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UseStreamingTranslate } from '@/hooks/use-streaming-translate';
import type { UseConferenceReturn } from '@/hooks/use-conference';
import type { UseConferenceEnd } from '@/hooks/use-conference-end';
import { accentFilledControls } from './accent-count';
import { elevatedSurfaces } from './surface-count';
import {
  balanceFixture,
  PLANS,
  SEPAY_ORDER,
  USAGE_PAGE,
} from '@/components/settings/credits.fixture';

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
// one row that wants the failure toast overrides it for itself.
const uploadConversationAudio = vi.hoisted(() => vi.fn<() => Promise<unknown>>());
// The AI Context library, defaulting to an empty one in `beforeEach`.
const listTranslationContexts = vi.hoisted(() => vi.fn<() => Promise<unknown>>());
// The conference lobby's "Create a room". Never pressed by a counting row except
// the one that wants the failure line, which rejects it for itself.
const createConference = vi.hoisted(() => vi.fn<() => Promise<unknown>>());
// The credits reads: Settings › Billing and the `/translate` readiness banner.
// Defaulted in `beforeEach` to a Free account with plenty left and checkout
// closed, which is what every row sees unless it names another state.
const getCreditBalance = vi.hoisted(() => vi.fn<() => Promise<unknown>>());
const listCreditUsage = vi.hoisted(() => vi.fn<() => Promise<unknown>>());
const listPlans = vi.hoisted(() => vi.fn<() => Promise<unknown>>());
const createCheckout = vi.hoisted(() => vi.fn<() => Promise<unknown>>());
// The glossary library and the open glossary's terms.
const deleteAvatar = vi.hoisted(() => vi.fn<() => Promise<unknown>>());
const listGlossaries = vi.hoisted(() => vi.fn<() => Promise<unknown>>());
const listGlossaryItems = vi.hoisted(() => vi.fn<() => Promise<unknown>>());
vi.mock('@/clients/api-client', () => ({
  getCreditBalance: () => getCreditBalance(),
  listCreditUsage: () => listCreditUsage(),
  listPlans: () => listPlans(),
  createCheckout: () => createCheckout(),
  // The QR panel's poll; never answering keeps the panel at "waiting".
  getCheckoutOrder: () => new Promise(() => {}),
  getBillingPortal: vi.fn(),
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
  // Empty unless a `/glossary` row seeds some; the translate screens read it too.
  listGlossaries: () => listGlossaries(),
  listGlossaryItems: () => listGlossaryItems(),
  createConference: () => createConference(),
  // The photo dialog's Remove; only the failed-removal row presses it.
  deleteAvatar: () => deleteAvatar(),
  uploadAvatar: vi.fn(),
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
const url = vi.hoisted(() => {
  const params: Record<string, string> = {};
  return { query: '', params };
});

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/history',
  useSearchParams: () => new URLSearchParams(url.query),
  // A cuid, because the room screen answers anything else as "room not found"
  // without asking the server.
  useParams: () => ({ roomId: 'cl9ebqhxk00003b600tymydho', ...url.params }),
}));

// Whether History's content area is wide enough for two panes. A box-model fact
// happy-dom does not have, so the rows that want the master–detail state say so.
const historyBox = vi.hoisted(() => ({ wide: false }));
vi.mock('@/components/history/use-container-wide', () => ({
  WIDE_PROBE_CLASS: 'hidden @5xl:block',
  useContainerWide: () => historyBox.wide,
}));

// Hoisted so the sign-out-failed row can make it fail.
const signOut = vi.hoisted(() => vi.fn<() => Promise<unknown>>());
vi.mock('next-auth/react', () => ({
  signOut: () => signOut(),
  useSession: () => ({ data: null, status: 'unauthenticated' }),
}));

// `useConference` is mocked so the conference page can be mounted in happy-dom
// without a real WebSocket or WebRTC connection. Typed against the hook's return,
// and every row builds its value through `call()` below, so a field the page
// reads that the hook stops returning is a type error here, not a silent
// `undefined` in a counting test.
const useConference = vi.hoisted(() => vi.fn<() => UseConferenceReturn>());
vi.mock('@/hooks/use-conference', () => ({ useConference: () => useConference() }));

// The end screen's reads and its generate, as one value a row sets — the same
// arrangement as `useMinutes` above, so a row names the state it counts.
const useConferenceEnd = vi.hoisted(() => vi.fn<() => UseConferenceEnd>());
vi.mock('@/hooks/use-conference-end', () => ({ useConferenceEnd: () => useConferenceEnd() }));

const { CascadePanel } = await import('@/components/translate/cascade-panel');
const { AppToaster } = await import('@/components/layout/app-toaster');
const { HistoryMasterDetail } = await import('@/components/history/history-master-detail');
const { SettingsDialog } = await import('@/components/settings/settings-dialog');
const { SettingsTabContent } = await import('@/components/settings/settings-dialog-tab-content');
const { useReportConversationRunning } = await import('@/hooks/use-conversation-running');
const { ChromeSlotsTestHost } = await import('@/components/history/chrome-slots-test-host');
const { default: GlossaryPage } = await import('../../app/(app)/glossary/page');
const { default: ConferenceRoomPage } = await import('../../app/(app)/conference/[roomId]/page');
const { default: ConferenceLobbyPage } = await import('../../app/(app)/conference/page');
const { default: ConferenceEndedPage } =
  await import('../../app/(app)/conference/[roomId]/ended/page');
const { LocaleProvider } = await import('@/i18n/provider');
const { forgetVoiceCatalogs } = await import('@/hooks/use-voice-catalog');
const { DEFAULT_TRANSLATE_SETTINGS, saveTranslateSettings } =
  await import('@/lib/translate-settings');

/** A conversation with one finished block, held at one identity. */
const oneTurn: UseStreamingTranslate['turns'] = [
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
    blockTranslations: {},
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
    ...over,
  };
}

/** A conference hook value: in a call, alone, unless a row says otherwise. */
function call(over: Partial<UseConferenceReturn> = {}): UseConferenceReturn {
  return {
    status: 'in-call',
    errorReason: undefined,
    localStream: null,
    peers: new Map(),
    mySocketId: 's-local',
    localMuted: false,
    localVideoEnabled: true,
    audioBlocked: false,
    localTranslating: false,
    translationEnded: null,
    reconnectAttempt: 0,
    reconnectCap: 3,
    join: vi.fn(() => Promise.resolve()),
    leave: vi.fn(),
    toggleMute: vi.fn(),
    toggleVideo: vi.fn(),
    resumeAudio: vi.fn(() => Promise.resolve()),
    messages: [],
    sendChat: vi.fn(),
    chatRefusal: null,
    ...over,
  };
}

/** Put the room screen in a state: the URL a joined room has, and the hook's value. */
function inRoom(over: Partial<UseConferenceReturn> = {}) {
  return () => {
    url.query = 'name=An&lang=vi';
    useConference.mockReturnValue(call(over));
  };
}

/** An ended room with two participants who spoke, at the shape the end screen reads. */
const ENDED_ROOM: NonNullable<UseConferenceEnd['conference']> = {
  id: 'cl9ebqhxk00003b600tymydho',
  status: 'ended',
  createdAt: '2026-10-26T09:00:00.000Z',
  ownerId: 'u-owner',
  startedAt: '2026-10-26T09:01:00.000Z',
  endedAt: '2026-10-26T09:43:00.000Z',
  participants: [
    {
      id: 'p-1',
      userId: 'u-owner',
      displayName: 'Alice',
      sourceLanguage: 'vi',
      status: 'left',
      joinedAt: '2026-10-26T09:01:00.000Z',
    },
    {
      id: 'p-2',
      userId: 'u-guest',
      displayName: 'Bob',
      sourceLanguage: 'en',
      status: 'left',
      joinedAt: '2026-10-26T09:02:00.000Z',
    },
  ],
  _count: { turns: 12 },
};

/** Put the end screen in a state: loaded, no minutes, unless a row says otherwise. */
function ended(over: Partial<UseConferenceEnd> = {}) {
  return () => {
    useConferenceEnd.mockReturnValue({
      load: 'ready',
      conference: ENDED_ROOM,
      minutes: null,
      generating: false,
      generateFailed: false,
      generate: vi.fn(() => Promise.resolve()),
      ...over,
    });
  };
}

const ALICE: UseConferenceReturn['peers'] = new Map([
  [
    's-peer-1',
    {
      displayName: 'Alice',
      stream: { getTracks: () => [], getVideoTracks: () => [{}] } as unknown as MediaStream,
      subtitle: undefined,
      muted: false,
      videoEnabled: true,
    },
  ],
]);

const translate = (
  settings: Partial<typeof DEFAULT_TRANSLATE_SETTINGS> = {},
  conversationMode: 'one-way' | 'two-way' = 'one-way',
) =>
  function Translate() {
    return (
      <CascadePanel
        conversationMode={conversationMode}
        settings={{ ...DEFAULT_TRANSLATE_SETTINGS, ...settings }}
        onChange={vi.fn()}
        getVolume={() => 1}
      />
    );
  };

/** The same screen as `/translate/two-way` draws it: both ways, its own pair. */
const twoWay = (settings: Partial<typeof DEFAULT_TRANSLATE_SETTINGS> = {}) =>
  translate(settings, 'two-way');

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
    languages: ['vi', 'en'],
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
        sourceLanguages: ['vi'],
        translations: { en: 'hello' },
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
    languages: ['en', 'vi'],
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

/**
 * History as its routes render it: the layout draws the list AND the conversation
 * (the one in `url.params`, or the newest at `/history`); the pages render nothing.
 */
function historyRoute() {
  // In a host with the topbar's slots: the open conversation's crumb and its
  // Rename, Download and `⋯` live there, and outside the chrome they render nothing.
  return (
    <ChromeSlotsTestHost>
      <HistoryMasterDetail>{null}</HistoryMasterDetail>
    </ChromeSlotsTestHost>
  );
}

/**
 * The Settings dialog over a page, as the signed-in frame mounts it: `/history` with
 * nothing stored, which draws no accent and no surface, so the counts are the dialog's.
 */
function settingsOverAPage() {
  return (
    <>
      {historyRoute()}
      <SettingsDialog />
    </>
  );
}

/** A page whose conversation is running, as `/translate` reports it to Settings. */
function RunningConversation() {
  useReportConversationRunning(true);
  return null;
}

/** A `setup` that opens Settings on `tab` over an empty `/history`. */
function settingsOn(tab: string) {
  return () => {
    url.query = `settings=${tab}`;
    listConversations.mockResolvedValue({ conversations: [], nextCursor: null });
  };
}

/** `/glossary` as its route renders it, with the topbar slot its New glossary uses. */
function glossaryRoute() {
  return (
    <ChromeSlotsTestHost>
      <GlossaryPage />
    </ChromeSlotsTestHost>
  );
}

const GLOSSARY = {
  id: '6f1c2b1e-3a4d-4e5f-8a9b-0c1d2e3f4a5b',
  name: 'Thesis defense',
  description: 'Terms the committee uses',
  sourceLang: 'vi',
  isActive: true,
  itemCount: 2,
  createdAt: '2026-11-01T08:00:00.000Z',
  updatedAt: '2026-11-01T08:00:00.000Z',
};

const GLOSSARY_TERMS = [
  {
    id: '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d',
    glossaryId: GLOSSARY.id,
    original: 'hội đồng phản biện',
    translation: 'thesis defense committee',
    targetLang: 'en',
    notes: null,
    createdAt: '2026-11-01T08:01:00.000Z',
  },
  {
    id: '1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e',
    glossaryId: GLOSSARY.id,
    original: 'đồ án',
    translation: 'capstone project',
    targetLang: 'en',
    notes: 'Not "thesis" — the committee is strict about it',
    createdAt: '2026-11-01T08:02:00.000Z',
  },
];

/** One glossary with two terms, opened from its row. */
function glossaryWithTerms() {
  listGlossaries.mockResolvedValue({ glossaries: [GLOSSARY] });
  listGlossaryItems.mockResolvedValue({ items: GLOSSARY_TERMS });
}

const GLOSSARY_ROW = '[data-slot="glossary-row"]';
const NEW_GLOSSARY = '[data-slot="topbar-actions"] button';
const ADD_TERM = '[data-slot="glossary-detail-header"] button:last-child';

/** `/history/<id>` with the list loaded beside it and the conversation answering. */
function openConversation(conversation: ReturnType<typeof stored>) {
  url.params = { conversationId: String(conversation.conversationId) };
  listConversations.mockResolvedValue({ conversations: STORED_CONVERSATIONS, nextCursor: null });
  getConversation.mockResolvedValue({ conversation });
}

const MINUTES_TAB = '[role="tab"][id$="-trigger-minutes"]';
const MORE_ACTIONS = 'button[aria-label="More actions"]';
/** The open conversation's Rename and Download, in the topbar. */
const RENAME = 'button[data-action="rename"]';
const DOWNLOAD = 'button[data-action="download"]';
/** A list row's `⋯` — named for its conversation, so never the header's. */
const ROW_ACTIONS = 'button[aria-label^="More actions for"]';
const MENU_ITEM = (action: string) => `[role="menuitem"][data-action="${action}"]`;
/** The minutes region inside the open Minutes tab, named without a visible title. */
const MINUTES_PANEL = '[role="tabpanel"] section[aria-label="Meeting minutes"]';

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
   * A control to press once the screen is up, by selector. Pressed BEFORE `open`,
   * so a row can reach a state and then open a popover in it — the gear inside
   * fullscreen is one.
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
  /**
   * Controls to press in order, AS A POINTER does: `pointerdown`, `mousedown`, then
   * `click`, with real time to settle after each.
   *
   * `press` above is a bare `.click()`, and Radix answers some triggers before the
   * click ever arrives — a dropdown opens on `pointerdown`, a tab activates on
   * `mousedown` — so a clicked `⋯` or tab is a state that was never reached. The
   * time is for steps that land on a timeout, like a menu reporting it has closed.
   */
  steps?: string[];
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
 * Zero is normal and correct. `/translate` is two hairline sheets on the page ground, not cards; `/history` is a
 * list on the page ground, and the minutes are a region on that ground wherever
 * they render; a meeting's summary card, the settings and account panels, and an
 * open popover are what earn one.
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
 * minutes below the dock sit on the page ground, so no surface. Identical in all
 * three, and that is the assertion — an arrangement changes how the transcript is
 * laid out and nothing else, so a second card or a second filled control that
 * appears in ONE of them is exactly what these rows catch.
 */
const ARRANGEMENTS = [
  { name: '/translate/one-way — one merged list', settings: { displayMode: 'list' as const } },
  {
    name: '/translate/one-way — panes stacked',
    settings: { displayMode: 'split' as const, paneLayout: 'column' as const },
  },
  { name: '/translate/one-way — translation only', settings: { translationOnly: true } },
].map(({ name, settings }) => ({
  name,
  filled: 1,
  surfaces: 0,
  shows: '[data-minutes-panel]',
  setup: idle,
  render: translate(settings),
}));

const SCREENS: ScreenState[] = [
  {
    name: '/translate/one-way — before anything starts',
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
    // Under one credit: the readiness banner says Start will be refused. It is
    // a notice, not a control, and Start stays the one filled action.
    name: '/translate/one-way — balance under one credit',
    filled: 1,
    surfaces: 0,
    setup() {
      getCreditBalance.mockResolvedValue(balanceFixture({ totalCredits: 0.5 }));
      useStreamingTranslate.mockReturnValue(conversation());
      useConversationSave.mockReturnValue({
        saved: false,
        failure: null,
        saving: false,
        retry: vi.fn(),
      });
    },
    render: translate(),
    shows: '[data-credits-fault]',
  },
  {
    // Credits running low mid-conversation: a readout line, and the run goes on.
    name: '/translate/one-way — running, credits low',
    filled: 0,
    surfaces: 0,
    setup() {
      useStreamingTranslate.mockReturnValue(
        conversation({ status: 'listening', notice: 'About 2 credits left.' }),
      );
      useConversationSave.mockReturnValue({
        saved: false,
        failure: null,
        saving: false,
        retry: vi.fn(),
      });
    },
    render: translate(),
    shows: '[data-conversation-notice]',
  },
  {
    name: '/translate/one-way — running',
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
  // Fullscreen carries the dock's controls in its own bar, and the dock's copy
  // of Start is not rendered meanwhile — both at once would be two accents on a
  // screen whose reader sees only one of them, which is exactly what this table
  // could not tell apart from the right answer if the dock kept its copy.
  {
    name: '/translate/one-way — fullscreen, before anything starts',
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
    press: 'button[aria-label="Full screen"]',
    shows: '[data-stage-bar] button.bg-primary',
  },
  {
    name: '/translate/one-way — fullscreen, running',
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
    press: 'button[aria-label="Full screen"]',
    shows: '[data-stage-bar] button[aria-label="Exit full screen"]',
  },
  {
    // The gear opened from inside fullscreen: its panel is the one surface, and
    // it lands inside the stage — where the browser draws it — not on the body.
    name: '/translate/one-way — fullscreen, display settings open',
    filled: 1,
    surfaces: 1,
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
    press: 'button[aria-label="Full screen"]',
    open: '[data-stage-bar] button[aria-label="Display settings"]',
    shows: 'section [data-slot="popover-content"]',
  },
  // `/translate/two-way` is the same panel run both ways: two language pickers, no
  // source control, and Start as the one accent — at rest and in fullscreen.
  {
    name: '/translate/two-way — before anything starts',
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
    render: twoWay(),
  },
  {
    name: '/translate/two-way — fullscreen, before anything starts',
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
    render: twoWay(),
    press: 'button[aria-label="Full screen"]',
    shows: '[data-stage-bar] button.bg-primary',
  },
  // The one-way source picker's "Auto-detect" and what it reaches. Every readout it adds —
  // the mode beside the source role, a turn's language tag, the line saying a
  // two-way start is running one way — is muted text, so each of these states
  // spends exactly what its declared twin above spends.
  {
    name: '/translate/one-way — auto-detect, before anything starts',
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
    // The swap goes dead only for an undeclared source while nothing is running.
    shows: 'button[aria-label^="Swap languages"]:disabled',
    render: translate({ languagePair: { source: 'detect', target: 'en' } }),
  },
  {
    name: '/translate/one-way — auto-detect, running',
    filled: 0,
    surfaces: 0,
    setup() {
      useStreamingTranslate.mockReturnValue(
        conversation({
          status: 'listening',
          languagePair: { source: 'detect', target: 'en' },
          languageMode: { mode: 'detect' },
          liveTurns: [{ sessionId: 'b', text: 'good morning', translation: '', language: 'en' }],
        }),
      );
      useConversationSave.mockReturnValue({
        saved: false,
        failure: null,
        saving: false,
        retry: vi.fn(),
      });
    },
    shows: '[data-language-mode="detect"]',
    render: translate({ languagePair: { source: 'detect', target: 'en' } }),
  },
  {
    name: '/translate/two-way — running with a turn from each side',
    filled: 0,
    surfaces: 0,
    setup() {
      useStreamingTranslate.mockReturnValue(
        conversation({
          status: 'listening',
          twoWayRequested: true,
          languageMode: { mode: 'two-way' },
          turns: [
            ...oneTurn,
            {
              id: 'seg-b',
              sessionId: 'b',
              speakerRole: 'speaker_b',
              sourceLanguages: ['en'],
              translations: { vi: 'chào buổi sáng' },
              sourceText: 'good morning',
              audioUrl: null,
              createdAt: '2026-09-03T00:00:05.000Z',
            },
          ],
          languageModes: { a: 'two-way', b: 'two-way' },
        }),
      );
      useConversationSave.mockReturnValue({
        saved: false,
        failure: null,
        saving: false,
        retry: vi.fn(),
      });
    },
    shows: '[data-turn-language="en"]',
    render: twoWay(),
  },
  {
    name: '/translate/two-way — asked both ways, running one way',
    filled: 0,
    surfaces: 0,
    setup() {
      useStreamingTranslate.mockReturnValue(
        conversation({
          status: 'listening',
          turns: oneTurn,
          twoWayRequested: true,
          languageMode: { mode: 'declared', reason: 'language_detection' },
          languageModes: { a: 'declared' },
        }),
      );
      useConversationSave.mockReturnValue({
        saved: false,
        failure: null,
        saving: false,
        retry: vi.fn(),
      });
    },
    shows: '[data-two-way-unavailable]',
    render: twoWay(),
  },
  {
    // One, where `— running` spends none. The microphone is off and the screen
    // is waiting on a single decision, so Resume is the filled control; End
    // beside it is `live`, which is its own token and not the accent.
    //
    // Still zero surfaces: paused is a RUNNING state, so nothing that appears
    // after a conversation ends is on screen yet.
    name: '/translate/one-way — paused',
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
    name: '/translate/one-way — finishing',
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
    name: '/translate/one-way — ended, turns stored',
    filled: 1,
    surfaces: 0,
    shows: '[data-minutes-panel]',
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
    // The failure is a toast now, so the row mounts the app's toast host beside
    // the panel and counts what it draws: one surface — the toast, over the page —
    // and no accent, because its Retry is the quiet action button. Start is still
    // the screen's one.
    name: '/translate/one-way — the recording failed to upload',
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
    // The toast only mounts once the automatic upload has fired and failed —
    // proof the row actually reached that state rather than counting the
    // untouched screen above with a mock nobody exercised.
    shows: '[data-sonner-toast]',
    render: function TranslateWithToasts() {
      const Translate = translate();
      return (
        <>
          <Translate />
          <AppToaster />
        </>
      );
    },
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
    render: historyRoute,
  },
  {
    // The state this screen is actually FOR on a phone: day headings, rows on the
    // page ground, a minutes badge, and "Load more" under a further cursor. Every
    // one of those is where a card or a filled control would arrive.
    name: '/history — days of conversations, and more behind them',
    filled: 0,
    surfaces: 0,
    setup() {
      listConversations.mockResolvedValue({
        conversations: STORED_CONVERSATIONS,
        nextCursor: 'c-3',
      });
    },
    shows: 'a[href^="/history/"]',
    render: historyRoute,
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
    render: historyRoute,
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
    render: historyRoute,
  },
  {
    // The combined screen, and the one most likely to break both budgets: the list
    // AND the newest conversation, open beside it at `/history`. Zero of each — the
    // conversation opens on its transcript, which is on the page ground, and the
    // one control that would spend the accent (Generate) is behind the Minutes tab.
    name: '/history — wide, the newest conversation open beside the list',
    filled: 0,
    surfaces: 0,
    setup() {
      historyBox.wide = true;
      listConversations.mockResolvedValue({
        conversations: STORED_CONVERSATIONS,
        nextCursor: 'c-3',
      });
      getConversation.mockResolvedValue({ conversation: stored() });
    },
    // Proof the pane is up: the detail's facts, which only a loaded conversation
    // draws. No steps to press — the empty list lets both fetches land.
    shows: '[data-slot="conversation-detail-header"]',
    steps: [],
    render: historyRoute,
  },
  {
    // The same screen on its Minutes tab: Generate is the one accent, and the
    // minutes panel is on the page ground — with the whole list still beside it.
    name: '/history — wide, the newest conversation on its Minutes tab',
    filled: 1,
    surfaces: 0,
    setup() {
      historyBox.wide = true;
      listConversations.mockResolvedValue({
        conversations: STORED_CONVERSATIONS,
        nextCursor: 'c-3',
      });
      getConversation.mockResolvedValue({ conversation: stored() });
    },
    steps: [MINUTES_TAB],
    shows: MINUTES_PANEL,
    render: historyRoute,
  },
  {
    // Wide, with nothing stored: one column, the empty state, no reading pane.
    name: '/history — wide, nothing stored yet',
    filled: 0,
    surfaces: 0,
    setup() {
      historyBox.wide = true;
      listConversations.mockResolvedValue({ conversations: [], nextCursor: null });
    },
    render: historyRoute,
  },
  {
    // Wide, with a search that matched nothing: the list says so, the pane is empty.
    name: '/history — wide, nothing matched the search',
    filled: 0,
    surfaces: 0,
    setup() {
      historyBox.wide = true;
      url.query = 'q=cảm ơn';
      listConversations.mockResolvedValue({ conversations: [], nextCursor: null });
    },
    render: historyRoute,
  },
  {
    // A stored conversation on a phone, as it opens: header, tabs, the transcript
    // on the ground. Nothing filled — back is ghost, play and `⋯` are outline — and
    // no surface, because the transcript is not a card any more.
    name: '/history/[conversationId] — on its transcript',
    filled: 0,
    surfaces: 0,
    setup() {
      openConversation(stored());
    },
    shows: '[role="tab"][aria-selected="true"]',
    render: historyRoute,
  },
  {
    // The Minutes tab before anything was generated: exactly one accent, and it is
    // Generate; no surface, because the minutes panel is not a card.
    name: '/history/[conversationId] — no minutes yet',
    filled: 1,
    surfaces: 0,
    setup() {
      openConversation(stored());
    },
    steps: [MINUTES_TAB],
    shows: MINUTES_PANEL,
    render: historyRoute,
  },
  {
    // Minutes exist, so the panel draws its body and gains a copy control beside
    // the button. Still one accent and no surface: regenerate is the same
    // default-variant control, copy is ghost, and the body is on the page ground.
    name: '/history/[conversationId] — minutes generated',
    filled: 1,
    surfaces: 0,
    setup() {
      openConversation(stored({ hasMinutes: true }));
      useMinutes.mockReturnValue({
        minutes: READY_MINUTES,
        loading: false,
        error: false,
        generate: vi.fn(),
        reset: vi.fn(),
      });
    },
    steps: [MINUTES_TAB],
    shows: MINUTES_PANEL,
    render: historyRoute,
  },
  {
    // The recording controls in the header: a play button, a slider and a readout.
    // Play is `outline`. The slider's filled range carries `bg-primary` and does
    // NOT count, because `accentFilledControls` restricts to `button, a,
    // [role="button"]` and the range is a `div` — this row is what proves that
    // exemption still holds rather than merely asserting it.
    name: '/history/[conversationId] — with a recording',
    filled: 0,
    surfaces: 0,
    setup() {
      openConversation(
        stored({ hasRecording: true, audioOffsetMs: 1_400, audioDurationMs: 600_000 }),
      );
    },
    shows: '[role="slider"]',
    render: historyRoute,
  },
  {
    // A recording the reader has PRESSED PLAY on and that failed to load. `failed`
    // is only set inside the player's `load()`, which runs from a press, so the
    // press is what makes this a distinct state — and the failure must not answer
    // with a card or a filled retry.
    name: '/history/[conversationId] — the recording failed to load',
    filled: 0,
    surfaces: 0,
    setup() {
      openConversation(
        stored({ hasRecording: true, audioOffsetMs: 1_400, audioDurationMs: 600_000 }),
      );
      fetchConversationAudio.mockRejectedValue(new Error('offline'));
    },
    press: 'button[aria-label="Play the recording"]',
    shows: '[role="status"]',
    render: historyRoute,
  },
  {
    // The `⋯` menu open. Its content is the one elevated surface while it is open,
    // and Delete in it is a menu item, not a filled control.
    name: '/history/[conversationId] — the actions menu open',
    filled: 0,
    surfaces: 1,
    setup() {
      openConversation(stored());
    },
    steps: [MORE_ACTIONS],
    shows: '[role="menuitem"]',
    render: historyRoute,
  },
  {
    // Delete chosen: the AlertDialog is the one elevated surface. The destructive
    // press fills with `live-fill`, not the accent.
    name: '/history/[conversationId] — confirming a delete',
    filled: 0,
    surfaces: 1,
    setup() {
      openConversation(stored());
    },
    steps: [MORE_ACTIONS, MENU_ITEM('delete')],
    shows: '[role="alertdialog"]',
    render: historyRoute,
  },
  {
    // Rename pressed in the topbar: the dialog is the one surface, and its Save is
    // OUTLINE — a rename is not the screen's action.
    name: '/history/[conversationId] — renaming the title',
    filled: 0,
    surfaces: 1,
    setup() {
      openConversation(stored());
    },
    steps: [RENAME],
    shows: '[role="dialog"] input',
    render: historyRoute,
  },
  {
    // Why Save is outline: renaming from the Minutes tab keeps Generate mounted
    // behind the dialog, and a filled Save would make two.
    name: '/history/[conversationId] — renaming over the Minutes tab',
    filled: 1,
    surfaces: 1,
    setup() {
      openConversation(stored());
    },
    steps: [MINUTES_TAB, RENAME],
    shows: '[role="dialog"] input',
    render: historyRoute,
  },
  {
    // The topbar's Download menu open, with the recording item under the formats:
    // one surface.
    name: '/history/[conversationId] — the download menu open',
    filled: 0,
    surfaces: 1,
    setup() {
      openConversation(stored({ hasRecording: true, audioOffsetMs: 0, audioDurationMs: 600_000 }));
    },
    steps: [DOWNLOAD],
    shows: MENU_ITEM('download-recording'),
    render: historyRoute,
  },
  {
    // A row's own `⋯` open on the list: the same menu, one surface, nothing filled.
    name: "/history — a row's actions menu open",
    filled: 0,
    surfaces: 1,
    setup() {
      listConversations.mockResolvedValue({
        conversations: STORED_CONVERSATIONS,
        nextCursor: null,
      });
    },
    steps: [ROW_ACTIONS],
    shows: MENU_ITEM('download-transcript'),
    render: historyRoute,
  },
  {
    // A row's Download transcript submenu open beside its menu: two elevated
    // surfaces, the ceiling, and the reason nothing else here may be one.
    name: "/history — a row's download submenu open",
    filled: 0,
    surfaces: 2,
    setup() {
      listConversations.mockResolvedValue({
        conversations: STORED_CONVERSATIONS,
        nextCursor: null,
      });
    },
    steps: [ROW_ACTIONS, '[data-action="download-transcript"]'],
    shows: MENU_ITEM('download-srt'),
    render: historyRoute,
  },
  {
    // Rename chosen on a row: the same dialog as the topbar's, one surface.
    name: '/history — renaming from a row',
    filled: 0,
    surfaces: 1,
    setup() {
      listConversations.mockResolvedValue({
        conversations: STORED_CONVERSATIONS,
        nextCursor: null,
      });
    },
    steps: [ROW_ACTIONS, MENU_ITEM('rename')],
    shows: '[role="dialog"] input',
    render: historyRoute,
  },
  {
    // Delete chosen on a row: the same AlertDialog as the topbar's, one surface.
    name: '/history — confirming a delete from a row',
    filled: 0,
    surfaces: 1,
    setup() {
      listConversations.mockResolvedValue({
        conversations: STORED_CONVERSATIONS,
        nextCursor: null,
      });
    },
    steps: [ROW_ACTIONS, MENU_ITEM('delete')],
    shows: '[role="alertdialog"]',
    render: historyRoute,
  },
  {
    // A deep link to an older conversation on a wide screen: the list beside it,
    // that row marked, and the same zero counts as the phone's transcript view.
    name: '/history/[conversationId] — wide, beside the list',
    filled: 0,
    surfaces: 0,
    setup() {
      historyBox.wide = true;
      openConversation(stored({ conversationId: 'c-2' }));
    },
    shows: 'a[aria-current="page"][href="/history/c-2"]',
    render: historyRoute,
  },
  {
    // A foreign or deleted id. Zero of both: the records that earn a surface are
    // the ones that did not load, and there is nothing to generate.
    name: '/history/[conversationId] — no longer here',
    filled: 0,
    surfaces: 0,
    setup() {
      url.params = { conversationId: 'c-1' };
      listConversations.mockResolvedValue({
        conversations: STORED_CONVERSATIONS,
        nextCursor: null,
      });
      getConversation.mockRejectedValue(new Error('not found'));
    },
    render: historyRoute,
  },
  {
    // Nothing yet: the empty list, and New glossary in the topbar — outline, so
    // the screen spends nothing until a dialog opens.
    name: '/glossary — nothing yet',
    filled: 0,
    surfaces: 0,
    setup() {
      listGlossaries.mockResolvedValue({ glossaries: [] });
    },
    shows: '[data-slot="glossary-empty"]',
    render: glossaryRoute,
  },
  {
    // The list failed: a notice and an outline retry, inline.
    name: '/glossary — the list failed',
    filled: 0,
    surfaces: 0,
    setup() {
      listGlossaries.mockRejectedValue(new Error('offline'));
    },
    shows: '[role="alert"]',
    render: glossaryRoute,
  },
  {
    // Rows on the page ground, none open: no box per row, nothing filled.
    name: '/glossary — glossaries listed',
    filled: 0,
    surfaces: 0,
    setup: glossaryWithTerms,
    shows: GLOSSARY_ROW,
    render: glossaryRoute,
  },
  {
    // A glossary open beside the list with its terms: the switch's fill is a
    // state, Add term is outline, the term rows sit between hairlines.
    name: '/glossary — a glossary open, with terms',
    filled: 0,
    surfaces: 0,
    setup: glossaryWithTerms,
    steps: [GLOSSARY_ROW],
    shows: '[data-slot="glossary-term"]',
    render: glossaryRoute,
  },
  {
    // New glossary pressed: the dialog is the one surface and Create the one
    // accent — the topbar button under it is outline.
    name: '/glossary — creating a glossary',
    filled: 1,
    surfaces: 1,
    setup: glossaryWithTerms,
    steps: [NEW_GLOSSARY],
    shows: '[role="dialog"] form',
    render: glossaryRoute,
  },
  {
    // Add term pressed: the same arithmetic as creating.
    name: '/glossary — adding a term',
    filled: 1,
    surfaces: 1,
    setup: glossaryWithTerms,
    steps: [GLOSSARY_ROW, ADD_TERM],
    shows: '[role="dialog"] form',
    render: glossaryRoute,
  },
  {
    // Edit on a term: the same dialog, filled with the term.
    name: '/glossary — editing a term',
    filled: 1,
    surfaces: 1,
    setup: glossaryWithTerms,
    steps: [GLOSSARY_ROW, 'button[aria-label^="Edit "]'],
    shows: '[role="dialog"] form',
    render: glossaryRoute,
  },
  {
    // Deleting the open glossary: the AlertDialog, one surface, and its press is
    // `destructive`, not the accent.
    name: '/glossary — confirming a glossary delete',
    filled: 0,
    surfaces: 1,
    setup: glossaryWithTerms,
    steps: [GLOSSARY_ROW, '[data-slot="glossary-detail-header"] button[aria-label^="Delete"]'],
    shows: '[role="alertdialog"]',
    render: glossaryRoute,
  },
  // ---- Settings ----
  //
  // Settings is one dialog over whatever page is open, so each state is the dialog on
  // one tab over a page — `/history` with nothing stored, which spends no accent and no
  // surface of its own, so every count below is the dialog's.
  //
  // ONE surface in every state at rest: the dialog itself. Its groups are hairline
  // boxes with no shadow and its tab list is buttons on its own ground. A nested
  // dialog opened from a tab — the photo dialog, the password dialog, the sign-out
  // confirmation — is the second, and the ceiling.
  //
  // ZERO accent at rest on every tab but Billing with checkout open. The one filled
  // control a settings state may spend belongs to the thing that state is for: the
  // Upgrade by card when a Free account can check out, Save in the context editor, the pick in the photo dialog, the submit in
  // the password dialog, the confirm in the sign-out dialog.
  {
    name: 'settings dialog › general, over /history',
    filled: 0,
    surfaces: 1,
    setup: settingsOn('general'),
    render: settingsOverAPage,
    shows: '[data-settings-pane="general"] [role="radiogroup"]',
  },
  {
    name: 'settings dialog › translation — the catalog is empty',
    filled: 0,
    surfaces: 1,
    setup() {
      settingsOn('translation')();
      listVoices.mockResolvedValue({ voices: [] });
    },
    render: settingsOverAPage,
    shows: '[data-settings-pane="translation"] [role="switch"]',
  },
  {
    // The same tab with a backend that actually answers: the picker lists voices
    // instead of saying there are none. Every row starts with no cached catalog
    // (`show` forgets them), so this row's answer is what the panels list.
    name: 'settings dialog › translation — voices listed',
    filled: 0,
    surfaces: 1,
    setup() {
      settingsOn('translation')();
      saveTranslateSettings({
        ...DEFAULT_TRANSLATE_SETTINGS,
        languagePair: { source: 'en', target: 'zh' },
      });
      listVoices.mockResolvedValue({ voices: VOICES });
    },
    render: settingsOverAPage,
    shows: '[data-settings-pane="translation"] [role="switch"]',
  },
  {
    // Frozen pairs and voices, and the one line saying why, spend nothing either.
    name: 'settings dialog › translation — a conversation running underneath',
    filled: 0,
    surfaces: 1,
    setup: settingsOn('translation'),
    render: () => (
      <>
        <RunningConversation />
        {settingsOverAPage()}
      </>
    ),
    shows: '[data-settings-pane="translation"] [data-settings-locked]',
  },
  {
    name: 'settings dialog › ai-context',
    filled: 0,
    surfaces: 1,
    setup() {
      settingsOn('ai-context')();
      listTranslationContexts.mockResolvedValue({ contexts: CONTEXTS });
    },
    render: settingsOverAPage,
    shows: '[data-settings-pane="ai-context"] li button[data-slot="button"]',
  },
  {
    // The editor open, the ONE state on this tab that spends an accent: Save is the
    // thing you came here to do and it exists only while there is something to save.
    // It expands inline, so still only the dialog's surface.
    //
    // The first button in a row of the list is the first context's Edit.
    name: 'settings dialog › ai-context — editing a context',
    filled: 1,
    surfaces: 1,
    setup() {
      settingsOn('ai-context')();
      listTranslationContexts.mockResolvedValue({ contexts: CONTEXTS });
    },
    press: '[data-settings-pane="ai-context"] li button[data-slot="button"]',
    shows: '[data-settings-pane="ai-context"] [data-slot="textarea"]',
    render: settingsOverAPage,
  },
  {
    name: 'settings dialog › account',
    filled: 0,
    surfaces: 1,
    setup() {
      settingsOn('account')();
      getMe.mockResolvedValue({
        id: 'u1',
        email: 'a@b.co',
        name: 'Quang Anh',
        createdAt: '2026-01-09T00:00:00.000Z',
      });
    },
    render: settingsOverAPage,
    shows: '[data-settings-pane="account"] #change-password-open',
  },
  {
    // The profile request failed: the join date says so and nothing is promoted.
    name: 'settings dialog › account — the profile request failed',
    filled: 0,
    surfaces: 1,
    setup() {
      settingsOn('account')();
      getMe.mockRejectedValue(new Error('unauthorized'));
    },
    render: settingsOverAPage,
    shows: '[data-settings-pane="account"] #photo-change-open',
  },
  {
    // The Change photo dialog, over Settings: its surface is the second, and "Choose
    // an image" is its one filled control; Remove is ghost.
    name: 'settings dialog › account — change photo dialog open',
    filled: 1,
    surfaces: 2,
    setup() {
      settingsOn('account')();
      getMe.mockRejectedValue(new Error('not read in this row'));
    },
    press: '#photo-change-open',
    shows: '[role="dialog"] #photo-choose',
    render: settingsOverAPage,
  },
  {
    // The password dialog: its submit is the state's one filled control.
    name: 'settings dialog › account — change password dialog open',
    filled: 1,
    surfaces: 2,
    setup() {
      settingsOn('account')();
      getMe.mockRejectedValue(new Error('not read in this row'));
    },
    press: '#change-password-open',
    shows: '[role="dialog"] #change-password-submit',
    render: settingsOverAPage,
  },
  {
    // Sign out asks first. The confirm is the state's one filled control; Cancel
    // is outline.
    name: 'settings dialog › account — confirming sign-out',
    filled: 1,
    surfaces: 2,
    setup() {
      settingsOn('account')();
      getMe.mockRejectedValue(new Error('not read in this row'));
    },
    press: '#sign-out-account',
    shows: '[role="alertdialog"] #sign-out-confirm',
    render: settingsOverAPage,
  },
  {
    // A sign-out that failed says so INSIDE its confirmation, never as a toast: a
    // toast would be a third surface over Settings and the confirmation. The confirm
    // is still the one filled control, for pressing again.
    name: 'settings dialog › account — sign-out failed',
    filled: 1,
    surfaces: 2,
    setup() {
      settingsOn('account')();
      getMe.mockRejectedValue(new Error('not read in this row'));
      signOut.mockRejectedValue(new Error('offline'));
    },
    steps: ['#sign-out-account', '#sign-out-confirm'],
    shows: '[role="alertdialog"] #sign-out-failed',
    render: settingsOverAPage,
  },
  {
    // A photo removal the server refused: inline under the photo, never a toast.
    name: 'settings dialog › account — photo change failed',
    filled: 1,
    surfaces: 2,
    setup() {
      settingsOn('account')();
      getMe.mockResolvedValue({
        id: 'u1',
        email: 'a@b.co',
        name: 'Quang Anh',
        createdAt: '2026-01-09T00:00:00.000Z',
        avatarUrl: 'https://cdn.example.com/a/k.webp',
      });
      deleteAvatar.mockRejectedValue(new Error('offline'));
    },
    steps: ['#photo-change-open', '#photo-remove'],
    shows: '[role="dialog"] [role="alert"]',
    render: settingsOverAPage,
  },
  {
    // The commonest Settings state: a change saved, its toast offering Undo. The toast
    // is in Settings' own host, inside the dialog: two surfaces, and Undo is quiet.
    name: 'settings dialog › general — saved, Undo toast',
    filled: 0,
    surfaces: 2,
    setup: settingsOn('general'),
    steps: ['[data-theme-tile="dark"] [role="radio"]'],
    shows: '[role="dialog"] [data-sonner-toast]',
    render: settingsOverAPage,
  },
  {
    // Back from Polar: Billing opens straight onto the "payment finished" toast, in
    // Settings' own host inside the dialog — the dialog and the toast, two surfaces.
    // (That the toast is routed there from the tab's first effect is pinned by
    // `settings-dialog.spec.tsx`.)
    name: 'settings dialog › billing — back from checkout',
    filled: 0,
    surfaces: 2,
    setup() {
      settingsOn('billing')();
      url.query = 'settings=billing&checkout=done';
    },
    render: settingsOverAPage,
    shows: '[role="dialog"] [data-sonner-toast]',
  },
  {
    // Checkout closed: the balance, the plan columns, the top-up tiles and the usage
    // list, all hairline regions with no shadow, and every Upgrade and Buy outline —
    // a disabled filled button would read as available.
    name: 'settings dialog › billing — Free, checkout closed',
    filled: 0,
    surfaces: 1,
    setup: settingsOn('billing'),
    render: settingsOverAPage,
    shows: '[data-credit-topups] button[disabled]',
  },
  {
    // An allowlisted Free account: Upgrade by card is the tab's one filled control;
    // Upgrade by VietQR, the payment-method segments and every Buy are quiet.
    name: 'settings dialog › billing — Free, checkout open',
    filled: 1,
    surfaces: 1,
    setup() {
      settingsOn('billing')();
      getCreditBalance.mockResolvedValue(balanceFixture({ checkoutAllowed: true }));
    },
    render: settingsOverAPage,
    shows: '[data-credit-topups] button:not([disabled])',
  },
  {
    // Pro by card subscription: the Pro column marked "Your plan" by an edge and a
    // check, Manage outline, no Upgrade — nothing on the tab outranks the rest.
    name: 'settings dialog › billing — Pro by card subscription',
    filled: 0,
    surfaces: 1,
    setup() {
      settingsOn('billing')();
      getCreditBalance.mockResolvedValue(
        balanceFixture({ checkoutAllowed: true, plan: 'pro', proSource: 'polar' }),
      );
    },
    render: settingsOverAPage,
    shows: '[data-plan-column="pro"][data-current-plan]',
  },
  {
    // Pro by a VietQR pass: the same, with its end date and no Manage.
    // Renew by VietQR is outline: renewing a pass is housekeeping, not the thing the
    // tab is for, so nothing is filled.
    name: 'settings dialog › billing — Pro by VietQR pass',
    filled: 0,
    surfaces: 1,
    setup() {
      settingsOn('billing')();
      getCreditBalance.mockResolvedValue(
        balanceFixture({ checkoutAllowed: true, plan: 'pro', proSource: 'sepay' }),
      );
    },
    render: settingsOverAPage,
    shows: '[data-plan-column="pro"][data-current-plan] [data-plan-checkout="sepay"]',
  },
  {
    // An allowlisted account bought a pack by VietQR. The QR panel is a hairline
    // region under the tiles, not a card, and its controls are ghost: Upgrade by card is still
    // the one filled control.
    name: 'settings dialog › billing — SePay QR open',
    filled: 1,
    surfaces: 1,
    setup() {
      settingsOn('billing')();
      getCreditBalance.mockResolvedValue(balanceFixture({ checkoutAllowed: true }));
      createCheckout.mockResolvedValue(SEPAY_ORDER);
    },
    render: settingsOverAPage,
    steps: [
      '[data-credit-topups] [data-value="sepay"]',
      '[data-credit-topups] li:first-child button',
    ],
    shows: '[data-credit-topups] [data-sepay-qr-panel]',
  },
  {
    // A Free account chose Upgrade by VietQR: the QR panel opens under the plan
    // columns, a hairline region with ghost controls, and Upgrade by card is still
    // the one filled control.
    name: 'settings dialog › billing — QR open from Upgrade by VietQR',
    filled: 1,
    surfaces: 1,
    setup() {
      settingsOn('billing')();
      getCreditBalance.mockResolvedValue(balanceFixture({ checkoutAllowed: true }));
      createCheckout.mockResolvedValue({ ...SEPAY_ORDER, amountVnd: 249000 });
    },
    render: settingsOverAPage,
    steps: ['[data-plan-column="pro"] [data-plan-checkout="sepay"]'],
    shows: '[data-credit-plans] ~ [data-sepay-qr-panel]',
  },
  {
    // Open, because closed it renders nothing. Six settings sit behind this gear
    // and the surface they arrive on is the popover's own — so it must count as
    // one, and everything inside it must count too. The switches carry
    // `data-[state=checked]:bg-primary`, which is a state variant rather than an
    // accent; the slider paints its range on a `div`. Neither is a control that
    // reads as THE action, and `accent-count.ts` says why.
    name: '/translate/one-way — display settings open',
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
    // `shows` keeps it honest: the voice Select exists only when the catalog
    // answered with voices, so an empty popover cannot pass for a full one.
    name: '/translate/one-way — voice settings open',
    filled: 1,
    surfaces: 1,
    open: 'button[data-voice-language="zh"]',
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
    render: translate({ languagePair: { source: 'en', target: 'zh' } }),
  },
  {
    // The two-way page's SECOND voice trigger, the one on the source header: each
    // language opens its own popover now, so the screen gains a control, and it
    // must spend no accent and add no surface beyond the popover itself.
    name: '/translate/two-way — source voice settings open',
    filled: 1,
    surfaces: 1,
    open: 'button[data-voice-language="vi"]',
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
    render: twoWay({ twoWayPair: { source: 'vi', target: 'en' } }),
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
    name: '/translate/one-way — a context selected',
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

  // ---- /conference landing ----
  //
  // "New meeting" is the one accent; "Join with a code" is outline. Its dialog
  // holds the code field, and while it is open the dialog's Join is the accent and
  // New meeting steps down to outline behind the scrim; the dialog is the one
  // elevated surface.
  {
    name: '/conference — lobby',
    filled: 1,
    surfaces: 0,
    setup() {},
    render: () => <ConferenceLobbyPage />,
    shows: '[data-join-by-code]',
  },
  {
    name: '/conference — lobby, opened from a shared room link',
    filled: 1,
    surfaces: 0,
    setup() {
      url.query = 'room=cl9ebqhxk00003b600tymydho&lang=en';
    },
    render: () => <ConferenceLobbyPage />,
    shows: '[data-join-by-code]',
  },
  {
    name: '/conference — join with a code dialog open',
    filled: 1,
    surfaces: 1,
    setup() {},
    render: () => <ConferenceLobbyPage />,
    steps: ['[data-join-by-code]'],
    shows: '[role="dialog"] #conf-room',
  },

  // ---- /conference/[roomId] pre-join screen ----
  //
  // "Join now" is the one accent. The mic and camera toggles and the voice chip
  // are outline, the device pickers are fields. The preview is a muted region on
  // the page ground, not a card; the voice popover is the one surface it opens.
  {
    name: '/conference/[roomId] — pre-join',
    filled: 1,
    surfaces: 0,
    setup() {
      url.query = '';
      useConference.mockReturnValue(call({ status: 'idle', mySocketId: null }));
    },
    render: () => <ConferenceRoomPage />,
    shows: '#conf-name',
  },
  {
    name: '/conference/[roomId] — pre-join, voice popover open',
    filled: 1,
    surfaces: 1,
    setup() {
      url.query = '';
      useConference.mockReturnValue(call({ status: 'idle', mySocketId: null }));
    },
    render: () => <ConferenceRoomPage />,
    open: '[data-conference-voice-chip]',
  },

  // ---- /conference/[roomId] in-call screen ----
  //
  // Every state spends exactly ONE accent: Leave, or Back to lobby where the call
  // is over. Mic and camera are outline, the roster button is ghost. Zero
  // elevated surfaces: the call screen is the page ground; the roster and chat
  // are a flat side region, not cards.
  {
    name: '/conference/[roomId] — waiting for others',
    filled: 1,
    surfaces: 0,
    setup: inRoom(),
    render: () => <ConferenceRoomPage />,
  },
  {
    name: '/conference/[roomId] — in-call with a peer',
    filled: 1,
    surfaces: 0,
    setup: inRoom({ peers: ALICE }),
    render: () => <ConferenceRoomPage />,
  },
  {
    // The roster opens with the screen, and the chat lives under it; with
    // messages in it the region carries its densest state.
    name: '/conference/[roomId] — roster and chat open, with messages',
    filled: 1,
    surfaces: 0,
    setup: inRoom({
      peers: ALICE,
      messages: [
        {
          id: 'm-1',
          socketId: 's-peer-1',
          displayName: 'Alice',
          text: 'Hello',
          lang: 'en',
          sentAt: Date.parse('2026-10-25T00:00:00.000Z'),
        },
        {
          id: 'm-2',
          socketId: 's-local',
          displayName: 'An',
          text: 'Hi',
          lang: 'en',
          sentAt: Date.parse('2026-10-25T00:00:05.000Z'),
        },
      ],
    }),
    render: () => <ConferenceRoomPage />,
    shows: 'aside section[aria-label="Chat"]',
  },
  {
    // A refused message is a line of text in the chat region, not a control.
    name: '/conference/[roomId] — chat message refused for sending too fast',
    filled: 1,
    surfaces: 0,
    setup: inRoom({ peers: ALICE, chatRefusal: 'rate-limited' }),
    render: () => <ConferenceRoomPage />,
    shows: 'aside section[aria-label="Chat"] [role="alert"]',
  },
  {
    name: '/conference/[roomId] — roster closed',
    filled: 1,
    surfaces: 0,
    setup: inRoom({ peers: ALICE }),
    render: () => <ConferenceRoomPage />,
    press: 'button[aria-label="Hide participants"]',
    shows: 'button[aria-label="Show participants"]',
  },
  {
    name: '/conference/[roomId] — permission denied',
    filled: 1,
    surfaces: 0,
    setup: inRoom({ status: 'error', errorReason: 'permission-denied', mySocketId: null }),
    render: () => <ConferenceRoomPage />,
  },
  {
    name: '/conference/[roomId] — disconnected mid-call',
    filled: 1,
    surfaces: 0,
    setup: inRoom({ status: 'disconnected', errorReason: 'connection-lost', mySocketId: null }),
    render: () => <ConferenceRoomPage />,
  },
  {
    name: '/conference/[roomId] — generic error',
    filled: 1,
    surfaces: 0,
    setup: inRoom({ status: 'error', errorReason: 'generic', mySocketId: null }),
    render: () => <ConferenceRoomPage />,
  },
  {
    name: '/conference/[roomId] — room not found',
    filled: 1,
    surfaces: 0,
    setup: inRoom({ status: 'error', errorReason: 'room-not-found', mySocketId: null }),
    render: () => <ConferenceRoomPage />,
  },
  {
    name: '/conference/[roomId] — meeting ended by its owner',
    filled: 1,
    surfaces: 0,
    setup: inRoom({ status: 'disconnected', errorReason: 'room-ended', mySocketId: null }),
    render: () => <ConferenceRoomPage />,
  },
  {
    // Audio-only is an in-call state with a soft inline notice — still one accent, zero surfaces.
    name: '/conference/[roomId] — audio-only (camera denied)',
    filled: 1,
    surfaces: 0,
    setup: inRoom({ errorReason: 'audio-only', localVideoEnabled: false }),
    render: () => <ConferenceRoomPage />,
  },
  {
    // Translation ended for good is a quiet readout — still one accent (Leave), zero surfaces.
    name: '/conference/[roomId] — translation ended mid-call',
    filled: 1,
    surfaces: 0,
    setup: inRoom({ peers: ALICE, translationEnded: 'retries_exhausted' }),
    render: () => <ConferenceRoomPage />,
    shows: '[data-translation-ended]',
  },
  {
    // Out of credits picks the same readout's other sentence: no new surface, no new control.
    name: '/conference/[roomId] — translation ended, out of credits',
    filled: 1,
    surfaces: 0,
    setup: inRoom({ peers: ALICE, translationEnded: 'credits_exhausted' }),
    render: () => <ConferenceRoomPage />,
    shows: '[data-translation-ended]',
  },
  {
    // Reconnecting is a transient mid-call state — one accent (Leave), zero surfaces.
    name: '/conference/[roomId] — reconnecting (auto-reconnect in progress)',
    filled: 1,
    surfaces: 0,
    setup: inRoom({ status: 'reconnecting', mySocketId: null, reconnectAttempt: 1 }),
    render: () => <ConferenceRoomPage />,
  },

  // ---- /conference/[roomId]/ended end screen ----
  // Back to lobby is the one accent in every state. No elevated surface: the
  // summary is hairline rows and the minutes panel sits on the page ground, its
  // Generate outline because the screen's action is leaving, not summarizing.
  {
    name: '/conference/[roomId]/ended — loading',
    filled: 1,
    surfaces: 0,
    setup: ended({ load: 'loading', conference: null }),
    render: () => <ConferenceEndedPage />,
  },
  {
    name: '/conference/[roomId]/ended — not a room the caller was in',
    filled: 1,
    surfaces: 0,
    setup: ended({ load: 'not-found', conference: null }),
    render: () => <ConferenceEndedPage />,
  },
  {
    name: '/conference/[roomId]/ended — no minutes yet',
    filled: 1,
    surfaces: 0,
    setup: ended(),
    render: () => <ConferenceEndedPage />,
    shows: '[data-minutes-panel]',
  },
  {
    name: '/conference/[roomId]/ended — generating minutes',
    filled: 1,
    surfaces: 0,
    // Generate is disabled only while a pass runs, since this fixture can generate.
    shows: '[data-minutes-panel] button:disabled',
    setup: ended({ generating: true }),
    render: () => <ConferenceEndedPage />,
  },
  {
    // The body and its copy control appear; copy is ghost, Regenerate outline.
    name: '/conference/[roomId]/ended — minutes ready',
    filled: 1,
    surfaces: 0,
    setup() {
      // The same content as the history rows, under a room instead of a conversation.
      const { summary, keyPoints, decisions, actionItems, generatedAt, model } = READY_MINUTES;
      ended({
        minutes: {
          conferenceId: ENDED_ROOM.id,
          status: 'ready',
          summary,
          keyPoints,
          decisions,
          actionItems,
          generatedAt,
          model,
        },
      })();
    },
    render: () => <ConferenceEndedPage />,
    shows: '[data-minutes-panel] ul',
  },
  {
    name: '/conference/[roomId]/ended — the last pass failed',
    filled: 1,
    surfaces: 0,
    setup: ended({ generateFailed: true }),
    render: () => <ConferenceEndedPage />,
    shows: '[data-minutes-panel] .text-destructive',
  },
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
  url.params = {};
  historyBox.wide = false;
  // Here rather than in each `setup()`: a screen that forgot it would get
  // `undefined` back from the factory and the banner's `.catch` would throw.
  checkHealth.mockResolvedValue(undefined);
  // Rejecting by default: nothing in a counting test presses play, so no row
  // should be able to reach a loaded player by accident.
  fetchConversationAudio.mockRejectedValue(new Error('not fetched in this test'));
  uploadConversationAudio.mockResolvedValue(undefined);
  // No contexts, which is what every screen but the two named for them sees.
  listTranslationContexts.mockResolvedValue({ contexts: [] });
  createConference.mockRejectedValue(new Error('not created in this test'));
  getCreditBalance.mockResolvedValue(balanceFixture());
  listCreditUsage.mockResolvedValue(USAGE_PAGE);
  listPlans.mockResolvedValue({ plans: PLANS });
  createCheckout.mockRejectedValue(new Error('not checked out in this test'));
  listGlossaries.mockResolvedValue({ glossaries: [] });
  listGlossaryItems.mockResolvedValue({ items: [] });
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
  // Each row is its own backend: a catalog an earlier row cached must not
  // answer for this one — Settings › Translation asks for every language at once.
  forgetVoiceCatalogs();
  screen.setup();
  await mount(screen.render());

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

  if (screen.steps) {
    // The list's page and then the conversation it opens are two fetches in a row,
    // so a row with steps first lets both land.
    await act(async () => {
      for (let i = 0; i < 4; i += 1) await Promise.resolve();
    });
    for (const step of screen.steps) {
      const control = document.querySelector<HTMLElement>(step);
      expect(control, `${screen.name}: nothing matches ${step}`).not.toBeNull();
      await act(async () => {
        control?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
        control?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
        control?.click();
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
    }
  }

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

  if (!screen.shows) return;
  // Polled rather than read once: a menu item such as Rename acts in the menu's
  // `onCloseAutoFocus`, which fires when its close animation ends — after the fixed
  // 20ms a step waits on a loaded CI runner. The demand is unchanged: the element
  // must mount, within a second.
  const shows = screen.shows;
  await act(async () => {
    await vi.waitFor(
      () => {
        expect(
          document.querySelector(shows),
          `${screen.name}: nothing matches ${shows}, so the row is not mounting what it is named for`,
        ).not.toBeNull();
      },
      { timeout: 1000, interval: 20 },
    );
  });
}

describe('the accent counter', () => {
  it('does not count a checked Switch, whose accent is a state variant', async () => {
    // Settings › Translation renders three processor switches, all on by default, so a
    // CHECKED switch is on screen carrying
    // `data-[state=checked]:bg-primary` in its class attribute. The substring
    // selector this helper replaced counts that; `classList.contains` does not.
    // Without this test the helper could quietly regress to a substring match and
    // every screen with a switch would start failing for the wrong reason.
    listVoices.mockResolvedValue({ voices: [] });
    await mount(<SettingsTabContent tab="translation" />);

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
