import { TranslatePageBody } from '@/components/translate/translate-page-body';

/**
 * One-way translation: a declared source, or one auto-detected turn by turn,
 * translated into the target. Two-way is its sibling, `/translate/two-way`.
 */
export default function OneWayTranslatePage() {
  return <TranslatePageBody conversationMode="one-way" />;
}
