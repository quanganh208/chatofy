import { dawn } from '@chatofy/ui';

/**
 * The head of a content page: the page's one `<h1>`, in the display face, and one line
 * saying what the page is for.
 *
 * It exists because every page below the topbar used to open straight on its content,
 * inside a column far narrower than the window, so the screens read as forms rather than
 * as places. This gives each one a title with some weight and the brand's dawn as a short
 * bar above it, the same bar the conference landing already carries.
 *
 * The bar is decoration only (`aria-hidden`, no text on it or behind it); a dawn value
 * measures 1.3 to 1.7:1 on stone and never carries meaning or a state.
 */
export function PageHeader({ title, description }: { title: string; description: string }) {
  return (
    // Settles in on arrival, so a route change reads as a new page rather than a swap.
    <header className="animate-in fade-in slide-in-from-bottom-2 fill-mode-both flex flex-col gap-3 pb-2 duration-300 motion-reduce:animate-none">
      <span
        aria-hidden
        className="h-1 w-16 rounded-full"
        style={{
          backgroundImage: `linear-gradient(135deg, ${dawn.peach}, ${dawn.lavender}, ${dawn.mint})`,
        }}
      />
      <h1 className="text-title lg:text-display font-display font-light tracking-tight text-balance">
        {title}
      </h1>
      <p className="text-prose text-muted-foreground max-w-[60ch]">{description}</p>
    </header>
  );
}
