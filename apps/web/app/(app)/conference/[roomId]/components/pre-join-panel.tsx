'use client';

import { useEffect, useId, useRef } from 'react';
import { Mic, MicOff, Video, VideoOff } from 'lucide-react';
import type { LanguageCode } from '@chatofy/types';
import { MAX_CONFERENCE_DISPLAY_NAME_CHARS } from '@chatofy/types/events';
import {
  Button,
  Input,
  Label,
  SegmentedControl,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@chatofy/ui/react';
import type { UseTranslateSettings } from '@/hooks/use-translate-settings';
import { useTranslate } from '@/i18n/provider';
import { languageNamer } from '@/i18n/language-pair-labels';
import type { PreJoinMedia } from '../hooks/use-pre-join-media';
import { ConferenceVoiceChip } from './conference-voice-chip';
import { MicLevelMeter } from './mic-level-meter';
import { DAWN_GRADIENT, DawnGlow } from '../../components/dawn-glow';

/** Radix reserves "" for a Select holding nothing, so the default needs a value of its own. */
const SYSTEM_DEFAULT = 'default';

/** Up to two initials for the camera-off tile. */
function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const picked = words.length > 1 ? [words[0], words[words.length - 1]] : words;
  return picked.map((word) => word!.charAt(0).toUpperCase()).join('');
}

interface PreJoinPanelProps {
  media: PreJoinMedia;
  name: string;
  onNameChange: (name: string) => void;
  language: LanguageCode;
  onLanguageChange: (language: LanguageCode) => void;
  onJoin: () => void;
  joining: boolean;
  /** The translated-voice settings, owned by the stage. */
  voice: UseTranslateSettings;
}

/**
 * The green room: see yourself, hear yourself, say who you are, then join.
 *
 * Design budget: "Join now" is the one accent-filled control. The toggles are
 * outline, the pickers are fields, the voice chip is outline. The preview is a
 * muted region on the page ground, not a card.
 */
