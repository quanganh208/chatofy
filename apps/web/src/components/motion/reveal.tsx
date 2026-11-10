'use client';

import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * Lets a block rise into place the first time it scrolls into view.
 *
 * **Content is there without this.** The first render, the server HTML and anyone who
 * prefers reduced motion all see the block fully visible; only after mount, and only for a
 * block that starts below the fold, is it held back (`opacity-0`, 16px low) and released
 * once it is a little way inside the viewport. A crawler, a print and a script that never
 * runs therefore read the whole page.
 *
 * It plays once per block and never again, so scrolling back up does not replay it.
 * `delay` (ms) staggers siblings that enter together.
 */
export function Reveal({
  children,
  className,
  delay = 0,
  as: Tag = 'div',
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
  /** `li` when the block is a list item, so the list keeps its own children. */
  as?: 'div' | 'li';
}) {
  const ref = useRef<HTMLDivElement & HTMLLIElement>(null);
  const [phase, setPhase] = useState<'rest' | 'held' | 'shown'>('rest');

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    // Already on screen at load: nothing to reveal, and holding it back would flash.
    if (el.getBoundingClientRect().top < window.innerHeight * 0.92) return;

    setPhase('held');
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setPhase('shown');
          observer.disconnect();
        }
      },
      { rootMargin: '0px 0px -8% 0px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <Tag
      ref={ref}
      data-reveal={phase}
      style={phase === 'shown' && delay ? { transitionDelay: `${delay}ms` } : undefined}
      className={cn(
        phase === 'held' && 'translate-y-4 opacity-0',
        phase === 'shown' && 'ease-enter translate-y-0 opacity-100 transition duration-500',
        className,
      )}
    >
      {children}
    </Tag>
  );
}
