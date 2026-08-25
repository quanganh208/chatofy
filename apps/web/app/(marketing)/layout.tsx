/**
 * The public surface: today just `/`.
 *
 * A pass-through in this phase, and deliberately so. This phase moves files and
 * changes nothing a reader can see, which is what makes reviewing it a single
 * question — "does anything look different?" — instead of a diff-by-diff read.
 * The marketing header lands here in the next phase.
 */
export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return children;
}
