import { TranslateSkeleton } from '@/components/translate/translate-skeleton';

/**
 * The gap before `/translate/two-way` renders: the screen's own shape rather than the
 * route group's generic blocks, so the page body's skeleton takes over from it
 * without a change.
 */
export default function TwoWayTranslateLoading() {
  return <TranslateSkeleton conversationMode="two-way" />;
}
