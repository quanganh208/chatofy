'use client';

import { SettingsSection } from '@/components/layout/settings-section';
import { TranslateSettingsPanel } from '@/components/translate/translate-settings-panel';
import { useTranslateSettings } from '@/hooks/use-translate-settings';
import { useTranslate } from '@/i18n/provider';

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
 * **This is the screen's one elevated surface.** The defaults really are a thing you
 * work on as a unit — you sit down and set them — where the interface rows above are
 * two unrelated switches.
 */
export function ConversationDefaultsSection() {
  const t = useTranslate();
  const { settings, set } = useTranslateSettings();

  return (
    <SettingsSection
      title={t('web.preferences.conversation')}
      note={t('web.preferences.conversationHint')}
      panel
    >
      <TranslateSettingsPanel
        settings={settings}
        running={false}
        onChange={set}
        // A no-op here, and deliberately not wired to anything. This prop exists to
        // reach the playback gain node ahead of the debounced write to storage, and
        // on this page there is nothing playing. The value itself still lands, via
        // `onChange` above.
        onVolumeChange={() => {}}
      />
    </SettingsSection>
  );
}
