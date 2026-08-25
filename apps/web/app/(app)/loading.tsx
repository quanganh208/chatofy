import { Skeleton } from '@chatofy/ui/react';

/**
 * The gap before a product route renders.
 *
 * Skeletons rather than a spinner: this group's routes resolve to a page of content,
 * and a shape that matches what is coming reads as loading, where a spinner in the
 * middle of an empty page reads as a stall.
 *
 * `motion-reduce` is not needed here — `Skeleton`'s own pulse already carries the
 * escape, applied when the primitive was re-skinned.
 */
export default function AppLoading() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-live="polite">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-32 w-full" />
      <Skeleton className="h-32 w-full" />
    </div>
  );
}
