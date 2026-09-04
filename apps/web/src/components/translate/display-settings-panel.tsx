'use client';

import {
  ALargeSmall,
  Columns2,
  EyeOff,
  List,
  MousePointer2,
  Rows3,
  SquareSplitHorizontal,
  UserRound,
} from 'lucide-react';
import { SegmentedControl, Separator, Switch } from '@chatofy/ui/react';
import type { TranslateSettings } from '@/lib/translate-settings';
import { SettingsRow } from '@/components/translate/settings-row';
import { TextSizeField } from '@/components/translate/text-size-field';
import { useTranslate } from '@/i18n/provider';

/**
 * How the page is arranged, as opposed to how it sounds.
 *
 * The gear this opens behind used to hold the voice as well, which put "what am I
 * hearing" and "how is the page arranged" behind one icon labelled neither — and
 * left the reader to discover that the speaker mark in the panel header, the thing
 * actually about sound, was not where sound was configured. The voice moved to
 * that header; this is everything else.
 *
 * ## Nothing here is ever disabled
 *
 * Not one row reaches the session. Every value is a property of this browser
 * applied at render, so the whole panel stays live while somebody is talking —
 * which is the opposite of the voice panel beside it, and the reason the two are
 * separate surfaces rather than one list with a separator.
 *
 * ## Words explain a refusal, never a function
 *
 * This panel shipped for an hour with a sentence under every row — five of them,
 * fifty-three words against twenty-one words of label, explaining what each
 * control did. All five described a function, and a function is what the label
 * plus one press already says.
 *
 * The last to go was the one for `translationOnly`, which named a real trade: the
 * source line is how a speaker catches a misrecognition. It went anyway, and not
 * because the panel was crowded — the consequence happens in front of the reader.
 * Flip it and the source disappears from the screen behind this popover. A
 * popover does not need to narrate a change the screen is performing.
 *
 * What stays, and stays in the VOICE panel next door, is the other kind: speed
 * disabled because the Vietnamese engine has no rate control, the switch frozen
 * because a session is running, the voice list that failed to load. Every one of
 * those is a control refusing, and a control that refuses without saying why is
 * the fault this project has already fixed once.
 *
 * ## A control that does not apply is absent, not disabled
 *
 * `paneLayout` orients two panes, so under `list` — one stream, no panes — it is
 * gone. `displayMode` and `paneLayout` are both gone under `translationOnly`,
 * where there is one side on screen to split and orient. Disabling them instead
 * would leave the reader working out how to enable something that has nothing to
 * act on; the switch or the mode immediately above is already the whole answer.
 *
 * The stored values survive that. Turning `translationOnly` back off returns the
 * arrangement that was in force, rather than the default — a control vanishing
 * must not also silently discard what it held.
 *
 * ## Ten steps of text size
 *
 * One step is barely a pixel on the source line; end to end the transcript goes
 * from just under to just over double, which is what makes ten of them worth
 * offering. How the ten are drawn is `text-size-field.tsx`.
 *
 * It scales the CONVERSATION and nothing else. The headers, the dock and the
 * chips are the frame around it, and a frame that grew with the text would eat
 * the height the reader just asked for.
 *
 * No accent anywhere. The screen's one accent-filled control is Start.
 */
export function DisplaySettingsPanel({
  settings,
  onChange,
}: {
  settings: TranslateSettings;
  onChange: (patch: Partial<TranslateSettings>) => void;
}) {
  const t = useTranslate();

  return (
    <div className="flex flex-col gap-5">
      {/* `aria-label` on every switch, matching the visible label word for word.
          `SettingsRow` draws a `<span>`, and a Radix switch is a `<button
          role="switch">` with no text of its own — so without this all three
          announce as "switch, on" with no name. The voice panel next door already
          carried one; these three were written without and nothing caught it. */}
      <SettingsRow icon={UserRound} label={t('web.translate.speakerLabels')}>
        <Switch
          aria-label={t('web.translate.speakerLabels')}
          checked={settings.speakerLabels}
          onCheckedChange={(speakerLabels) => onChange({ speakerLabels })}
        />
      </SettingsRow>

      <SettingsRow icon={EyeOff} label={t('web.translate.translationOnly')}>
        <Switch
          aria-label={t('web.translate.translationOnly')}
          checked={settings.translationOnly}
          onCheckedChange={(translationOnly) => onChange({ translationOnly })}
        />
      </SettingsRow>

      <SettingsRow icon={MousePointer2} label={t('web.translate.freeScroll')}>
        <Switch
          aria-label={t('web.translate.freeScroll')}
          checked={settings.freeScroll}
          onCheckedChange={(freeScroll) => onChange({ freeScroll })}
        />
      </SettingsRow>

      <Separator />

      {settings.translationOnly ? null : (
        <SegmentedControl
          label={t('web.translate.displayMode')}
          value={settings.displayMode}
          options={[
            {
              value: 'split',
              label: (
                <span className="flex items-center gap-1.5">
                  <SquareSplitHorizontal aria-hidden className="size-4" />{' '}
                  {t('web.translate.displayModeSplit')}
                </span>
              ),
            },
            {
              value: 'list',
              label: (
                <span className="flex items-center gap-1.5">
                  <List aria-hidden className="size-4" /> {t('web.translate.displayModeList')}
                </span>
              ),
            },
          ]}
          onChange={(displayMode) => onChange({ displayMode })}
        />
      )}

      {/* Directly under the mode that creates it, so "immediately above" in the
          note at the top of this file is literally true — it was two rows down
          with the text size in between. */}
      {settings.translationOnly || settings.displayMode === 'list' ? null : (
        <SegmentedControl
          label={t('web.translate.paneLayout')}
          value={settings.paneLayout}
          options={[
            {
              value: 'row',
              label: (
                <span className="flex items-center gap-1.5">
                  <Columns2 aria-hidden className="size-4" /> {t('web.translate.paneLayoutRow')}
                </span>
              ),
            },
            {
              value: 'column',
              label: (
                <span className="flex items-center gap-1.5">
                  <Rows3 aria-hidden className="size-4" /> {t('web.translate.paneLayoutColumn')}
                </span>
              ),
            },
          ]}
          onChange={(paneLayout) => onChange({ paneLayout })}
        />
      )}

      <SettingsRow icon={ALargeSmall} label={t('web.translate.textSize')}>
        <TextSizeField
          label={t('web.translate.textSize')}
          value={settings.textSize}
          onChange={(textSize) => onChange({ textSize })}
        />
      </SettingsRow>
    </div>
  );
}
