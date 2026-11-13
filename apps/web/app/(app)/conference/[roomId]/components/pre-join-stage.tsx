'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import type { LanguageCode } from '@chatofy/types';
import type { PreferredDevices } from '@/conference/acquire-local-media';
import { usePreferences } from '@/hooks/use-preferences';
import { useTranslateSettings } from '@/hooks/use-translate-settings';
import { usePreJoinMedia } from '../hooks/use-pre-join-media';
import { ACTIVE_CALL_KEY } from '../utils/room-route';
import { PreJoinPanel } from './pre-join-panel';

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

  // What the user picked, else the language they last joined with (an account
  // preference, so the phone joins in what the laptop did), else Vietnamese. The
  // stored one is null on the server and until the preferences are ready, so the
  // server render and the hydrating one agree.
  const preferences = usePreferences();
  const [pickedLanguage, setPickedLanguage] = useState<LanguageCode | null>(null);
  const storedLanguage = preferences.ready ? preferences.preferences.conferenceLanguage : null;
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
    // The speaker leg reads the voice from the preferences snapshot when it is
    // built, and every change made here is already in it: updates apply to the
    // snapshot at once, and only the save to the account is debounced.
    if (language !== storedLanguage) preferences.update({ conferenceLanguage: language });
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
