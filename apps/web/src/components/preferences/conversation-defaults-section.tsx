'use client';

import { DirectionToggle, Separator, Skeleton } from '@chatofy/ui/react';
import { SettingsSection, SettingsSectionRow } from '@/components/layout/settings-section';
import { ContextPicker } from '@/components/translate/context-picker';
import { VoiceSettingsPanel } from '@/components/translate/voice-settings-panel';
import { DisplaySettingsPanel } from '@/components/translate/display-settings-panel';
import { useTranslateSettings } from '@/hooks/use-translate-settings';
import { useTranslationContexts } from '@/hooks/use-translation-contexts';
import { useTranslate } from '@/i18n/provider';
import { directionLabels, makeLanguageName } from '@/i18n/direction-labels';

/**
 * Where a new conversation starts from.
 *
 * **One component, two mounts — not two components.** The panel supplies no surface of
 * its own, so the popover on `/translate` gives it `PopoverContent` and this section
 * gives it a card. There is one settings object in storage
 * (`chatofy.translate-settings`), so a "defaults" copy and a "live" copy would be a
 * distinction the storage cannot make and the user would experience as a change that
 * did not take.
 *
 * `running={false}`, and that is the honest difference between the two mounts. Direction
 * and voice ride `client.session.start` and cannot be changed inside a conversation, so
 * the popover disables them; here there is no conversation, so they are editable. The
 * other difference is `showDirection`: on `/translate` the direction is the two panel
 * headers, permanently on screen, so the popover hides the row — this page has no such
 * headers, and the direction a new conversation starts in is exactly what it is for.
 *
 * `useTranslateSettings` is called here, once, in a page-level component. The rule is
 * one call site per PAGE, not one per app: `/translate` and `/preferences` never mount
 * together, so their copies never coexist and cannot diverge. A settings summary in a
 * layout or in the chrome WOULD break that, silently.
 *
 * **This is the SECOND of the screen's two elevated surfaces**, and the last. The
 * defaults really are a thing you work on as a unit — you sit down and set them — where
 * the interface rows above are two unrelated switches. The AI Context library above
 * earns the other one on the same grounds. Two is the ceiling here, which is what makes
 * the context editor inline rather than a dialog.
 */
export function ConversationDefaultsSection() {
  const t = useTranslate();
  const { settings, ready, set } = useTranslateSettings();
  const { contexts, status } = useTranslationContexts();

  return (
    <SettingsSection
      title={t('web.preferences.conversation')}
      note={t('web.preferences.conversationHint')}
      panel
    >
      {/* Not rendered against the defaults and corrected a frame later: every row
          here is a stored value, so a first paint at 1× and 100% for someone who
          set 1.5× and 40% is the panel visibly changing its own mind. Same reason
          `/translate` waits, and the same shape reserved so nothing below moves. */}
      {ready ? (
        <div className="flex flex-col gap-5">
          {/* Direction is a setting HERE and nowhere else. `/translate` names it in
              two permanent panel headers with the swap between them, which is a
              better answer than a row in a popover; this page has no such headers,
              and the direction a new conversation starts in is what it is for. */}
          <DirectionToggle
            value={settings.direction}
            onChange={(direction) => set({ direction })}
            labels={directionLabels(t)}
            nameLanguage={makeLanguageName(t)}
          />

          {/* Which context a NEW conversation starts under, beside the direction
              and the voice it starts with. `running={false}` like everything else
              on this page — there is no conversation here to be fixed by. The
              picker renders nothing at all when the account has authored none —
              or the list is still loading, or failed to — so the ROW around it is
              gated on the same condition: `SettingsSectionRow` draws its label and
              border-b unconditionally, and rendering it over an empty picker put
              a labelled row on every screen with nothing under it. `showLabel`
              is off because this row already draws the name; the picker still
              carries it for assistive tech, `sr-only`. */}
          {status === 'ready' && contexts.length > 0 ? (
            <SettingsSectionRow label={t('web.translate.context')} block>
              <ContextPicker
                contexts={contexts}
                status={status}
                value={settings.contextId}
                running={false}
                showLabel={false}
                onChange={(contextId) => set({ contextId })}
              />
            </SettingsSectionRow>
          ) : null}

          <VoiceSettingsPanel
            settings={settings}
            // No conversation on this page, so the rows that ride
            // `client.session.start` are all editable.
            running={false}
            onChange={set}
            // A no-op here, and deliberately not wired to anything. This prop exists
            // to reach the playback gain node ahead of the debounced write to
            // storage, and on this page there is nothing playing. The value itself
            // still lands, via `onChange` above.
            onVolumeChange={() => {}}
          />

          <Separator />

          {/* Kept on THIS section rather than moved up to the interface one it
              belongs with by subject. `useTranslateSettings` is one call site per
              page, and that section does not have it — giving it its own would be
              a second copy of one storage key, diverging silently. Lifting the hook
              to the page is the real fix and is not this change. */}
          <DisplaySettingsPanel settings={settings} onChange={set} />
        </div>
      ) : (
        <Skeleton aria-hidden className="h-72" />
      )}
    </SettingsSection>
  );
}
