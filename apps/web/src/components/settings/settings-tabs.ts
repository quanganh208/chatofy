import {
  CreditCard,
  Languages,
  Palette,
  Sparkles,
  UserRound,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { MessageKey } from '@chatofy/i18n';
import type { SettingsTabId } from './settings-tab-ids';

/**
 * What each Settings tab is called and says, grouped as the dialog's navigation lists
 * them. The ids and the URL token live in `settings-tab-ids.ts`, which has no
 * imports, because `next.config.ts` reads them for the legacy redirects.
 *
 * Two groups, split by what the setting belongs to: this person's way of using the
 * app ("Personal"), or the account itself ("Account").
 */
export interface SettingsTabMeta {
  id: SettingsTabId;
  labelKey: MessageKey;
  /** One line under the pane's title saying what the tab holds. */
  descriptionKey: MessageKey;
  icon: LucideIcon;
}

export interface SettingsTabGroup {
  labelKey: MessageKey;
  tabs: readonly SettingsTabMeta[];
}

export const SETTINGS_TAB_GROUPS: readonly SettingsTabGroup[] = [
  {
    labelKey: 'web.settings.groupPersonal',
    tabs: [
      {
        id: 'general',
        labelKey: 'web.settings.general',
        descriptionKey: 'web.settings.appearanceDescription',
        icon: Palette,
      },
      {
        id: 'translation',
        labelKey: 'web.settings.translation',
        descriptionKey: 'web.settings.translationDescription',
        icon: Languages,
      },
      {
        id: 'ai-context',
        labelKey: 'web.preferences.aiContext',
        descriptionKey: 'web.preferences.aiContextDescription',
        icon: Sparkles,
      },
    ],
  },
  {
    labelKey: 'web.settings.groupAccount',
    tabs: [
      {
        id: 'account',
        labelKey: 'web.settings.account',
        descriptionKey: 'web.settings.accountDescription',
        icon: UserRound,
      },
      // In Account because team membership belongs to the account, not to a device.
      {
        id: 'team',
        labelKey: 'web.settings.team',
        descriptionKey: 'web.settings.teamDescription',
        icon: Users,
      },
      {
        id: 'billing',
        labelKey: 'web.settings.billing',
        descriptionKey: 'web.settings.billingDescription',
        icon: CreditCard,
      },
    ],
  },
];

/** Every tab, flat, in navigation order. */
export const SETTINGS_TABS: readonly SettingsTabMeta[] = SETTINGS_TAB_GROUPS.flatMap(
  (group) => group.tabs,
);

export function settingsTab(id: SettingsTabId): SettingsTabMeta {
  const tab = SETTINGS_TABS.find((candidate) => candidate.id === id);
  // Unreachable for a typed id; thrown rather than returning undefined so a typo in a
  // new tab fails its first render instead of drawing an untitled pane.
  if (!tab) throw new Error(`Unknown settings tab: ${id}`);
  return tab;
}
