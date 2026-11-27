import { Loader2Icon } from 'lucide-react';

import { cn } from '../lib/utils.js';

/**
 * shadcn's `spinner`, re-skinned.
 *
 * Decorative by default here, where upstream gives it `role="status"` and an English
 * "Loading" label. Every caller in this product sits inside a control whose own text
 * already says what is happening ("Signing in…"), so a second live region would make a
 * screen reader announce the same moment twice — once in a language the reader may not
 * have chosen. A caller that shows the spinner alone passes its own `aria-label` and
 * `role`.
 *
 * Under reduced motion it stops turning and stays as a still ring: the text beside it
 * carries the state, so nothing is lost.
 */
function Spinner({ className, ...props }: React.ComponentProps<'svg'>) {
  return (
    <Loader2Icon
      aria-hidden
      data-slot="spinner"
      className={cn('size-4 animate-spin motion-reduce:animate-none', className)}
      {...props}
    />
  );
}

export { Spinner };
