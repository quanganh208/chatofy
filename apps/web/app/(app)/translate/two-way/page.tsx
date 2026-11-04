import { TranslatePageBody } from '@/components/translate/translate-page-body';

/**
 * Two-way translation: two people, two languages, each turn identified and
 * translated into the other side. One-way is its sibling, `/translate/one-way`.
 */
export default function TwoWayTranslatePage() {
  return <TranslatePageBody conversationMode="two-way" />;
}