export function PreJoinPanel({
  media,
  name,
  onNameChange,
  language,
  onLanguageChange,
  onJoin,
  joining,
  voice,
}: PreJoinPanelProps) {
  const t = useTranslate();
  const nameLanguage = languageNamer(t);
  const micLabelId = useId();
  const camLabelId = useId();
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = media.stream;
  }, [media.stream]);

  const showVideo = media.camOn && Boolean(media.stream?.getVideoTracks().length);

  return (
    // The room is a flush route — a fixed-height frame that never scrolls — so
    // this screen scrolls itself, and `m-auto` centres it on both axes while it
    // fits and lets it scroll from the top when it does not.
    <div className="flex min-h-0 flex-1 overflow-y-auto">
      <div className="m-auto grid w-full max-w-6xl items-center gap-10 px-6 py-10 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-4">
          <div className="relative">
            <DawnGlow />
            <div className="bg-muted relative aspect-video w-full overflow-hidden rounded-2xl">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className={showVideo ? 'h-full w-full -scale-x-100 object-cover' : 'hidden'}
              />
              {showVideo && name.trim() && (
                <p className="text-body absolute left-4 top-3 font-medium text-white drop-shadow">
                  {name.trim()}
                </p>
              )}
              {!showVideo && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 pb-10">
                  {name.trim() && (
                    // A dawn ring around a neutral disc: the initials sit on the
                    // card colour, never on the dawn itself.
                    <div
                      aria-hidden
                      className="rounded-full p-1"
                      style={{ backgroundImage: DAWN_GRADIENT }}
                    >
                      <div className="bg-card text-title flex size-24 items-center justify-center rounded-full font-semibold">
                        {initials(name)}
                      </div>
                    </div>
                  )}
                  <p className="text-body text-textMuted">{t('web.conference.noCameraPreview')}</p>
                </div>
              )}
              <div className="absolute inset-x-0 bottom-4 flex justify-center gap-4">
                <Button
                  type="button"
                  // Off is a state worth seeing at a glance: the live fill, as on
                  // Stop. It is not the accent, so the budget is untouched.
                  variant={media.micOn ? 'outline' : 'destructive'}
                  size="icon"
                  className="size-12 rounded-full [&_svg]:size-5"
                  aria-pressed={!media.micOn}
                  aria-label={
                    media.micOn ? t('common.conference.muteMic') : t('common.conference.unmuteMic')
                  }
                  onClick={() => media.setMicOn(!media.micOn)}
                >
                  {media.micOn ? <Mic aria-hidden /> : <MicOff aria-hidden />}
                </Button>
                <Button
                  type="button"
                  variant={media.camOn ? 'outline' : 'destructive'}
                  size="icon"
                  className="size-12 rounded-full [&_svg]:size-5"
                  aria-pressed={!media.camOn}
                  aria-label={
                    media.camOn
                      ? t('common.conference.disableCamera')
                      : t('common.conference.enableCamera')
                  }
                  onClick={() => media.setCamOn(!media.camOn)}
                >
                  {media.camOn ? <Video aria-hidden /> : <VideoOff aria-hidden />}
                </Button>
              </div>
            </div>
          </div>

          <MicLevelMeter level={media.level} label={t('web.conference.micLevel')} />

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex min-w-0 flex-col gap-1.5">
              <Label id={micLabelId}>{t('web.conference.microphone')}</Label>
              <Select
                value={media.micId ?? SYSTEM_DEFAULT}
                onValueChange={(id) => media.setMicId(id === SYSTEM_DEFAULT ? undefined : id)}
              >
                <SelectTrigger aria-labelledby={micLabelId} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={SYSTEM_DEFAULT}>
                    {t('web.conference.defaultDevice')}
                  </SelectItem>
                  {media.mics
                    .filter((device) => device.deviceId && device.deviceId !== SYSTEM_DEFAULT)
                    .map((device, index) => (
                      <SelectItem key={device.deviceId} value={device.deviceId}>
                        {device.label || `${t('web.conference.microphone')} ${index + 1}`}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex min-w-0 flex-col gap-1.5">
              <Label id={camLabelId}>{t('web.conference.camera')}</Label>
              <Select
                value={media.camId ?? SYSTEM_DEFAULT}
                onValueChange={(id) => media.setCamId(id === SYSTEM_DEFAULT ? undefined : id)}
              >
                <SelectTrigger aria-labelledby={camLabelId} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={SYSTEM_DEFAULT}>
                    {t('web.conference.defaultDevice')}
                  </SelectItem>
                  {media.cams
                    .filter((device) => device.deviceId && device.deviceId !== SYSTEM_DEFAULT)
                    .map((device, index) => (
                      <SelectItem key={device.deviceId} value={device.deviceId}>
                        {device.label || `${t('web.conference.camera')} ${index + 1}`}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        {/* Not a <form>: the voice chip and the segmented controls are buttons, and
          any of them without an explicit type would submit it. */}
        <div className="mx-auto flex w-full max-w-sm flex-col items-center gap-6">
          <h2 className="text-title text-center font-semibold">
            {t('web.conference.readyToJoin')}
          </h2>

          <div className="flex w-full flex-col gap-2">
            <Label htmlFor="conf-name">{t('common.conference.yourName')}</Label>
            <Input
              id="conf-name"
              value={name}
              onChange={(e) => onNameChange(e.target.value)}
              placeholder={t('common.conference.yourNamePlaceholder')}
              autoComplete="name"
              maxLength={MAX_CONFERENCE_DISPLAY_NAME_CHARS}
            />
          </div>

          <SegmentedControl<LanguageCode>
            className="self-stretch"
            equalWidth
            label={t('common.conference.sourceLanguage')}
            value={language}
            onChange={onLanguageChange}
            options={[
              { value: 'vi', label: nameLanguage('vi') },
              { value: 'en', label: nameLanguage('en') },
              { value: 'zh', label: nameLanguage('zh') },
            ]}
          />

          <ConferenceVoiceChip voice={voice} />

          <Button size="lg" className="w-full" disabled={!name.trim() || joining} onClick={onJoin}>
            {joining ? t('common.conference.connecting') : t('web.conference.joinNow')}
          </Button>
        </div>
      </div>
    </div>
  );
}
