import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { PreferencesSync } from '@chatofy/api-client';
import type { TranslationContext, UserPreferences } from '@chatofy/types';
import type { CaptureSettings, OverlayState } from '../../src/messages';
import {
  microphonePermission,
  openMicrophonePermissionPage,
} from '../../src/microphone-permission';
import {
  loadSiteEnablement,
  runsOn,
  saveSiteEnablement,
  withSiteEnabled,
  type SiteEnablement,
} from '../../src/site-enablement';
import { applyTheme, dropLegacyTheme, loadTheme, type ThemeChoice } from '../../src/theme';
import {
  loadAccessToken,
  signIn,
  signOut as endSession,
  verifyAccessToken,
} from '../../src/access-token';
import { PREFERENCES_KEY } from '../../src/preferences-cache';
import { patchFromSynced, syncedFieldsOf } from '../../src/preferences-mapping';
import { createExtensionPreferences } from '../../src/preferences-store';
import { dropLegacySyncedSettings, loadSettings, saveSettings } from '../../src/settings';
import {
  meetingSiteOf,
  supportOf,
  type MeetingSite,
  type MeetingSupport,
} from '../../src/supported-meeting-url';
import { listTranslationContexts } from '../../src/translation-contexts';
import { consentGate } from './consent-gate';
import { statusMessage } from './popup-status';

/**
 * Everything the popup knows, gathered once when it opens.
 *
 * An MV3 popup dies whenever it loses focus, so none of this is cached and none of
 * it is a store: the page is opened, it asks, it renders, it goes away. The state
 * that outlives a meeting lives in the worker and in `chrome.storage`, and keeping
 * a durable client copy here would be inventing a second source for facts the
 * worker already owns.
 */

const IDLE: SiteEnablement = { enabled: true, disabledSites: [] };

/** What the overlay shows when nothing is being captured. Reset to from two paths. */
const IDLE_OVERLAY: OverlayState = {
  capturing: false,
  lines: [],
  outbound: 'off',
  errors: {},
};

