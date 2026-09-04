'use client';

import { Card, CardContent } from '@chatofy/ui/react';
import { TranslateSettingsPanel } from '@/components/translate/translate-settings-panel';
import { useTranslateSettings } from '@/hooks/use-translate-settings';
import { useTranslate } from '@/i18n/provider';
import { CardEyebrow } from '@/components/layout/card-eyebrow';

/**
 * The same settings panel the translate popover opens, on a page where nothing is live.
 *
 * **One component, two mounts — not two components.** The panel supplies no surface of
 * its own, so the popover gives it `PopoverContent` and this page gives it a `Card`.
 * There is one settings object in storage (`chatofy.translate-settings`), so a "defaults"
 * copy and a "live" copy would be a distinction the storage cannot make and the user
 * would experience as a change that did not take.
 *
 * `running={false}`, and that is the whole honest difference between the two mounts.
 * Direction and voice ride `client.session.start` and cannot be changed inside a
 * conversation, so the popover disables them; here there is no conversation, so they
 * are editable. Nothing else about the panel differs.
 *
 * `useTranslateSettings` is called here, once, in a page-level component. The rule is
 * one call site per PAGE, not one per app: `/translate` and `/preferences` never mount
 * together, so their copies never coexist and cannot diverge. A settings summary in a
 * layout or in the chrome WOULD break that, silently.
 */
export function ConversationPreferencesCard() {
  const t = useTranslate();
  const { settings, set } = useTranslateSettings();

  return (
    <Card>
      <CardContent className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <CardEyebrow>{t('web.preferences.conversation')}</CardEyebrow>
          <p className="text-hint text-muted-foreground max-w-prose">
            {t('web.preferences.conversationHint')}
          </p>
        </div>
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
      </CardContent>
    </Card>
  );
}
