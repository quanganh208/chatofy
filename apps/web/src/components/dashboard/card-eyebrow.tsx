/**
 * The small caption above a card's content.
 *
 * `text-label uppercase` is this project's pattern for a tiny caption — see
 * `direction-toggle.tsx` and `segmented-control.tsx` — and it is written once here
 * rather than three times across the hub's cards. It is a caption, not a heading:
 * it names the group below it and never becomes the page's outline.
 */
export function CardEyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-muted-foreground text-label font-semibold tracking-wide uppercase">
      {children}
    </p>
  );
}