export function usePopup() {
  const consentRequired = useSyncExternalStore(consentGate.subscribe, consentGate.snapshot);

  const [theme, setThemeState] = useState<ThemeChoice>();
  const [settings, setSettings] = useState<CaptureSettings>();
  const [enablement, setEnablement] = useState<SiteEnablement>(IDLE);
  const [support, setSupport] = useState<MeetingSupport>({ ok: false });
  const [site, setSite] = useState<MeetingSite>();
  const [host, setHost] = useState('');
  const [overlay, setOverlay] = useState<OverlayState>();
  const [micGranted, setMicGranted] = useState(true);
  /** Set only by a Start that found no tab; replaced by the next real render. */
  const [transient, setTransient] = useState<string>();
  /**
   * `undefined` until storage answers — which is not the same as signed out, and
   * the sign-in form must not flash during that window.
   */
  const [signedIn, setSignedIn] = useState<boolean>();
  const [signInError, setSignInError] = useState<string>();
  const [signingIn, setSigningIn] = useState(false);
  /**
   * The caller's saved AI Contexts, fetched once when the popup opens.
   *
   * An MV3 popup dies on blur, so there is nothing to refresh this against later
   * — the next popup open fetches again. Starts empty rather than `undefined`:
   * the picker's own rule is "hidden when the list is empty", which this
   * satisfies before the fetch has even returned.
   */
  const [contexts, setContexts] = useState<TranslationContext[]>([]);
  /**
   * The account store for this popup's lifetime, present only while signed in.
   * A ref, not state: nothing renders from it directly — its snapshots are
   * copied into `settings` and `theme` by the effect that owns it.
   */
  const storeRef = useRef<PreferencesSync>(null);
  /** Whether the store is currently told a capture is running. */
  const heldRef = useRef(false);
  /** True once the worker has said whether a capture is running. */
  const [captureKnown, setCaptureKnown] = useState(false);

  useEffect(() => {
    void (async () => {
      // First, and awaited before anything else renders: the ground the rest is
      // drawn on should not change once the reader is looking at it.
      const chosen = await loadTheme();
      applyTheme(chosen);
      setThemeState(chosen);

      const stored = await loadSettings();
      setSettings(stored);

      // Painted from STORAGE first, then corrected.
      //
      // A stored token is no longer proof that captures will work — a password
      // reset revokes tokens before they expire — so the API has to be asked.
      // But asking it is a network round trip, and awaiting it here would hold
      // the whole popup on a disabled control until it answers: an MV3 popup is
      // opened, read and dismissed in seconds, and on a slow or dead network
      // that is the entire time the user is looking at it.
      //
      // So the stored value renders immediately and the check runs beside it,
      // downgrading only on a definite 401. It never upgrades: a token that was
      // absent cannot become valid while the popup is open.
      setSignedIn((await loadAccessToken()) !== null);
      void verifyAccessToken(stored.apiBaseUrl).then((stillValid) => {
        if (!stillValid) setSignedIn(false);
      });

      setMicGranted((await microphonePermission()) === 'granted');

      // A failure here reads back as an empty list (`listTranslationContexts`
      // never throws), which is exactly what hides the picker below — never a
      // reason this popup fails to render.
      void listTranslationContexts(stored.apiBaseUrl).then((result) => {
        setContexts(result.contexts);
      });

      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const url = tab?.url;
      setSupport(supportOf(url));
      const found = meetingSiteOf(url);
      setSite(found);
      setHost(found ?? (url ? new URL(url).hostname : ''));

      setEnablement(await loadSiteEnablement());

      // `catch` rather than a throw: with no worker listening this is `undefined`,
      // which every reader below already treats as "not capturing".
      const state = (await chrome.runtime
        .sendMessage({ to: 'worker', type: 'query' })
        .catch(() => undefined)) as OverlayState | undefined;
      setOverlay(state);
      setCaptureKnown(true);
    })();
  }, []);

  const capturing = overlay?.capturing ?? false;
  const capturingRef = useRef(capturing);
  capturingRef.current = capturing;
  const apiBaseUrl = settings?.apiBaseUrl;

  /**
   * Make the held state match the capture, whichever side moved first.
   *
   * A running capture reads the pair, the voice and the context once, when it
   * opens. A change made on another device is therefore kept back while one runs
   * and lands at the next open instead of halfway through a sentence. One flag
   * rather than a count so the open-time check and the later transitions cannot
   * both hold and leave a release short.
   */
  const syncHold = useCallback((running: boolean) => {
    const store = storeRef.current;
    if (!store || heldRef.current === running) return;
    heldRef.current = running;
    if (running) store.hold();
    else store.release();
  }, []);

  /**
   * The account's preferences, from the moment the popup opens signed in.
   *
   * Started only after the worker has said whether a capture is running, so the
   * refresh that `start` performs is already held when one is. Its snapshots
   * (cache first, then the server's) are copied onto the form and the ground;
   * the cache key is also watched, because the worker writes the pair and the
   * voice from its own context and this popup must not later write the cache
   * back with an older copy of them.
   */
  useEffect(() => {
    if (signedIn !== true || !captureKnown || !apiBaseUrl) return;
    const store = createExtensionPreferences(apiBaseUrl);
    storeRef.current = store;
    heldRef.current = false;
    syncHold(capturingRef.current);

    const apply = () => {
      const { preferences } = store.getState();
      setSettings((current) =>
        current ? { ...current, ...syncedFieldsOf(preferences) } : current,
      );
      applyTheme(preferences.theme);
      setThemeState(preferences.theme);
    };
    const unsubscribe = store.subscribe(apply);
    const onCacheChanged = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string,
    ) => {
      const next = changes[PREFERENCES_KEY]?.newValue;
      if (area !== 'local' || next === undefined || next === null) return;
      if (JSON.stringify(next) === JSON.stringify(store.getState().preferences)) return;
      // `receive` re-parses it field by field; the cast only names the shape.
      store.receive(next as UserPreferences);
    };
    chrome.storage.onChanged.addListener(onCacheChanged);

    // Old per-browser values are forgotten, not carried over.
    void dropLegacyTheme();
    void dropLegacySyncedSettings();
    void store.start();

    return () => {
      chrome.storage.onChanged.removeListener(onCacheChanged);
      unsubscribe();
      void store.flush().finally(() => store.dispose());
      storeRef.current = null;
    };
  }, [signedIn, captureKnown, apiBaseUrl, syncHold]);

  useEffect(() => syncHold(capturing), [capturing, syncHold]);
  // Both gates, in the order the worker applies them: a tab Chrome cannot capture,
  // or a platform the user switched off.
  const captureable = support.ok && runsOn(enablement, site);

  /**
   * The ones the offscreen document is handed at capture time go through the
   * worker instead of straight to storage, because a running capture has to be
   * reopened for a change to take effect and only the worker can do that. Writing
   * them here would leave the popup showing a setting the live capture is not
   * using — and for `outbound` that contradiction is visible, since the overlay
   * renders it as status as well.
   */
  const pushToWorker = useCallback((next: CaptureSettings) => {
    void chrome.runtime
      .sendMessage({
        to: 'worker',
        type: 'settings',
        languagePair: next.languagePair,
        voiceGender: next.voiceGender,
        outbound: next.outbound,
        micProcessing: next.micProcessing,
      })
      .catch(() => undefined);
  }, []);

  const change = useCallback(
    (
      patch: Partial<
        Pick<CaptureSettings, 'languagePair' | 'voiceGender' | 'outbound' | 'micProcessing'>
      >,
    ) => {
      // The pair and the voice are the account's: written through the store so the
      // form, the cache and the server agree, and the worker (which is also sent
      // the change, to reopen a running capture) finds nothing left to write.
      const store = storeRef.current;
      if (store && (patch.languagePair || patch.voiceGender)) {
        const accountPatch = patchFromSynced(store.getState().preferences, {
          languagePair: patch.languagePair,
          voiceGender: patch.voiceGender,
        });
        if (accountPatch) {
          store.update(accountPatch);
          void store.flush();
        }
      }
      setSettings((current) => {
        // Nothing to send before the first read: the fields this page does not show
        // would travel as whatever a default says rather than as what is stored.
        if (!current) return current;
        const next = { ...current, ...patch };
        // The voice follows the language that is spoken: a new target shows that
        // language's stored voice, not the previous one's.
        if (store && patch.languagePair && patch.voiceGender === undefined) {
          next.voiceGender = syncedFieldsOf(store.getState().preferences).voiceGender;
        }
        pushToWorker(next);
        return next;
      });
      // Turning the outbound leg on is the moment the microphone starts
      // mattering, and the moment to say it is still missing — not after a capture
      // has already started and produced nothing. Re-asked rather than read once,
      // because the answer changes while this popup is closed.
      if (patch.outbound !== undefined) {
        void microphonePermission().then((state) => setMicGranted(state === 'granted'));
      }
    },
    [pushToWorker],
  );

  /**
   * Which saved AI Context this meeting runs under.
   *
   * Written to the account, like `setTheme` and unlike `change`: a context
   * is resolved once at the START of a capture (`MeetingCapture.begin`), not
   * read live by a running one, so there is no running capture to reopen and
   * nothing for the worker to do with this until the next `start`.
   */
  const setContext = useCallback((contextId: string | undefined) => {
    const store = storeRef.current;
    if (store) {
      store.update({ contextId: contextId ?? null });
      void store.flush();
    }
    setSettings((current) => (current ? { ...current, contextId } : current));
  }, []);

  /**
   * Where the extension may run: its own store and its own write path.
   *
   * Routing this through the worker's `settings` message would reopen a running
   * capture — restarting a translation because someone changed a checkbox about a
   * different platform.
   */
  const persistEnablement = useCallback((next: SiteEnablement) => {
    setEnablement(next);
    void saveSiteEnablement(next);
  }, []);

  const setTheme = useCallback((choice: ThemeChoice) => {
    // Appearance is not a capture setting, so it never reaches the worker: it goes
    // to the account's document. See src/theme.ts.
    applyTheme(choice);
    setThemeState(choice);
    const store = storeRef.current;
    if (store) {
      store.update({ theme: choice });
      void store.flush();
    }
  }, []);

  /**
   * Exchange credentials for a token and keep it.
   *
   * The popup is where this happens because it is the extension's only page: a
   * capture cannot open its socket without a token, and there is nowhere else
   * for someone to supply one.
   */
  const submitSignIn = useCallback(
    (email: string, password: string) => {
      void (async () => {
        if (!settings) return;
        setSigningIn(true);
        setSignInError(undefined);
        const result = await signIn(settings.apiBaseUrl, email, password);
        setSigningIn(false);
        if (result.ok) {
          setSignedIn(true);
          return;
        }
        setSignInError(result.message);
      })();
    },
    [settings],
  );

  const signOut = useCallback(() => {
    void (async () => {
      // Told to the API as well as forgotten here: this browser's refresh token
      // outlives its access token by weeks, and a sign-out that only dropped the
      // local copy would leave a renewable credential on a machine someone has
      // just walked away from. Aliased on import because the popup's own action
      // has the name the button reads.
      // The store is dropped first and its cache with it, so nothing it still
      // holds is written back after the tokens' own clean-up has run.
      await storeRef.current?.dispose(true);
      await endSession(settings?.apiBaseUrl);
      setSignedIn(false);
      // A capture already running keeps its socket — the token was checked at
      // the upgrade and is not re-checked — so it is stopped rather than left
      // running under an identity this machine no longer holds.
      await chrome.runtime.sendMessage({ to: 'worker', type: 'stop' }).catch(() => undefined);
      setOverlay(IDLE_OVERLAY);
    })();
  }, [settings]);

  const toggleCapture = useCallback(() => {
    void (async () => {
      // Saved before starting, not after: the worker reads settings from storage
      // when it opens the offscreen document, so an unsaved change would start a
      // capture with the previous language pair.
      //
      // `apiBaseUrl` is dropped rather than carried: the compile decides it and
      // `saveSettings` refuses it. `reportMetrics` IS carried — its checkbox is
      // gone but the worker and the realtime client still read the flag, so a save
      // that dropped it would reset it because someone picked a different voice.
      if (settings) {
        const { apiBaseUrl: _ignored, ...writable } = settings;
        await saveSettings(writable);
      }

      if (capturing) {
        await chrome.runtime.sendMessage({ to: 'worker', type: 'stop' }).catch(() => undefined);
        setTransient(undefined);
        setOverlay(IDLE_OVERLAY);
        return;
      }

      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id === undefined) {
        setTransient('No tab to capture.');
        return;
      }
      await chrome.runtime
        .sendMessage({ to: 'worker', type: 'start', tabId: tab.id })
        .catch(() => undefined);
      // Reported optimistically. The popup is usually closed before capture
      // finishes opening, and the overlay carries the real answer, including any
      // failure.
      setTransient(undefined);
      setOverlay({
        capturing: true,
        lines: [],
        // What the offscreen document reports will replace this; the popup is
        // usually closed before it arrives.
        outbound: settings?.outbound ? 'monitor' : 'off',
        errors: {},
      });
    })();
  }, [capturing, settings]);

  return {
    consentRequired,
    signedIn,
    signInError,
    signingIn,
    theme,
    settings,
    contexts,
    enablement,
    support,
    site,
    host,
    capturing,
    captureable,
    // Only while the outbound leg is on. Chrome grants the microphone to the
    // extension, not to a meeting, so asking someone who has not turned that
    // leg on is asking for something they have no use for.
    microphoneNeeded: Boolean(settings?.outbound) && !micGranted,
    status: transient ?? statusMessage({ overlay, capturing, captureable, site, enablement }),
    actions: {
      change,
      setContext,
      setTheme,
      setRunEnabled: (enabled: boolean) => persistEnablement({ ...enablement, enabled }),
      setSiteEnabled: (target: MeetingSite, on: boolean) =>
        persistEnablement(withSiteEnabled(enablement, target, on)),
      // Opens a tab and lets this popup die with it. The prompt takes focus, and a
      // popup that has lost focus is already closing — trying to keep this one
      // alive to report the outcome would race Chrome for it and lose. The grant
      // page reports it instead.
      allowMicrophone: () => void openMicrophonePermissionPage(),
      submitSignIn,
      signOut,
      toggleCapture,
    },
  };
}
