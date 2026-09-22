import { cn } from '@/lib/utils';

/**
 * One band of the landing page, with the anchor the header nav points at.
 *
 * The `id` is not decoration: it is what makes the header's three links work, and an
 * anchor whose target does not exist fails silently and only for the person who clicked
 * it. Section and anchor therefore land together — the same rule the nav items follow.
 *
 * `scroll-mt` because the header is sticky. Without it a jump puts the heading under
 * the header rather than below it, which reads as the link having gone to the wrong
 * place.
 */
export function Section({
  id,
  title,
  description,
  children,
  className,
}: {
  id?: string;
  title?: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section id={id} className={cn('scroll-mt-24 py-16', className)}>
      {title ? (
        <div className="mb-10 flex flex-col gap-3">
          <h2 className="text-title font-display font-light tracking-tight text-balance">
            {title}
          </h2>
          {description ? <p className="text-prose text-body max-w-prose">{description}</p> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}
