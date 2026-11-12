import type { Route } from 'next';
import {
  CreditCard,
  KeyRound,
  Mic,
  Palette,
  Sparkles,
  SlidersHorizontal,
  UserRound,
  type LucideIcon,
} from 'lucide-react';
import type { MessageKey } from '@chatofy/i18n';

/**
 * The seven pages of Settings, in the order the sub-navigation lists them.
 *
 * One list read by three readers: the settings sub-navigation, the topbar
 * breadcrumb (through `nav-items.ts`, so the trail reads Settings › Appearance in
 * the same words the sub-nav highlights) and each page's own title and metadata.
 * A page that existed in one of them and not another is what this prevents.
 *
 * Two groups, split by what the setting belongs to: this person's way of using the
 * app ("Personal"), or the account itself ("Account").
 */
export type SettingsSectionId =
  'appearance' | 'audio' | 'defaults' | 'ai-context' | 'profile' | 'billing' | 'security';

export interface SettingsSectionMeta {
  id: SettingsSectionId;
  /** `Route`, so a section without a page is a compile error rather than a 404. */
  href: Route;
  labelKey: MessageKey;
  descriptionKey: MessageKey;
  icon: LucideIcon;
}

export interface SettingsSectionGroup {
  labelKey: MessageKey;
  sections: readonly SettingsSectionMeta[];
}

export const SETTINGS_SECTION_GROUPS: readonly SettingsSectionGroup[] = [
  {
    labelKey: 'web.settings.groupPersonal',
    sections: [
      {
        id: 'appearance',
        href: '/settings/appearance',
        labelKey: 'web.settings.appearance',
        descriptionKey: 'web.settings.appearanceDescription',
        icon: Palette,
      },
      {
        id: 'audio',
        href: '/settings/audio',
        labelKey: 'web.settings.audio',
        descriptionKey: 'web.settings.audioDescription',
        icon: Mic,
      },
      {
        id: 'defaults',
        href: '/settings/defaults',
        labelKey: 'web.settings.defaults',
        descriptionKey: 'web.settings.defaultsDescription',
        icon: SlidersHorizontal,
      },
      {
        id: 'ai-context',
        href: '/settings/ai-context',
        labelKey: 'web.preferences.aiContext',
        descriptionKey: 'web.preferences.aiContextHint',
        icon: Sparkles,
      },
    ],
  },
  {
    labelKey: 'web.settings.groupAccount',
    sections: [
      {
        id: 'profile',
        href: '/settings/profile',
        labelKey: 'web.settings.profile',
        descriptionKey: 'web.settings.profileDescription',
        icon: UserRound,
      },
      {
        id: 'billing',
        href: '/settings/billing',
        labelKey: 'web.settings.billing',
        descriptionKey: 'web.settings.billingDescription',
        icon: CreditCard,
      },
      {
        id: 'security',
        href: '/settings/security',
        labelKey: 'web.account.security',
        descriptionKey: 'web.settings.securityDescription',
        icon: KeyRound,
      },
    ],
  },
];

/** Every section, flat, in sub-nav order. */
export const SETTINGS_SECTIONS: readonly SettingsSectionMeta[] = SETTINGS_SECTION_GROUPS.flatMap(
  (group) => group.sections,
);

export function settingsSection(id: SettingsSectionId): SettingsSectionMeta {
  const section = SETTINGS_SECTIONS.find((candidate) => candidate.id === id);
  // Unreachable for a typed id; thrown rather than returning undefined so a typo in a
  // new page fails its first render instead of drawing an untitled page.
  if (!section) throw new Error(`Unknown settings section: ${id}`);
  return section;
}
