'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { useSession } from 'next-auth/react';
import { toLanguageCode, type LanguageCode } from '@chatofy/types';
import type { PreferredDevices } from '@/conference/acquire-local-media';
import { useTranslateSettings } from '@/hooks/use-translate-settings';
import { saveTranslateSettings } from '@/lib/translate-settings';
import { usePreJoinMedia } from '../hooks/use-pre-join-media';
import { ACTIVE_CALL_KEY } from '../utils/room-route';
import { PreJoinPanel } from './pre-join-panel';

/** The spoken language last joined with — a per-browser convenience, nothing more. */
const LANGUAGE_KEY = 'chatofy.conference.language';

/** Storage never announces a change this screen cares about. */
const subscribeNever = () => () => {};

/** The stored language, or null on the server and when nothing valid is stored. */
function readStoredLanguage(): LanguageCode | null {
  try {
    return toLanguageCode(localStorage.getItem(LANGUAGE_KEY) ?? '') ?? null;
  } catch {
    return null;
  }
}

/** What the user settled on before pressing "Join now". */
export interface PreJoinChoice {
  displayName: string;
  sourceLanguage: LanguageCode;
  micOn: boolean;
  camOn: boolean;
  devices: PreferredDevices;
}

/**
 * The pre-join screen's state, held here so that leaving this screen — by
 * joining or by navigating away — releases the preview camera and microphone.
 */
export function PreJoinStage({ onJoin }: { onJoin: (choice: PreJoinChoice) => void }) {
  const media = usePreJoinMedia();
  const { data: session } = useSession();
  // The ONE settings instance on this screen; the voice chip edits it.
  const voice = useTranslateSettings();
  const [joining, setJoining] = useState(false);

  // What the user typed, else the account's name once the session has it.
  const [typedName, setTypedName] = useState<string | null>(null);
  const name = typedName ?? session?.user?.name ?? '';

  // What the user picked, else the language they last joined with, else
  // Vietnamese. Storage is read through `useSyncExternalStore` so the server
  // render and the hydrating one agree (both see null).
  const [pickedLanguage, setPickedLanguage] = useState<LanguageCode | null>(null);
  const storedLanguage = useSyncExternalStore(subscribeNever, readStoredLanguage, () => null);
  const language = pickedLanguage ?? storedLanguage ?? 'vi';

  // Reaching this screen is the way back into a call, so the landing must not
  // bounce here again — otherwise Back from here returns straight to it.
  useEffect(() => {
    try {
      sessionStorage.removeItem(ACTIVE_CALL_KEY);
    } catch {
      /* nothing to clear */
    }
  }, []);

  function join() {
    const displayName = name.trim();
    if (!displayName || joining) return;
    setJoining(true);
    // The speaker leg reads the voice from storage when it is built, and the
    // settings hook writes storage on a debounce: write it now.
    saveTranslateSettings(voice.current());
    try {
      localStorage.setItem(LANGUAGE_KEY, language);
    } catch {
      /* remembered next time only if storage works */
    }
    media.release();
    onJoin({
      displayName,
      sourceLanguage: language,
      micOn: media.micOn,
      camOn: media.camOn,
      devices: { audioDeviceId: media.micId, videoDeviceId: media.camId },
    });
  }

  return (
    <PreJoinPanel
      media={media}
      name={name}
      onNameChange={setTypedName}
      language={language}
      onLanguageChange={setPickedLanguage}
      onJoin={join}
      joining={joining}
      voice={voice}
    />
  );
}
